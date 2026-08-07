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
//! ## 冲突：检测 → 交给人选 → 带着选择重放
//!
//! 撞上冲突时仍然整个撤回（`rebase.abort()`），工作区一个字节不动 —— 但
//! 现在会把每篇的**本地内容和远端内容**一起带回去，前端用它画逐段对比、
//! 让人选边（ConflictView）。选完调 `sync_with` 带着「路径 → 定稿内容」
//! 重放整条链：变基再撞上这几篇时，用定稿内容落解、继续走完、推上去。
//!
//! 两次 sync 之间远端可能又动了 —— 无所谓，重放会重新 fetch，撞上新冲突
//! 就再报一轮。**绝不自作主张合一半**：没给定稿的文件照旧撤回。

use std::cell::Cell;
use std::collections::HashMap;
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

/// 一篇撞上冲突的笔记，两边的完整内容都带上 —— 冲突 UI 靠它画对比、
/// 拼定稿。笔记就是几 KB 的文本，整篇过一趟 IPC 无所谓
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    /// 两边分叉前的共同版本。语义冲突必须靠它判断「谁改了哪个属性」；
    /// 新文件或无法读取的二进制内容为 None
    pub base: Option<String>,
    /// 本地当前的样子（工作区）。本地删了这篇、或不是文本时为 None
    pub local: Option<String>,
    /// 远端那一版（FETCH_HEAD）。远端删了这篇、或不是文本时为 None
    pub remote: Option<String>,
    /// 最近一次真正改到这条路径的提交；用于界面说明两边是谁、何时改的。
    pub local_change: Option<ConflictChange>,
    pub remote_change: Option<ConflictChange>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictChange {
    pub author: String,
    /// Unix 秒。前端按本机时区显示，不在仓库里制造格式差异。
    pub timestamp: i64,
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
    pub conflicts: Vec<ConflictFile>,
}

/// 当前分支名。仓库还没有任何提交时 HEAD 指向一个不存在的分支，
/// 那时 `shorthand()` 仍然给得出名字（`main`）
pub(super) fn branch_name(repo: &git2::Repository) -> String {
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

/// 新共享空间只能推到一个真正空的远端。已有内容时继续同步虽然在 Git 层
/// 做得到，却会把未知仓库悄悄并入用户确认过的共享清单。
pub fn ensure_remote_empty(root: &Path, token: Option<String>) -> Result<()> {
    let repo = git2::Repository::open(root)?;
    let mut remote = repo
        .find_remote(REMOTE)
        .map_err(|_| Error::Vault("还没配置共享空间的远端地址".into()))?;

    #[cfg(target_os = "android")]
    {
        super::transport::ensure_registered();
        super::transport::set_token(token.clone());
    }

    // 不用 `Remote::list()`：libgit2 在完全空的本地 bare remote 上会给
    // git2-rs 返回空指针，debug 版因此触发 UB precondition panic。真实 fetch
    // 同时完成认证预检，随后只看它落下来的远端分支即可。
    let mut options = git2::FetchOptions::new();
    options.remote_callbacks(callbacks(token));
    remote
        .fetch(&[] as &[&str], Some(&mut options), None)
        .map_err(humanize)?;
    let has_content = repo
        .references_glob("refs/remotes/origin/*")?
        .filter_map(std::result::Result::ok)
        .any(|reference| reference.symbolic_target().is_none());

    if has_content {
        return Err(Error::Vault(
            "这个远端仓库已经有内容。请选择一个空仓库，Verso 不会把未知文件混进共享空间".into(),
        ));
    }
    Ok(())
}

/// 认证回调。
///
/// **必须自己数尝试次数**：认证失败时 libgit2 会反复回调，而我们每次都回
/// 同一份凭据的话就成了死循环（表现是同步按钮一直转、没有任何错误）。
/// 数到头就返回错误，让它把「认证失败」原样抛上来。
pub(super) fn callbacks(token: Option<String>) -> git2::RemoteCallbacks<'static> {
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

/// 把一个已有远端安全地克隆进用户选定的空目录。
///
/// 不直接在目标目录里下载：网络断掉时 libgit2 会留下一半 `.git`，用户下次
/// 再选同一目录只会得到「目录非空」。先落到同级临时目录，完整成功后再原子
/// 换过去；失败只清理由我们用随机名字创建的那一处。
pub fn clone_remote(url: &str, destination: &Path, token: Option<String>) -> Result<()> {
    let url = url.trim();
    if url.is_empty() {
        return Err(Error::Vault("请填写共享仓库地址".into()));
    }
    if !destination.is_dir() {
        return Err(Error::Vault(format!(
            "本地位置不是一个目录：{}",
            destination.display()
        )));
    }
    if destination.read_dir()?.next().is_some() {
        return Err(Error::Vault(
            "请选择一个空文件夹，Verso 不会覆盖里面已有的文件".into(),
        ));
    }

    let destination = destination.canonicalize().unwrap_or_else(|_| destination.to_path_buf());
    let parent = destination
        .parent()
        .ok_or_else(|| Error::Vault("不能把磁盘根目录作为共享仓库位置".into()))?;
    let temp = parent.join(format!(".verso-clone-{}", ulid::Ulid::new()));

    #[cfg(target_os = "android")]
    {
        super::transport::ensure_registered();
        super::transport::set_token(token.clone());
    }

    let mut fetch = git2::FetchOptions::new();
    fetch.remote_callbacks(callbacks(token));
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch);
    if let Err(error) = builder.clone(url, &temp) {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(humanize(error));
    }

    // 下载期间用户或别的程序可能往目标里放了东西。此时宁可留下完整临时
    // 克隆供诊断，也绝不删掉刚出现的用户文件。
    if destination.read_dir()?.next().is_some() {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(Error::Vault(
            "下载期间本地文件夹出现了文件，已取消加入以免覆盖".into(),
        ));
    }

    std::fs::remove_dir(&destination)?;
    if let Err(error) = std::fs::rename(&temp, &destination) {
        // rename 极少失败；把空目录补回来，让目录选择器里那条路径不至于消失。
        let _ = std::fs::create_dir_all(&destination);
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error.into());
    }
    Ok(())
}

/// 把 libgit2 的网络/认证错误翻成人话。
///
/// 原文是 `request failed with status code: 403; class=Http (34)` 这个样子 ——
/// 状态码对用户毫无线索（403 的实际原因几乎总是令牌权限，而人在这里的第一
/// 反应是「地址填错了？」，作者本人第一次就猜错了方向）。**只翻网络和认证
/// 这两类**，其余原样保留：变基、检出这些错误的原文里带着文件名等关键信息，
/// 包一层反而把线索盖住。
///
/// 安卓的自定义传输层（transport.rs）里有一份同样口径的翻译 —— 那边的错误
/// 不经过 libgit2 的 Http class，走不到这里。
pub(super) fn humanize(e: git2::Error) -> Error {
    let msg = e.message().to_string();
    let friendly = match e.class() {
        git2::ErrorClass::Http => {
            if msg.contains("401") || msg.contains("403") {
                Some(
                    "远端不接受这个令牌。检查令牌是否过期、Contents 权限是不是 \
                     Read and write、仓库有没有勾选"
                        .to_string(),
                )
            } else if msg.contains("404") {
                Some("仓库不存在，或令牌无权看到它。检查仓库地址".to_string())
            } else {
                None
            }
        }
        git2::ErrorClass::Net => Some(format!("连不上远端（{msg}）。检查网络，或稍后再试")),
        _ => None,
    };
    match friendly {
        Some(f) => Error::Vault(f),
        None => e.into(),
    }
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
/// 返回冲突的文件名；空 vec 表示接好了。撞上冲突时先看 `resolutions` 里
/// 有没有这几篇的定稿：**全都有**就用定稿落解、继续走；缺任何一篇则
/// **整个撤回**（工作区回到变基之前的样子），把全部冲突报出去 —— 不做
/// 「解决一半」这种状态，UI 每轮拿到的都是完整清单。
fn rebase_onto(
    repo: &git2::Repository,
    upstream: git2::Oid,
    resolutions: &HashMap<String, Option<String>>,
) -> Result<Vec<String>> {
    let upstream = repo.find_annotated_commit(upstream)?;
    let sig = super::git::signature(repo)?;
    let mut rebase = repo.rebase(None, Some(&upstream), None, None)?;

    while let Some(op) = rebase.next() {
        op?;
        let mut index = repo.index()?;
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

            if names.iter().all(|n| resolutions.contains_key(n)) {
                // 只对**索引里真在冲突**的路径动手 —— resolutions 的键来自
                // 前端，不能拿它当路径清单去写文件
                let workdir = repo
                    .workdir()
                    .ok_or_else(|| Error::Vault("裸仓库没有工作区".into()))?;
                for name in &names {
                    let abs = workdir.join(name);
                    match &resolutions[name] {
                        Some(content) => {
                            if let Some(dir) = abs.parent() {
                                std::fs::create_dir_all(dir)?;
                            }
                            std::fs::write(&abs, content)?;
                            index.add_path(Path::new(name))?;
                        }
                        // None = 定稿是「接受删除」
                        None => {
                            let _ = std::fs::remove_file(&abs);
                            index.remove_path(Path::new(name))?;
                        }
                    }
                }
                index.write()?;
            } else {
                rebase.abort()?;
                return Ok(names);
            }
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

/// 冲突文件的两边内容。本地读工作区 —— abort 之后那就是变基前的样子；
/// 远端读 FETCH_HEAD 那个提交的树。读不出来（删除、二进制）就是 None
fn conflict_files(
    root: &Path,
    repo: &git2::Repository,
    merge_base: Option<git2::Oid>,
    local_tip: git2::Oid,
    remote_tip: git2::Oid,
    names: Vec<String>,
) -> Vec<ConflictFile> {
    let base_tree = merge_base
        .and_then(|id| repo.find_commit(id).ok())
        .and_then(|c| c.tree().ok());
    let tree = repo.find_commit(remote_tip).ok().and_then(|c| c.tree().ok());
    names
        .into_iter()
        .map(|path| {
            let base = base_tree.as_ref().and_then(|t| {
                let entry = t.get_path(Path::new(&path)).ok()?;
                let blob = repo.find_blob(entry.id()).ok()?;
                std::str::from_utf8(blob.content()).ok().map(str::to_string)
            });
            let local = std::fs::read_to_string(root.join(&path)).ok();
            let remote = tree.as_ref().and_then(|t| {
                let entry = t.get_path(Path::new(&path)).ok()?;
                let blob = repo.find_blob(entry.id()).ok()?;
                std::str::from_utf8(blob.content()).ok().map(str::to_string)
            });
            let local_change = latest_path_change(repo, local_tip, merge_base, &path);
            let remote_change = latest_path_change(repo, remote_tip, merge_base, &path);
            ConflictFile {
                path,
                base,
                local,
                remote,
                local_change,
                remote_change,
            }
        })
        .collect()
}

/// 在线性同步历史里向共同版本回溯，找最近一次真正改到这个路径的提交。
/// 找不到就不显示，不能拿分支头作者冒充实际修改者。
fn latest_path_change(
    repo: &git2::Repository,
    tip: git2::Oid,
    stop: Option<git2::Oid>,
    path: &str,
) -> Option<ConflictChange> {
    let mut commit = repo.find_commit(tip).ok()?;
    loop {
        if Some(commit.id()) == stop {
            return None;
        }
        let current = commit.tree().ok()?.get_path(Path::new(path)).ok().map(|e| e.id());
        let parent = commit.parent(0).ok();
        let previous = parent
            .as_ref()
            .and_then(|p| p.tree().ok())
            .and_then(|t| t.get_path(Path::new(path)).ok())
            .map(|e| e.id());
        if current != previous {
            let sig = commit.author();
            let author = sig
                .name()
                .filter(|name| !name.trim().is_empty())
                .or_else(|| sig.email())
                .unwrap_or("未知成员")
                .to_string();
            return Some(ConflictChange {
                author,
                timestamp: commit.time().seconds(),
            });
        }
        commit = parent?;
    }
}

/// 同步一次。
///
/// 顺序是**先提交再取远端**：工作区不干净时变基会失败，而「按同步之前得先
/// 手动保存一下」是没人会记得的规矩。
pub fn sync(root: &Path, token: Option<String>) -> Result<SyncOutcome> {
    sync_with(root, token, &HashMap::new())
}

/// 带「冲突定稿」的同步 —— 冲突 UI 选完边之后走这条。
/// `resolutions`：路径 → 定稿内容，None 表示接受删除。
pub fn sync_with(
    root: &Path,
    token: Option<String>,
    resolutions: &HashMap<String, Option<String>>,
) -> Result<SyncOutcome> {
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
    remote
        .fetch(&[&branch], Some(&mut opts), None)
        .map_err(humanize)?;

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
                let names = rebase_onto(&repo, theirs, resolutions)?;
                if !names.is_empty() {
                    // 冲突时连拉取都不算数：这次同步什么都没发生
                    return Ok(SyncOutcome {
                        conflicts: conflict_files(root, &repo, base, ours, theirs, names),
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
            remote
                .push(&[&format!("{refname}:{refname}")], Some(&mut opts))
                .map_err(humanize)?;
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

    /// 403 的实际原因几乎总是令牌权限（fine-grained 令牌的 Contents 默认
    /// No access），而 libgit2 的原文只有状态码 —— 作者第一次撞上时猜错了
    /// 方向。这里钉住翻译口径
    #[test]
    fn http_and_net_errors_speak_chinese() {
        let e = |class, msg: &str| {
            humanize(git2::Error::new(git2::ErrorCode::GenericError, class, msg)).to_string()
        };
        let auth = e(git2::ErrorClass::Http, "request failed with status code: 403");
        assert!(auth.contains("令牌"), "{auth}");
        assert!(auth.contains("Read and write"), "{auth}");
        assert!(
            e(git2::ErrorClass::Http, "unexpected http status code: 401").contains("令牌")
        );
        assert!(
            e(git2::ErrorClass::Http, "request failed with status code: 404").contains("仓库地址")
        );
        let net = e(git2::ErrorClass::Net, "failed to resolve address for github.com");
        assert!(net.contains("连不上远端"), "{net}");
        assert!(net.contains("github.com"), "原文要保留，线索在里面：{net}");

        // 其余类别原样放行：变基/检出的原文里带着文件名等关键信息
        let other = e(git2::ErrorClass::Rebase, "could not apply 甲.md");
        assert!(other.contains("could not apply 甲.md"), "{other}");
        // HTTP 类别里认不出的状态码也不硬翻
        let odd = e(git2::ErrorClass::Http, "request failed with status code: 502");
        assert!(odd.contains("502"), "{odd}");
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
        assert!(out.conflicts.is_empty());

        // 远端真的有了
        let remote = git2::Repository::open_bare(&origin).unwrap();
        let head = remote.find_reference("refs/heads/main").unwrap();
        let tree = head.peel_to_commit().unwrap().tree().unwrap();
        assert!(tree.get_name("甲.md").is_some());
    }

    #[test]
    fn clone_joins_an_existing_remote_and_refuses_nonempty_destinations() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("共享.md"), "来自队友").unwrap();
        sync(&a, None).unwrap();

        let joined = std::env::temp_dir().join(format!("verso-join-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&joined).unwrap();
        clone_remote(origin.to_str().unwrap(), &joined, None).unwrap();
        assert_eq!(read(&joined, "共享.md").as_deref(), Some("来自队友"));
        assert_eq!(remote_get(&joined).unwrap().url.as_deref(), origin.to_str());

        let occupied = std::env::temp_dir().join(format!("verso-join-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&occupied).unwrap();
        std::fs::write(occupied.join("不能覆盖.md"), "保留").unwrap();
        let error = clone_remote(origin.to_str().unwrap(), &occupied, None)
            .unwrap_err()
            .to_string();
        assert!(error.contains("空文件夹"), "{error}");
        assert_eq!(read(&occupied, "不能覆盖.md").as_deref(), Some("保留"));

        let _ = std::fs::remove_dir_all(origin);
        let _ = std::fs::remove_dir_all(a);
        let _ = std::fs::remove_dir_all(joined);
        let _ = std::fs::remove_dir_all(occupied);
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

        assert!(out.conflicts.is_empty(), "改的不是同一篇，不该冲突");
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

        // 冲突要带回两边的内容 —— 冲突 UI 全靠它画对比
        assert_eq!(out.conflicts.len(), 1);
        let c = &out.conflicts[0];
        assert_eq!(c.path, "甲.md");
        assert_eq!(c.base.as_deref(), Some("原来的"), "语义合并必须拿到共同版本");
        assert_eq!(c.local.as_deref(), Some("B 改的"), "本地 = 自己工作区的样子");
        assert_eq!(c.remote.as_deref(), Some("A 改的"), "远端 = 对面推上来的样子");
        assert!(c.local_change.is_some(), "本地最近修改者要随冲突返回");
        assert!(c.remote_change.is_some(), "远端最近修改者要随冲突返回");
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

    /// 冲突 UI 的完整回路：报冲突 → 用户选边拼出定稿 → 带着定稿重放 →
    /// 两台机器最终一字不差
    #[test]
    fn resolved_conflict_syncs_and_both_sides_converge() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("甲.md"), "原来的").unwrap();
        sync(&a, None).unwrap();
        let b = vault(&origin);
        sync(&b, None).unwrap();

        std::fs::write(a.join("甲.md"), "A 改的").unwrap();
        sync(&a, None).unwrap();
        std::fs::write(b.join("甲.md"), "B 改的").unwrap();
        assert_eq!(sync(&b, None).unwrap().conflicts.len(), 1);

        // 用户在 UI 里拼出的定稿（模拟「两边都要」）
        let mut fixes = HashMap::new();
        fixes.insert("甲.md".to_string(), Some("A 改的\nB 改的".to_string()));
        let out = sync_with(&b, None, &fixes).unwrap();
        assert!(out.conflicts.is_empty(), "{:?}", out.conflicts);
        assert!(out.pushed >= 1, "定稿要推得出去：{out:?}");
        assert_eq!(read(&b, "甲.md").as_deref(), Some("A 改的\nB 改的"));

        // A 那边一同步就拿到定稿；历史干净、没有残留的变基状态
        sync(&a, None).unwrap();
        assert_eq!(read(&a, "甲.md").as_deref(), Some("A 改的\nB 改的"));
        let repo = git2::Repository::open(&b).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    /// 远端删了、本地改了 —— 定稿可以是「接受删除」（content = None）
    #[test]
    fn resolution_can_accept_a_deletion() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("甲.md"), "原来的").unwrap();
        sync(&a, None).unwrap();
        let b = vault(&origin);
        sync(&b, None).unwrap();

        std::fs::remove_file(a.join("甲.md")).unwrap();
        sync(&a, None).unwrap();
        std::fs::write(b.join("甲.md"), "B 又改了").unwrap();
        let out = sync(&b, None).unwrap();
        assert_eq!(out.conflicts.len(), 1);
        assert_eq!(out.conflicts[0].remote, None, "远端删了，remote 该是 None");
        assert_eq!(out.conflicts[0].local.as_deref(), Some("B 又改了"));

        let mut fixes = HashMap::new();
        fixes.insert("甲.md".to_string(), None);
        let out = sync_with(&b, None, &fixes).unwrap();
        assert!(out.conflicts.is_empty(), "{:?}", out.conflicts);
        assert_eq!(read(&b, "甲.md"), None, "接受删除后文件要真的没了");
        let repo = git2::Repository::open(&b).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    /// 同一篇里相距足够远的段落由两边分别修改，Git 应当直接三方合并，
    /// 不把本来无需人决定的内容送进冲突面板。
    #[test]
    fn different_paragraphs_in_one_note_merge_automatically() {
        let origin = bare_remote();
        let a = vault(&origin);
        let original = "第一段\n\n中间一\n\n中间二\n\n最后一段\n";
        std::fs::write(a.join("甲.md"), original).unwrap();
        sync(&a, None).unwrap();
        let b = vault(&origin);
        sync(&b, None).unwrap();

        std::fs::write(
            a.join("甲.md"),
            original.replace("第一段", "A 修改第一段"),
        )
        .unwrap();
        sync(&a, None).unwrap();
        std::fs::write(
            b.join("甲.md"),
            original.replace("最后一段", "B 修改最后一段"),
        )
        .unwrap();
        let out = sync(&b, None).unwrap();
        assert!(out.conflicts.is_empty(), "不重叠段落不该询问：{out:?}");
        let merged = read(&b, "甲.md").unwrap();
        assert!(merged.contains("A 修改第一段"), "远端段落不能丢：{merged}");
        assert!(merged.contains("B 修改最后一段"), "本地段落不能丢：{merged}");
    }

    /// 一边改名、另一边继续编辑旧路径时，rename 检测应把修改重放到新路径；
    /// 若 libgit2 无法识别则必须报冲突，绝不能静默丢掉正文。
    #[test]
    fn rename_on_one_side_keeps_the_other_sides_edit() {
        let origin = bare_remote();
        let a = vault(&origin);
        std::fs::write(a.join("旧名.md"), "共同正文\n").unwrap();
        sync(&a, None).unwrap();
        let b = vault(&origin);
        sync(&b, None).unwrap();

        std::fs::rename(a.join("旧名.md"), a.join("新名.md")).unwrap();
        sync(&a, None).unwrap();
        std::fs::write(b.join("旧名.md"), "共同正文\nB 补充\n").unwrap();
        let out = sync(&b, None).unwrap();
        if out.conflicts.is_empty() {
            assert_eq!(read(&b, "旧名.md"), None, "旧路径不应留下分叉副本");
            let moved = read(&b, "新名.md").expect("改名后的路径必须存在");
            assert!(moved.contains("B 补充"), "另一边的修改必须跟着移动：{moved}");
        } else {
            assert!(
                out.conflicts.iter().any(|c| c.local.as_deref().unwrap_or("").contains("B 补充")),
                "无法自动识别时也必须把修改交给冲突界面：{:?}",
                out.conflicts
            );
        }
    }

    #[test]
    fn adjacent_frontmatter_changes_report_the_common_version() {
        let origin = bare_remote();
        let a = vault(&origin);
        let original = "---\n状态: 草稿\n评分: 1\n---\n正文\n";
        std::fs::write(a.join("数据.md"), original).unwrap();
        sync(&a, None).unwrap();
        let b = vault(&origin);
        sync(&b, None).unwrap();

        std::fs::write(a.join("数据.md"), original.replace("状态: 草稿", "状态: 完成"))
            .unwrap();
        sync(&a, None).unwrap();
        std::fs::write(b.join("数据.md"), original.replace("评分: 1", "评分: 5")).unwrap();
        let out = sync(&b, None).unwrap();
        if let Some(conflict) = out.conflicts.first() {
            assert_eq!(conflict.base.as_deref(), Some(original));
        } else {
            let merged = read(&b, "数据.md").unwrap();
            assert!(merged.contains("状态: 完成"));
            assert!(merged.contains("评分: 5"));
        }
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
