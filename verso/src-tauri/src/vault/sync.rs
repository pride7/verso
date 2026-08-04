//! 远端同步。DESIGN.md §2.8 的第二步（M5b）。
//!
//! ## 对用户只有一个「同步」
//!
//! 界面上不出现 fetch / rebase / push / upstream 这些词。按一下同步，底下是
//! 一整条链：**先把本地改动提交掉 → 取远端 → 合到一起 → 推上去**。中间任何
//! 一步失败，vault 都停在按下之前的样子。
//!
//! ## 为什么是变基而不是合并
//!
//! 自动提交每几分钟就产生一个版本，两台机器各自攒一串之后再合并，历史里会
//! 插满 `Merge branch 'main'` —— 而侧栏那个历史列表正是给人翻的（§2.8），
//! 一半是合并记录就没法翻了。变基把两串改动接成一条线。
//!
//! 代价是变基会**重写本地那几个提交的 id**。对 vault 来说这没有影响：没有
//! 别人基于这些提交做开发，也没有 PR 引用它们。
//!
//! ## 为什么只支持 https + 令牌，没有 ssh
//!
//! git2 的 `ssh` 特性会链进 libssh2，而**链进去之后的二进制在开启了
//! Smart App Control 的 Windows 上直接跑不起来**（`os error 4551`，
//! 应用程序控制策略已阻止此文件）—— 开发机上的 `cargo test` 就复现得到。
//! 那是个签名/信誉问题，不是代码问题，但在我们给安装包签名之前无解。
//!
//! https + 个人访问令牌本来也是 §2.8 写的主路径（「粘贴仓库 URL + token
//! 即可」），GitHub / GitLab / Gitea 都支持。ssh 等签名的事解决了再说。
//!
//! ## 冲突这一版只检测不解决
//!
//! 撞上冲突就整个撤回（`rebase.abort()`），报出是哪几篇，工作区一个字节都
//! 不动。段落级的对比 UI 留给下一版 —— 在能稳定复现之前，**把冲突留在原地
//! 让人用别的工具处理，比自作主张合一半强得多**。

use std::cell::Cell;
use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};

use super::git::{commit_all, CommitInfo};

/// 远端只认这一个名字。用户配的是一个 URL，不是一套 remote 管理
const REMOTE: &str = "origin";

/// 当前配的远端。`url` 为空表示还没配
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub url: Option<String>,
    /// 当前分支名。同步只管这一个分支
    pub branch: String,
    /// 这个 URL 需要令牌吗（https 要，ssh 和本地路径不要）
    pub needs_token: bool,
}

/// 同步的结果。给界面报一句人话用
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    /// 这次顺手提交掉的本地改动（没有改动时为 None）
    pub committed: Option<CommitInfo>,
    /// 从远端拿下来几个版本
    pub pulled: usize,
    /// 推上去几个版本
    pub pushed: usize,
    /// 撞上冲突的文件。**非空就意味着这次同步什么都没做**
    pub conflicts: Vec<String>,
}

/// 当前分支名。仓库还没有任何提交时 HEAD 指向一个不存在的分支，
/// 那时 `shorthand()` 仍然给得出名字（`main`）
fn branch_name(repo: &git2::Repository) -> String {
    repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(str::to_string))
        .or_else(|| {
            // 空仓库：HEAD 是个未出生的引用，只能从原始名字里截
            let r = repo.find_reference("HEAD").ok()?;
            let target = r.symbolic_target()?.to_string();
            target.strip_prefix("refs/heads/").map(str::to_string)
        })
        .unwrap_or_else(|| "main".into())
}

/// `https://` 要令牌。本地路径（测试、以及「同步到一个 U 盘上的仓库」）
/// 什么都不要 —— 那条路能走通是意外之喜，但它确实能走通
fn needs_token(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

pub fn remote_get(root: &Path) -> Result<RemoteInfo> {
    let repo = git2::Repository::open(root)?;
    let url = repo
        .find_remote(REMOTE)
        .ok()
        .and_then(|r| r.url().map(str::to_string))
        .filter(|u| !u.is_empty());
    Ok(RemoteInfo {
        needs_token: url.as_deref().map(needs_token).unwrap_or(false),
        url,
        branch: branch_name(&repo),
    })
}

/// 配远端。传空串 = 不要远端了。
///
/// 已经有 `origin` 时改它的 URL 而不是新建一个：用户心里只有「同步到哪儿」
/// 这一件事，多出来的 remote 只会让 `git remote -v` 变得莫名其妙。
pub fn remote_set(root: &Path, url: &str) -> Result<RemoteInfo> {
    let repo = git2::Repository::open(root)?;
    let url = url.trim();
    if url.is_empty() {
        // 没配过就删，libgit2 会报错 —— 那不是错误，是本来就没有
        let _ = repo.remote_delete(REMOTE);
    } else if repo.find_remote(REMOTE).is_ok() {
        repo.remote_set_url(REMOTE, url)?;
    } else {
        repo.remote(REMOTE, url)?;
    }
    remote_get(root)
}

/// 认证回调。
///
/// **必须自己数尝试次数**：认证失败时 libgit2 会反复回调，而我们每次都回
/// 同一份凭据的话就成了死循环（表现是同步按钮一直转、没有任何错误）。
/// 数到头就返回错误，让它把「认证失败」原样抛上来。
fn callbacks(token: Option<String>) -> git2::RemoteCallbacks<'static> {
    let mut cb = git2::RemoteCallbacks::new();
    let tried = Cell::new(0u32);
    cb.credentials(move |url, username, allowed| {
        tried.set(tried.get() + 1);
        if tried.get() > 3 {
            return Err(git2::Error::from_str("认证失败：远端不接受这个令牌"));
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(t) = &token {
                // GitHub / GitLab 都接受「任意用户名 + 令牌当密码」。
                // URL 里自带用户名时用它，否则给一个明显是占位的
                let user = match username {
                    Some(u) if !u.is_empty() => u,
                    _ => "verso",
                };
                return git2::Cred::userpass_plaintext(user, t);
            }
            return Err(git2::Error::from_str(&format!(
                "{url} 需要令牌，去设置里填一个"
            )));
        }
        git2::Cred::default()
    });
    cb
}

/// `a..b` 之间有几个提交。报「拉下来几个 / 推上去几个」用
fn count_between(repo: &git2::Repository, from: Option<git2::Oid>, to: git2::Oid) -> usize {
    let mut walk = match repo.revwalk() {
        Ok(w) => w,
        Err(_) => return 0,
    };
    if walk.push(to).is_err() {
        return 0;
    }
    if let Some(f) = from {
        let _ = walk.hide(f);
    }
    walk.count()
}

/// 把本地这一串提交接到远端那一串后面。
///
/// 返回冲突的文件名；空 vec 表示接好了。撞上冲突时**整个撤回**，
/// 工作区回到变基之前的样子。
fn rebase_onto(repo: &git2::Repository, upstream: git2::Oid) -> Result<Vec<String>> {
    let upstream = repo.find_annotated_commit(upstream)?;
    let sig = super::git::signature(repo)?;
    let mut rebase = repo.rebase(None, Some(&upstream), None, None)?;

    while let Some(op) = rebase.next() {
        op?;
        let index = repo.index()?;
        if index.has_conflicts() {
            let mut names: Vec<String> = index
                .conflicts()?
                .filter_map(|c| c.ok())
                .filter_map(|c| {
                    c.our
                        .or(c.their)
                        .or(c.ancestor)
                        .and_then(|e| String::from_utf8(e.path).ok())
                })
                .collect();
            names.sort();
            names.dedup();
            rebase.abort()?;
            return Ok(names);
        }
        // 这一步没有实际改动（远端已经有一模一样的内容）时 commit 会报
        // `unchanged`，跳过它而不是当失败 —— 两台机器改出同样的内容很常见
        match rebase.commit(None, &sig, None) {
            Ok(_) => {}
            Err(e) if e.code() == git2::ErrorCode::Applied => {}
            Err(e) => {
                rebase.abort()?;
                return Err(e.into());
            }
        }
    }
    rebase.finish(Some(&sig))?;
    Ok(Vec::new())
}

/// 快进：本地没有独有的提交，直接把分支指到远端那个点上。
///
/// 必须**同时**移动引用和检出工作区 —— 只改引用的话，磁盘上还是旧内容，
/// 而 status 会把远端的每一处改动都报成「本地删除」
fn fast_forward(repo: &git2::Repository, branch: &str, target: git2::Oid) -> Result<()> {
    let refname = format!("refs/heads/{branch}");
    let target_obj = repo.find_object(target, None)?;
    repo.checkout_tree(&target_obj, None)?;
    match repo.find_reference(&refname) {
        Ok(mut r) => {
            r.set_target(target, "sync: 快进")?;
        }
        // 空仓库：分支还不存在（本地一个提交都没有）
        Err(_) => {
            repo.reference(&refname, target, true, "sync: 首次拉取")?;
        }
    }
    repo.set_head(&refname)?;
    Ok(())
}

/// 同步一次。
///
/// 顺序是**先提交再取远端**：工作区不干净时变基会失败，而「按同步之前得先
/// 手动保存一下」是没人会记得的规矩。
pub fn sync(root: &Path, token: Option<String>) -> Result<SyncOutcome> {
    let repo = git2::Repository::open(root)?;
    let mut remote = repo
        .find_remote(REMOTE)
        .map_err(|_| Error::Vault("还没配远端，去设置里填一个仓库地址".into()))?;

    // 安卓的 libgit2 没编 https 后端（Cargo.toml 那段写了为什么），
    // 走 vault/transport.rs 的 rustls 传输层。注册是进程级一次；令牌
    // 直接塞给传输层自己放进 HTTP 头 —— libgit2 的凭据回调（下面
    // callbacks 那套）不会为自定义传输层工作
    #[cfg(target_os = "android")]
    {
        super::transport::ensure_registered();
        super::transport::set_token(token.clone());
    }

    let mut out = SyncOutcome::default();
    // 1. 本地改动先落成一个版本
    out.committed = commit_all(root, None)?;

    let branch = branch_name(&repo);
    let refname = format!("refs/heads/{branch}");
    let before = repo.refname_to_id(&refname).ok();

    // 2. 取远端
    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(callbacks(token.clone()));
    remote.fetch(&[&branch], Some(&mut opts), None)?;

    // 远端还没有这个分支（第一次推）时 FETCH_HEAD 是空的，直接跳到推送
    let fetched = repo.refname_to_id("FETCH_HEAD").ok();

    // 3. 合到一起
    if let (Some(theirs), Some(ours)) = (fetched, before) {
        if theirs != ours {
            let base = repo.merge_base(ours, theirs).ok();
            if base == Some(theirs) {
                // 远端的东西本地都有 —— 只需要推
            } else if base == Some(ours) {
                out.pulled = count_between(&repo, Some(ours), theirs);
                fast_forward(&repo, &branch, theirs)?;
            } else {
                out.pulled = count_between(&repo, base, theirs);
                let conflicts = rebase_onto(&repo, theirs)?;
                if !conflicts.is_empty() {
                    // 冲突时连拉取都不算数：这次同步什么都没发生
                    return Ok(SyncOutcome {
                        conflicts,
                        pulled: 0,
                        pushed: 0,
                        committed: out.committed,
                    });
                }
            }
        }
    } else if let Some(theirs) = fetched {
        // 本地是空仓库，远端有东西
        out.pulled = count_between(&repo, None, theirs);
        fast_forward(&repo, &branch, theirs)?;
    }

    // 4. 推上去
    let head = repo.refname_to_id(&refname).ok();
    if let Some(head) = head {
        out.pushed = count_between(&repo, fetched, head);
        if out.pushed > 0 || fetched.is_none() {
            let mut opts = git2::PushOptions::new();
            opts.remote_callbacks(callbacks(token));
            remote.push(&[&format!("{refname}:{refname}")], Some(&mut opts))?;
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一个裸仓库当远端。**全程走本地路径，不碰网络** —— 同步这条链上
    /// 真正容易错的是「快进 / 变基 / 冲突」那几个判断，和传输层无关
    fn bare_remote() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("verso-remote-{}.git", ulid::Ulid::new()));
        let repo = git2::Repository::init_bare(&dir).unwrap();
        // 裸仓库的默认分支也得是 main，否则第一次推送之后
        // 远端的 HEAD 指着一个不存在的 master
        repo.set_head("refs/heads/main").unwrap();
        dir
    }

    fn vault(remote: &Path) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("verso-sync-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        super::super::git::ensure_repo(&dir).unwrap();
        commit_all(&dir, Some("初始化")).unwrap();
        remote_set(&dir, remote.to_str().unwrap()).unwrap();
        dir
    }

    fn read(dir: &Path, name: &str) -> Option<String> {
        std::fs::read_to_string(dir.join(name)).ok()
    }

    #[test]
    fn remote_url_roundtrips_and_empty_removes_it() {
        let origin = bare_remote();
        let a = vault(&origin);
        let info = remote_get(&a).unwrap();
        assert_eq!(info.url.as_deref(), origin.to_str());
        assert_eq!(info.branch, "main");
        assert!(!info.needs_token, "本地路径不需要令牌");

        let info = remote_set(&a, "https://github.com/x/y.git").unwrap();
        assert!(info.needs_token, "https 要令牌");

        let info = remote_set(&a, "  ").unwrap();
        assert_eq!(info.url, None, "空串 = 不要远端了");
        // 再删一次不该报错
        assert!(remote_set(&a, "").is_ok());
    }

    #[test]
    fn syncing_without_a_remote_says_so_in_plain_words() {
        let origin = bare_remote();
        let a = vault(&origin);
        remote_set(&a, "").unwrap();
        let e = sync(&a, None).unwrap_err().to_string();
        assert!(e.contains("还没配远端"), "{e}");
    }

    #[test]
    fn first_sync_pushes_everything_up() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("甲.md"), "一").unwrap();

        let out = sync(&a, None).unwrap();
        assert!(out.committed.is_some(), "本地改动应当先被提交掉");
        assert!(out.pushed >= 1);
        assert_eq!(out.conflicts, Vec::<String>::new());

        // 远端真的有了
        let remote = git2::Repository::open_bare(&origin).unwrap();
        let head = remote.find_reference("refs/heads/main").unwrap();
        let tree = head.peel_to_commit().unwrap().tree().unwrap();
        assert!(tree.get_name("甲.md").is_some());
    }

    #[test]
    fn second_machine_pulls_what_the_first_pushed() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("甲.md"), "一").unwrap();
        sync(&a, None).unwrap();

        let b = vault(&origin);
        let out = sync(&b, None).unwrap();
        assert!(out.pulled >= 1, "{out:?}");
        assert_eq!(read(&b, "甲.md").as_deref(), Some("一"), "文件要真的落到磁盘上");
    }

    /// 两台机器各改各的 —— 这是同步最常见的状态，不是异常
    #[test]
    fn both_sides_changed_different_files_and_both_survive() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("甲.md"), "一").unwrap();
        sync(&a, None).unwrap();

        let b = vault(&origin);
        sync(&b, None).unwrap();

        std::fs::write(a.join("乙.md"), "二").unwrap();
        sync(&a, None).unwrap();
        std::fs::write(b.join("丙.md"), "三").unwrap();
        let out = sync(&b, None).unwrap();

        assert_eq!(out.conflicts, Vec::<String>::new(), "改的不是同一篇，不该冲突");
        assert_eq!(read(&b, "乙.md").as_deref(), Some("二"), "对面的改动要拿到");
        assert_eq!(read(&b, "丙.md").as_deref(), Some("三"), "自己的改动不能丢");

        // A 再同步一次就都齐了
        sync(&a, None).unwrap();
        assert_eq!(read(&a, "丙.md").as_deref(), Some("三"));

        // 历史是一条线：没有合并提交
        let repo = git2::Repository::open(&b).unwrap();
        let merges = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .parents()
            .count();
        assert_eq!(merges, 1, "变基之后头一个提交只该有一个父");
    }

    /// 冲突这一版只检测。**要点是「什么都没发生」** —— 报出哪几篇，
    /// 工作区、历史、远端全都停在按下同步之前
    #[test]
    fn a_real_conflict_is_reported_and_nothing_moves() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("甲.md"), "原来的").unwrap();
        sync(&a, None).unwrap();

        let b = vault(&origin);
        sync(&b, None).unwrap();

        std::fs::write(a.join("甲.md"), "A 改的").unwrap();
        sync(&a, None).unwrap();
        std::fs::write(b.join("甲.md"), "B 改的").unwrap();
        let out = sync(&b, None).unwrap();

        assert_eq!(out.conflicts, vec!["甲.md".to_string()]);
        assert_eq!(out.pulled, 0);
        assert_eq!(out.pushed, 0);
        assert_eq!(
            read(&b, "甲.md").as_deref(),
            Some("B 改的"),
            "自己写的东西不能被动"
        );

        // 变基没有留在半路上
        let repo = git2::Repository::open(&b).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        // 远端也没被推上去半截
        let remote = git2::Repository::open_bare(&origin).unwrap();
        let tip = remote
            .find_reference("refs/heads/main")
            .unwrap()
            .peel_to_commit()
            .unwrap();
        assert!(tip.message().unwrap_or_default().contains("甲"));
    }

    /// 同步完再按一次不该做任何事 —— 状态栏会因此一直显示「有改动」
    #[test]
    fn syncing_twice_in_a_row_is_a_no_op() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("甲.md"), "一").unwrap();
        sync(&a, None).unwrap();

        let out = sync(&a, None).unwrap();
        assert_eq!(out.committed, None, "没有改动就不该造出空版本");
        assert_eq!((out.pulled, out.pushed), (0, 0), "{out:?}");
    }
}
