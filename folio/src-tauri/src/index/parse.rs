//! 从 Markdown 里抽出索引需要的东西：链接、标签、属性。
//!
//! ## 为什么 Rust 这边也要一份解析器
//!
//! §1 的技术栈表里写了「两处都要解析，用途不同」：前端的 `@lezer/markdown`
//! 服务于**当前打开的这一篇**（增量、要产语法树给 live preview 用），
//! 这里的服务于**全库索引**（一次扫几千篇，只要结果不要树）。
//!
//! 两者的方言必须保持一致 —— 改了 `markdownExtended.ts` 里的语法，
//! 这里也要跟着改。有意做得简单：只做行扫描，不建树。

use serde_yaml::{Mapping, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub target_text: String,
    /// `[[笔记#标题]]` 里的锚点，或 `[[笔记#^块id]]`
    pub block_id: Option<String>,
    pub kind: LinkKind,
    /// 1 起算，给「跳到出处」用
    pub line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Wiki,
    Embed,
}

impl LinkKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkKind::Wiki => "wiki",
            LinkKind::Embed => "embed",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Parsed {
    pub links: Vec<Link>,
    pub tags: Vec<String>,
}

/// CJK 与全角标点。与 `markdownExtended.ts` 里的同名判断保持一致 ——
/// 否则同一篇笔记在编辑器里高亮成标签、在索引里却不算，反向链接就对不上。
fn is_cjk_punctuation(ch: char) -> bool {
    let c = ch as u32;
    (0x2010..=0x206f).contains(&c)
        || (0x3000..=0x303f).contains(&c)
        || (0xfe10..=0xfe6f).contains(&c)
        || (0xff00..=0xff0f).contains(&c)
        || (0xff1a..=0xff20).contains(&c)
        || (0xff3b..=0xff40).contains(&c)
        || (0xff5b..=0xff65).contains(&c)
}

fn is_tag_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
        || ch == '/'
        || ch == '-'
        || ch == '_'
        || (!ch.is_ascii() && !is_cjk_punctuation(ch))
}

/// 扫一遍正文，抽出链接与标签。
///
/// 跳过围栏代码块、行内代码和公式 —— 那些地方的 `[[` 和 `#` 不是语法。
/// 少了这一步，一篇讲 Markdown 语法的笔记会把自己的示例代码全索引成链接。
pub fn scan_body(body: &str) -> Parsed {
    let mut out = Parsed::default();
    let mut in_fence = false;
    let mut fence_marker = ' ';

    for (idx, raw_line) in body.lines().enumerate() {
        let line_no = idx + 1;
        let trimmed = raw_line.trim_start();

        // 围栏代码块
        if let Some(marker) = trimmed.chars().next() {
            if (marker == '`' || marker == '~') && trimmed.starts_with(&marker.to_string().repeat(3))
            {
                if in_fence && marker == fence_marker {
                    in_fence = false;
                } else if !in_fence {
                    in_fence = true;
                    fence_marker = marker;
                }
                continue;
            }
        }
        if in_fence {
            continue;
        }

        scan_line(raw_line, line_no, &mut out);
    }

    out.tags.sort();
    out.tags.dedup();
    out
}

fn scan_line(line: &str, line_no: usize, out: &mut Parsed) {
    let chars: Vec<char> = line.chars().collect();
    let n = chars.len();
    let mut i = 0;

    while i < n {
        match chars[i] {
            // 行内代码：整段跳过
            '`' => {
                i += 1;
                while i < n && chars[i] != '`' {
                    i += 1;
                }
                i += 1;
            }
            // 公式：整段跳过。`$` 未闭合时只跳过它自己，避免吃掉整行
            '$' => {
                let mut j = i + 1;
                while j < n && chars[j] != '$' {
                    j += 1;
                }
                i = if j < n { j + 1 } else { i + 1 };
            }
            '\\' => i += 2, // 转义，跳过下一个字符
            '!' if i + 2 < n && chars[i + 1] == '[' && chars[i + 2] == '[' => {
                i = read_wiki_link(&chars, i, i + 3, LinkKind::Embed, line_no, out);
            }
            '[' if i + 1 < n && chars[i + 1] == '[' => {
                i = read_wiki_link(&chars, i, i + 2, LinkKind::Wiki, line_no, out);
            }
            '#' => {
                // 前一个字符是标签字符就说明在词中间，不是标签
                if i > 0 && is_tag_char(chars[i - 1]) {
                    i += 1;
                    continue;
                }
                let mut j = i + 1;
                let mut has_non_digit = false;
                while j < n && is_tag_char(chars[j]) {
                    if !chars[j].is_ascii_digit() {
                        has_non_digit = true;
                    }
                    j += 1;
                }
                // 纯数字不是标签（`#1` 通常是编号或 issue 引用）
                if j > i + 1 && has_non_digit {
                    out.tags.push(chars[i + 1..j].iter().collect());
                }
                i = j.max(i + 1);
            }
            _ => i += 1,
        }
    }
}

/// 从 `content_start` 开始读到 `]]`，返回下一个扫描位置
fn read_wiki_link(
    chars: &[char],
    start: usize,
    content_start: usize,
    kind: LinkKind,
    line_no: usize,
    out: &mut Parsed,
) -> usize {
    let n = chars.len();
    let mut j = content_start;
    while j + 1 < n && !(chars[j] == ']' && chars[j + 1] == ']') {
        // 中途又遇到 `[[`，说明前一个没闭合。放弃它，让外层扫描器从下一个
        // 字符继续，最终会命中里面那个真正闭合的链接。
        // 少了这一步，`[[没闭合 然后 [[真的]]` 会被贪婪匹配成一整条。
        if chars[j] == '[' && j + 1 < n && chars[j + 1] == '[' {
            return start + 1;
        }
        j += 1;
    }
    if j + 1 >= n {
        return start + 1; // 没有闭合，当普通字符处理
    }

    let inner: String = chars[content_start..j].iter().collect();
    if !inner.is_empty() {
        // `|` 之后是显示别名，索引只关心目标
        let target_part = inner.split('|').next().unwrap_or("").trim();
        // `#` 之后是标题锚点或块引用
        let mut it = target_part.splitn(2, '#');
        let target_text = it.next().unwrap_or("").trim().to_string();
        let block_id = it.next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        if !target_text.is_empty() {
            out.links.push(Link {
                target_text,
                block_id,
                kind,
                line: line_no,
            });
        }
    }
    j + 2
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prop {
    pub key: String,
    pub value: String,
    pub num: Option<f64>,
    pub kind: &'static str,
}

/// 把 frontmatter 摊平成键值对 —— database 视图的数据来源（§2.6）。
///
/// 数组会展开成多行（一个标签一行），这样 `where tags = "数学"` 才查得到。
pub fn flatten_props(fm: &Mapping) -> Vec<Prop> {
    let mut out = Vec::new();
    for (k, v) in fm {
        let Some(key) = k.as_str() else { continue };
        // 这几个是内部字段，不作为用户属性暴露给 database 视图
        if matches!(key, "id" | "created" | "updated") {
            continue;
        }
        push_value(key, v, &mut out);
    }
    out
}

fn push_value(key: &str, v: &Value, out: &mut Vec<Prop>) {
    match v {
        Value::Sequence(items) => {
            for item in items {
                push_value(key, item, out);
            }
        }
        Value::String(s) => out.push(Prop {
            key: key.into(),
            value: s.clone(),
            // 日期形状的字符串也存一份数值，排序才对
            num: None,
            kind: if looks_like_date(s) { "date" } else { "string" },
        }),
        Value::Number(nv) => out.push(Prop {
            key: key.into(),
            value: nv.to_string(),
            num: nv.as_f64(),
            kind: "number",
        }),
        Value::Bool(b) => out.push(Prop {
            key: key.into(),
            value: b.to_string(),
            num: Some(if *b { 1.0 } else { 0.0 }),
            kind: "bool",
        }),
        Value::Null => {}
        _ => out.push(Prop {
            key: key.into(),
            value: serde_yaml::to_string(v).unwrap_or_default().trim().to_string(),
            num: None,
            kind: "string",
        }),
    }
}

fn looks_like_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..10].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(body: &str) -> Vec<String> {
        scan_body(body).links.into_iter().map(|l| l.target_text).collect()
    }

    #[test]
    fn extracts_wiki_links() {
        assert_eq!(targets("见 [[线性代数]] 与 [[特征值]]"), vec!["线性代数", "特征值"]);
    }

    #[test]
    fn alias_and_anchor_are_stripped_from_target() {
        let p = scan_body("[[特征值|左奇异向量]] 与 [[线性代数#奇异值分解]]");
        assert_eq!(p.links[0].target_text, "特征值");
        assert_eq!(p.links[1].target_text, "线性代数");
        assert_eq!(p.links[1].block_id.as_deref(), Some("奇异值分解"));
    }

    #[test]
    fn embeds_are_distinguished() {
        let p = scan_body("![[fig.png]] 和 [[笔记]]");
        assert_eq!(p.links[0].kind, LinkKind::Embed);
        assert_eq!(p.links[1].kind, LinkKind::Wiki);
    }

    #[test]
    fn records_line_numbers() {
        let p = scan_body("第一行\n\n见 [[目标]]\n");
        assert_eq!(p.links[0].line, 3);
    }

    /// 一篇讲 Markdown 语法的笔记会在代码块里写示例。把那些索引成真链接，
    /// 反向链接面板就全是噪音。
    #[test]
    fn skips_fenced_code_blocks() {
        let body = "真链接 [[甲]]\n\n```md\n[[假链接]]\n#假标签\n```\n\n又一个 [[乙]]";
        let p = scan_body(body);
        assert_eq!(
            p.links.iter().map(|l| l.target_text.as_str()).collect::<Vec<_>>(),
            vec!["甲", "乙"]
        );
        assert_eq!(p.tags, Vec::<String>::new());
    }

    #[test]
    fn skips_inline_code_and_math() {
        assert_eq!(targets("`[[代码里]]` 和 [[真的]]"), vec!["真的"]);
        assert_eq!(scan_body("$a\\#b$ 与 #真标签").tags, vec!["真标签"]);
    }

    #[test]
    fn extracts_tags_including_chinese_and_nested() {
        let p = scan_body("标签：#线性代数 #数学/矩阵分解 #tag-1");
        assert_eq!(p.tags, vec!["tag-1", "数学/矩阵分解", "线性代数"]);
    }

    /// 与前端解析器保持一致：全角冒号不是标签字符，中文标点终止标签
    #[test]
    fn tag_rules_match_the_frontend_parser() {
        assert_eq!(scan_body("标签：#甲").tags, vec!["甲"]);
        assert_eq!(scan_body("这是 #甲。下一句").tags, vec!["甲"]);
        assert_eq!(scan_body("语言 C# 和 F#").tags, Vec::<String>::new());
        assert_eq!(scan_body("见条目 #1 和 #2026").tags, Vec::<String>::new());
    }

    #[test]
    fn tags_are_deduped() {
        assert_eq!(scan_body("#甲 #甲 #甲").tags, vec!["甲"]);
    }

    #[test]
    fn unterminated_link_does_not_eat_the_rest() {
        assert_eq!(targets("[[没有闭合 然后 [[真的]]"), vec!["真的"]);
    }

    #[test]
    fn flattens_frontmatter_into_props() {
        let fm: Mapping = serde_yaml::from_str(
            "title: 甲\ntags: [数学, 矩阵]\n难度: 4\n完成: true\ncreated: 2026-01-01\n",
        )
        .unwrap();
        let props = flatten_props(&fm);

        let get = |k: &str| -> Vec<&Prop> { props.iter().filter(|p| p.key == k).collect() };

        // 数组展开成多行，`where tags = "数学"` 才查得到
        assert_eq!(get("tags").len(), 2);
        assert_eq!(get("难度")[0].num, Some(4.0));
        assert_eq!(get("难度")[0].kind, "number");
        assert_eq!(get("完成")[0].kind, "bool");
        // created 是内部字段，不暴露给 database 视图
        assert!(get("created").is_empty());
    }

    #[test]
    fn detects_date_shaped_strings() {
        let fm: Mapping = serde_yaml::from_str("截止: \"2026-07-31\"\n").unwrap();
        assert_eq!(flatten_props(&fm)[0].kind, "date");
    }
}
