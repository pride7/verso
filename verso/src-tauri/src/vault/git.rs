//! Git 底座。DESIGN.md §2.8
//!
//! M0 只做一件事：新建/打开 vault 时确保它是个 git 仓库，并写好 .gitignore。
//! 成本几乎为零，但省掉了以后要求用户手动补救。完整的 pull/commit/push
//! 与冲突解决在 M5。

use std::path::Path;

use crate::error::Result;

/// `.verso/` 是纯派生数据（索引缓存、UI 状态），删掉能重建，不该进版本库。
const GITIGNORE: &str = "\
# Verso 私有目录：索引缓存与 UI 状态，纯派生数据，删掉可重建
.verso/

.DS_Store
Thumbs.db
";

pub struct GitInitResult {
    pub created_repo: bool,
    pub created_gitignore: bool,
    /// 把早期版本建出来的空仓库从 master 迁到了 main
    pub renamed_branch: bool,
}

/// 把还没有任何提交的空仓库从 `master` 迁到 `main`。
///
/// 只在**完全空**的仓库上做：没有提交、没有远端。那种状态下分支名纯粹是
/// 个名字，改它不会破坏任何东西。一旦有了提交或远端就绝不碰 —— 悄悄给
/// 用户改分支名可能打断他们和远端的对应关系，也可能人家就是想用 master。
fn migrate_empty_master(repo: &git2::Repository) -> bool {
    if !repo.is_empty().unwrap_or(false) {
        return false;
    }
    if repo.remotes().map(|r| r.len() > 0).unwrap_or(true) {
        return false;
    }
    let is_master = repo
        .find_reference("HEAD")
        .ok()
        .and_then(|h| h.symbolic_target().map(str::to_owned))
        .is_some_and(|t| t == "refs/heads/master");
    if !is_master {
        return false;
    }
    repo.set_head(&format!("refs/heads/{INITIAL_BRANCH}")).is_ok()
}

/// 初始分支名。
///
/// libgit2 默认还是 `master`，且不读 `init.defaultBranch` 这个 git 配置 ——
/// 必须显式指定，否则新建的 vault 会和 GitHub 等平台的默认分支对不上，
/// 第一次推送就得手动改名。
const INITIAL_BRANCH: &str = "main";

/// 幂等：已经是仓库就不动它，已有 .gitignore 也不覆盖
/// （用户可能已经加了自己的规则）。
pub fn ensure_repo(root: &Path) -> Result<GitInitResult> {
    let mut renamed_branch = false;
    let created_repo = match git2::Repository::open(root) {
        Ok(repo) => {
            renamed_branch = migrate_empty_master(&repo);
            false
        }
        Err(_) => {
            let mut opts = git2::RepositoryInitOptions::new();
            opts.initial_head(INITIAL_BRANCH);
            git2::Repository::init_opts(root, &opts)?;
            true
        }
    };

    let gitignore = root.join(".gitignore");
    let created_gitignore = if gitignore.exists() {
        false
    } else {
        std::fs::write(&gitignore, GITIGNORE)?;
        true
    };

    Ok(GitInitResult {
        created_repo,
        created_gitignore,
        renamed_branch,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(std::path::PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp_dir() -> Tmp {
        let d = std::env::temp_dir().join(format!("verso-git-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&d).unwrap();
        Tmp(d)
    }

    /// HEAD 还没有提交时是 unborn，`repo.head()` 会报错 ——
    /// 得读 HEAD 这个符号引用本身。
    fn head_branch(root: &Path) -> String {
        let repo = git2::Repository::open(root).unwrap();
        // 必须先绑到局部变量：Reference 借用 repo，直接作为块的尾表达式
        // 会让这个临时值活得比 repo 还久
        let head = repo.find_reference("HEAD").unwrap();
        let target = head.symbolic_target().unwrap().to_string();
        target
    }

    #[test]
    fn init_uses_main_not_master() {
        let t = tmp_dir();
        let r = ensure_repo(&t.0).unwrap();
        assert!(r.created_repo);
        assert_eq!(head_branch(&t.0), "refs/heads/main");
    }

    #[test]
    fn writes_gitignore_covering_the_private_dir() {
        let t = tmp_dir();
        let r = ensure_repo(&t.0).unwrap();
        assert!(r.created_gitignore);
        let content = std::fs::read_to_string(t.0.join(".gitignore")).unwrap();
        assert!(content.contains(".verso/"), ".verso 是派生数据，必须被忽略");
    }

    /// 打开已有 vault 时不能动它的仓库和 .gitignore —— 用户可能已经加了
    /// 自己的规则，也可能有意用了别的分支名。
    #[test]
    fn is_idempotent_and_leaves_existing_repo_alone() {
        let t = tmp_dir();
        ensure_repo(&t.0).unwrap();
        std::fs::write(t.0.join(".gitignore"), "我自己写的规则\n").unwrap();

        let again = ensure_repo(&t.0).unwrap();

        assert!(!again.created_repo);
        assert!(!again.created_gitignore);
        assert_eq!(
            std::fs::read_to_string(t.0.join(".gitignore")).unwrap(),
            "我自己写的规则\n",
            "不能覆盖用户已有的 .gitignore"
        );
    }

    /// 早期版本建出来的空仓库停在 master。空仓库里分支名纯粹是个名字，
    /// 迁到 main 不会破坏任何东西。
    #[test]
    fn migrates_empty_master_repo_to_main() {
        let t = tmp_dir();
        let mut opts = git2::RepositoryInitOptions::new();
        opts.initial_head("master");
        git2::Repository::init_opts(&t.0, &opts).unwrap();
        assert_eq!(head_branch(&t.0), "refs/heads/master");

        let r = ensure_repo(&t.0).unwrap();

        assert!(r.renamed_branch);
        assert_eq!(head_branch(&t.0), "refs/heads/main");
    }

    /// 一旦有了提交就绝不碰分支名 —— 那可能打断用户和远端的对应关系
    #[test]
    fn leaves_master_alone_once_there_are_commits() {
        let t = tmp_dir();
        // 放进作用域块：index / tree 都借用 repo，让它们按声明的逆序一起析构
        {
            let mut opts = git2::RepositoryInitOptions::new();
            opts.initial_head("master");
            let repo = git2::Repository::init_opts(&t.0, &opts).unwrap();

            std::fs::write(t.0.join("a.md"), "内容").unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("a.md")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let sig = git2::Signature::now("t", "t@example.com").unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "初始", &tree, &[]).unwrap();
        }

        let r = ensure_repo(&t.0).unwrap();

        assert!(!r.renamed_branch);
        assert_eq!(head_branch(&t.0), "refs/heads/master", "有提交就不该改名");
    }
}
