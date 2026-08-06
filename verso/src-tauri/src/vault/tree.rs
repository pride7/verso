//! 文档树：把 `X.md` 和同名文件夹 `X/` 合并成树上的**同一个节点**。
//!
//! DESIGN.md §2.1。磁盘上是两个对象，用户看到的是一个「既有内容、又能展开」
//! 的节点 —— 这就是 Notion / 思源 的文档嵌套，但底下仍是纯 .md。

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use super::fs::VaultFs;
use crate::error::Result;

/// 不进入文档树的目录名。
///
/// `attachments` 之所以硬编码在这里是临时的 —— M0 还没有配置系统，
/// DESIGN.md §10.2 定了它可配置。等 config.json 落地后从配置读。
const HIDDEN_DIRS: &[&str] = &[".verso", ".git", ".obsidian", "attachments", "node_modules"];

/// 根目录里供 AI CLI 读取的仓库说明不是笔记，不进入文档树及其下游索引。
/// 只匹配根目录：子目录里同名的文件仍可能是用户真正写的文档。
const HIDDEN_ROOT_DOCS: &[&str] = &["AGENTS.md", "CLAUDE.md"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    /// 有 `X.md`，可能同时有 `X/`
    Document,
    /// 只有 `X/`，没有同名 .md —— UI 上是纯文件夹节点，
    /// 提供「创建为文档」把它升级成 Document
    Folder,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// 显示名（不含 .md 后缀）
    pub name: String,
    /// vault 相对路径，正斜杠。Document 指向 `X.md`，Folder 指向 `X/`
    pub path: String,
    pub kind: NodeKind,
    /// 同名文件夹的相对路径，仅 Document 且该文件夹存在时有值
    pub child_dir: Option<String>,
    pub children: Vec<TreeNode>,

    // ---- 排序键。扫目录时填不了，由 `tree_list` 从索引补上 ----
    //
    // **手动顺序存在 frontmatter 的 `order` 里**，不存 `.verso/`：
    // §0 第 1 条要求用户数据能脱离本软件存在，而第 6 条要求 `.verso/`
    // 可以整个删掉重建 —— 手动排的顺序显然不是能重建的派生数据。
    // 放 frontmatter 里它是纯文本、能 git diff、拖进 Obsidian 也还在。
    /// frontmatter 里的 `order`，没有则为 None
    pub order: Option<f64>,
    pub created: Option<String>,
    pub updated: Option<String>,

    /// frontmatter 里的 `icon`（§2.3）—— 一个 emoji，用来在树上一眼认出这篇。
    ///
    /// 和上面几个一样由 `tree_list` 从索引补：扫目录时不读文件内容，
    /// 为了一个图标去打开每一篇笔记，大 vault 里会让侧栏卡住。
    pub icon: Option<String>,
}

/// 递归扫描目录，产出合并后的树。
///
/// `rel` 是相对 vault 根的路径，根目录传空串。
pub fn scan(fs: &dyn VaultFs, root: &Path, rel: &str) -> Result<Vec<TreeNode>> {
    let abs = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };

    let entries = fs.read_dir(&abs)?;

    // BTreeMap 顺便给出稳定的字典序，省掉后面再排一次
    let mut docs: BTreeMap<String, ()> = BTreeMap::new();
    let mut dirs: BTreeMap<String, ()> = BTreeMap::new();

    for e in entries {
        if e.is_dir {
            if is_hidden_dir(&e.name) {
                continue;
            }
            dirs.insert(e.name, ());
        } else if let Some(stem) = e.name.strip_suffix(".md") {
            if stem.is_empty() {
                continue; // 文件名就叫 ".md"，忽略
            }
            if rel.is_empty() && is_hidden_root_doc(&e.name) {
                continue;
            }
            docs.insert(stem.to_string(), ());
        }
    }

    let mut nodes = Vec::with_capacity(docs.len() + dirs.len());

    // 1) 每个 X.md 是一个 Document 节点；若存在同名 X/ 就把它的内容挂成子节点
    for name in docs.keys() {
        let doc_path = join_rel(rel, &format!("{name}.md"));
        let has_dir = dirs.contains_key(name);
        let (child_dir, children) = if has_dir {
            let dir_rel = join_rel(rel, name);
            let kids = scan(fs, root, &dir_rel)?;
            (Some(dir_rel), kids)
        } else {
            (None, Vec::new())
        };

        nodes.push(TreeNode {
            name: name.clone(),
            path: doc_path,
            kind: NodeKind::Document,
            child_dir,
            children,
            order: None,
            created: None,
            updated: None,
            icon: None,
        });
    }

    // 2) 没有同名 .md 的文件夹，作为纯 Folder 节点
    for name in dirs.keys() {
        if docs.contains_key(name) {
            continue; // 已经被上面合并进 Document 了
        }
        let dir_rel = join_rel(rel, name);
        let children = scan(fs, root, &dir_rel)?;
        nodes.push(TreeNode {
            name: name.clone(),
            path: dir_rel,
            kind: NodeKind::Folder,
            child_dir: None,
            children,
            order: None,
            created: None,
            updated: None,
            icon: None,
        });
    }

    // 有子节点的排前面，其次按名字。让「像文件夹的东西」聚在上方，
    // 这是文件管理器的通用习惯。
    nodes.sort_by(|a, b| {
        let a_branch = !a.children.is_empty();
        let b_branch = !b.children.is_empty();
        b_branch
            .cmp(&a_branch)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });

    Ok(nodes)
}

fn is_hidden_dir(name: &str) -> bool {
    name.starts_with('.') || HIDDEN_DIRS.contains(&name)
}

/// 保存 / 文件监听的增量索引也要复用同一判断，否则编辑一次隐藏文件后，
/// 它又会悄悄回到搜索结果里。
pub(crate) fn is_hidden_root_doc(rel: &str) -> bool {
    HIDDEN_ROOT_DOCS.contains(&rel)
}

fn join_rel(rel: &str, name: &str) -> String {
    if rel.is_empty() {
        name.to_string()
    } else {
        format!("{rel}/{name}")
    }
}

/// 大小写不敏感的比较，且数字段按数值比 —— 让「第2章」排在「第10章」前面。
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();

    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(ca), Some(cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let na = take_number(&mut ai);
                    let nb = take_number(&mut bi);
                    match na.cmp(&nb) {
                        std::cmp::Ordering::Equal => continue,
                        ord => return ord,
                    }
                } else {
                    let la = ca.to_lowercase().next().unwrap_or(ca);
                    let lb = cb.to_lowercase().next().unwrap_or(cb);
                    match la.cmp(&lb) {
                        std::cmp::Ordering::Equal => {
                            ai.next();
                            bi.next();
                        }
                        ord => return ord,
                    }
                }
            }
        }
    }
}

fn take_number(it: &mut std::iter::Peekable<std::str::Chars>) -> u64 {
    let mut n: u64 = 0;
    while let Some(c) = it.peek().copied() {
        if !c.is_ascii_digit() {
            break;
        }
        // saturating：避免超长数字串（比如某种 ID）导致 panic
        n = n.saturating_mul(10).saturating_add(c as u64 - '0' as u64);
        it.next();
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::fs::{DirEntry, FileMeta};
    use std::collections::HashMap;

    /// 内存假文件系统 —— VaultFs 抽象的第一份回报：
    /// 树合并逻辑可以完全不碰真实磁盘来测。
    struct FakeFs {
        /// 目录相对路径 -> 目录项
        dirs: HashMap<String, Vec<DirEntry>>,
        root: std::path::PathBuf,
    }

    impl FakeFs {
        fn new(spec: &[(&str, &[(&str, bool)])]) -> Self {
            let root = std::path::PathBuf::from("/vault");
            let mut dirs = HashMap::new();
            for (dir, entries) in spec {
                dirs.insert(
                    dir.to_string(),
                    entries
                        .iter()
                        .map(|(n, is_dir)| DirEntry {
                            name: n.to_string(),
                            is_dir: *is_dir,
                        })
                        .collect(),
                );
            }
            FakeFs { dirs, root }
        }

        fn rel_of(&self, path: &Path) -> String {
            path.strip_prefix(&self.root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default()
        }
    }

    impl VaultFs for FakeFs {
        fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
            Ok(self.dirs.get(&self.rel_of(path)).cloned().unwrap_or_default())
        }
        fn read_to_string(&self, _: &Path) -> Result<String> {
            unimplemented!()
        }
        fn write_atomic(&self, _: &Path, _: &str) -> Result<()> {
            unimplemented!()
        }
        fn write_bytes(&self, _: &Path, _: &[u8]) -> Result<()> {
            unimplemented!()
        }
        fn create_dir_all(&self, _: &Path) -> Result<()> {
            unimplemented!()
        }
        fn rename(&self, _: &Path, _: &Path) -> Result<()> {
            unimplemented!()
        }
        fn remove_file(&self, _: &Path) -> Result<()> {
            unimplemented!()
        }
        fn remove_dir_all(&self, _: &Path) -> Result<()> {
            unimplemented!()
        }
        fn remove_dir_if_empty(&self, _: &Path) -> Result<bool> {
            unimplemented!()
        }
        fn exists(&self, _: &Path) -> bool {
            unimplemented!()
        }
        fn is_dir(&self, _: &Path) -> bool {
            unimplemented!()
        }
        fn metadata(&self, _: &Path) -> Result<FileMeta> {
            unimplemented!()
        }
    }

    /// DESIGN.md §2.1 的那个例子，一比一还原
    fn design_doc_vault() -> FakeFs {
        FakeFs::new(&[
            ("", &[("数学", true), ("attachments", true), (".verso", true)]),
            (
                "数学",
                &[
                    ("线性代数.md", false),
                    ("线性代数", true),
                    ("泛函分析.md", false),
                ],
            ),
            (
                "数学/线性代数",
                &[
                    ("特征值.md", false),
                    ("奇异值分解.md", false),
                    ("奇异值分解", true),
                ],
            ),
            ("数学/线性代数/奇异值分解", &[("计算方法.md", false)]),
        ])
    }

    #[test]
    fn merges_note_with_same_named_folder_into_one_node() {
        let fs = design_doc_vault();
        let tree = scan(&fs, Path::new("/vault"), "").unwrap();

        let math = &tree[0];
        assert_eq!(math.name, "数学");
        assert_eq!(math.kind, NodeKind::Folder); // 没有 数学.md

        // 线性代数.md + 线性代数/ 必须合并成一个节点，而不是两个
        let linalg = math.children.iter().find(|n| n.name == "线性代数").unwrap();
        assert_eq!(math.children.iter().filter(|n| n.name == "线性代数").count(), 1);
        assert_eq!(linalg.kind, NodeKind::Document);
        assert_eq!(linalg.path, "数学/线性代数.md");
        assert_eq!(linalg.child_dir.as_deref(), Some("数学/线性代数"));
        assert_eq!(linalg.children.len(), 2);
    }

    #[test]
    fn nests_arbitrarily_deep() {
        let fs = design_doc_vault();
        let tree = scan(&fs, Path::new("/vault"), "").unwrap();
        let svd = tree[0].children[0]
            .children
            .iter()
            .find(|n| n.name == "奇异值分解")
            .unwrap();
        assert_eq!(svd.children[0].name, "计算方法");
        assert_eq!(svd.children[0].path, "数学/线性代数/奇异值分解/计算方法.md");
    }

    #[test]
    fn leaf_document_has_no_child_dir() {
        let fs = design_doc_vault();
        let tree = scan(&fs, Path::new("/vault"), "").unwrap();
        let fa = tree[0].children.iter().find(|n| n.name == "泛函分析").unwrap();
        assert_eq!(fa.kind, NodeKind::Document);
        assert!(fa.child_dir.is_none());
        assert!(fa.children.is_empty());
    }

    #[test]
    fn skips_private_and_attachment_dirs() {
        let fs = design_doc_vault();
        let tree = scan(&fs, Path::new("/vault"), "").unwrap();
        assert_eq!(tree.len(), 1, "只应剩下「数学」，.verso 和 attachments 要被跳过");
    }

    #[test]
    fn hides_only_root_ai_instructions() {
        let fs = FakeFs::new(&[
            (
                "",
                &[
                    ("AGENTS.md", false),
                    ("CLAUDE.md", false),
                    ("正文.md", false),
                    ("项目", true),
                ],
            ),
            ("项目", &[("AGENTS.md", false)]),
        ]);
        let tree = scan(&fs, Path::new("/vault"), "").unwrap();

        assert!(tree.iter().all(|node| node.name != "AGENTS" && node.name != "CLAUDE"));
        assert!(tree.iter().any(|node| node.path == "正文.md"));
        let project = tree.iter().find(|node| node.name == "项目").unwrap();
        assert!(project.children.iter().any(|node| node.path == "项目/AGENTS.md"));
    }

    #[test]
    fn folder_without_matching_note_stays_a_folder() {
        let fs = FakeFs::new(&[("", &[("素材", true)]), ("素材", &[("图.md", false)])]);
        let tree = scan(&fs, Path::new("/vault"), "").unwrap();
        assert_eq!(tree[0].kind, NodeKind::Folder);
        assert_eq!(tree[0].path, "素材");
        assert!(tree[0].child_dir.is_none());
    }

    #[test]
    fn sorts_numbers_naturally() {
        let fs = FakeFs::new(&[(
            "",
            &[("第2章.md", false), ("第10章.md", false), ("第1章.md", false)],
        )]);
        let tree = scan(&fs, Path::new("/vault"), "").unwrap();
        let names: Vec<_> = tree.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["第1章", "第2章", "第10章"]);
    }
}
