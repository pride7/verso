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

/// 新笔记的初始 frontmatter。
///
/// `id` 用 ULID：重命名/移动后链接不断，且按时间有序、索引局部性好。
/// 时间戳带时区，不依赖文件系统 mtime —— 同步工具会破坏 mtime。
pub fn new_frontmatter(title: &str) -> Mapping {
    let mut m = Mapping::new();
    ensure_identity(&mut m, title);
    touch_updated(&mut m);
    m
}

/// 补齐 `id` / `title` / `created`，已有的不动。
///
/// 从别处拿来的 `.md`（Obsidian vault、git clone、AI 生成的文件）通常没有
/// frontmatter。首次保存时必须补上 `id`，否则这篇笔记没有稳定标识，
/// 一重命名链接就断了 —— 这正是 §2.3 用 ULID 的理由。
pub fn ensure_identity(frontmatter: &mut Mapping, fallback_title: &str) {
    if !frontmatter.contains_key("id") {
        frontmatter.insert("id".into(), ulid::Ulid::new().to_string().into());
    }
    if !frontmatter.contains_key("title") {
        frontmatter.insert("title".into(), fallback_title.into());
    }
    if !frontmatter.contains_key("created") {
        frontmatter.insert("created".into(), now_rfc3339().into());
    }
}

pub fn touch_updated(frontmatter: &mut Mapping) {
    frontmatter.insert("updated".into(), now_rfc3339().into());
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

    #[test]
    fn new_note_has_ulid_and_timestamps() {
        let fm = new_frontmatter("测试");
        assert_eq!(get_str(&fm, "id").unwrap().len(), 26); // ULID 固定 26 字符
        assert_eq!(get_str(&fm, "title").as_deref(), Some("测试"));
        assert!(fm.contains_key("created") && fm.contains_key("updated"));
    }
}
