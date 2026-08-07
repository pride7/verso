//! GitHub 快速共享：自动创建私有仓库并邀请协作者。DESIGN.md §2.8。
//!
//! 这里只负责 GitHub REST API；正文仍由 `share.rs` 通过普通 Git 推送，所以
//! 创建出来的空间不依赖 Verso 服务，换任何 Git 客户端都能继续使用。

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::error::{Error, Result};

const API: &str = "https://api.github.com";
const API_VERSION: &str = "2026-03-10";
pub const ACCOUNT_SECRET: &str = "github://verso-account";

/// 底层名字只负责稳定、唯一和可移植，不再让用户为了分享一篇笔记先理解仓库命名。
pub fn generated_repository_name() -> String {
    format!(
        "verso-space-{}",
        ulid::Ulid::new().to_string().to_ascii_lowercase()
    )
}

pub fn is_github_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://github.com/") || lower.starts_with("http://github.com/")
}

fn repository_coordinates(url: &str) -> Result<(String, String)> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let prefix = if lower.starts_with("https://github.com/") {
        "https://github.com/"
    } else if lower.starts_with("http://github.com/") {
        "http://github.com/"
    } else {
        return Err(Error::Vault("这不是可核对成员的 GitHub 仓库地址".into()));
    };
    let rest = &trimmed[prefix.len()..];
    let mut parts = rest.trim_end_matches('/').split('/');
    let owner = parts.next().unwrap_or_default();
    let repository = parts.next().unwrap_or_default().trim_end_matches(".git");
    if owner.is_empty() || repository.is_empty() || parts.next().is_some() {
        return Err(Error::Vault("GitHub 仓库地址格式不正确".into()));
    }
    Ok((owner.to_string(), repository.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: String,
}

#[derive(Debug, Deserialize)]
struct Owner {
    login: String,
}

#[derive(Debug, Deserialize)]
struct User {
    login: String,
}

#[derive(Debug, Deserialize)]
struct Invitation {
    id: u64,
    invitee: Option<User>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAccess {
    pub members: Vec<String>,
    pub pending: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct Repository {
    pub name: String,
    pub clone_url: String,
    pub html_url: String,
    owner: Owner,
}

impl Repository {
    pub fn owner(&self) -> &str {
        &self.owner.login
    }
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: Option<String>,
}

fn request(method: &str, path: &str, token: &str) -> ureq::Request {
    ureq::request(method, &format!("{API}{path}"))
        .timeout(Duration::from_secs(20))
        .set("Accept", "application/vnd.github+json")
        .set("Authorization", &format!("Bearer {}", token.trim()))
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", "Verso")
}

fn humanize(error: ureq::Error) -> Error {
    match error {
        ureq::Error::Status(code, response) => {
            let message = response
                .into_json::<ApiError>()
                .ok()
                .and_then(|body| body.message)
                .unwrap_or_else(|| format!("HTTP {code}"));
            let hint = match code {
                401 => "GitHub 拒绝了这个令牌，请重新连接",
                403 => "GitHub 拒绝了操作。令牌需要 Contents 与 Administration 写入权限",
                404 => "GitHub 找不到目标账号或仓库",
                422 => "仓库名可能已存在，或协作者用户名无效",
                _ => "GitHub 请求失败",
            };
            Error::Vault(format!("{hint}：{message}"))
        }
        ureq::Error::Transport(error) => {
            Error::Vault(format!("连不上 GitHub，请检查网络连接：{error}"))
        }
    }
}

pub fn account(token: &str) -> Result<Account> {
    if token.trim().is_empty() {
        return Err(Error::Vault("请先连接 GitHub".into()));
    }
    request("GET", "/user", token)
        .call()
        .map_err(humanize)?
        .into_json()
        .map_err(|error| Error::Vault(format!("GitHub 返回了无法识别的账号信息：{error}")))
}

pub fn validate_repo_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(Error::Vault(
            "仓库名称不能为空，且不能超过 100 个字符".into(),
        ));
    }
    let device = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let windows_reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && matches!(device.as_bytes()[3], b'1'..=b'9'));
    if name == "."
        || name == ".."
        || name.ends_with('.')
        || windows_reserved
        || name
            .chars()
            .any(|ch| ch.is_control() || "/\\:*?\"<>|".contains(ch))
    {
        return Err(Error::Vault(
            "仓库名称包含不能用于仓库或文件夹的字符".into(),
        ));
    }
    Ok(name.to_string())
}

pub fn validate_username(username: &str) -> Result<String> {
    let username = username.trim().trim_start_matches('@');
    if username.is_empty()
        || username.len() > 39
        || username.starts_with('-')
        || username.ends_with('-')
        || username.contains("--")
        || username
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '-'))
    {
        return Err(Error::Vault(format!("GitHub 用户名格式不正确：{username}")));
    }
    Ok(username.to_string())
}

pub fn create_private_repository(token: &str, name: &str) -> Result<Repository> {
    let name = validate_repo_name(name)?;
    request("POST", "/user/repos", token)
        .send_json(serde_json::json!({
            "name": name,
            "private": true,
            "auto_init": false,
            "description": "由 Verso 创建的共享文档空间"
        }))
        .map_err(humanize)?
        .into_json()
        .map_err(|error| Error::Vault(format!("GitHub 返回了无法识别的仓库信息：{error}")))
}

pub fn invite(token: &str, repository: &Repository, username: &str) -> Result<()> {
    let username = validate_username(username)?;
    let path = format!(
        "/repos/{}/{}/collaborators/{username}",
        repository.owner(),
        repository.name
    );
    request("PUT", &path, token)
        .send_json(serde_json::json!({ "permission": "push" }))
        .map_err(humanize)?;
    Ok(())
}

pub fn invite_to_url(token: &str, url: &str, username: &str) -> Result<()> {
    let username = validate_username(username)?;
    let (owner, repository) = repository_coordinates(url)?;
    request(
        "PUT",
        &format!("/repos/{owner}/{repository}/collaborators/{username}"),
        token,
    )
    .send_json(serde_json::json!({ "permission": "push" }))
    .map_err(humanize)?;
    Ok(())
}

/// 已加入成员与待接受邀请走的是 GitHub 两条不同的删除接口。先找邀请，
/// 找不到再按协作者移除；UI 不需要让用户理解这层差别。
pub fn remove_access(token: &str, url: &str, username: &str) -> Result<()> {
    let username = validate_username(username)?;
    let (owner, repository) = repository_coordinates(url)?;
    for page in 1.. {
        let invitations = request(
            "GET",
            &format!("/repos/{owner}/{repository}/invitations?per_page=100&page={page}"),
            token,
        )
        .call()
        .map_err(humanize)?
        .into_json::<Vec<Invitation>>()
        .map_err(|error| Error::Vault(format!("GitHub 返回了无法识别的邀请列表：{error}")))?;
        let complete = invitations.len() < 100;
        if let Some(invitation) = invitations.into_iter().find(|invitation| {
            invitation
                .invitee
                .as_ref()
                .is_some_and(|user| user.login.eq_ignore_ascii_case(&username))
        }) {
            request(
                "DELETE",
                &format!("/repos/{owner}/{repository}/invitations/{}", invitation.id),
                token,
            )
            .call()
            .map_err(humanize)?;
            return Ok(());
        }
        if complete {
            break;
        }
    }

    request(
        "DELETE",
        &format!("/repos/{owner}/{repository}/collaborators/{username}"),
        token,
    )
    .call()
    .map_err(humanize)?;
    Ok(())
}

/// 远端权限才是共享边界。这里同时读取已经有访问权的人和仍待接受的邀请，
/// 避免把创建时写进 marker 的旧名单当作当前事实。
pub fn repository_access(token: &str, url: &str) -> Result<RepositoryAccess> {
    let (owner, repository) = repository_coordinates(url)?;
    // GitHub 每页最多 100 条。成员名单是权限提示，静默截断会让确认框漏人，
    // 所以宁可多请求几页，也不能把第一页误当成完整权限边界。
    let mut pending = Vec::new();
    for page in 1.. {
        let invitations = request(
            "GET",
            &format!("/repos/{owner}/{repository}/invitations?per_page=100&page={page}"),
            token,
        )
        .call()
        .map_err(humanize)?
        .into_json::<Vec<Invitation>>()
        .map_err(|error| Error::Vault(format!("GitHub 返回了无法识别的邀请列表：{error}")))?;
        let complete = invitations.len() < 100;
        pending.extend(
            invitations
                .into_iter()
                .filter_map(|invitation| invitation.invitee.map(|user| user.login)),
        );
        if complete {
            break;
        }
    }

    let mut members = Vec::new();
    for page in 1.. {
        let users = request(
            "GET",
            &format!(
                "/repos/{owner}/{repository}/collaborators?affiliation=all&per_page=100&page={page}"
            ),
            token,
        )
        .call()
        .map_err(humanize)?
        .into_json::<Vec<User>>()
        .map_err(|error| Error::Vault(format!("GitHub 返回了无法识别的成员列表：{error}")))?;
        let complete = users.len() < 100;
        members.extend(users.into_iter().map(|user| user.login));
        if complete {
            break;
        }
    }
    members.sort_by_key(|name| name.to_ascii_lowercase());
    members.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    pending.sort_by_key(|name| name.to_ascii_lowercase());
    pending.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    pending.retain(|name| {
        !members
            .iter()
            .any(|member| member.eq_ignore_ascii_case(name))
    });
    Ok(RepositoryAccess { members, pending })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_names_are_safe_as_local_folders_too() {
        assert_eq!(validate_repo_name("联合实验").unwrap(), "联合实验");
        assert!(validate_repo_name("../秘密").is_err());
        assert!(validate_repo_name("a/b").is_err());
        assert!(validate_repo_name("CON.md").is_err());
        assert!(validate_repo_name("project.").is_err());
        assert!(validate_repo_name("").is_err());
    }

    #[test]
    fn collaborator_names_are_normalized_and_checked() {
        assert_eq!(validate_username("@person-1").unwrap(), "person-1");
        assert!(validate_username("person 1").is_err());
        assert!(validate_username("-person").is_err());
        assert!(validate_username("person--one").is_err());
    }

    #[test]
    fn generated_names_are_valid_and_unique() {
        let first = generated_repository_name();
        let second = generated_repository_name();
        assert!(first.starts_with("verso-space-"));
        assert!(validate_repo_name(&first).is_ok());
        assert_ne!(first, second);
    }

    #[test]
    fn recognizes_github_https_remotes_only() {
        assert!(is_github_url("https://github.com/team/notes.git"));
        assert!(!is_github_url("https://github.example.com/team/notes.git"));
        assert!(!is_github_url("https://gitlab.com/team/notes.git"));
    }

    #[test]
    fn extracts_repository_coordinates_without_accepting_page_urls() {
        assert_eq!(
            repository_coordinates("https://github.com/team/notes.git").unwrap(),
            ("team".into(), "notes".into())
        );
        assert!(repository_coordinates("https://github.com/team/notes/tree/main").is_err());
        assert!(repository_coordinates("https://gitlab.com/team/notes.git").is_err());
    }
}
