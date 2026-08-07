//! 手机上的多仓库。DESIGN.md §2.1
//!
//! ## 为什么手机要单独一套
//!
//! 桌面上「换一个仓库」就是再选一个目录，目录选择器给什么就是什么。手机上
//! 没有目录选择器（§1.2 b0：Tauri 在移动端没实现，点下去毫无反应），于是
//! 仓库放哪儿必须由我们自己定 —— **一个固定的容器目录，里面每个子文件夹
//! 是一个仓库**：
//!
//! ```text
//! /storage/emulated/0/Verso/     ← 容器，本身不是仓库
//!     默认/                       ← 仓库（有自己的 .git）
//!     工作/
//! ```
//!
//! 这样在手机的文件管理器里也看得懂：一层目录，一个文件夹一个仓库。
//!
//! ## 判据是 `.git`，不是「像不像」
//!
//! 子目录算不算仓库**只看它有没有 `.git/`**，因为 `Vault::open` 一定会
//! `ensure_repo`。不能用「有没有 `.md` 文件」那类启发式：§2.1 的同名文件夹
//! 嵌套意味着 `数学.md` 旁边就有一个 `数学/`，而那是一篇笔记的子目录，不是
//! 仓库。用启发式的话，用户每建一篇带子文档的笔记，仓库列表里就会多出一条
//! 假的。
//!
//! ## 迁移只做一次，而且靠整目录改名
//!
//! v0.7.21 之前容器本身就是仓库（笔记直接躺在 `Verso/` 下）。改成容器之后
//! 那些笔记要挪进 `Verso/默认/`。
//!
//! **不是逐个文件搬**：搬到一半失败会留下一个谁也说不清的半截状态。改成
//! 两次整目录改名，每一次都是原子的，中间失败还能原样退回去：
//!
//! ```text
//! Verso  →  Verso.migrating        (1)
//! mkdir Verso                      (2)
//! Verso.migrating  →  Verso/默认   (3)
//! ```

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// 迁移时的中转目录，建在容器**旁边**（同一个文件系统，改名才是原子的）。
///
/// 名字从容器自己派生而不是写死一个常量：写死的话，同一个上级目录下有第二个
/// 容器时两次迁移会撞在一起 —— 而撞上的表现是「另一个仓库说上次迁移没完成」，
/// 没人能把这两件事联系起来。带 `.migrating` 后缀是为了万一它被留在原地，
/// 用户一眼看得出这是我们的东西。
fn staging_dir(container: &Path) -> Result<PathBuf> {
    let parent = container
        .parent()
        .ok_or_else(|| Error::Vault("仓库目录没有上级目录，无法迁移".into()))?;
    let name = container
        .file_name()
        .ok_or_else(|| Error::Vault("仓库目录没有名字，无法迁移".into()))?;
    Ok(parent.join(format!("{}.migrating", name.to_string_lossy())))
}

/// 老版本的笔记迁进来之后叫什么。**不叫 vault / default** —— 手机的文件
/// 管理器里这一层是给人看的。
pub const DEFAULT_VAULT: &str = "默认";

/// 这个目录是不是一个仓库。判据见模块头：只认 `.git`。
pub fn is_vault(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// 容器里现有的仓库，按名字排序。
///
/// 排序是为了**稳定**：`read_dir` 的顺序由文件系统决定，安卓那层 FUSE 给的
/// 顺序不保证两次一致，而一个每次刷新都在跳的仓库列表没法用。
pub fn list(container: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(container) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && is_vault(p))
        .collect();
    out.sort();
    out
}

/// 容器本身还是个老式仓库的话，把它整个挪进 `默认/`。
///
/// 幂等：已经是容器（没有 `.git`）就直接返回。返回是否真的迁过 —— 调用方
/// 要据此提示用户，一次搬走整个仓库而不吭声太吓人了。
pub fn migrate_if_legacy(container: &Path) -> Result<bool> {
    if !is_vault(container) {
        return Ok(false);
    }
    let staging = staging_dir(container)?;
    if staging.exists() {
        // 上一次迁到一半断了。**不要猜**：两个目录都可能有用户的东西，
        // 合并的每一种规则都可能悄悄覆盖掉一份笔记
        return Err(Error::Vault(format!(
            "上一次迁移没有完成，{} 还在。请手动处理后再打开",
            staging.display()
        )));
    }

    // (1) 整个仓库改个名字挪开
    std::fs::rename(container, &staging)
        .map_err(|e| Error::Vault(format!("迁移失败（第 1 步，仓库没有被改动）：{e}")))?;

    // (2) 建新的容器。失败就把上一步退回去 —— 那时磁盘上和迁移前一模一样
    if let Err(e) = std::fs::create_dir_all(container) {
        let _ = std::fs::rename(&staging, container);
        return Err(Error::Vault(format!(
            "迁移失败（第 2 步，已退回原状）：{e}"
        )));
    }

    // (3) 挪进容器里当默认仓库。同样可退回：先删掉刚建的空容器
    let target = container.join(DEFAULT_VAULT);
    if let Err(e) = std::fs::rename(&staging, &target) {
        let _ = std::fs::remove_dir(container);
        let _ = std::fs::rename(&staging, container);
        return Err(Error::Vault(format!(
            "迁移失败（第 3 步，已退回原状）：{e}"
        )));
    }
    Ok(true)
}

/// 新建仓库时校验名字。
///
/// 只挡真的会出事的：路径分隔符和 `..`（会让仓库建到容器外面去）、空名字、
/// 以及 Windows 保留的那几个字符 —— 手机上不受限，但 vault 会被同步到桌面，
/// 一个在安卓上合法、在 Windows 上建不出来的目录名会让同步在对面炸掉。
pub fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Vault("仓库名不能为空".into()));
    }
    if name.starts_with('.') {
        return Err(Error::Vault("仓库名不能以点开头".into()));
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(Error::Vault("仓库名不能包含路径分隔符".into()));
    }
    if name.contains(['<', '>', ':', '"', '|', '?', '*']) {
        return Err(Error::Vault(
            "仓库名不能包含 < > : \" | ? * —— 同步到桌面时会建不出目录".into(),
        ));
    }
    Ok(name.to_string())
}

/// 在容器里建一个新仓库，返回它的路径。目录已存在就报错 —— 悄悄复用一个
/// 已有目录意味着用户以为新建了一个空仓库，打开却是别的笔记。
pub fn create(container: &Path, name: &str) -> Result<PathBuf> {
    let name = validate_name(name)?;
    let dir = container.join(&name);
    if dir.exists() {
        return Err(Error::Vault(format!("已经有一个叫「{name}」的仓库了")));
    }
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 打开哪一个：上次那个（还在的话）→ `默认` → 排第一个 → 都没有就建 `默认`。
///
/// `last` 只认**容器的直接子目录**：recent.json 里可能留着桌面时代的路径，
/// 或者上一版直接指向容器本身的那条记录。
pub fn pick(container: &Path, last: Option<&str>) -> PathBuf {
    let vaults = list(container);
    if let Some(last) = last {
        let last = PathBuf::from(last);
        if last.parent() == Some(container) && vaults.iter().any(|v| v == &last) {
            return last;
        }
    }
    let default = container.join(DEFAULT_VAULT);
    if vaults.contains(&default) {
        return default;
    }
    vaults.into_iter().next().unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("verso-mv-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 建一个「看起来像仓库」的目录：只有 `.git` 才算数
    fn vault(at: &Path) {
        std::fs::create_dir_all(at.join(".git")).unwrap();
    }

    #[test]
    fn 只有带_git_的子目录才算仓库() {
        let c = tmp();
        vault(&c.join("工作"));
        // 同名文件夹嵌套（§2.1）：这是一篇笔记的子目录，不是仓库
        std::fs::create_dir_all(c.join("数学")).unwrap();
        std::fs::write(c.join("数学.md"), "# 数学").unwrap();

        let found = list(&c);
        assert_eq!(found, vec![c.join("工作")], "把笔记的子目录当成了仓库");
    }

    #[test]
    fn 列表按名字排序_不跟着文件系统的顺序走() {
        let c = tmp();
        for name in ["丙", "甲", "乙"] {
            vault(&c.join(name));
        }
        let names: Vec<_> = list(&c)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
    }

    #[test]
    fn 老仓库整个挪进默认_内容一个不少() {
        let c = tmp();
        vault(&c);
        std::fs::write(c.join("记录.md"), "正文").unwrap();
        std::fs::create_dir_all(c.join("记录")).unwrap();
        std::fs::write(c.join("记录/子.md"), "子文档").unwrap();

        assert!(migrate_if_legacy(&c).unwrap());

        let moved = c.join(DEFAULT_VAULT);
        assert!(moved.join(".git").exists(), "git 仓库没跟着走");
        assert_eq!(std::fs::read_to_string(moved.join("记录.md")).unwrap(), "正文");
        assert_eq!(
            std::fs::read_to_string(moved.join("记录/子.md")).unwrap(),
            "子文档",
            "子树没跟着走"
        );
        // 容器自己不再是仓库了
        assert!(!is_vault(&c));
        assert_eq!(list(&c), vec![moved]);
    }

    #[test]
    fn 迁移是幂等的_第二次什么也不做() {
        let c = tmp();
        vault(&c);
        std::fs::write(c.join("a.md"), "x").unwrap();
        assert!(migrate_if_legacy(&c).unwrap());
        assert!(!migrate_if_legacy(&c).unwrap(), "第二次不该再动一遍");
        assert!(c.join(DEFAULT_VAULT).join("a.md").exists());
    }

    /// 上一次迁到一半留下的中转目录：**不猜，直接报错**。
    /// 两个目录都可能有用户的笔记，合并的任何一种规则都可能悄悄盖掉一份。
    #[test]
    fn 有残留的中转目录时拒绝继续() {
        let c = tmp();
        vault(&c);
        std::fs::create_dir_all(staging_dir(&c).unwrap()).unwrap();
        assert!(migrate_if_legacy(&c).is_err());
        // 而且原地没动过
        assert!(is_vault(&c));
    }

    #[test]
    fn 不是老仓库时不迁移() {
        let c = tmp();
        vault(&c.join("工作"));
        assert!(!migrate_if_legacy(&c).unwrap());
        assert!(c.join("工作").exists());
    }

    #[test]
    fn 仓库名挡掉会跑到容器外面去的写法() {
        for bad in ["", "  ", "../跑出去", "a/b", "a\\b", ".隐藏"] {
            assert!(validate_name(bad).is_err(), "{bad} 应当被挡下");
        }
        // Windows 建不出来的字符也要挡：vault 会被同步到桌面
        assert!(validate_name("问号?").is_err());
        assert_eq!(validate_name("  工作  ").unwrap(), "工作");
    }

    #[test]
    fn 不覆盖已有目录() {
        let c = tmp();
        std::fs::create_dir_all(c.join("工作")).unwrap();
        assert!(create(&c, "工作").is_err(), "悄悄复用已有目录会让人以为新建了空仓库");
    }

    #[test]
    fn 选哪个仓库_上次的优先() {
        let c = tmp();
        vault(&c.join("默认"));
        vault(&c.join("工作"));
        let last = c.join("工作");
        assert_eq!(pick(&c, Some(&last.to_string_lossy())), last);
    }

    #[test]
    fn 选哪个仓库_上次那个没了就退回默认() {
        let c = tmp();
        vault(&c.join("默认"));
        assert_eq!(
            pick(&c, Some(&c.join("删掉了").to_string_lossy())),
            c.join("默认")
        );
    }

    /// recent.json 里可能留着桌面时代的路径，或者上一版指向容器本身的记录。
    /// 那些都不是这个容器的直接子目录，不能认
    #[test]
    fn 选哪个仓库_不认容器外面的路径() {
        let c = tmp();
        vault(&c.join("默认"));
        assert_eq!(pick(&c, Some("D:/Notes/research")), c.join("默认"));
        assert_eq!(pick(&c, Some(&c.to_string_lossy())), c.join("默认"));
    }

    #[test]
    fn 一个仓库都没有时给出默认的路径() {
        let c = tmp();
        assert_eq!(pick(&c, None), c.join(DEFAULT_VAULT));
    }
}
