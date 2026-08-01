//! 手动排序。DESIGN.md §2.1
//!
//! ## 为什么存在 vault 根目录，而不是 `.verso/`，也不是笔记的 frontmatter
//!
//! 三个位置各自的问题：
//!
//! - **`.verso/`**：它在 vault 的 `.gitignore` 里。顺序放那儿换台机器就没了，
//!   而 M5 是 git 同步、M6 是移动端 —— 这基本是判死刑。何况铁律第 6 条说
//!   `.verso/` 必须能整个删掉重建，而手动排的顺序重建不出来。
//! - **frontmatter**：顺序跟着文件走，重命名移动都不丢，但每篇笔记都会多一个
//!   用户没写的 `order` 字段；而且拖一次要改一整组文件，git diff 很吵。
//! - **这里**（`.verso-order.json`，vault 根）：笔记一个字不动，文件受版本管理
//!   所以跟着 vault 一起同步，拖一次只改一个文件。
//!
//! 代价是它**可能变陈旧** —— 在别的软件里重命名了笔记，那一条就对不上了。
//! 处理方式是优雅降级：认不出的路径当作「没排过」，沉到底部而不是报错。
//! Verso 自己的重命名/移动/删除会同步更新这个文件。
//!
//! ## 格式
//!
//! ```json
//! {
//!   "": ["数学.md", "论文.md"],
//!   "数学": ["数学/线性代数.md", "数学/泛函分析.md"]
//! }
//! ```
//!
//! 键是父目录的 vault 相对路径（根目录是空串），值是**完整相对路径**。
//! 存完整路径而不是文件名：重命名时能直接做字符串替换，不必先拼回去。

use std::collections::BTreeMap;
use std::path::Path;

use crate::error::Result;

use super::fs::VaultFs;

/// 文件名。放 vault 根目录，**不放 `.verso/`** —— 那里不进版本库
pub const ORDER_FILE: &str = ".verso-order.json";

pub type OrderMap = BTreeMap<String, Vec<String>>;

pub fn load(fs: &dyn VaultFs, root: &Path) -> OrderMap {
    // 读不出来就当没排过。这个文件损坏不该让整个 vault 打不开 ——
    // 它承载的是顺序，不是内容
    fs.read_to_string(&root.join(ORDER_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(fs: &dyn VaultFs, root: &Path, map: &OrderMap) -> Result<()> {
    let json = serde_json::to_string_pretty(map)
        .map_err(|e| crate::error::Error::Vault(format!("排序文件序列化失败: {e}")))?;
    fs.write_atomic(&root.join(ORDER_FILE), &format!("{json}\n"))?;
    Ok(())
}

/// 某个路径的父目录（vault 相对）。根下的条目返回空串
pub fn parent_of(rel: &str) -> String {
    match rel.rfind('/') {
        Some(i) => rel[..i].to_string(),
        None => String::new(),
    }
}

/// 记录一组兄弟的次序。传进来的应当是**完整的一组**，不是只有被移动的那个
pub fn set_group(map: &mut OrderMap, parent: &str, paths: Vec<String>) {
    if paths.is_empty() {
        map.remove(parent);
    } else {
        map.insert(parent.to_string(), paths);
    }
}

/// 路径 → 顺序号（1 起）。没排过的返回 None，由上层决定沉到底部
pub fn index_of(map: &OrderMap, rel: &str) -> Option<f64> {
    let group = map.get(&parent_of(rel))?;
    group.iter().position(|p| p == rel).map(|i| (i + 1) as f64)
}

/// 重命名/移动之后修好受影响的条目。
///
/// 不只换那一条：重命名一个有子文档的节点时，`X/` 下面所有孙节点的路径都变了，
/// 它们在别的分组里的条目也得跟着改，否则整棵子树的顺序会一次性全丢。
pub fn rename_path(map: &mut OrderMap, from: &str, to: &str) {
    let from_dir = from.strip_suffix(".md").unwrap_or(from).to_string();
    let to_dir = to.strip_suffix(".md").unwrap_or(to).to_string();

    let mut next = OrderMap::new();
    for (parent, paths) in std::mem::take(map) {
        // 分组的键（父目录）本身也可能落在被重命名的子树里
        let new_parent = if parent == from_dir {
            to_dir.clone()
        } else if let Some(rest) = parent.strip_prefix(&format!("{from_dir}/")) {
            format!("{to_dir}/{rest}")
        } else {
            parent
        };

        let new_paths = paths
            .into_iter()
            .map(|p| {
                if p == from {
                    to.to_string()
                } else if let Some(rest) = p.strip_prefix(&format!("{from_dir}/")) {
                    format!("{to_dir}/{rest}")
                } else {
                    p
                }
            })
            .collect();
        next.insert(new_parent, new_paths);
    }
    *map = next;
}

/// 删除之后清掉条目（连同它子树的分组）
pub fn remove_path(map: &mut OrderMap, rel: &str) {
    let dir = rel.strip_suffix(".md").unwrap_or(rel).to_string();
    map.retain(|parent, _| parent != &dir && !parent.starts_with(&format!("{dir}/")));
    for paths in map.values_mut() {
        paths.retain(|p| p != rel);
    }
    map.retain(|_, paths| !paths.is_empty());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &[&str])]) -> OrderMap {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect()))
            .collect()
    }

    #[test]
    fn index_is_one_based_and_scoped_to_parent() {
        let m = map(&[
            ("", &["甲.md", "乙.md"]),
            ("甲", &["甲/丙.md", "甲/丁.md"]),
        ]);
        assert_eq!(index_of(&m, "乙.md"), Some(2.0));
        assert_eq!(index_of(&m, "甲/丁.md"), Some(2.0));
        // 没排过的返回 None，让上层把它沉到底部
        assert_eq!(index_of(&m, "戊.md"), None);
    }

    #[test]
    fn rename_fixes_the_entry() {
        let mut m = map(&[("", &["甲.md", "乙.md"])]);
        rename_path(&mut m, "甲.md", "新甲.md");
        assert_eq!(m[""], vec!["新甲.md", "乙.md"]);
    }

    // 重命名一个有子文档的节点时，整棵子树的路径都变了。只换那一条的话，
    // 子树里所有笔记的顺序会一次性全丢
    #[test]
    fn rename_fixes_the_whole_subtree() {
        let mut m = map(&[
            ("", &["数学.md"]),
            ("数学", &["数学/线代.md", "数学/泛函.md"]),
            ("数学/线代", &["数学/线代/SVD.md"]),
        ]);
        rename_path(&mut m, "数学.md", "Math.md");

        assert_eq!(m[""], vec!["Math.md"]);
        assert_eq!(m["Math"], vec!["Math/线代.md", "Math/泛函.md"]);
        assert_eq!(m["Math/线代"], vec!["Math/线代/SVD.md"]);
    }

    #[test]
    fn remove_clears_entry_and_subtree_groups() {
        let mut m = map(&[
            ("", &["甲.md", "乙.md"]),
            ("甲", &["甲/丙.md"]),
        ]);
        remove_path(&mut m, "甲.md");
        assert_eq!(m[""], vec!["乙.md"]);
        assert!(!m.contains_key("甲"), "子树的分组也要清掉");
    }

    #[test]
    fn empty_group_is_dropped_not_kept_as_empty_array() {
        let mut m = map(&[("甲", &["甲/丙.md"])]);
        set_group(&mut m, "甲", vec![]);
        assert!(!m.contains_key("甲"));
    }

    #[test]
    fn parent_of_handles_root() {
        assert_eq!(parent_of("甲.md"), "");
        assert_eq!(parent_of("数学/甲.md"), "数学");
    }

    fn tmp_root(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("verso-order-{tag}-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trips_through_the_file() {
        let root = tmp_root("rt");
        let fs = super::super::fs::DesktopFs::new();
        let m = map(&[("", &["甲.md"]), ("甲", &["甲/丙.md"])]);

        save(&fs, &root, &m).unwrap();
        assert!(root.join(ORDER_FILE).is_file(), "文件要落在 vault 根目录");
        assert_eq!(load(&fs, &root), m);

        std::fs::remove_dir_all(&root).ok();
    }

    // 这个文件承载的是顺序，不是内容。它坏了（手改花了、同步冲突留下垃圾）
    // 只该让顺序退回默认，不该让整个 vault 打不开
    #[test]
    fn corrupt_file_degrades_to_no_order() {
        let root = tmp_root("bad");
        let fs = super::super::fs::DesktopFs::new();
        std::fs::write(root.join(ORDER_FILE), "{ 这不是 json").unwrap();

        assert!(load(&fs, &root).is_empty());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_file_is_not_an_error() {
        let root = tmp_root("none");
        let fs = super::super::fs::DesktopFs::new();
        assert!(load(&fs, &root).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}
