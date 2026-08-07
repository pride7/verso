//! 修改建议与审阅。DESIGN.md §2.8（v0.7.16）。
//!
//! 建议是 `refs/heads/verso/suggestions/<ULID>` 下的一条普通 Git 分支；审阅结论
//! 是主线里 `.verso-reviews/<id>.json` 的版本化记录。前者让未接受内容与正式
//! 内容隔离，后者保证接受/退回不是只存在某台设备上的临时状态。

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

use super::git::{self, commit_all, FileDiff};
use super::sync::{self, ConflictChange, ConflictFile};

const REMOTE: &str = "origin";
const PREFIX: &str = "verso/suggestions/";
const REVIEW_DIR: &str = ".verso-reviews";

fn content_path(root: &Path, rel: &str) -> Result<PathBuf> {
    let path = Path::new(rel);
    if rel.is_empty() || path.is_absolute() {
        return Err(Error::PathEscape(rel.to_string()));
    }
    let mut out = root.to_path_buf();
    let mut first = true;
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                if first && (part == ".git" || part == ".verso" || part == REVIEW_DIR) {
                    return Err(Error::PathEscape(rel.to_string()));
                }
                first = false;
                out.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(Error::PathEscape(rel.to_string()));
            }
        }
    }
    if first {
        return Err(Error::PathEscape(rel.to_string()));
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionFile {
    pub path: String,
    pub previous_path: Option<String>,
    /// `added` | `modified` | `deleted` | `renamed`
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: String,
    pub title: String,
    pub author_name: String,
    pub author_email: Option<String>,
    pub at: i64,
    pub files: Vec<SuggestionFile>,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOutcome {
    pub done: bool,
    pub conflicts: Vec<ConflictFile>,
    pub warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewRecord {
    version: u8,
    id: String,
    title: String,
    suggestion_tip: String,
    reviewer_name: String,
    reviewer_email: Option<String>,
    reviewed_at: i64,
    accepted: Vec<String>,
    rejected: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn remote_branch(branch: &str) -> String {
    format!("refs/remotes/{REMOTE}/{branch}")
}

fn suggestion_ref(id: &str) -> String {
    format!("refs/heads/{PREFIX}{id}")
}

fn suggestion_remote_ref(id: &str) -> String {
    format!("refs/remotes/{REMOTE}/{PREFIX}{id}")
}

fn fetch(root: &Path, token: Option<String>) -> Result<(git2::Repository, git2::Oid)> {
    let repo = git2::Repository::open(root)?;
    let branch = sync::branch_name(&repo);
    let mut remote = repo
        .find_remote(REMOTE)
        .map_err(|_| Error::Vault("还没配置共享空间的远端地址".into()))?;

    #[cfg(target_os = "android")]
    {
        super::transport::ensure_registered();
        super::transport::set_token(token.clone());
    }

    let main_spec = format!("+refs/heads/{branch}:{}", remote_branch(&branch));
    let suggestion_spec = format!(
        "+refs/heads/{PREFIX}*:refs/remotes/{REMOTE}/{PREFIX}*"
    );
    let mut options = git2::FetchOptions::new();
    options.remote_callbacks(sync::callbacks(token));
    options.prune(git2::FetchPrune::On);
    remote
        .fetch(&[&main_spec, &suggestion_spec], Some(&mut options), None)
        .map_err(sync::humanize)?;
    drop(remote);

    let main = repo
        .refname_to_id(&remote_branch(&branch))
        .map_err(|_| Error::Vault("远端还没有正式内容，暂时不能提交修改建议".into()))?;
    Ok((repo, main))
}

fn reviewed(repo: &git2::Repository, main: git2::Oid, id: &str) -> bool {
    repo.find_commit(main)
        .ok()
        .and_then(|commit| commit.tree().ok())
        .and_then(|tree| tree.get_path(Path::new(&format!("{REVIEW_DIR}/{id}.json"))).ok())
        .is_some()
}

fn suggestion_files(
    repo: &git2::Repository,
    base: git2::Oid,
    tip: git2::Oid,
) -> Result<(Vec<SuggestionFile>, usize, usize)> {
    let old_tree = repo.find_commit(base)?.tree()?;
    let new_tree = repo.find_commit(tip)?.tree()?;
    let mut diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)?;
    let mut find = git2::DiffFindOptions::new();
    find.renames(true);
    diff.find_similar(Some(&mut find))?;
    let files = diff
        .deltas()
        .filter_map(|delta| {
            let old = delta.old_file().path().map(|p| p.to_string_lossy().into_owned());
            let next = delta.new_file().path().map(|p| p.to_string_lossy().into_owned());
            let path = next.clone().or_else(|| old.clone())?;
            if content_path(Path::new("."), &path).is_err() {
                return None;
            }
            let kind = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Renamed => "renamed",
                _ => "modified",
            };
            Some(SuggestionFile {
                path,
                previous_path: (kind == "renamed").then(|| old).flatten(),
                kind: kind.to_string(),
            })
        })
        .collect();
    let stats = diff.stats()?;
    Ok((files, stats.insertions(), stats.deletions()))
}

fn build_suggestion(
    repo: &git2::Repository,
    main: git2::Oid,
    id: &str,
    tip: git2::Oid,
) -> Result<Suggestion> {
    let base = repo.merge_base(main, tip)?;
    let commit = repo.find_commit(tip)?;
    let (files, additions, deletions) = suggestion_files(repo, base, tip)?;
    let author = commit.author();
    let summary = commit.summary().unwrap_or("修改建议");
    let title = summary
        .strip_prefix("修改建议：")
        .unwrap_or(summary)
        .trim()
        .to_string();
    Ok(Suggestion {
        id: id.to_string(),
        title,
        author_name: author.name().unwrap_or("未知成员").to_string(),
        author_email: author.email().map(str::to_string),
        at: commit.time().seconds(),
        files,
        additions,
        deletions,
    })
}

pub fn list(root: &Path, token: Option<String>) -> Result<Vec<Suggestion>> {
    let (repo, main) = fetch(root, token)?;
    let glob = format!("refs/remotes/{REMOTE}/{PREFIX}*");
    let mut out = Vec::new();
    for reference in repo.references_glob(&glob)? {
        let Ok(reference) = reference else { continue };
        let Some(name) = reference.name() else { continue };
        let Some(id) = name.strip_prefix(&format!("refs/remotes/{REMOTE}/{PREFIX}")) else {
            continue;
        };
        if !valid_id(id) || reviewed(&repo, main, id) {
            continue;
        }
        let Some(tip) = reference.target() else { continue };
        if let Ok(suggestion) = build_suggestion(&repo, main, id, tip) {
            if !suggestion.files.is_empty() {
                out.push(suggestion);
            }
        }
    }
    out.sort_by(|a, b| b.at.cmp(&a.at));
    Ok(out)
}

fn push_ref(repo: &git2::Repository, token: Option<String>, spec: &str) -> Result<()> {
    let mut remote = repo.find_remote(REMOTE)?;
    let mut options = git2::PushOptions::new();
    options.remote_callbacks(sync::callbacks(token));
    remote.push(&[spec], Some(&mut options)).map_err(sync::humanize)
}

/// 把所有尚未推到正式分支的本地版本作为一批建议上传，然后把本地正式分支
/// 恢复到远端主线。内容已经耐久地存在建议分支上之后才会执行恢复。
pub fn submit(root: &Path, token: Option<String>, title: &str) -> Result<Suggestion> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Vault("请用一句话说明这批修改建议".into()));
    }
    if title.contains(['\r', '\n']) || title.chars().count() > 120 {
        return Err(Error::Vault("修改建议标题需为 1–120 个字符的一行文字".into()));
    }
    commit_all(root, None)?;
    let (repo, main) = fetch(root, token.clone())?;
    let local = repo.head()?.peel_to_commit()?.id();
    let _base = repo
        .merge_base(local, main)
        .map_err(|_| Error::Vault("本地与共享正式版本没有共同历史，不能提交建议".into()))?;
    let (ahead, _) = repo.graph_ahead_behind(local, main)?;
    if ahead == 0 {
        return Err(Error::Vault("当前没有尚未同步的修改可以提交为建议".into()));
    }

    let id = ulid::Ulid::new().to_string().to_lowercase();
    let parent = repo.find_commit(local)?;
    let tree = parent.tree()?;
    let signature = super::git::signature(&repo)?;
    let message = format!("修改建议：{title}");
    let tip = repo.commit(Some("HEAD"), &signature, &signature, &message, &tree, &[&parent])?;
    let spec = format!("HEAD:{}", suggestion_ref(&id));
    if let Err(error) = push_ref(&repo, token, &spec) {
        let object = repo.find_object(local, None)?;
        repo.reset(&object, git2::ResetType::Hard, None)?;
        return Err(error);
    }

    // 建议已经在远端耐久保存，现在才把本地正式分支退回远端主线。
    let branch = sync::branch_name(&repo);
    let local_ref = format!("refs/heads/{branch}");
    repo.reference(&local_ref, main, true, "Verso：建议已提交，回到正式版本")?;
    repo.set_head(&local_ref)?;
    let object = repo.find_object(main, None)?;
    repo.reset(&object, git2::ResetType::Hard, None)?;
    repo.reference(
        &suggestion_remote_ref(&id),
        tip,
        true,
        "Verso：记录远端修改建议",
    )?;
    build_suggestion(&repo, main, &id, tip).map(|mut suggestion| {
        suggestion.title = title.to_string();
        suggestion
    })
}

fn tree_bytes(repo: &git2::Repository, commit: git2::Oid, path: &str) -> Option<Vec<u8>> {
    let tree = repo.find_commit(commit).ok()?.tree().ok()?;
    let entry = tree.get_path(Path::new(path)).ok()?;
    repo.find_blob(entry.id()).ok().map(|blob| blob.content().to_vec())
}

fn side_change(repo: &git2::Repository, tip: git2::Oid) -> Option<ConflictChange> {
    let commit = repo.find_commit(tip).ok()?;
    let author = commit.author();
    Some(ConflictChange {
        author: author
            .name()
            .or_else(|| author.email())
            .unwrap_or("未知成员")
            .to_string(),
        timestamp: commit.time().seconds(),
    })
}

fn conflict(
    repo: &git2::Repository,
    path: &str,
    base: git2::Oid,
    main: git2::Oid,
    suggestion: git2::Oid,
) -> ConflictFile {
    let text = |bytes: Option<Vec<u8>>| bytes.and_then(|b| String::from_utf8(b).ok());
    ConflictFile {
        path: path.to_string(),
        base: text(tree_bytes(repo, base, path)),
        local: text(tree_bytes(repo, main, path)),
        remote: text(tree_bytes(repo, suggestion, path)),
        local_change: side_change(repo, main),
        remote_change: side_change(repo, suggestion),
    }
}

fn write_path(root: &Path, path: &str, content: Option<&[u8]>) -> Result<()> {
    let absolute = content_path(root, path)?;
    match content {
        Some(bytes) => {
            if let Some(parent) = absolute.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(absolute, bytes)?;
        }
        None => {
            if absolute.is_file() {
                std::fs::remove_file(absolute)?;
            }
        }
    }
    Ok(())
}

pub fn diff(root: &Path, token: Option<String>, id: &str, path: &str) -> Result<FileDiff> {
    if !valid_id(id) {
        return Err(Error::Vault("看不懂的修改建议编号".into()));
    }
    let (repo, main) = fetch(root, token)?;
    let tip = repo.refname_to_id(&suggestion_remote_ref(id))?;
    let suggestion = build_suggestion(&repo, main, id, tip)?;
    let file = suggestion
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or_else(|| Error::Vault(format!("这批建议里没有 {path}")))?;
    let base = repo.merge_base(main, tip)?;
    let old_path = file.previous_path.as_deref().unwrap_or(&file.path);
    let old = tree_bytes(&repo, base, old_path);
    let next = tree_bytes(&repo, tip, &file.path);
    match (old, next) {
        (Some(old), Some(next)) => match (String::from_utf8(old), String::from_utf8(next)) {
            (Ok(old), Ok(next)) => {
                let mut result = git::diff_texts(path, &old, &next)?;
                result.kind = match file.kind.as_str() {
                    "renamed" => "renamed",
                    _ => "modified",
                };
                Ok(result)
            }
            _ => Ok(FileDiff {
                path: path.to_string(),
                kind: "modified",
                additions: 0,
                deletions: 0,
                binary: true,
                hunks: Vec::new(),
            }),
        },
        (None, Some(next)) => match String::from_utf8(next) {
            Ok(next) => {
                let mut result = git::diff_texts(path, "", &next)?;
                result.kind = "added";
                Ok(result)
            }
            Err(_) => Ok(FileDiff {
                path: path.to_string(),
                kind: "added",
                additions: 0,
                deletions: 0,
                binary: true,
                hunks: Vec::new(),
            }),
        },
        (Some(old), None) => match String::from_utf8(old) {
            Ok(old) => {
                let mut result = git::diff_texts(path, &old, "")?;
                result.kind = "deleted";
                Ok(result)
            }
            Err(_) => Ok(FileDiff {
                path: path.to_string(),
                kind: "deleted",
                additions: 0,
                deletions: 0,
                binary: true,
                hunks: Vec::new(),
            }),
        },
        (None, None) => Err(Error::Vault(format!("这批建议里找不到 {path}"))),
    }
}

/// 接受 `accepted` 里的文件，其余视为退回。若主线在建议提交后也修改了同一
/// 路径，先返回三方冲突，工作区不动；前端定稿后把 resolutions 原样带回来重试。
pub fn resolve(
    root: &Path,
    token: Option<String>,
    id: &str,
    accepted: &[String],
    resolutions: &HashMap<String, Option<String>>,
) -> Result<ReviewOutcome> {
    if !valid_id(id) {
        return Err(Error::Vault("看不懂的修改建议编号".into()));
    }

    // 审阅必须基于最新正式版本。这里仍遵守普通同步的冲突事务边界。
    let synced = sync::sync_with(root, token.clone(), resolutions)?;
    if !synced.conflicts.is_empty() {
        return Ok(ReviewOutcome {
            done: false,
            conflicts: synced.conflicts,
            warning: None,
        });
    }

    let (repo, main) = fetch(root, token.clone())?;
    let tip = repo
        .refname_to_id(&suggestion_remote_ref(id))
        .map_err(|_| Error::Vault("这批修改建议已经不存在，可能已被其他人处理".into()))?;
    let suggestion = build_suggestion(&repo, main, id, tip)?;
    let known: HashSet<&str> = suggestion.files.iter().map(|f| f.path.as_str()).collect();
    if accepted.iter().any(|path| !known.contains(path.as_str())) {
        return Err(Error::Vault("接受清单里混入了不属于这批建议的文件".into()));
    }
    let accepted_set: HashSet<&str> = accepted.iter().map(String::as_str).collect();
    let base = repo.merge_base(main, tip)?;

    #[derive(Clone)]
    struct Operation {
        path: String,
        content: Option<Vec<u8>>,
    }
    let mut operations = Vec::<Operation>::new();
    let mut conflicts = Vec::new();

    for file in &suggestion.files {
        if !accepted_set.contains(file.path.as_str()) {
            continue;
        }
        let mut paths = vec![file.path.clone()];
        if let Some(old) = &file.previous_path {
            if old != &file.path {
                paths.push(old.clone());
            }
        }
        for path in paths {
            // 改名的旧路径在建议树里应视为删除，新路径则视为新增。
            let suggestion_path = if file.previous_path.as_deref() == Some(path.as_str()) {
                None
            } else {
                Some(file.path.as_str())
            };
            let base_path = if file.previous_path.is_some() && path == file.path {
                None
            } else {
                Some(path.as_str())
            };
            let base_bytes = base_path.and_then(|p| tree_bytes(&repo, base, p));
            let main_bytes = tree_bytes(&repo, main, &path);
            let suggested = suggestion_path.and_then(|p| tree_bytes(&repo, tip, p));
            if main_bytes == suggested || suggested == base_bytes {
                continue;
            }
            if main_bytes == base_bytes {
                operations.push(Operation { path, content: suggested });
                continue;
            }
            if let Some(content) = resolutions.get(&path) {
                operations.push(Operation {
                    path,
                    content: content.as_ref().map(|s| s.as_bytes().to_vec()),
                });
                continue;
            }
            // 二进制重叠修改不能塞进字符串冲突面板；保持两边原始内容并明确报错。
            let all_text = [&base_bytes, &main_bytes, &suggested]
                .into_iter()
                .flatten()
                .all(|bytes| std::str::from_utf8(bytes).is_ok());
            if !all_text {
                return Err(Error::Vault(format!(
                    "{path} 是两边都修改过的二进制文件。Verso 不会猜，请先将其中一版另存后再审阅"
                )));
            }
            conflicts.push(conflict(&repo, &path, base, main, tip));
        }
    }
    if !conflicts.is_empty() {
        return Ok(ReviewOutcome {
            done: false,
            conflicts,
            warning: None,
        });
    }

    let before = repo.head()?.peel_to_commit()?.id();
    for operation in &operations {
        write_path(root, &operation.path, operation.content.as_deref())?;
    }

    let accepted_files: Vec<String> = suggestion
        .files
        .iter()
        .filter(|f| accepted_set.contains(f.path.as_str()))
        .map(|f| f.path.clone())
        .collect();
    let rejected_files: Vec<String> = suggestion
        .files
        .iter()
        .filter(|f| !accepted_set.contains(f.path.as_str()))
        .map(|f| f.path.clone())
        .collect();
    let signature = super::git::signature(&repo)?;
    let record = ReviewRecord {
        version: 1,
        id: id.to_string(),
        title: suggestion.title.clone(),
        suggestion_tip: tip.to_string(),
        reviewer_name: signature.name().unwrap_or("未知成员").to_string(),
        reviewer_email: signature.email().map(str::to_string),
        reviewed_at: chrono::Utc::now().timestamp(),
        accepted: accepted_files.clone(),
        rejected: rejected_files.clone(),
    };
    let record_path = root.join(REVIEW_DIR).join(format!("{id}.json"));
    std::fs::create_dir_all(record_path.parent().unwrap())?;
    let encoded = serde_json::to_vec_pretty(&record)
        .map_err(|error| Error::Vault(format!("写不出审阅记录：{error}")))?;
    std::fs::write(&record_path, encoded)?;
    let message = if accepted_files.is_empty() {
        format!("退回修改建议「{}」", suggestion.title)
    } else if rejected_files.is_empty() {
        format!("接受修改建议「{}」", suggestion.title)
    } else {
        format!(
            "审阅修改建议「{}」：接受 {} 项，退回 {} 项",
            suggestion.title,
            accepted_files.len(),
            rejected_files.len()
        )
    };
    commit_all(root, Some(&message))?;
    let pushed = sync::sync(root, token.clone())?;
    if !pushed.conflicts.is_empty() {
        let object = repo.find_object(before, None)?;
        repo.reset(&object, git2::ResetType::Hard, None)?;
        return Ok(ReviewOutcome {
            done: false,
            conflicts: pushed.conflicts,
            warning: Some("正式版本刚刚又有变化，已撤回本次审阅写入；确认冲突后可重试".into()),
        });
    }

    let delete = format!(":{}", suggestion_ref(id));
    let warning = push_ref(&repo, token, &delete)
        .err()
        .map(|error| format!("审阅结果已保存，但远端建议分支暂时没能清理：{error}"));
    if let Ok(mut reference) = repo.find_reference(&suggestion_remote_ref(id)) {
        let _ = reference.delete();
    }
    Ok(ReviewOutcome {
        done: true,
        conflicts: Vec::new(),
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::sync::{remote_set, sync};

    fn remote() -> PathBuf {
        let path = std::env::temp_dir().join(format!("verso-review-origin-{}.git", ulid::Ulid::new()));
        let repo = git2::Repository::init_bare(&path).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        path
    }

    fn vault(remote: &Path) -> PathBuf {
        let path = std::env::temp_dir().join(format!("verso-review-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&path).unwrap();
        super::super::git::ensure_repo(&path).unwrap();
        commit_all(&path, Some("初始化")).unwrap();
        remote_set(&path, remote.to_str().unwrap()).unwrap();
        path
    }

    fn clone(remote: &Path) -> PathBuf {
        let path = std::env::temp_dir().join(format!("verso-review-clone-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&path).unwrap();
        super::super::sync::clone_remote(remote.to_str().unwrap(), &path, None).unwrap();
        path
    }

    #[test]
    fn suggestion_is_isolated_then_accepts_selected_files() {
        let origin = remote();
        let author = vault(&origin);
        std::fs::write(author.join("甲.md"), "正式甲\n").unwrap();
        std::fs::write(author.join("乙.md"), "正式乙\n").unwrap();
        sync(&author, None).unwrap();
        let reviewer = clone(&origin);

        std::fs::write(author.join("甲.md"), "建议甲\n").unwrap();
        std::fs::write(author.join("乙.md"), "建议乙\n").unwrap();
        let suggestion = submit(&author, None, "调整两篇").unwrap();
        assert_eq!(std::fs::read_to_string(author.join("甲.md")).unwrap(), "正式甲\n");
        assert_eq!(list(&reviewer, None).unwrap().len(), 1);

        let out = resolve(
            &reviewer,
            None,
            &suggestion.id,
            &["甲.md".into()],
            &HashMap::new(),
        )
        .unwrap();
        assert!(out.done, "{out:?}");
        assert_eq!(std::fs::read_to_string(reviewer.join("甲.md")).unwrap(), "建议甲\n");
        assert_eq!(
            std::fs::read_to_string(reviewer.join("乙.md")).unwrap().trim_end(),
            "正式乙"
        );
        assert!(reviewer.join(REVIEW_DIR).join(format!("{}.json", suggestion.id)).is_file());
        assert!(list(&author, None).unwrap().is_empty(), "已审阅建议不应再次出现");
    }

    #[test]
    fn overlapping_main_edit_returns_conflict_without_writing() {
        let origin = remote();
        let author = vault(&origin);
        std::fs::write(author.join("甲.md"), "原文\n").unwrap();
        sync(&author, None).unwrap();
        let reviewer = clone(&origin);

        std::fs::write(author.join("甲.md"), "建议版本\n").unwrap();
        let suggestion = submit(&author, None, "改甲").unwrap();
        std::fs::write(reviewer.join("甲.md"), "正式版本又改了\n").unwrap();
        sync(&reviewer, None).unwrap();

        let out = resolve(
            &reviewer,
            None,
            &suggestion.id,
            &["甲.md".into()],
            &HashMap::new(),
        )
        .unwrap();
        assert!(!out.done);
        assert_eq!(out.conflicts.len(), 1);
        assert_eq!(std::fs::read_to_string(reviewer.join("甲.md")).unwrap(), "正式版本又改了\n");
        assert!(!reviewer.join(REVIEW_DIR).exists(), "确认之前不能写审阅记录");

        let mut resolutions = HashMap::new();
        resolutions.insert("甲.md".to_string(), Some("审阅后的定稿\n".to_string()));
        let completed = resolve(
            &reviewer,
            None,
            &suggestion.id,
            &["甲.md".into()],
            &resolutions,
        )
        .unwrap();
        assert!(completed.done, "{completed:?}");
        assert_eq!(
            std::fs::read_to_string(reviewer.join("甲.md")).unwrap(),
            "审阅后的定稿\n"
        );
    }

    #[test]
    fn rejecting_every_file_records_the_decision_without_changing_main() {
        let origin = remote();
        let author = vault(&origin);
        std::fs::write(author.join("甲.md"), "正式版本\n").unwrap();
        sync(&author, None).unwrap();
        let reviewer = clone(&origin);

        std::fs::write(author.join("甲.md"), "不采用的版本\n").unwrap();
        let suggestion = submit(&author, None, "不采用").unwrap();
        let out = resolve(&reviewer, None, &suggestion.id, &[], &HashMap::new()).unwrap();
        assert!(out.done, "{out:?}");
        assert_eq!(
            std::fs::read_to_string(reviewer.join("甲.md"))
                .unwrap()
                .trim_end(),
            "正式版本"
        );
        assert!(list(&author, None).unwrap().is_empty());
    }

    #[test]
    fn accepting_a_rename_removes_the_old_path_and_writes_the_new_one() {
        let origin = remote();
        let author = vault(&origin);
        std::fs::write(author.join("旧名.md"), "同一篇内容\n").unwrap();
        sync(&author, None).unwrap();
        let reviewer = clone(&origin);

        std::fs::rename(author.join("旧名.md"), author.join("新名.md")).unwrap();
        let suggestion = submit(&author, None, "改名").unwrap();
        assert_eq!(suggestion.files.len(), 1);
        assert_eq!(suggestion.files[0].kind, "renamed");
        assert_eq!(suggestion.files[0].previous_path.as_deref(), Some("旧名.md"));

        let out = resolve(
            &reviewer,
            None,
            &suggestion.id,
            &["新名.md".into()],
            &HashMap::new(),
        )
        .unwrap();
        assert!(out.done, "{out:?}");
        assert!(!reviewer.join("旧名.md").exists());
        assert_eq!(
            std::fs::read_to_string(reviewer.join("新名.md")).unwrap(),
            "同一篇内容\n"
        );
    }
}
