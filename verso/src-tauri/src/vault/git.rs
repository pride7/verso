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

// ---------------------------------------------------------------- 本地提交
//
// M5 的第一块：**只做本地历史**，不碰远端、不处理冲突。
//
// §2.8 的形态是「界面上只有一个同步按钮和一个状态点」，但那要等远端和
// 冲突 UI 都齐了才成立。先把本地这半边做扎实：有了逐次提交，用 AI 改完
// 一整篇也能一眼 diff、一键回退 —— 那是这个软件最容易丢数据的路径（§7.4）。

use serde::Serialize;

/// 仓库现在的样子。给状态栏那个点用。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// 是不是个能用的 git 仓库。用户手动删掉 `.git` 之后就不是了
    pub enabled: bool,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
    /// 三者之和 —— 界面上显示的就是它
    pub dirty: usize,
    /// 上一次提交的说明与时刻（unix 秒）
    pub last_message: Option<String>,
    pub last_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub message: String,
    /// 这一次提交动了几个文件
    pub files: usize,
}

fn status_opts() -> git2::StatusOptions {
    let mut opts = git2::StatusOptions::new();
    // 未跟踪的文件也要算 —— 新建一篇笔记就是一个未跟踪文件，
    // 不算它的话「有改动」永远显示不出来
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        // 被 .gitignore 挡掉的（`.verso/`）不算改动
        .include_ignored(false)
        .include_unmodified(false);
    opts
}

/// 数一数有多少改动。仓库打不开时返回 `enabled: false` 而不是报错 ——
/// 这只是状态栏上的一个点，不该让整个界面因为它起不来。
pub fn status(root: &Path) -> GitStatus {
    let Ok(repo) = git2::Repository::open(root) else {
        return GitStatus::default();
    };
    let mut out = GitStatus {
        enabled: true,
        ..Default::default()
    };

    if let Ok(statuses) = repo.statuses(Some(&mut status_opts())) {
        for e in statuses.iter() {
            let s = e.status();
            if s.is_wt_new() || s.is_index_new() {
                out.added += 1;
            } else if s.is_wt_deleted() || s.is_index_deleted() {
                out.deleted += 1;
            } else {
                out.modified += 1;
            }
        }
    }
    out.dirty = out.added + out.modified + out.deleted;

    if let Ok(head) = repo.head().and_then(|h| h.peel_to_commit()) {
        out.last_message = head.summary().map(str::to_string);
        out.last_at = Some(head.time().seconds());
    }
    out
}

/// 自动生成的提交说明。§2.8：「commit message 自动生成（`更新 3 篇笔记`）」
fn auto_message(s: &GitStatus) -> String {
    let mut parts = Vec::new();
    if s.added > 0 {
        parts.push(format!("新增 {} 个", s.added));
    }
    if s.modified > 0 {
        parts.push(format!("更新 {} 个", s.modified));
    }
    if s.deleted > 0 {
        parts.push(format!("删除 {} 个", s.deleted));
    }
    if parts.is_empty() {
        "保存改动".to_string()
    } else {
        parts.join("、")
    }
}

/// 提交作者。
///
/// 用户没配过 `user.name` / `user.email` 时 libgit2 会直接报错 —— 而那在
/// 一台没写过代码的机器上是常态。回落到一个明确写着是软件自己提交的身份，
/// 比让「保存」这件事失败强得多；用户什么时候配好了，之后的提交就跟着变。
fn signature(repo: &git2::Repository) -> Result<git2::Signature<'static>> {
    match repo.signature() {
        Ok(sig) => Ok(sig.to_owned()),
        Err(_) => Ok(git2::Signature::now("Verso", "verso@localhost")?),
    }
}

/// 把工作区的全部改动提交掉。没有改动时返回 `None`，**不产生空提交**。
///
/// `message` 为 None 时自动生成。暂存用 `add_all` + `update_all` 两步：
/// 前者收新增和修改，后者才收得到**删除** —— 只调 add_all 的话，删掉一篇
/// 笔记永远提交不上去，而这种漏提交要等到换台机器才发现。
pub fn commit_all(root: &Path, message: Option<&str>) -> Result<Option<CommitInfo>> {
    let repo = git2::Repository::open(root)?;
    let st = status(root);
    if st.dirty == 0 {
        return Ok(None);
    }

    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    let tree = repo.find_tree(index.write_tree()?)?;

    let sig = signature(&repo)?;
    let msg = message
        .map(str::to_string)
        .unwrap_or_else(|| auto_message(&st));
    let parents = match repo.head().and_then(|h| h.peel_to_commit()) {
        Ok(c) => vec![c],
        // 第一次提交没有父 —— 空仓库里 HEAD 指向一个还不存在的分支
        Err(_) => vec![],
    };
    let id = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &msg,
        &tree,
        &parents.iter().collect::<Vec<_>>(),
    )?;

    Ok(Some(CommitInfo {
        id: id.to_string(),
        message: msg,
        files: st.dirty,
    }))
}

#[cfg(test)]
mod commit_tests {
    use super::*;

    /// 建好仓库并**先提交一次**：`ensure_repo` 会写出 `.gitignore`，
    /// 那本身就是一个未跟踪文件。不先提交掉的话，下面每条断言都要多算它一个
    fn temp_vault() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("verso-git-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        ensure_repo(&dir).unwrap();
        commit_all(&dir, Some("初始化")).unwrap();
        dir
    }

    #[test]
    fn counts_new_modified_and_deleted() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        let s = status(&dir);
        assert!(s.enabled);
        assert_eq!((s.added, s.modified, s.deleted, s.dirty), (1, 0, 0, 1));

        commit_all(&dir, None).unwrap();
        assert_eq!(status(&dir).dirty, 0, "提交完就该是干净的");

        std::fs::write(dir.join("甲.md"), "二").unwrap();
        std::fs::write(dir.join("乙.md"), "新的").unwrap();
        let s = status(&dir);
        assert_eq!((s.added, s.modified), (1, 1));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 只调 `add_all` 的话删除永远提交不上去，而这种漏提交要等到换台机器才发现
    #[test]
    fn deletions_get_committed_too() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        commit_all(&dir, None).unwrap();

        std::fs::remove_file(dir.join("甲.md")).unwrap();
        assert_eq!(status(&dir).deleted, 1);
        commit_all(&dir, None).unwrap();
        assert_eq!(status(&dir).dirty, 0, "删除也要进提交");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 没有改动时**绝不产生空提交** —— 自动提交每 5 分钟跑一次，
    /// 空提交会把历史冲成一片噪音
    #[test]
    fn no_changes_makes_no_commit() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        assert!(commit_all(&dir, None).unwrap().is_some());
        assert!(commit_all(&dir, None).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn message_says_what_happened() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        std::fs::write(dir.join("乙.md"), "二").unwrap();
        let c = commit_all(&dir, None).unwrap().unwrap();
        assert_eq!(c.message, "新增 2 个");
        assert_eq!(c.files, 2);

        std::fs::write(dir.join("甲.md"), "改了").unwrap();
        assert_eq!(commit_all(&dir, None).unwrap().unwrap().message, "更新 1 个");

        // 自己写的说明优先
        std::fs::write(dir.join("甲.md"), "又改了").unwrap();
        let c = commit_all(&dir, Some("整理了一遍")).unwrap().unwrap();
        assert_eq!(c.message, "整理了一遍");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `.verso/` 是派生数据，进了版本库每次索引都会造出一大堆 diff
    #[test]
    fn ignored_files_never_get_committed() {
        let dir = temp_vault();
        std::fs::create_dir_all(dir.join(".verso")).unwrap();
        std::fs::write(dir.join(".verso/index.db"), "二进制").unwrap();
        std::fs::write(dir.join("甲.md"), "一").unwrap();

        // `.verso/` 整个被忽略，所以只数得出那一篇笔记
        assert_eq!(status(&dir).dirty, 1, ".verso/ 不该算成改动");
        commit_all(&dir, None).unwrap();

        let repo = git2::Repository::open(&dir).unwrap();
        let tree = repo.head().unwrap().peel_to_commit().unwrap().tree().unwrap();
        assert!(tree.get_name(".verso").is_none(), ".verso/ 不该进版本库");
        assert!(tree.get_name("甲.md").is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 没配过 `user.name` 的机器上，提交不能失败 —— 那是「保存」这条路
    #[test]
    fn commits_even_without_a_configured_identity() {
        let dir = temp_vault();
        // 仓库级配置清空，让它只能走回落身份
        let repo = git2::Repository::open(&dir).unwrap();
        let mut cfg = repo.config().unwrap();
        let _ = cfg.remove("user.name");
        let _ = cfg.remove("user.email");

        std::fs::write(dir.join("甲.md"), "一").unwrap();
        assert!(commit_all(&dir, None).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_reports_the_last_commit() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        commit_all(&dir, Some("第一次")).unwrap();

        let s = status(&dir);
        assert_eq!(s.last_message.as_deref(), Some("第一次"));
        assert!(s.last_at.unwrap() > 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 不是仓库时不报错，只是「没这功能」—— 状态栏那个点不该拖垮界面
    #[test]
    fn plain_folder_is_not_enabled() {
        let dir = std::env::temp_dir().join(format!("verso-nogit-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = status(&dir);
        assert!(!s.enabled);
        assert_eq!(s.dirty, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
