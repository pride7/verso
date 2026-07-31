//! 文档树的结构性操作：重命名、移动、删除。DESIGN.md §2.1 的边界情况表。
//!
//! 这些操作的难点全在「同名文件夹」上 —— 一个文档在磁盘上是 `X.md` 和
//! 可选的 `X/` 两个对象，任何操作都必须把它们当成一个整体，否则树就散了。

use std::path::Path;

use crate::error::{Error, Result};

use super::Vault;

/// 文档 `a/b/X.md` 的子文档目录是 `a/b/X`
pub fn child_dir_of(doc_rel: &str) -> Result<String> {
    doc_rel
        .strip_suffix(".md")
        .map(|s| s.to_string())
        .ok_or_else(|| Error::Vault(format!("不是文档: {doc_rel}")))
}

fn parent_rel(rel: &str) -> &str {
    match rel.rfind('/') {
        Some(i) => &rel[..i],
        None => "",
    }
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

pub fn validate_title(title: &str) -> Result<&str> {
    let t = title.trim();
    if t.is_empty() {
        return Err(Error::Vault("标题不能为空".into()));
    }
    if let Some(bad) = t.chars().find(|c| r#"\/:*?"<>|"#.contains(*c)) {
        return Err(Error::Vault(format!("标题不能包含字符 {bad:?}")));
    }
    if t == "." || t == ".." {
        return Err(Error::Vault("非法标题".into()));
    }
    Ok(t)
}

impl Vault {
    /// 重命名文档。`X.md` 与同名文件夹 `X/` 必须一起改，且要么都成功要么都不变。
    pub fn rename_note(&self, rel: &str, new_title: &str) -> Result<String> {
        let title = validate_title(new_title)?;
        let dir = parent_rel(rel);
        let new_rel = join(dir, &format!("{title}.md"));
        if new_rel == rel {
            return Ok(new_rel);
        }

        let old_abs = self.resolve(rel)?;
        let new_abs = self.resolve(&new_rel)?;
        if self.fs.exists(&new_abs) {
            return Err(Error::Vault(format!("已存在同名文档: {new_rel}")));
        }

        let old_child = child_dir_of(rel)?;
        let new_child = child_dir_of(&new_rel)?;
        let old_child_abs = self.resolve(&old_child)?;
        let new_child_abs = self.resolve(&new_child)?;
        let has_children = self.fs.is_dir(&old_child_abs);

        if has_children && self.fs.exists(&new_child_abs) {
            return Err(Error::Vault(format!("已存在同名文件夹: {new_child}")));
        }

        // 先动文件夹。文件夹改名失败的概率更高（可能有文件被占用），
        // 先做它意味着失败时无需回滚。
        if has_children {
            self.fs.rename(&old_child_abs, &new_child_abs)?;
        }

        if let Err(e) = self.fs.rename(&old_abs, &new_abs) {
            // 回滚，绝不能留下「文件夹改了名但文档没改」的半吊子状态 ——
            // 那会让父文档和子文档在树上断开
            if has_children {
                let _ = self.fs.rename(&new_child_abs, &old_child_abs);
            }
            return Err(e);
        }

        Ok(new_rel)
    }

    /// 把文档移到新的父文档之下（`new_parent_doc` 为 None 表示移到 vault 根）。
    pub fn move_note(&self, rel: &str, new_parent_doc: Option<&str>) -> Result<String> {
        let name = Path::new(rel)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .ok_or_else(|| Error::Vault(format!("非法路径: {rel}")))?;

        let target_dir = match new_parent_doc {
            None => String::new(),
            Some(p) => {
                let d = child_dir_of(p)?;
                // 不能把一个文档移进它自己的子树，否则整棵子树会从树上消失
                let self_dir = child_dir_of(rel)?;
                if d == self_dir || d.starts_with(&format!("{self_dir}/")) {
                    return Err(Error::Vault("不能把文档移动到它自己的子文档下".into()));
                }
                self.fs.create_dir_all(&self.resolve(&d)?)?;
                d
            }
        };

        let new_rel = join(&target_dir, &name);
        if new_rel == rel {
            return Ok(new_rel);
        }

        let new_abs = self.resolve(&new_rel)?;
        if self.fs.exists(&new_abs) {
            return Err(Error::Vault(format!("目标位置已存在同名文档: {new_rel}")));
        }

        let old_child = child_dir_of(rel)?;
        let new_child = child_dir_of(&new_rel)?;
        let old_child_abs = self.resolve(&old_child)?;
        let has_children = self.fs.is_dir(&old_child_abs);

        if has_children {
            self.fs.rename(&old_child_abs, &self.resolve(&new_child)?)?;
        }
        if let Err(e) = self.fs.rename(&self.resolve(rel)?, &new_abs) {
            if has_children {
                let _ = self.fs.rename(&self.resolve(&new_child)?, &old_child_abs);
            }
            return Err(e);
        }

        self.cleanup_empty_dir(parent_rel(rel))?;
        Ok(new_rel)
    }

    /// 删除文档。`with_children = false` 时保留同名文件夹 —— 树上会降级成
    /// 纯文件夹节点，子文档不会跟着消失（§2.1）。
    pub fn delete_note(&self, rel: &str, with_children: bool) -> Result<()> {
        let abs = self.resolve(rel)?;
        let child = child_dir_of(rel)?;
        let child_abs = self.resolve(&child)?;

        if with_children && self.fs.is_dir(&child_abs) {
            self.fs.remove_dir_all(&child_abs)?;
        }
        if self.fs.exists(&abs) {
            self.fs.remove_file(&abs)?;
        }
        // 没有子文档时顺手清掉空的同名文件夹，避免残留
        self.fs.remove_dir_if_empty(&child_abs)?;
        self.cleanup_empty_dir(parent_rel(rel))?;
        Ok(())
    }

    /// 删掉变空的同名文件夹（§2.1「子文档为空时」）。只清一层，不递归上溯 ——
    /// 递归会在用户删掉最后一篇笔记时把整条目录链都抹掉，太激进。
    fn cleanup_empty_dir(&self, dir_rel: &str) -> Result<()> {
        if dir_rel.is_empty() {
            return Ok(());
        }
        // 只有「有同名文档的文件夹」才归我们管；普通文件夹是用户自己建的，不动
        let owner = format!("{dir_rel}.md");
        if !self.fs.exists(&self.resolve(&owner)?) {
            return Ok(());
        }
        self.fs.remove_dir_if_empty(&self.resolve(dir_rel)?)?;
        Ok(())
    }

    /// 扁平的笔记清单，供快速切换器使用。
    ///
    /// 有意返回全量而不是在 Rust 里做模糊匹配：让前端一次拿到、在本地过滤，
    /// 每敲一个字符就走一次 IPC 会毁掉「三个字母直达」的手感（§2.2）。
    /// 真正的索引是 M3 的事。
    pub fn note_list(&self) -> Result<Vec<super::NoteRef>> {
        let mut out = Vec::new();
        collect(&self.tree()?, &mut out);
        Ok(out)
    }
}

fn collect(nodes: &[super::tree::TreeNode], out: &mut Vec<super::NoteRef>) {
    for n in nodes {
        if n.kind == super::tree::NodeKind::Document {
            out.push(super::NoteRef {
                path: n.path.clone(),
                name: n.name.clone(),
            });
        }
        collect(&n.children, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Arc;

    use crate::vault::fs::DesktopFs;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn setup() -> (Tmp, Vault) {
        let dir = std::env::temp_dir().join(format!("folio-ops-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = Vault {
            root: dir.clone(),
            fs: Arc::new(DesktopFs::new()),
        };
        (Tmp(dir), v)
    }

    #[test]
    fn rename_moves_note_and_its_child_folder_together() {
        let (t, v) = setup();
        let parent = v.create_note(None, "线性代数").unwrap();
        v.create_note(Some(&parent.path), "特征值").unwrap();

        let new_rel = v.rename_note(&parent.path, "矩阵论").unwrap();

        assert_eq!(new_rel, "矩阵论.md");
        assert!(t.0.join("矩阵论.md").is_file());
        assert!(t.0.join("矩阵论").is_dir(), "同名文件夹必须跟着改名");
        assert!(t.0.join("矩阵论/特征值.md").is_file(), "子文档必须还在");
        assert!(!t.0.join("线性代数.md").exists());
        assert!(!t.0.join("线性代数").exists());
    }

    #[test]
    fn rename_rejects_existing_name() {
        let (_t, v) = setup();
        v.create_note(None, "甲").unwrap();
        let b = v.create_note(None, "乙").unwrap();
        assert!(v.rename_note(&b.path, "甲").is_err(), "重名应当报错而不是覆盖");
    }

    #[test]
    fn move_note_into_another_document() {
        let (t, v) = setup();
        let a = v.create_note(None, "甲").unwrap();
        let b = v.create_note(None, "乙").unwrap();

        let new_rel = v.move_note(&b.path, Some(&a.path)).unwrap();

        assert_eq!(new_rel, "甲/乙.md");
        assert!(t.0.join("甲/乙.md").is_file());
        assert!(!t.0.join("乙.md").exists());
    }

    /// 把父文档移进自己的子文档会让整棵子树从树上消失
    #[test]
    fn move_rejects_moving_into_own_subtree() {
        let (_t, v) = setup();
        let parent = v.create_note(None, "父").unwrap();
        let child = v.create_note(Some(&parent.path), "子").unwrap();
        assert!(v.move_note(&parent.path, Some(&child.path)).is_err());
    }

    #[test]
    fn delete_without_children_keeps_the_subtree() {
        let (t, v) = setup();
        let parent = v.create_note(None, "父").unwrap();
        v.create_note(Some(&parent.path), "子").unwrap();

        v.delete_note(&parent.path, false).unwrap();

        assert!(!t.0.join("父.md").exists());
        assert!(t.0.join("父/子.md").is_file(), "子文档不该跟着消失");
    }

    #[test]
    fn delete_with_children_removes_the_whole_subtree() {
        let (t, v) = setup();
        let parent = v.create_note(None, "父").unwrap();
        v.create_note(Some(&parent.path), "子").unwrap();

        v.delete_note(&parent.path, true).unwrap();

        assert!(!t.0.join("父.md").exists());
        assert!(!t.0.join("父").exists());
    }

    /// 删掉最后一个子文档后，空的同名文件夹不该留在那里
    #[test]
    fn deleting_last_child_cleans_up_empty_folder() {
        let (t, v) = setup();
        let parent = v.create_note(None, "父").unwrap();
        let child = v.create_note(Some(&parent.path), "子").unwrap();
        assert!(t.0.join("父").is_dir());

        v.delete_note(&child.path, false).unwrap();

        assert!(t.0.join("父.md").is_file(), "父文档要留着");
        assert!(!t.0.join("父").exists(), "空的同名文件夹应当被清掉");
    }

    #[test]
    fn note_list_is_flat_and_covers_all_depths() {
        let (_t, v) = setup();
        let a = v.create_note(None, "甲").unwrap();
        let b = v.create_note(Some(&a.path), "乙").unwrap();
        v.create_note(Some(&b.path), "丙").unwrap();

        let mut paths: Vec<_> = v.note_list().unwrap().into_iter().map(|n| n.path).collect();
        paths.sort();
        assert_eq!(paths, vec!["甲.md", "甲/乙.md", "甲/乙/丙.md"]);
    }
}
