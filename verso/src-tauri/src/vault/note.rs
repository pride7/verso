//! 笔记的读写与 frontmatter 处理。DESIGN.md §2.3

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

/// 拆分 frontmatter 与正文。
///
/// 只认「文件**第一行**就是 `---`」这一种形式。宽松匹配会把正文里
/// 合法的水平分隔线误当成 frontmatter，从而吃掉用户内容。
pub fn split_frontmatter(raw: &str) -> (Option<&str>, &str) {
    // 允许 UTF-8 BOM —— Windows 上的编辑器常留
    let s = raw.strip_prefix('\u{feff}').unwrap_or(raw);

    let rest = match s.strip_prefix("---\n") {
        Some(r) => r,
        None => match s.strip_prefix("---\r\n") {
            Some(r) => r,
            None => return (None, s),
        },
    };

    // 找闭合的 `---` 行
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == "---" || trimmed == "..." {
            let fm = &rest[..offset];
            let body = &rest[offset + line.len()..];
            return (Some(fm), body);
        }
        offset += line.len();
    }

    // 没有闭合标记 —— 不是 frontmatter，整体当正文，别把内容吞掉
    (None, s)
}

pub fn parse_frontmatter(raw: &str) -> (Mapping, String) {
    let (fm, body) = split_frontmatter(raw);
    let map = fm
        .and_then(|s| serde_yaml::from_str::<Value>(s).ok())
        .and_then(|v| match v {
            Value::Mapping(m) => Some(m),
            _ => None, // frontmatter 不是键值映射就忽略，不报错
        })
        .unwrap_or_default();
    (map, body.to_string())
}

pub fn serialize_note(frontmatter: &Mapping, body: &str) -> Result<String, serde_yaml::Error> {
    if frontmatter.is_empty() {
        return Ok(body.to_string());
    }
    let yaml = serde_yaml::to_string(&Value::Mapping(frontmatter.clone()))?;
    Ok(format!("---\n{}---\n{}", yaml, body))
}

/// 秒级精度即可。默认的 `to_rfc3339()` 会带 9 位小数，在 git diff 里
/// 每次保存都是一行噪音。
fn now_rfc3339() -> String {
    Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

/// 刷新 `updated` —— **只在这个键已经存在时**。
///
/// ## 为什么不主动加
///
/// Verso 不往用户的文件里塞任何他没要求的东西（§2.3）。以前每次保存都会补齐
/// `id` / `title` / `created` / `updated`，于是一篇只写了两行字的笔记，文件头上
/// 永远顶着五行 YAML —— 而这些字段里真正被用到的只有排序，`id` 连链接解析都
/// 没走它（那条「按历史 id 自动修链」至今没实现）。
///
/// 现在的规则一句话：**文件里已经有的字段照常维护，没有的不添。** 想要时间戳
/// 就自己写一行 `updated:`，之后每次保存它都会刷新；不想要就删掉，删了不再长
/// 回来。文档树按时间排序在没有这些字段时回落到文件系统 mtime。
pub fn touch_updated(frontmatter: &mut Mapping) {
    let key: Value = "updated".into();
    if frontmatter.contains_key(&key) {
        frontmatter.insert(key, now_rfc3339().into());
    }
}

pub fn get_str(frontmatter: &Mapping, key: &str) -> Option<String> {
    frontmatter.get(key).and_then(|v| match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    /// 相对 vault 根的路径
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    /// frontmatter 原样回传给前端（M1 的属性表单要用）
    pub frontmatter: serde_json::Value,
    /// frontmatter 在文件里的**原文**（两道 `---` 之间那段，不含 `---` 本身）。
    ///
    /// 上面那个 `frontmatter` 是解析后的映射，键序、缩进、注释全没了 ——
    /// 源码模式（§4.2）要给人看的恰恰是文件里真实的样子，所以另存一份原文。
    /// 没有 frontmatter 的笔记是 `None`。
    pub frontmatter_text: Option<String>,
    pub body: String,
    pub mtime_ms: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_frontmatter() {
        let raw = "---\ntitle: 奇异值分解\ntags: [线性代数]\n---\n正文第一行\n";
        let (fm, body) = parse_frontmatter(raw);
        assert_eq!(get_str(&fm, "title").as_deref(), Some("奇异值分解"));
        assert_eq!(body, "正文第一行\n");
    }

    #[test]
    fn note_without_frontmatter_is_all_body() {
        let raw = "就是一段普通笔记\n";
        let (fm, body) = parse_frontmatter(raw);
        assert!(fm.is_empty());
        assert_eq!(body, raw);
    }

    /// 关键的不吞内容用例：正文里的 `---` 是合法的水平分隔线，
    /// 宽松匹配会把它当成 frontmatter 起始，吃掉用户内容。
    #[test]
    fn horizontal_rule_in_body_is_not_frontmatter() {
        let raw = "上面一段\n\n---\n\n下面一段\n";
        let (fm, body) = parse_frontmatter(raw);
        assert!(fm.is_empty());
        assert_eq!(body, raw, "正文必须原样保留");
    }

    /// 只有开头的 `---` 没有闭合 —— 同样不能当 frontmatter，否则丢正文
    #[test]
    fn unterminated_frontmatter_is_treated_as_body() {
        let raw = "---\ntitle: 没关\n还有正文\n";
        let (fm, body) = parse_frontmatter(raw);
        assert!(fm.is_empty());
        assert_eq!(body, raw);
    }

    #[test]
    fn handles_crlf_and_bom() {
        let raw = "\u{feff}---\r\ntitle: 中文\r\n---\r\n正文\r\n";
        let (fm, body) = parse_frontmatter(raw);
        assert_eq!(get_str(&fm, "title").as_deref(), Some("中文"));
        assert_eq!(body, "正文\r\n");
    }

    #[test]
    fn roundtrips() {
        let raw = "---\ntitle: 甲\n---\n正文\n";
        let (fm, body) = parse_frontmatter(raw);
        let out = serialize_note(&fm, &body).unwrap();
        let (fm2, body2) = parse_frontmatter(&out);
        assert_eq!(get_str(&fm2, "title"), get_str(&fm, "title"));
        assert_eq!(body2, body);
    }

    /// §2.3：Verso 不往用户文件里塞他没要求的字段。
    /// `updated` 只在已经存在时刷新，不存在就不添。
    #[test]
    fn touch_updated_only_refreshes_an_existing_key() {
        let mut bare = Mapping::new();
        touch_updated(&mut bare);
        assert!(bare.is_empty(), "没有 updated 就不该凭空造一个");

        let (mut fm, _) = parse_frontmatter("---
updated: 2020-01-01T00:00:00+08:00
---
");
        touch_updated(&mut fm);
        assert_ne!(
            get_str(&fm, "updated").as_deref(),
            Some("2020-01-01T00:00:00+08:00"),
            "已经有的要刷新"
        );
    }

    /// 空 frontmatter 序列化出来必须是**纯正文**，一道 `---` 都不留 ——
    /// 「源码模式里把整块删干净」最终落到这里
    #[test]
    fn empty_frontmatter_serializes_to_bare_body() {
        assert_eq!(serialize_note(&Mapping::new(), "只有正文
").unwrap(), "只有正文
");
    }
}
