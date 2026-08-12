//! 附件落盘。DESIGN.md §2.1 / §2.3
//!
//! 附件统一放 vault 根的 `attachments/`（§0 的已定决策）。**不按笔记分目录**：
//! 笔记会改名、会移动、会变成别的笔记的子文档（§2.1 的同名文件夹），附件跟着
//! 走的话每一次都要改一堆 `![[]]`；放一处则永远不用动。
//!
//! 重名**不覆盖**，加时间戳后缀。粘贴来的图片十有八九叫 `image.png`，
//! 覆盖掉的是别人笔记里正在用的那一张 —— 这类数据损坏没有撤销。

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result};

use super::Vault;

/// 附件目录，相对 vault 根。§2.3 说过要可配置，暂时先按默认值来
pub const DIR: &str = "attachments";

/// 把 `name` 变成安全的文件名：只留最后一段、去掉路径分隔符和 Windows 保留字符。
///
/// 名字来自剪贴板/拖拽，属于外部输入。`Vault::resolve` 只拦 `..` 和绝对路径，
/// 这里再收一道，保证附件一定落在 `attachments/` 里面。
fn sanitize(name: &str) -> Result<(String, Option<String>)> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, ext) = match base.rsplit_once('.') {
        Some((stem, ext)) if !ext.is_empty() => (stem, Some(ext.to_ascii_lowercase())),
        _ => (base, None),
    };

    let stem: String = stem
        .chars()
        .map(|c| {
            if r#"<>:"/\|?*"#.contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let stem = stem.trim().trim_matches('.').to_string();
    let stem = if stem.is_empty() {
        "image".to_string()
    } else {
        stem
    };
    Ok((stem, ext))
}

fn file_name(stem: &str, ext: Option<&str>) -> String {
    ext.map(|ext| format!("{stem}.{ext}"))
        .unwrap_or_else(|| stem.to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReference {
    pub note: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingAttachment {
    pub path: String,
    pub references: Vec<AttachmentReference>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnusedAttachment {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentAudit {
    pub missing: Vec<MissingAttachment>,
    pub unused: Vec<UnusedAttachment>,
}

fn external(target: &str) -> bool {
    let lower = target.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("data:")
        || lower.starts_with('#')
}

fn normalize_target(note: &str, raw: &str, wiki: bool) -> Option<String> {
    let target = raw.trim().trim_matches(['<', '>']).replace('\\', "/");
    if target.is_empty() || external(&target) {
        return None;
    }
    let target = target.split('#').next()?.split('|').next()?.trim();
    if target.is_empty() {
        return None;
    }
    let bare_attachment = !target.contains('/')
        && Path::new(target).extension().is_some()
        && Path::new(target)
            .extension()?
            .to_string_lossy()
            .to_ascii_lowercase()
            != "md";

    let mut out = PathBuf::new();
    if !wiki && !target.starts_with('/') {
        if let Some(parent) = Path::new(note).parent() {
            out.push(parent);
        }
    }
    for component in Path::new(target.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    let rel = out.to_string_lossy().replace('\\', "/");
    let rel = if rel.contains('/') {
        rel
    } else {
        format!("{DIR}/{rel}")
    };
    (rel.starts_with(&format!("{DIR}/")) && (target.contains('/') || bare_attachment))
        .then_some(rel)
}

fn line_references(line: &str) -> Vec<(String, bool)> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let target = after[..end].split('|').next().unwrap_or_default().trim();
        if !target.is_empty() {
            out.push((target.to_string(), true));
        }
        rest = &after[end + 2..];
    }

    let mut from = 0;
    while let Some(offset) = line[from..].find("](") {
        let start = from + offset + 2;
        let Some(end_offset) = line[start..].find(')') else {
            break;
        };
        let raw = line[start..start + end_offset].trim();
        let target = if let Some(inner) = raw.strip_prefix('<') {
            inner.split('>').next().unwrap_or_default()
        } else {
            raw.split_whitespace().next().unwrap_or_default()
        };
        if !target.is_empty() {
            out.push((target.to_string(), false));
        }
        from = start + end_offset + 1;
    }
    out
}

fn outside_inline_code(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = line;
    loop {
        let Some(start) = rest.find('`') else {
            out.push(rest);
            break;
        };
        out.push(&rest[..start]);
        let ticks = rest[start..].chars().take_while(|c| *c == '`').count();
        let after = &rest[start + ticks..];
        let marker = "`".repeat(ticks);
        let Some(end) = after.find(&marker) else {
            break;
        };
        rest = &after[end + ticks..];
    }
    out
}

/// frontmatter 的 `cover: attachments/x.png` 不是 Markdown 链接，但同样是有效
/// 使用者。宁可把正文里手写的一段路径也算作“在用”，不能误删封面。
fn plain_attachment_paths(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(offset) = line[from..].find(&format!("{DIR}/")) {
        let start = from + offset;
        let token_start = line[..start]
            .rfind(char::is_whitespace)
            .map(|index| index + 1)
            .unwrap_or(0);
        if line[token_start..start].contains("://") {
            from = start + DIR.len() + 1;
            continue;
        }
        let end = line[start..]
            .find(|c: char| c.is_whitespace() || r#")]}>"',|#"#.contains(c))
            .map(|offset| start + offset)
            .unwrap_or(line.len());
        let path = line[start..end]
            .trim_end_matches(['.', ';', ':'])
            .replace('\\', "/");
        if path.len() > DIR.len() + 1 {
            out.push(path);
        }
        from = end.max(start + DIR.len() + 1);
    }
    out
}

fn references(note: &str, text: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut fence: Option<char> = None;
    for (index, line) in text.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let marker = trimmed.chars().next().unwrap();
            if fence == Some(marker) {
                fence = None;
            } else if fence.is_none() {
                fence = Some(marker);
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        for segment in outside_inline_code(line) {
            for (target, wiki) in line_references(segment) {
                if let Some(rel) = normalize_target(note, &target, wiki) {
                    out.push((rel, index + 1));
                }
            }
            for path in plain_attachment_paths(segment) {
                out.push((path, index + 1));
            }
        }
    }
    out
}

impl Vault {
    /// 写一个附件，返回它的 **vault 相对路径**（正斜杠），供前端拼 `![[]]`。
    pub fn write_attachment(&self, name: &str, bytes: &[u8]) -> Result<String> {
        if bytes.is_empty() {
            return Err(Error::Vault("附件是空的".into()));
        }
        let (stem, ext) = sanitize(name)?;

        let dir_abs = self.resolve(DIR)?;
        self.fs.create_dir_all(&dir_abs)?;

        let mut rel = format!("{DIR}/{}", file_name(&stem, ext.as_deref()));
        if self.fs.exists(&self.resolve(&rel)?) {
            // 重名不覆盖。时间戳到秒够用了，同一秒里连粘两张同名图的话
            // 后面还有一层计数
            let stamp = chrono::Local::now().format("%Y%m%d%H%M%S");
            rel = format!(
                "{DIR}/{}",
                file_name(&format!("{stem}-{stamp}"), ext.as_deref())
            );
            let mut n = 2;
            while self.fs.exists(&self.resolve(&rel)?) {
                rel = format!(
                    "{DIR}/{}",
                    file_name(&format!("{stem}-{stamp}-{n}"), ext.as_deref())
                );
                n += 1;
            }
        }

        self.fs.write_bytes(&self.resolve(&rel)?, bytes)?;
        Ok(rel)
    }

    pub fn attachment_audit(&self) -> Result<AttachmentAudit> {
        let mut used: BTreeMap<String, Vec<AttachmentReference>> = BTreeMap::new();
        for note in self.note_list()? {
            let body = self.fs.read_to_string(&self.resolve(&note.path)?)?;
            let mut seen = BTreeSet::new();
            for (path, line) in references(&note.path, &body) {
                if !seen.insert((path.clone(), line)) {
                    continue;
                }
                used.entry(path).or_default().push(AttachmentReference {
                    note: note.path.clone(),
                    line,
                });
            }
        }

        let mut existing = BTreeMap::new();
        let dir = self.resolve(DIR)?;
        if self.fs.is_dir(&dir) {
            for entry in self.fs.read_dir(&dir)? {
                if entry.is_dir {
                    continue;
                }
                let path = format!("{DIR}/{}", entry.name);
                existing.insert(path.clone(), self.fs.metadata(&self.resolve(&path)?)?.size);
            }
        }

        let missing = used
            .iter()
            .filter_map(|(path, refs)| {
                (!existing.contains_key(path)).then(|| MissingAttachment {
                    path: path.clone(),
                    references: refs.clone(),
                })
            })
            .collect();
        let unused = existing
            .into_iter()
            .filter_map(|(path, size)| {
                (!used.contains_key(&path)).then_some(UnusedAttachment { path, size })
            })
            .collect();
        Ok(AttachmentAudit { missing, unused })
    }

    /// 真删之前重新体检；只删除此刻仍未被引用的附件。
    pub fn attachment_delete_unused(&self, paths: &[String]) -> Result<Vec<String>> {
        let unused: BTreeSet<String> = self
            .attachment_audit()?
            .unused
            .into_iter()
            .map(|item| item.path)
            .collect();
        let mut deleted = Vec::new();
        for path in paths {
            let rel = path.replace('\\', "/");
            if !rel.starts_with(&format!("{DIR}/")) || !unused.contains(&rel) {
                continue;
            }
            let abs = self.resolve(&rel)?;
            if self.fs.exists(&abs) {
                self.fs.remove_file(&abs)?;
                deleted.push(rel);
            }
        }
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 重名不覆盖 —— 粘贴来的图十有八九叫同一个名字，
    /// 覆盖掉的是别的笔记正在用的那一张，这类损坏没有撤销
    #[test]
    fn writes_into_attachments_and_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("verso-att-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let (v, _) = Vault::open(dir.clone()).unwrap();

        let a = v.write_attachment("图.png", &[1, 2, 3]).unwrap();
        assert_eq!(a, "attachments/图.png");
        assert_eq!(
            std::fs::read(dir.join("attachments/图.png")).unwrap(),
            vec![1, 2, 3]
        );

        let b = v.write_attachment("图.png", &[4, 5, 6]).unwrap();
        assert_ne!(b, a, "重名要另起一个");
        assert_eq!(
            std::fs::read(dir.join("attachments/图.png")).unwrap(),
            vec![1, 2, 3]
        );

        assert!(v.write_attachment("空.png", &[]).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn takes_arbitrary_regular_files() {
        assert!(sanitize("图.PNG").is_ok());
        assert!(sanitize("资料.pdf").is_ok());
        assert!(sanitize("没有扩展名").is_ok());
    }

    /// 名字来自剪贴板，属于外部输入 —— 分隔符和 Windows 保留字符都得挡掉，
    /// 否则附件可能落到 `attachments/` 外面去
    #[test]
    fn sanitizes_hostile_names() {
        assert_eq!(
            sanitize("../../跑出去.png").unwrap(),
            ("跑出去".into(), Some("png".into()))
        );
        assert_eq!(
            sanitize(r"C:\Windows\x.png").unwrap(),
            ("x".into(), Some("png".into()))
        );
        assert_eq!(
            sanitize("a:b|c?.png").unwrap(),
            ("a-b-c-".into(), Some("png".into()))
        );
        // 清干净之后什么都不剩，也得有个名字
        assert_eq!(sanitize("...png").unwrap().0, "image");
    }

    #[test]
    fn audits_missing_and_unused_and_skips_code_examples() {
        let dir = std::env::temp_dir().join(format!("verso-att-audit-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let (v, _) = Vault::open(dir.clone()).unwrap();
        std::fs::write(
            dir.join("一.md"),
            "---\n封面: attachments/封面.png\n---\n![[attachments/有.png]]\n[资料](attachments/缺.pdf)\n`![[attachments/行内示例.png]]`\n```\n![[attachments/示例.png]]\n```\n",
        )
        .unwrap();
        std::fs::create_dir_all(dir.join(DIR)).unwrap();
        std::fs::write(dir.join("attachments/有.png"), b"x").unwrap();
        std::fs::write(dir.join("attachments/封面.png"), b"cover").unwrap();
        std::fs::write(dir.join("attachments/闲.pdf"), b"unused").unwrap();

        let audit = v.attachment_audit().unwrap();
        assert_eq!(audit.missing[0].path, "attachments/缺.pdf");
        assert_eq!(audit.missing[0].references[0].line, 5);
        assert_eq!(audit.unused[0].path, "attachments/闲.pdf");

        // 面板打开后才新加引用：删除命令必须重新扫描，不能照旧删。
        std::fs::write(
            dir.join("一.md"),
            "![[attachments/有.png]]\n[[attachments/闲.pdf]]\n",
        )
        .unwrap();
        let deleted = v
            .attachment_delete_unused(&["attachments/闲.pdf".into()])
            .unwrap();
        assert!(deleted.is_empty());
        assert!(dir.join("attachments/闲.pdf").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
