//! Git 底座。DESIGN.md §2.8
//!
//! M0 只做一件事：新建/打开 vault 时确保它是个 git 仓库，并写好 .gitignore。
//! 成本几乎为零，但省掉了以后要求用户手动补救。完整的 pull/commit/push
//! 与冲突解决在 M5。

use std::path::Path;

use crate::error::{Error, Result};

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

/// 关掉 libgit2 的「仓库属主校验」。**只在安卓上关。**
///
/// git 的 dubious-ownership 保护（CVE-2022-24765）会拒绝操作一个「属主不是
/// 当前用户」的仓库。安卓的共享存储是一层 FUSE，它合成出来的属主和进程的
/// uid 对不上，于是 `/storage/emulated/0/Verso` 必然被判成别人的仓库：
///
/// ```text
/// repository path '/storage/emulated/0/Verso' is not owned by current user;
/// class=Config (7); code=Owner (-36)
/// ```
///
/// 症状极具迷惑性：`Repository::init` 会成功（`.git/` 建得出来），下一次
/// 打开它才失败 —— 看起来像「目录写了一半」。
///
/// 桌面上**不关**：那里的属主检查是真的安全边界。
#[cfg(target_os = "android")]
fn relax_owner_check() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        let _ = git2::opts::set_verify_owner_validation(false);
    });
}

/// 幂等：已经是仓库就不动它，已有 .gitignore 也不覆盖
/// （用户可能已经加了自己的规则）。
/// 仓库级关掉 autocrlf/eol 转换。
///
/// 用户机器上常见 `core.autocrlf=true`（Git for Windows 安装时的推荐项），
/// 它会让**同步悄悄改写笔记的行尾**：B 推上去的 LF，A 一拉取 checkout 出来
/// 变 CRLF —— 文件字节变了、diff 里满屏「整篇都改了」，而用户什么都没做。
/// 笔记的字节应当原样进原样出，vault 仓库一律仓库级覆盖，不动全局配置
fn forbid_eol_rewrites(repo: &git2::Repository) {
    if let Ok(mut config) = repo.config() {
        let _ = config.set_bool("core.autocrlf", false);
    }
}

pub fn ensure_repo(root: &Path) -> Result<GitInitResult> {
    #[cfg(target_os = "android")]
    relax_owner_check();

    let mut renamed_branch = false;
    let created_repo = match git2::Repository::open(root) {
        Ok(repo) => {
            renamed_branch = migrate_empty_master(&repo);
            forbid_eol_rewrites(&repo);
            false
        }
        Err(_) => {
            let mut opts = git2::RepositoryInitOptions::new();
            opts.initial_head(INITIAL_BRANCH);
            let repo = git2::Repository::init_opts(root, &opts)?;
            forbid_eol_rewrites(&repo);
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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub message: String,
    /// 这一次提交动了几个文件
    pub files: usize,
}

/// 一处改动。`path` 是 vault 相对路径
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Added,
    Modified,
    Deleted,
}

impl Kind {
    fn verb(self) -> &'static str {
        match self {
            Kind::Added => "新增",
            Kind::Modified => "更新",
            Kind::Deleted => "删除",
        }
    }

    fn key(self) -> &'static str {
        match self {
            Kind::Added => "added",
            Kind::Modified => "modified",
            Kind::Deleted => "deleted",
        }
    }
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

/// 逐个列出改动。计数和提交说明都从它来 —— 两处各扫一遍迟早会对不上。
fn changes(repo: &git2::Repository) -> Vec<(Kind, String)> {
    let Ok(statuses) = repo.statuses(Some(&mut status_opts())) else {
        return Vec::new();
    };
    let mut out: Vec<(Kind, String)> = statuses
        .iter()
        .filter_map(|e| {
            let s = e.status();
            let kind = if s.is_wt_new() || s.is_index_new() {
                Kind::Added
            } else if s.is_wt_deleted() || s.is_index_deleted() {
                Kind::Deleted
            } else {
                Kind::Modified
            };
            Some((kind, e.path()?.to_string()))
        })
        .collect();
    // 排个序再返回：git 给的顺序不保证稳定，而这个顺序会进提交说明 ——
    // 同样两个文件、两次提交写出不一样的说明，会让人以为记错了
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
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

    let list = changes(&repo);
    for (kind, _) in &list {
        match kind {
            Kind::Added => out.added += 1,
            Kind::Modified => out.modified += 1,
            Kind::Deleted => out.deleted += 1,
        }
    }
    out.dirty = list.len();

    if let Ok(head) = repo.head().and_then(|h| h.peel_to_commit()) {
        out.last_message = head.summary().map(str::to_string);
        out.last_at = Some(head.time().seconds());
    }
    out
}

/// 一条改动的显示名：笔记用标题（去掉目录和 `.md`），别的文件用原路径。
///
/// 用标题而不是路径：`更新「线性代数」` 一眼看得懂，
/// `更新 数学/线性代数.md` 要在脑子里再翻译一次。完整路径留给正文那几行。
fn display_name(path: &str) -> String {
    // git 的 status 一律给正斜杠，这里仍然把反斜杠也切掉：以后要是有别的
    // 来源塞进 Windows 路径，不至于把整段路径当成文件名
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    file.strip_suffix(".md").unwrap_or(file).to_string()
}

/// 全是 `.md` 时量词用「篇」，混了附件就退回「个」
fn unit(list: &[(Kind, String)]) -> &'static str {
    if list.iter().all(|(_, p)| p.ends_with(".md")) {
        "篇"
    } else {
        "个"
    }
}

/// 自动生成的提交说明。§2.8：「commit message 自动生成（`更新 3 篇笔记`）」
///
/// **改动少的时候直接报名字。** 一屏 `git log` 全是「更新 1 个」等于没记 ——
/// 而人回头翻历史，找的正是「哪一篇」。三条以内列名字，再多就报数目。
fn auto_message(list: &[(Kind, String)]) -> String {
    if list.is_empty() {
        return "保存改动".to_string();
    }

    // 同一类且不超过三条：直接把名字列出来
    let first = list[0].0;
    if list.len() <= 3 && list.iter().all(|(k, _)| *k == first) {
        let names = list
            .iter()
            .map(|(_, p)| format!("「{}」", display_name(p)))
            .collect::<Vec<_>>()
            .join("");
        return format!("{}{}", first.verb(), names);
    }

    let u = unit(list);
    let mut parts = Vec::new();
    for kind in [Kind::Added, Kind::Modified, Kind::Deleted] {
        let n = list.iter().filter(|(k, _)| *k == kind).count();
        if n > 0 {
            parts.push(format!("{} {n} {u}", kind.verb()));
        }
    }
    parts.join("、")
}

/// 提交说明的正文：逐行列出动了哪些文件。
///
/// 摘要那一行只能放三个名字，而「到底动了哪些」才是回头翻历史时要看的。
/// 写成正文之后，任何 git 工具里都读得到。
const BODY_MAX: usize = 20;

fn body(list: &[(Kind, String)]) -> String {
    let mut lines: Vec<String> = list
        .iter()
        .take(BODY_MAX)
        .map(|(k, p)| format!("{}  {p}", k.verb()))
        .collect();
    if list.len() > BODY_MAX {
        lines.push(format!("…… 还有 {} 个", list.len() - BODY_MAX));
    }
    lines.join("
")
}

/// 提交作者。
///
/// 用户没配过 `user.name` / `user.email` 时 libgit2 会直接报错 —— 而那在
/// 一台没写过代码的机器上是常态。回落到一个明确写着是软件自己提交的身份，
/// 比让「保存」这件事失败强得多；用户什么时候配好了，之后的提交就跟着变。
pub(super) fn signature(repo: &git2::Repository) -> Result<git2::Signature<'static>> {
    match repo.signature() {
        Ok(sig) => Ok(sig.to_owned()),
        Err(_) => Ok(git2::Signature::now("Verso", "verso@localhost")?),
    }
}

/// 提交署名。设置「同步」页读写的就是它。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// 生效的署名：仓库级配置优先，其次本机全局。两者都没有时是 None ——
/// 那时提交挂的是上面 `signature()` 的回落身份「Verso」。
pub fn identity_get(root: &Path) -> Result<Identity> {
    let repo = git2::Repository::open(root)?;
    let cfg = repo.config()?.snapshot()?;
    let get = |key: &str| {
        cfg.get_string(key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    Ok(Identity {
        name: get("user.name"),
        email: get("user.email"),
    })
}

/// 把署名写进 vault 仓库级配置（`.git/config`）。**不动全局** —— 一个笔记
/// 软件没有资格改用户整台机器的 git 身份。传空串 = 清掉仓库级的那一条，
/// 回到全局配置。
pub fn identity_set(root: &Path, name: &str, email: &str) -> Result<Identity> {
    let entries = [("user.name", name.trim()), ("user.email", email.trim())];
    // 先整体校验再写：名字合法、邮箱非法时不能只写进去一半。
    // git 的身份行是 `名字 <邮箱>`，这几个字符会把它撕开 ——
    // libgit2 建 Signature 时也会拒绝，但那时报的错跟「保存」对不上号
    if entries.iter().any(|(_, v)| v.contains(['<', '>', '\n'])) {
        return Err(Error::Vault("署名和邮箱里不能有尖括号或换行".into()));
    }

    let repo = git2::Repository::open(root)?;
    let mut local = repo.config()?.open_level(git2::ConfigLevel::Local)?;
    for (key, value) in entries {
        if value.is_empty() {
            // 本来就没配过时 remove 会报错 —— 那不是错误
            let _ = local.remove(key);
        } else {
            local.set_str(key, value)?;
        }
    }
    drop(local);
    identity_get(root)
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

    let list = changes(&repo);
    let sig = signature(&repo)?;
    // 自己写的说明也配上文件清单 —— 「整理了一遍」同样需要知道动了哪些
    let msg = format!(
        "{}

{}",
        message.map(str::to_string).unwrap_or_else(|| auto_message(&list)),
        body(&list)
    );
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
        // 只把摘要那一行报给界面：正文是给 git log 看的
        id: id.to_string(),
        message: msg.lines().next().unwrap_or_default().to_string(),
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

    /// **一屏 `git log` 全是「更新 1 个」等于没记。** 三条以内直接报名字，
    /// 再多才报数目 —— 人回头翻历史，找的正是「哪一篇」。
    #[test]
    fn message_names_the_notes_when_there_are_few() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        assert_eq!(commit_all(&dir, None).unwrap().unwrap().message, "新增「甲」");

        std::fs::write(dir.join("乙.md"), "二").unwrap();
        std::fs::write(dir.join("丙.md"), "三").unwrap();
        // 顺序按路径排，两次提交写出来的说明才是稳定的
        assert_eq!(
            commit_all(&dir, None).unwrap().unwrap().message,
            "新增「丙」「乙」"
        );

        std::fs::write(dir.join("甲.md"), "改了").unwrap();
        assert_eq!(commit_all(&dir, None).unwrap().unwrap().message, "更新「甲」");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 超过三条、或者动作不止一种时报数目，量词跟着内容走
    #[test]
    fn message_counts_when_there_are_many() {
        let dir = temp_vault();
        for n in ["甲", "乙", "丙", "丁"] {
            std::fs::write(dir.join(format!("{n}.md")), "x").unwrap();
        }
        assert_eq!(commit_all(&dir, None).unwrap().unwrap().message, "新增 4 篇");

        // 混了动作就分开说
        // 动作不止一种时分开说，哪怕只有两个文件 —— 「更新 1 篇、删除 1 篇」
        // 比硬凑成一句「改了 2 篇」准确
        std::fs::write(dir.join("甲.md"), "改了").unwrap();
        std::fs::remove_file(dir.join("乙.md")).unwrap();
        assert_eq!(
            commit_all(&dir, None).unwrap().unwrap().message,
            "更新 1 篇、删除 1 篇"
        );

        // 混进非笔记文件、且多到要报数目时，量词退回「个」
        std::fs::create_dir_all(dir.join("attachments")).unwrap();
        std::fs::write(dir.join("attachments/图.png"), "x").unwrap();
        for n in ["戊", "己", "庚"] {
            std::fs::write(dir.join(format!("{n}.md")), "x").unwrap();
        }
        assert_eq!(commit_all(&dir, None).unwrap().unwrap().message, "新增 4 个");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 摘要那一行放不下几个名字，**正文逐行列出动了哪些文件** ——
    /// 那才是回头翻历史时真正要看的
    #[test]
    fn body_lists_every_file() {
        let dir = temp_vault();
        std::fs::create_dir_all(dir.join("数学")).unwrap();
        std::fs::write(dir.join("数学/线性代数.md"), "一").unwrap();
        std::fs::write(dir.join("甲.md"), "二").unwrap();
        std::fs::write(dir.join("乙.md"), "三").unwrap();
        std::fs::write(dir.join("丙.md"), "四").unwrap();
        commit_all(&dir, None).unwrap();

        let repo = git2::Repository::open(&dir).unwrap();
        let full = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .message()
            .unwrap()
            .to_string();

        assert!(full.starts_with("新增 4 篇"));
        assert!(full.contains("新增  数学/线性代数.md"), "正文要带完整路径：
{full}");
        assert!(full.contains("新增  甲.md"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 自己写的说明优先，但**文件清单照样附上**
    #[test]
    fn custom_message_still_gets_the_file_list() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        let c = commit_all(&dir, Some("整理了一遍")).unwrap().unwrap();
        assert_eq!(c.message, "整理了一遍", "报给界面的只有摘要那一行");

        let repo = git2::Repository::open(&dir).unwrap();
        let full = repo.head().unwrap().peel_to_commit().unwrap().message().unwrap().to_string();
        assert!(full.starts_with("整理了一遍"));
        assert!(full.contains("新增  甲.md"));

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

    #[test]
    fn history_lists_commits_newest_first() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        commit_all(&dir, Some("第一步")).unwrap();
        std::fs::write(dir.join("乙.md"), "二").unwrap();
        commit_all(&dir, Some("第二步")).unwrap();

        let h = history(&dir, 10).unwrap();
        assert_eq!(h[0].message, "第二步", "新的在前");
        assert_eq!(h[1].message, "第一步");
        assert!(h[0].at >= h[1].at);
        assert!(!h[0].author_name.is_empty());
        assert!(h[0].author_email.is_some());
        assert!(h[0].detail.contains("新增  乙.md"));
        assert_eq!((h[0].additions, h[0].deletions), (1, 0));
        assert_eq!(h.len(), 3, "还有一条「初始化」");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 动了哪些文件**从 diff 算**，不解析我们自己写进正文的那几行 ——
    /// 用户自己写说明时会把那几行整段替换掉
    #[test]
    fn history_files_come_from_the_diff() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "一").unwrap();
        commit_all(&dir, None).unwrap();

        std::fs::write(dir.join("甲.md"), "改了").unwrap();
        std::fs::write(dir.join("乙.md"), "新的").unwrap();
        std::fs::remove_file(dir.join(".gitignore")).unwrap();
        commit_all(&dir, Some("随手写的说明")).unwrap();

        let h = history(&dir, 1).unwrap();
        let mut got: Vec<_> = h[0].files.iter().map(|f| (f.path.as_str(), f.kind)).collect();
        got.sort();
        assert_eq!(
            got,
            vec![(".gitignore", "deleted"), ("乙.md", "added"), ("甲.md", "modified")]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn review_records_are_versioned_but_hidden_from_content_activity() {
        let dir = temp_vault();
        std::fs::create_dir_all(dir.join(".verso-reviews")).unwrap();
        std::fs::write(dir.join(".verso-reviews/review.json"), "{\n  \"version\": 1\n}\n").unwrap();
        std::fs::write(dir.join("甲.md"), "正文\n").unwrap();
        commit_all(&dir, Some("接受修改建议")).unwrap();

        let entry = &history(&dir, 1).unwrap()[0];
        assert_eq!(entry.files.len(), 1);
        assert_eq!(entry.files[0].path, "甲.md");
        assert_eq!((entry.additions, entry.deletions), (1, 0));

        let repo = git2::Repository::open(&dir).unwrap();
        let tree = repo.head().unwrap().peel_to_commit().unwrap().tree().unwrap();
        assert!(tree.get_name(".verso-reviews").is_some(), "审阅结论必须随正式版本同步");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_of_a_repo_without_commits_is_empty_not_an_error() {
        let dir = std::env::temp_dir().join(format!("verso-git-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        ensure_repo(&dir).unwrap();
        assert_eq!(history(&dir, 10).unwrap().len(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 回退一篇：取出那一版的内容。**写盘不在这儿** —— 那要走 VaultFs
    #[test]
    fn file_at_reads_an_old_version() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "第一版").unwrap();
        commit_all(&dir, None).unwrap();
        let old = history(&dir, 1).unwrap()[0].id.clone();

        std::fs::write(dir.join("甲.md"), "第二版").unwrap();
        commit_all(&dir, None).unwrap();

        assert_eq!(file_at(&dir, &old, "甲.md").unwrap(), "第一版");
        // 那一版里没有的文件要说清楚，而不是给个空串
        assert!(file_at(&dir, &old, "不存在.md").is_err());
        assert!(file_at(&dir, "乱写的", "甲.md").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn working_changes_and_diff_include_modified_and_new_files() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "第一行\n旧内容\n最后一行\n").unwrap();
        commit_all(&dir, None).unwrap();

        std::fs::write(dir.join("甲.md"), "第一行\n新内容\n最后一行\n").unwrap();
        std::fs::write(dir.join("乙.md"), "新笔记\n").unwrap();

        let files = working_changes(&dir).unwrap();
        assert_eq!(
            files
                .iter()
                .map(|f| (f.path.as_str(), f.kind))
                .collect::<Vec<_>>(),
            vec![("乙.md", "added"), ("甲.md", "modified")]
        );

        let changed = diff_file(&dir, None, "甲.md").unwrap();
        assert_eq!((changed.additions, changed.deletions), (1, 1));
        let lines = &changed.hunks[0].lines;
        assert!(lines
            .iter()
            .any(|line| line.kind == "deleted" && line.text == "旧内容"));
        assert!(lines
            .iter()
            .any(|line| line.kind == "added" && line.text == "新内容"));

        let added = diff_file(&dir, None, "乙.md").unwrap();
        assert_eq!(added.kind, "added");
        assert_eq!((added.additions, added.deletions), (1, 0));

        commit_all(&dir, None).unwrap();
        std::fs::remove_file(dir.join("甲.md")).unwrap();
        let deleted = diff_file(&dir, None, "甲.md").unwrap();
        assert_eq!(deleted.kind, "deleted");
        assert_eq!((deleted.additions, deleted.deletions), (0, 3));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discarding_restores_tracked_files_and_removes_new_files() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), b"old\n").unwrap();
        commit_all(&dir, None).unwrap();

        std::fs::write(dir.join("甲.md"), b"new\n").unwrap();
        std::fs::write(dir.join("乙.md"), b"untracked\n").unwrap();

        let old = file_at_head(&dir, "甲.md").unwrap().unwrap();
        std::fs::write(dir.join("甲.md"), old).unwrap();
        reset_index_file(&dir, "甲.md").unwrap();
        assert_eq!(std::fs::read(dir.join("甲.md")).unwrap(), b"old\n");

        assert!(file_at_head(&dir, "乙.md").unwrap().is_none());
        std::fs::remove_file(dir.join("乙.md")).unwrap();
        reset_index_file(&dir, "乙.md").unwrap();
        assert_eq!(status(&dir).dirty, 0);

        // 已跟踪文件被删掉时同样从 HEAD 取回，不把“撤销删除”误当成新文件。
        std::fs::remove_file(dir.join("甲.md")).unwrap();
        let old = file_at_head(&dir, "甲.md").unwrap().unwrap();
        std::fs::write(dir.join("甲.md"), old).unwrap();
        reset_index_file(&dir, "甲.md").unwrap();
        assert_eq!(status(&dir).dirty, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discarding_also_clears_a_staged_change_for_that_file_only() {
        let dir = temp_vault();
        std::fs::write(dir.join("a[1].md"), b"old\n").unwrap();
        std::fs::write(dir.join("other.md"), b"other old\n").unwrap();
        commit_all(&dir, None).unwrap();

        std::fs::write(dir.join("a[1].md"), b"staged\n").unwrap();
        std::fs::write(dir.join("other.md"), b"keep staged\n").unwrap();
        let repo = git2::Repository::open(&dir).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a[1].md")).unwrap();
        index.add_path(Path::new("other.md")).unwrap();
        index.write().unwrap();

        let old = file_at_head(&dir, "a[1].md").unwrap().unwrap();
        std::fs::write(dir.join("a[1].md"), old).unwrap();
        reset_index_file(&dir, "a[1].md").unwrap();

        let files = working_changes(&dir).unwrap();
        assert_eq!(
            files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            vec!["other.md"],
            "literal 路径只能撤销目标文件，不能把方括号当通配符"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn historical_diff_compares_a_commit_with_its_parent() {
        let dir = temp_vault();
        std::fs::write(dir.join("甲.md"), "之前\n").unwrap();
        commit_all(&dir, None).unwrap();
        std::fs::write(dir.join("甲.md"), "之后\n").unwrap();
        let commit = commit_all(&dir, Some("改写甲")).unwrap().unwrap();

        let diff = diff_file(&dir, Some(&commit.id), "甲.md").unwrap();
        assert_eq!(diff.kind, "modified");
        assert_eq!((diff.additions, diff.deletions), (1, 1));
        let lines = &diff.hunks[0].lines;
        assert_eq!(lines[0].text, "之前");
        assert_eq!(lines[0].kind, "deleted");
        assert_eq!(lines[1].text, "之后");
        assert_eq!(lines[1].kind, "added");

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

#[cfg(test)]
mod identity_tests {
    use super::*;

    fn temp_vault() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("verso-ident-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        ensure_repo(&dir).unwrap();
        commit_all(&dir, Some("初始化")).unwrap();
        dir
    }

    /// 设置里存的署名要真的出现在之后的提交上 —— 不然历史侧栏里
    /// 多台机器全显示「Verso」，分不清是谁改的
    #[test]
    fn saved_identity_signs_the_next_commit() {
        let dir = temp_vault();
        let id = identity_set(&dir, " 冯 ", "x@example.com").unwrap();
        assert_eq!(id.name.as_deref(), Some("冯"), "首尾空白要修剪掉");
        assert_eq!(id.email.as_deref(), Some("x@example.com"));

        std::fs::write(dir.join("甲.md"), "一").unwrap();
        commit_all(&dir, None).unwrap();
        let h = history(&dir, 1).unwrap();
        assert_eq!(h[0].author_name, "冯");
        assert_eq!(h[0].author_email.as_deref(), Some("x@example.com"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 清空 = 只删仓库级的条目，回到全局配置 —— 绝不动 `~/.gitconfig`
    #[test]
    fn empty_clears_only_the_repo_level_entry() {
        let dir = temp_vault();
        identity_set(&dir, "某人", "a@b.c").unwrap();
        identity_set(&dir, "", "").unwrap();
        // 再清一次也不该报错（remove 一个不存在的键）
        identity_set(&dir, "", "").unwrap();

        let repo = git2::Repository::open(&dir).unwrap();
        let local = repo
            .config()
            .unwrap()
            .open_level(git2::ConfigLevel::Local)
            .unwrap();
        assert!(local.get_string("user.name").is_err(), "仓库级条目应当被删掉");
        assert!(local.get_string("user.email").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `名字 <邮箱>` 这一行会被尖括号撕开 —— 在「保存」这一步就要拦下来，
    /// 不能等到提交时被 libgit2 静默换成回落身份
    #[test]
    fn angle_brackets_and_newlines_are_rejected() {
        let dir = temp_vault();
        assert!(identity_set(&dir, "a<b>", "x@y.z").is_err());
        assert!(identity_set(&dir, "好名字", "a@b\nc").is_err());
        // 拦下来之后什么都不该写进去
        let repo = git2::Repository::open(&dir).unwrap();
        let local = repo
            .config()
            .unwrap()
            .open_level(git2::ConfigLevel::Local)
            .unwrap();
        assert!(local.get_string("user.name").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ---------------------------------------------------------------- 历史与回退

/// 一次提交，给侧栏的历史面板用
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// 摘要那一行。侧栏用它，悬浮信息卡再显示下面的 `detail`
    pub message: String,
    /// 摘要下面的完整说明。自动记录时这里是逐行文件清单，手写说明则原样保留
    pub detail: String,
    pub author_name: String,
    pub author_email: Option<String>,
    /// unix 秒
    pub at: i64,
    pub files: Vec<FileChange>,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// `added` | `modified` | `deleted` | `renamed`
    pub kind: &'static str,
}

/// 当前还没记进版本历史的文件清单。
///
/// 和状态栏、自动说明共用 `changes`：三处各扫一遍的话，最容易出现状态栏说
/// 3 个、侧栏只列 2 个这种很难解释的分叉。
pub fn working_changes(root: &Path) -> Result<Vec<FileChange>> {
    let repo = git2::Repository::open(root)?;
    Ok(changes(&repo)
        .into_iter()
        .map(|(kind, path)| FileChange {
            path,
            kind: kind.key(),
        })
        .collect())
}

/// HEAD 里某个文件的原始内容。`None` 表示它还没有被记进任何版本。
///
/// 返回字节而不是字符串：当前改动也会列附件，撤销图片时不能先经过 UTF-8。
pub fn file_at_head(root: &Path, path: &str) -> Result<Option<Vec<u8>>> {
    let repo = git2::Repository::open(root)?;
    let Some(tree) = repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .and_then(|commit| commit.tree().ok())
    else {
        return Ok(None);
    };
    let Ok(entry) = tree.get_path(Path::new(path)) else {
        return Ok(None);
    };
    let blob = repo.find_blob(entry.id())?;
    Ok(Some(blob.content().to_vec()))
}

/// 只撤销选中的那几行改动，其余留在工作区（§2.8）。
///
/// `rejected` 里是「要撤销的那些行」在 `diff_file(None, path)` 结果里的坐标：
/// `(第几个 hunk, 这个 hunk 里的第几行)`。返回撤销之后的**全文**，写盘由调用方
/// 负责 —— 组装本身不碰文件系统，才能在单测里穷举各种行尾和边界。
///
/// 三种行各自的含义：
///
/// - `context`：两边都有，原样抄工作区那一行
/// - `added`：工作区有、上一版没有。撤销它 = 从工作区去掉
/// - `deleted`：上一版有、工作区没有。撤销它 = 把它加回来
pub fn compose_partial_revert(working: &str, diff: &FileDiff, rejected: &[(usize, usize)]) -> String {
    // 保留行尾：`split_inclusive` 让每一项自带换行符，抄回去就是原字节。
    // 用 `lines()` 再 join 会把没动过的那些行的行尾也统一掉，于是一次
    // 「撤销三行」在下一个 diff 里变成整篇都改了（这个仓库里 CRLF/LF 是混的）
    let lines: Vec<&str> = working.split_inclusive('\n').collect();
    let newline = if working.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = String::with_capacity(working.len());
    let mut at = 0usize;

    for (hi, hunk) in diff.hunks.iter().enumerate() {
        // `new_lines == 0` 是纯删除：unified diff 里那个行号说的是「删掉的
        // 内容原来在这一行**之后**」，不减一
        let start = if hunk.new_lines == 0 {
            hunk.new_start as usize
        } else {
            (hunk.new_start as usize).saturating_sub(1)
        };
        for line in lines.iter().take(start).skip(at) {
            out.push_str(line);
        }
        at = at.max(start);

        for (li, line) in hunk.lines.iter().enumerate() {
            let undo = rejected.contains(&(hi, li));
            match line.kind {
                "context" => {
                    match lines.get(at) {
                        Some(text) => out.push_str(text),
                        None => {
                            out.push_str(&line.text);
                            out.push_str(newline);
                        }
                    }
                    at += 1;
                }
                "added" => {
                    if !undo {
                        if let Some(text) = lines.get(at) {
                            out.push_str(text);
                        }
                    }
                    at += 1;
                }
                "deleted" => {
                    if undo {
                        out.push_str(&line.text);
                        out.push_str(newline);
                    }
                }
                _ => {}
            }
        }
    }
    for line in lines.iter().skip(at) {
        out.push_str(line);
    }
    out
}

/// 只把索引里的这一条恢复到 HEAD；工作区内容由 `VaultFs` 写回。
///
/// Verso 自己不暴露暂存区，但外部工具可能留下 staged 改动。只改工作区的话，
/// 侧栏仍会把那条 staged 改动列出来，看起来像「撤销没生效」。这里直接按精确
/// 路径更新一条 index entry，不走 pathspec；文件名里的 `[`、`*` 不是通配符。
pub fn reset_index_file(root: &Path, path: &str) -> Result<()> {
    let repo = git2::Repository::open(root)?;
    let mut index = repo.index()?;
    let repo_path = Path::new(path);
    if index.conflict_get(repo_path).is_ok() {
        index.conflict_remove(repo_path)?;
    }
    let head_entry = repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .and_then(|commit| commit.tree().ok())
        .and_then(|tree| tree.get_path(repo_path).ok());

    if let Some(head_entry) = head_entry {
        let blob = repo.find_blob(head_entry.id())?;
        let mut entry = index.get_path(repo_path, 0).unwrap_or(git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: head_entry.filemode() as u32,
            uid: 0,
            gid: 0,
            file_size: 0,
            id: head_entry.id(),
            flags: (path.len().min(0x0fff)) as u16,
            flags_extended: 0,
            path: path.as_bytes().to_vec(),
        });
        entry.id = head_entry.id();
        entry.mode = head_entry.filemode() as u32;
        entry.file_size = blob.size().min(u32::MAX as usize) as u32;
        // stage 位在 flags 的高两位；恢复后必须回到普通 stage 0。
        entry.flags &= 0x3fff;
        index.add(&entry)?;
    } else if index.get_path(repo_path, 0).is_some() {
        index.remove_path(repo_path)?;
    }
    index.write()?;
    Ok(())
}

/// 对比视图里的一行。行号缺失的一侧用 `None`：新增行没有旧行号，删除反之。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// `context` | `added` | `deleted`
    pub kind: &'static str,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// 一篇文件的逐行差异。只传 Git 已经裁过上下文的 hunk，不把两份完整笔记
/// 都经 IPC 搬到前端；长文只有几处小改时，这个差别很大。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    /// `added` | `modified` | `deleted` | `renamed`
    pub kind: &'static str,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

fn diff_kind(delta: git2::Delta) -> &'static str {
    match delta {
        git2::Delta::Added | git2::Delta::Untracked => "added",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Renamed => "renamed",
        _ => "modified",
    }
}

fn line_text(bytes: &[u8]) -> String {
    // libgit2 把换行也放进 content。视图按“一项就是一行”渲染，留下它会让
    // <pre> 自己再多撑一行；只拿掉一组行尾，正文末尾的空格必须原样保留。
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

/// 从一个 Patch 里抽出 (新增行数, 删除行数, hunk 列表)。
/// `diff_file` 和 `diff_texts` 共用 —— 两边的渲染结构必须一字不差，
/// 冲突 UI 直接复用历史对比的那套组件
fn hunks_from_patch(patch: &git2::Patch<'_>) -> Result<(usize, usize, Vec<DiffHunk>)> {
    let (_, additions, deletions) = patch.line_stats()?;
    let mut hunks = Vec::with_capacity(patch.num_hunks());
    for hunk_index in 0..patch.num_hunks() {
        let (header, line_count) = patch.hunk(hunk_index)?;
        let mut lines = Vec::with_capacity(line_count);
        for line_index in 0..line_count {
            let line = patch.line_in_hunk(hunk_index, line_index)?;
            let kind = match line.origin() {
                '+' => "added",
                '-' => "deleted",
                ' ' => "context",
                // `No newline at end of file` 是元信息，不是正文的一行。少画这句
                // 比给它编一个行号更准确。
                _ => continue,
            };
            lines.push(DiffLine {
                kind,
                old_line: line.old_lineno(),
                new_line: line.new_lineno(),
                text: line_text(line.content()),
            });
        }
        hunks.push(DiffHunk {
            old_start: header.old_start(),
            old_lines: header.old_lines(),
            new_start: header.new_start(),
            new_lines: header.new_lines(),
            lines,
        });
    }
    Ok((additions, deletions, hunks))
}

fn file_diff_from_git(diff: &git2::Diff<'_>, path: &str) -> Result<FileDiff> {
    let delta = diff
        .deltas()
        .next()
        .ok_or_else(|| Error::Vault(format!("{path} 在这里没有变化")))?;
    let kind = diff_kind(delta.status());
    let Some(patch) = git2::Patch::from_diff(diff, 0)? else {
        // libgit2 对二进制文件不给 patch。仍然给出文件级变化，让界面能明确
        // 说明“有变化但不能逐行比较”，而不是像没点中一样空白。
        return Ok(FileDiff {
            path: path.to_string(),
            kind,
            additions: 0,
            deletions: 0,
            binary: true,
            hunks: Vec::new(),
        });
    };

    let (additions, deletions, hunks) = hunks_from_patch(&patch)?;
    Ok(FileDiff {
        path: path.to_string(),
        kind,
        additions,
        deletions,
        binary: false,
        hunks,
    })
}

/// 两段文本的逐行差异，结构与 `diff_file` 完全一致。
/// 冲突 UI 用它对比「本地 vs 远端」—— 旧的一侧是本地、新的一侧是远端，
/// 前端按 hunk 选边后用本地全文 + hunk 行号拼定稿
pub fn diff_texts(path: &str, old: &str, new: &str) -> Result<FileDiff> {
    let mut opts = git2::DiffOptions::new();
    opts.context_lines(3);
    let patch = git2::Patch::from_buffers(
        old.as_bytes(),
        None,
        new.as_bytes(),
        None,
        Some(&mut opts),
    )?;
    let (additions, deletions, hunks) = hunks_from_patch(&patch)?;
    Ok(FileDiff {
        path: path.to_string(),
        kind: "modified",
        additions,
        deletions,
        binary: false,
        hunks,
    })
}

fn diff_options(path: &str) -> git2::DiffOptions {
    let mut opts = git2::DiffOptions::new();
    opts.context_lines(3)
        // 路径来自侧栏，看似可信，但最终仍是前端参数。禁掉 glob 后，文件名里
        // 的 `[` `*` 不会意外匹配到别的笔记。
        .disable_pathspec_match(true)
        .pathspec(path);
    opts
}

/// 对比一篇文件。
///
/// `commit = None`：HEAD 与当前工作区；`Some`：那次提交与它的上一版。
/// 这两条正好对应侧栏的「当前改动」和「版本记录」。
pub fn diff_file(root: &Path, commit: Option<&str>, path: &str) -> Result<FileDiff> {
    let repo = git2::Repository::open(root)?;
    let mut opts = diff_options(path);

    if let Some(commit) = commit {
        let oid = git2::Oid::from_str(commit)
            .map_err(|_| Error::Vault(format!("看不懂的版本号：{commit}")))?;
        let current = repo.find_commit(oid)?;
        let new_tree = current.tree()?;
        let old_tree = current.parent(0).ok().and_then(|p| p.tree().ok());
        let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))?;
        file_diff_from_git(&diff, path)
    } else {
        // HEAD 不存在就是一个还没记过任何版本的新 vault；和空树比较即可。
        let old_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| c.tree().ok());
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        let diff = repo.diff_tree_to_workdir_with_index(old_tree.as_ref(), Some(&mut opts))?;
        file_diff_from_git(&diff, path)
    }
}

/// 这一次提交动了哪些文件。
///
/// **从 diff 算，不解析我们自己写进正文的那几行** —— 那几行是给人看的，
/// 而且用户自己写说明时可能整段替换掉。历史面板要的是事实。
fn commit_files(repo: &git2::Repository, c: &git2::Commit) -> (Vec<FileChange>, usize, usize) {
    let new_tree = match c.tree() {
        Ok(t) => t,
        Err(_) => return (Vec::new(), 0, 0),
    };
    // 第一次提交没有父：和「空」比，于是所有文件都算新增
    let old_tree = c.parent(0).ok().and_then(|p| p.tree().ok());
    let Ok(diff) = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None) else {
        return (Vec::new(), 0, 0);
    };

    let mut files = Vec::new();
    let mut additions = 0;
    let mut deletions = 0;
    for (index, delta) in diff.deltas().enumerate() {
        let Some(path) = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|path| path.to_string_lossy().into_owned())
        else {
            continue;
        };
        // 审阅结论是需要同步的团队事实，但不是用户笔记。活动流保留这次
        // 「接受/退回」的提交说明，不把内部 JSON 假装成一篇文档或统计它的行数。
        if path.starts_with(".verso-reviews/") {
            continue;
        }
        let kind = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Renamed => "renamed",
            _ => "modified",
        };
        files.push(FileChange { path, kind });
        if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, index) {
            if let Ok((_, added, deleted)) = patch.line_stats() {
                additions += added;
                deletions += deleted;
            }
        }
    }
    (files, additions, deletions)
}

/// 最近的若干次提交，新的在前。仓库还没有任何提交时返回空表，不报错。
pub fn history(root: &Path, limit: usize) -> Result<Vec<HistoryEntry>> {
    let repo = git2::Repository::open(root)?;
    // 空仓库（一次都没提交过）里 revwalk.push_head 会失败 —— 那不是错误
    let Ok(mut walk) = repo.revwalk() else {
        return Ok(Vec::new());
    };
    if walk.push_head().is_err() {
        return Ok(Vec::new());
    }
    // **TOPOLOGICAL 不能少。** 提交时间只精确到秒，同一秒里的两次提交
    // （自动记完手动又记一次）光按时间排会给出随机的先后；拓扑序保证
    // 子提交永远排在它的父提交前面
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;

    let mut out = Vec::new();
    for oid in walk.take(limit) {
        let Ok(oid) = oid else { continue };
        let Ok(c) = repo.find_commit(oid) else {
            continue;
        };
        let (files, additions, deletions) = commit_files(&repo, &c);
        let full = c.message().unwrap_or("");
        let detail = full
            .split_once('\n')
            .map(|(_, rest)| rest.trim().to_string())
            .unwrap_or_default();
        let author = c.author();
        out.push(HistoryEntry {
            id: c.id().to_string(),
            message: c.summary().unwrap_or("").to_string(),
            detail,
            author_name: author.name().unwrap_or("未知作者").to_string(),
            author_email: author.email().map(str::to_string),
            at: c.time().seconds(),
            files,
            additions,
            deletions,
        });
    }
    Ok(out)
}

/// 取某一次提交里某个文件的内容。回退单篇笔记用。
///
/// 只做「读出来」这一半，**写回磁盘交给 `Vault`** —— 业务代码只走 `VaultFs`
/// （§1.2 移动端要换实现），而且那条路会给文件监听打上「是我自己写的」标记，
/// 不然回退完会被当成外部修改再弹一条提示。
pub fn file_at(root: &Path, commit: &str, path: &str) -> Result<String> {
    let repo = git2::Repository::open(root)?;
    let oid = git2::Oid::from_str(commit)
        .map_err(|_| Error::Vault(format!("看不懂的版本号：{commit}")))?;
    let tree = repo.find_commit(oid)?.tree()?;
    let entry = tree
        .get_path(Path::new(path))
        .map_err(|_| Error::Vault(format!("这一版里没有 {path}")))?;
    let blob = repo.find_blob(entry.id())?;
    String::from_utf8(blob.content().to_vec())
        .map_err(|_| Error::Vault(format!("{path} 不是文本，没法回退")))
}

#[cfg(test)]
mod partial_revert_tests {
    use super::*;

    /// 造一份「上一版 → 工作区」的差异，和界面上看到的是同一份
    fn diff(old: &str, new: &str) -> FileDiff {
        diff_texts("甲.md", old, new).unwrap()
    }

    /// 每个 hunk 里第几行是什么类型 —— 挑「要撤销哪几行」时要靠它数
    fn kinds(d: &FileDiff) -> Vec<Vec<&'static str>> {
        d.hunks.iter().map(|h| h.lines.iter().map(|l| l.kind).collect()).collect()
    }

    #[test]
    fn revert_nothing_keeps_the_file_byte_for_byte() {
        let old = "甲\n乙\n丙\n";
        let new = "甲\n改过的乙\n丙\n";
        assert_eq!(compose_partial_revert(new, &diff(old, new), &[]), new);
    }

    #[test]
    fn reverting_an_added_line_drops_it() {
        let old = "甲\n乙\n";
        let new = "甲\n新的一行\n乙\n";
        let d = diff(old, new);
        let at = kinds(&d)[0].iter().position(|k| *k == "added").unwrap();
        assert_eq!(compose_partial_revert(new, &d, &[(0, at)]), old);
    }

    #[test]
    fn reverting_a_deleted_line_puts_it_back() {
        let old = "甲\n乙\n丙\n";
        let new = "甲\n丙\n";
        let d = diff(old, new);
        let at = kinds(&d)[0].iter().position(|k| *k == "deleted").unwrap();
        assert_eq!(compose_partial_revert(new, &d, &[(0, at)]), old);
    }

    /// 这条是这个功能存在的理由：一处撤销、一处留下
    #[test]
    fn one_change_reverted_the_other_kept() {
        // 中间要隔开七行以上，否则两处会被算进同一个 hunk（上下文各三行）
        let filler = "中间\n".repeat(9);
        let old = format!("第一段\n{filler}第二段\n");
        let new = format!("第一段改了\n{filler}第二段也改了\n");
        let (old, new) = (old.as_str(), new.as_str());
        let d = diff(old, new);
        assert_eq!(d.hunks.len(), 2, "两处离得够远，应当是两个 hunk");

        // 只撤销第一个 hunk 里那一对（删掉的加回来、加上的去掉）
        let first: Vec<(usize, usize)> = d.hunks[0]
            .lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.kind != "context")
            .map(|(i, _)| (0, i))
            .collect();
        let out = compose_partial_revert(new, &d, &first);
        assert!(out.starts_with("第一段\n"), "第一处该回到上一版：{out}");
        assert!(out.contains("第二段也改了"), "第二处不该被动：{out}");
    }

    /// 撤销全部 = 和整篇丢弃同一个结果
    #[test]
    fn reverting_every_line_equals_discarding_the_file() {
        let old = "甲\n乙\n丙\n丁\n";
        let new = "甲\n改了乙\n丙\n";
        let d = diff(old, new);
        let all: Vec<(usize, usize)> = d
            .hunks
            .iter()
            .enumerate()
            .flat_map(|(hi, h)| {
                h.lines
                    .iter()
                    .enumerate()
                    .filter(|(_, l)| l.kind != "context")
                    .map(move |(li, _)| (hi, li))
            })
            .collect();
        assert_eq!(compose_partial_revert(new, &d, &all), old);
    }

    /// CRLF 的文件不能被顺手改成 LF —— 那会让下一次 diff 变成整篇都改了
    #[test]
    fn crlf_line_endings_survive() {
        let old = "甲\r\n乙\r\n丙\r\n";
        let new = "甲\r\n乙改了\r\n丙\r\n";
        let d = diff(old, new);
        let at = kinds(&d)[0].iter().position(|k| *k == "deleted").unwrap();
        let out = compose_partial_revert(new, &d, &[(0, at)]);
        assert!(out.contains("乙\r\n"), "加回来的那一行要带 CRLF：{out:?}");
        assert!(!out.contains("丙\n\r"), "别的行的行尾不许动：{out:?}");
    }

    /// 末尾没有换行的文件（用户手写的笔记常常这样）
    #[test]
    fn file_without_trailing_newline() {
        let old = "甲\n乙";
        let new = "甲\n乙改了";
        let d = diff(old, new);
        assert_eq!(compose_partial_revert(new, &d, &[]), new);
    }
}
