pub mod fs;
pub mod git;
pub mod note;
pub mod ops;
pub mod tree;

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_yaml::Mapping;

use crate::error::{Error, Result};
use fs::{DesktopFs, VaultFs};
use note::NoteContent;
use tree::TreeNode;

pub struct Vault {
    pub root: PathBuf,
    pub fs: Arc<dyn VaultFs>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
    pub created_repo: bool,
    pub created_gitignore: bool,
    /// 把早期版本建出来的空仓库从 master 迁到了 main
    pub renamed_branch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub path: String,
    pub id: String,
    pub title: String,
}

/// 快速切换器用的轻量条目。不含 id/时间戳 —— 那些数据量在大 vault 里
/// 会让一次性全量传输变得昂贵，而模糊匹配只需要名字和路径。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub path: String,
    pub name: String,
}

impl Vault {
    /// 用共享的「自己写入」登记表打开 —— 文件监听靠它区分「我改的」和
    /// 「外部程序改的」（§2.7）
    pub fn open_watched(
        root: PathBuf,
        self_writes: std::sync::Arc<crate::watcher::SelfWrites>,
    ) -> Result<(Self, VaultInfo)> {
        let (mut v, info) = Self::open(root)?;
        v.fs = Arc::new(DesktopFs::with_self_writes(self_writes));
        Ok((v, info))
    }

    pub fn open(root: PathBuf) -> Result<(Self, VaultInfo)> {
        if !root.is_dir() {
            return Err(Error::Vault(format!("不是一个目录: {}", root.display())));
        }
        // 规范化，否则 `..` 之类会让后面的越界检查失效
        let root = root.canonicalize()?;

        let g = git::ensure_repo(&root)?;
        let info = VaultInfo {
            root: root.to_string_lossy().into_owned(),
            name: root
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "vault".into()),
            created_repo: g.created_repo,
            created_gitignore: g.created_gitignore,
            renamed_branch: g.renamed_branch,
        };

        Ok((
            Vault {
                root,
                fs: Arc::new(DesktopFs::new()),
            },
            info,
        ))
    }

    /// 把前端传来的相对路径解析成绝对路径，并**拒绝任何越界**。
    ///
    /// 这是唯一的防线。前端传 `../../Windows/System32/...` 不应该能读到
    /// vault 以外的东西 —— 尤其考虑到笔记内容可以来自分享和发布（§2.9），
    /// 路径不能当作可信输入。
    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let rel_path = Path::new(rel);
        if rel_path.is_absolute() {
            return Err(Error::PathEscape(rel.to_string()));
        }

        let mut out = self.root.clone();
        for comp in rel_path.components() {
            match comp {
                Component::Normal(c) => out.push(c),
                Component::CurDir => {}
                // 不做「弹出上一级」的宽容处理：正常操作不会产生 `..`，
                // 出现即视为攻击或 bug，直接拒绝。
                Component::ParentDir => return Err(Error::PathEscape(rel.to_string())),
                Component::RootDir | Component::Prefix(_) => {
                    return Err(Error::PathEscape(rel.to_string()))
                }
            }
        }
        Ok(out)
    }

    pub fn tree(&self) -> Result<Vec<TreeNode>> {
        tree::scan(self.fs.as_ref(), &self.root, "")
    }

    pub fn read_note(&self, rel: &str) -> Result<NoteContent> {
        let abs = self.resolve(rel)?;
        let raw = self.fs.read_to_string(&abs)?;
        let (fm, body) = note::parse_frontmatter(&raw);
        let meta = self.fs.metadata(&abs)?;

        let title = note::get_str(&fm, "title").unwrap_or_else(|| stem_of(rel));

        Ok(NoteContent {
            path: rel.to_string(),
            id: note::get_str(&fm, "id"),
            title,
            frontmatter: mapping_to_json(&fm),
            body,
            mtime_ms: meta.mtime_ms,
        })
    }

    /// 保存正文。frontmatter 从磁盘上的旧版本继承 —— M0 的编辑器只编辑正文，
    /// 属性表单是 M1 的事。
    ///
    /// 返回写入后的 mtime，前端存下来用于「窗口重新聚焦时比对是否被外部改过」
    /// （§7.4 —— 有了终端跑 AI 之后，这是会丢数据的路径）。
    pub fn write_note(&self, rel: &str, body: &str) -> Result<i64> {
        let abs = self.resolve(rel)?;

        let mut fm: Mapping = if self.fs.exists(&abs) {
            let raw = self.fs.read_to_string(&abs)?;
            note::parse_frontmatter(&raw).0
        } else {
            Mapping::new()
        };
        // 外来的 .md 通常没有 frontmatter，首次保存时补上 id，
        // 否则这篇笔记没有稳定标识，重命名后链接会断。
        note::ensure_identity(&mut fm, &stem_of(rel));
        note::touch_updated(&mut fm);

        let out = note::serialize_note(&fm, body)?;
        self.fs.write_atomic(&abs, &out)?;
        Ok(self.fs.metadata(&abs)?.mtime_ms)
    }

    /// 新建文档。`parent_doc` 是父文档的 `.md` 相对路径（None = 建在 vault 根）。
    ///
    /// 有父文档时会按 §2.1 建出同名文件夹：父文档 `X.md` 的子文档放进 `X/`。
    pub fn create_note(&self, parent_doc: Option<&str>, title: &str) -> Result<NoteMeta> {
        let title = ops::validate_title(title)?;

        let dir_rel = match parent_doc {
            None => String::new(),
            Some(p) => {
                // 父文档 `数学/线性代数.md` → 子文档目录 `数学/线性代数`
                let d = p
                    .strip_suffix(".md")
                    .ok_or_else(|| Error::Vault(format!("父节点不是文档: {p}")))?
                    .to_string();
                self.fs.create_dir_all(&self.resolve(&d)?)?;
                d
            }
        };

        let rel = if dir_rel.is_empty() {
            format!("{title}.md")
        } else {
            format!("{dir_rel}/{title}.md")
        };

        let abs = self.resolve(&rel)?;
        if self.fs.exists(&abs) {
            return Err(Error::Vault(format!("已存在同名文档: {rel}")));
        }

        let fm = note::new_frontmatter(title);
        let id = note::get_str(&fm, "id").unwrap_or_default();
        self.fs
            .write_atomic(&abs, &note::serialize_note(&fm, "")?)?;

        Ok(NoteMeta {
            path: rel,
            id,
            title: title.to_string(),
        })
    }

    /// 改写一条 frontmatter 属性。DESIGN.md §2.6
    ///
    /// **这是 database 视图「可写」的实现基础** —— 在表格里改一个单元格
    /// 就是走这条路径改对应笔记的 frontmatter，然后文件落盘。设计文档说
    /// 「必须可写，这是它好不好用的分水岭」。
    ///
    /// `value` 为 None 表示删除该属性。
    pub fn set_prop(&self, rel: &str, key: &str, value: Option<&str>) -> Result<()> {
        // 这几个是内部字段，不能让 database 视图改掉 —— 改了 id 就等于
        // 把这篇笔记的身份换了，所有指向它的链接都会断
        if matches!(key, "id" | "created") {
            return Err(Error::Vault(format!("{key} 是内部字段，不能修改")));
        }

        let abs = self.resolve(rel)?;
        let raw = self.fs.read_to_string(&abs)?;
        let (mut fm, body) = note::parse_frontmatter(&raw);

        match value {
            None => {
                fm.remove(serde_yaml::Value::String(key.to_string()));
            }
            Some(v) => {
                let k = serde_yaml::Value::String(key.to_string());
                // 原本是数组的（比如 tags）就仍然写成数组，
                // 否则一次编辑会把 `tags: [a, b]` 压成一个字符串
                let was_seq = matches!(fm.get(&k), Some(serde_yaml::Value::Sequence(_)));
                let new_val = if was_seq {
                    serde_yaml::Value::Sequence(
                        v.split(['、', ','])
                            .map(|s| s.trim())
                            .filter(|s| !s.is_empty())
                            .map(|s| serde_yaml::Value::String(s.to_string()))
                            .collect(),
                    )
                } else if let Ok(n) = v.parse::<i64>() {
                    serde_yaml::Value::Number(n.into())
                } else if let Ok(f) = v.parse::<f64>() {
                    serde_yaml::Value::Number(serde_yaml::Number::from(f))
                } else if v == "true" || v == "false" {
                    serde_yaml::Value::Bool(v == "true")
                } else {
                    serde_yaml::Value::String(v.to_string())
                };
                fm.insert(k, new_val);
            }
        }

        note::ensure_identity(&mut fm, &stem_of(rel));
        note::touch_updated(&mut fm);
        self.fs.write_atomic(&abs, &note::serialize_note(&fm, &body)?)?;
        Ok(())
    }

    /// 只读取 mtime，用于「窗口重新聚焦时检查文件是否被外部程序改过」。
    /// 见 §7.4 —— 用 AI 改完文件回到编辑器，不能一保存就覆盖掉它的修改。
    pub fn stat(&self, rel: &str) -> Result<i64> {
        Ok(self.fs.metadata(&self.resolve(rel)?)?.mtime_ms)
    }
}

fn stem_of(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未命名".into())
}

fn mapping_to_json(m: &Mapping) -> serde_json::Value {
    serde_json::to_value(m).unwrap_or(serde_json::Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_at(root: &Path) -> Vault {
        Vault {
            root: root.to_path_buf(),
            fs: Arc::new(DesktopFs::new()),
        }
    }

    #[test]
    fn resolve_rejects_traversal() {
        let v = vault_at(Path::new("/vault"));
        for bad in ["../secret", "数学/../../secret", "..", "/etc/passwd"] {
            assert!(
                matches!(v.resolve(bad), Err(Error::PathEscape(_))),
                "应当拒绝: {bad}"
            );
        }
    }

    #[test]
    fn resolve_accepts_normal_paths() {
        let v = vault_at(Path::new("/vault"));
        assert_eq!(
            v.resolve("数学/线性代数.md").unwrap(),
            Path::new("/vault").join("数学").join("线性代数.md")
        );
        assert_eq!(v.resolve("./a.md").unwrap(), Path::new("/vault").join("a.md"));
    }

    #[test]
    fn atomic_write_then_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("folio-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        let meta = v.create_note(None, "测试笔记").unwrap();
        assert_eq!(meta.path, "测试笔记.md");
        assert_eq!(meta.id.len(), 26);

        v.write_note(&meta.path, "$$E = mc^2$$\n").unwrap();
        let read = v.read_note(&meta.path).unwrap();
        assert_eq!(read.body, "$$E = mc^2$$\n");
        assert_eq!(read.title, "测试笔记");
        assert_eq!(read.id.as_deref(), Some(meta.id.as_str()));

        // 保存不能丢掉 frontmatter 里的 id —— 丢了链接就断了
        let raw = std::fs::read_to_string(dir.join("测试笔记.md")).unwrap();
        assert!(raw.contains(&meta.id));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 从 Obsidian vault / git clone / AI 生成来的 .md 通常没有 frontmatter。
    /// 首次保存必须补上 id，否则这篇笔记没有稳定标识，重命名后链接就断了。
    #[test]
    fn foreign_note_gets_an_id_on_first_save() {
        let dir = std::env::temp_dir().join(format!("folio-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        // 模拟外来文件：纯正文，没有 frontmatter
        std::fs::write(dir.join("外来.md"), "别处拿来的笔记\n").unwrap();
        assert!(v.read_note("外来.md").unwrap().id.is_none());

        v.write_note("外来.md", "别处拿来的笔记，改了一下\n").unwrap();

        let after = v.read_note("外来.md").unwrap();
        let id = after.id.expect("首次保存后必须有 id");
        assert_eq!(id.len(), 26);
        assert_eq!(after.body, "别处拿来的笔记，改了一下\n");

        // 再存一次，id 必须保持不变
        v.write_note("外来.md", "再改一次\n").unwrap();
        assert_eq!(v.read_note("外来.md").unwrap().id.as_deref(), Some(id.as_str()));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 时间戳不该带 9 位小数 —— 每次保存都会在 git diff 里制造一行噪音
    #[test]
    fn timestamps_are_second_precision() {
        let fm = note::new_frontmatter("甲");
        let created = note::get_str(&fm, "created").unwrap();
        assert!(!created.contains('.'), "不该有小数秒: {created}");
    }

    #[test]
    fn create_child_note_makes_same_named_folder() {
        let dir = std::env::temp_dir().join(format!("folio-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        let parent = v.create_note(None, "线性代数").unwrap();
        let child = v.create_note(Some(&parent.path), "奇异值分解").unwrap();

        assert_eq!(child.path, "线性代数/奇异值分解.md");
        assert!(dir.join("线性代数.md").is_file(), "父文档本体仍是一个 .md");
        assert!(dir.join("线性代数").is_dir(), "同名文件夹应被建出来");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_duplicate_and_invalid_titles() {
        let dir = std::env::temp_dir().join(format!("folio-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        v.create_note(None, "甲").unwrap();
        assert!(v.create_note(None, "甲").is_err(), "重名应当报错而不是覆盖");
        assert!(v.create_note(None, "a/b").is_err(), "标题里的路径分隔符应被拒绝");
        assert!(v.create_note(None, "  ").is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
