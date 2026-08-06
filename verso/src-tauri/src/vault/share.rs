//! 把一个文档节点（正文、同名子树与附件）迁进独立共享空间。DESIGN.md §2.8。
//!
//! Git 托管服务的权限边界是仓库，不是仓库里的某个路径。因此这里绝不做
//! sparse checkout 或「只在界面隐藏其他文件」：共享一个内容节点就是新建
//! 真正独立的仓库，只把确认过的子树与附件放进去。

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

use super::Vault;

/// 跟着共享空间同步的轻量标记。删掉它不丢内容，只会让 Verso 把该目录当成
/// 普通 vault 展示，因此不违背「派生状态可重建」的边界。
pub const MARKER: &str = ".verso-space.json";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedSpaceInfo {
    pub root: String,
    pub name: String,
    /// 这是 Verso 上次创建空间时邀请的成员，用来帮助选择；远端权限仍是最终事实。
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SpaceMarker {
    kind: String,
    version: u32,
    entry: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    members: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharePreview {
    pub note: String,
    /// 主文档 + 同名目录里的全部子文档。
    pub documents: Vec<String>,
    /// 同名目录里随项目一起迁移的其他普通文件。
    pub files: Vec<String>,
    /// 文档引用、但位于共享子树外的附件；它们只复制，不从私人库删除。
    pub attachments: Vec<String>,
    /// 正文里提到、但不会跟着共享的其他 Markdown 文档。
    pub linked_notes: Vec<String>,
}

fn relative_to(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

/// 收集同名子目录里的**普通文件**。不跟随符号链接：共享内容来自用户仓库，
/// 一个指向仓库外的链接绝不能借「共享项目」把私人文件带出去。
fn walk_files(root: &Path, dir: &Path, out: &mut BTreeSet<String>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let name = entry.file_name();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if name == ".git" || name == ".verso" {
                continue;
            }
            walk_files(root, &entry.path(), out)?;
        } else if file_type.is_file() {
            if let Some(rel) = relative_to(root, &entry.path()) {
                out.insert(rel);
            }
        }
    }
    Ok(())
}

pub fn is_shared_space(root: &Path) -> bool {
    root.join(MARKER).is_file()
}

pub fn space_info(root: &Path) -> Option<SharedSpaceInfo> {
    if !root.is_dir() {
        return None;
    }
    let marker: SpaceMarker = serde_json::from_slice(&std::fs::read(root.join(MARKER)).ok()?).ok()?;
    if marker.kind != "shared-space" && marker.kind != "shared-note" {
        return None;
    }
    let name = marker.label.clone().filter(|label| !label.trim().is_empty()).unwrap_or_else(|| {
        root.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string_lossy().into_owned())
    });
    Some(SharedSpaceInfo {
        root: crate::winpath::for_external(root).to_string_lossy().into_owned(),
        name,
        members: marker.members,
    })
}

fn external(target: &str) -> bool {
    let lower = target.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("data:")
        || lower.starts_with('#')
}

/// 把链接目标归一成 vault 相对路径，同时拒绝 `..` 逃出根目录。
fn normalize_target(note: &str, target: &str, wiki: bool) -> Option<String> {
    let target = target.trim().trim_matches(['<', '>']).replace('\\', "/");
    if target.is_empty() || external(&target) {
        return None;
    }
    let target = target.split('#').next()?.split('|').next()?.trim();
    if target.is_empty() {
        return None;
    }

    let mut out = PathBuf::new();
    if !wiki && !target.starts_with('/') {
        if let Some(parent) = Path::new(note).parent() {
            out.push(parent);
        }
    }
    for component in Path::new(target.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!out.as_os_str().is_empty()).then(|| out.to_string_lossy().replace('\\', "/"))
}

/// 抽出 Obsidian wikilink 和 Markdown 链接。这里只负责找目标；是否存在、是
/// 笔记还是附件，统一交给 `preview` 按真实文件系统判断。
fn references(text: &str) -> Vec<(String, bool)> {
    let mut out = Vec::new();

    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let target = after[..end].split('|').next().unwrap_or_default();
        if !target.trim().is_empty() {
            out.push((target.trim().to_string(), true));
        }
        rest = &after[end + 2..];
    }

    let bytes = text.as_bytes();
    let mut from = 0;
    while let Some(offset) = text[from..].find("](") {
        let start = from + offset + 2;
        let Some(end_offset) = text[start..].find(')') else {
            break;
        };
        let raw = text[start..start + end_offset].trim();
        let target = if let Some(inner) = raw.strip_prefix('<') {
            inner.split('>').next().unwrap_or_default()
        } else {
            raw.split_whitespace().next().unwrap_or_default()
        };
        // `](` 也会命中普通括号文本；前面至少要找得到本次链接的 `[`。
        if bytes[..start - 2]
            .iter()
            .rposition(|b| *b == b'[')
            .is_some()
            && !target.is_empty()
        {
            out.push((target.to_string(), false));
        }
        from = start + end_offset + 1;
    }
    out
}

pub fn preview(vault: &Vault, note: &str) -> Result<SharePreview> {
    let note_abs = vault.resolve(note)?;
    if !note.ends_with(".md") || !note_abs.is_file() {
        return Err(Error::Vault("只能共享一篇现有的 Markdown 文档".into()));
    }
    let mut included = BTreeSet::from([note.to_string()]);
    let child_dir = note.strip_suffix(".md").unwrap_or(note);
    walk_files(&vault.root, &vault.resolve(child_dir)?, &mut included)?;

    let documents: BTreeSet<String> = included
        .iter()
        .filter(|path| path.ends_with(".md"))
        .cloned()
        .collect();
    let files: Vec<String> = included
        .iter()
        .filter(|path| !path.ends_with(".md"))
        .cloned()
        .collect();
    let mut attachments = BTreeSet::new();
    let mut linked_notes = BTreeSet::new();

    for document in &documents {
        let text = std::fs::read_to_string(vault.resolve(document)?)?;
        for (target, wiki) in references(&text) {
            let Some(mut rel) = normalize_target(document, &target, wiki) else {
                continue;
            };
            let mut abs = vault.resolve(&rel)?;
            if !abs.is_file() && Path::new(&rel).extension().is_none() {
                rel.push_str(".md");
                abs = vault.resolve(&rel)?;
            }
            if !abs.is_file() || included.contains(&rel) {
                continue;
            }
            if rel.ends_with(".md") {
                linked_notes.insert(rel);
            } else {
                attachments.insert(rel);
            }
        }
    }

    Ok(SharePreview {
        note: note.to_string(),
        documents: documents.into_iter().collect(),
        files,
        attachments: attachments.into_iter().collect(),
        linked_notes: linked_notes.into_iter().collect(),
    })
}

#[derive(Debug)]
pub struct CreateInput<'a> {
    pub note: &'a str,
    pub destination: &'a Path,
    pub url: &'a str,
    pub token: Option<String>,
    pub name: &'a str,
    pub email: &'a str,
    pub members: &'a [String],
    /// 面向人的名称，与底层仓库和目录名分开。旧空间没有这一项时仍回落到目录名。
    pub label: Option<&'a str>,
}

pub fn validate_identity(name: &str, email: &str) -> Result<()> {
    if name.trim().is_empty() || email.trim().is_empty() {
        return Err(Error::Vault("请填写你的姓名和邮箱，用来区分协作者".into()));
    }
    if !email.contains('@') || name.contains(['<', '>', '\n']) || email.contains(['<', '>', '\n']) {
        return Err(Error::Vault("请检查姓名和邮箱格式".into()));
    }
    Ok(())
}

/// 完整建库并推送成功后才从原 vault 移走正文。网络、认证、非空目录等任何
/// 失败都发生在那之前，所以用户不会因为「试着共享」丢掉正在写的文档。
pub fn create(vault: &Vault, input: CreateInput<'_>) -> Result<PathBuf> {
    let preview = preview(vault, input.note)?;
    let url = input.url.trim();
    if url.is_empty() {
        return Err(Error::Vault("请填写空的远端仓库地址".into()));
    }
    validate_identity(input.name, input.email)?;
    if (url.starts_with("http://") || url.starts_with("https://")) && input.token.is_none() {
        return Err(Error::Vault("这个共享空间需要你自己的访问令牌".into()));
    }
    if !input.destination.is_dir() {
        return Err(Error::Vault(format!(
            "本地位置不是一个目录：{}",
            input.destination.display()
        )));
    }
    if input.destination.read_dir()?.next().is_some() {
        return Err(Error::Vault(
            "请选择一个空文件夹，Verso 不会覆盖已有文件".into(),
        ));
    }

    let destination = input
        .destination
        .canonicalize()
        .unwrap_or_else(|_| input.destination.to_path_buf());
    let root = vault
        .root
        .canonicalize()
        .unwrap_or_else(|_| vault.root.clone());
    if destination.starts_with(&root) {
        return Err(Error::Vault(
            "共享空间不能建在当前仓库里面，请选择旁边的独立文件夹".into(),
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| Error::Vault("不能把磁盘根目录作为共享空间".into()))?;
    let temp = parent.join(format!(".verso-share-{}", ulid::Ulid::new()));

    let staged = (|| -> Result<()> {
        std::fs::create_dir(&temp)?;
        super::git::ensure_repo(&temp)?;

        for rel in preview
            .documents
            .iter()
            .chain(preview.files.iter())
            .chain(preview.attachments.iter())
        {
            let to = temp.join(rel);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(vault.resolve(rel)?, to)?;
        }

        let marker = SpaceMarker {
            kind: "shared-space".into(),
            version: 1,
            entry: preview.note.clone(),
            label: input.label.map(str::trim).filter(|label| !label.is_empty()).map(str::to_string),
            members: input.members.to_vec(),
        };
        let marker = serde_json::to_vec_pretty(&marker)
            .map_err(|error| Error::Vault(format!("共享空间标记生成失败：{error}")))?;
        std::fs::write(temp.join(MARKER), marker)?;
        super::git::identity_set(&temp, input.name, input.email)?;
        super::sync::remote_set(&temp, url)?;
        super::sync::ensure_remote_empty(&temp, input.token.clone())?;
        super::git::commit_all(&temp, Some("创建共享空间"))?;
        let outcome = super::sync::sync(&temp, input.token.clone())?;
        if !outcome.conflicts.is_empty() {
            return Err(Error::Vault("远端在创建期间出现了内容，已取消共享".into()));
        }
        Ok(())
    })();
    if let Err(error) = staged {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error);
    }

    // 网络阶段结束后再碰原文。主文档和同名目录一起移进一个隐藏备份目录；
    // 目标换入之前任一步失败，都能把整棵节点原样放回。
    let source = vault.resolve(input.note)?;
    let child = vault.resolve(input.note.strip_suffix(".md").unwrap_or(input.note))?;
    let source_parent = source
        .parent()
        .ok_or_else(|| Error::Vault("共享文档没有可用的父目录".into()))?;
    let backup = source_parent.join(format!(".verso-share-source-{}", ulid::Ulid::new()));
    std::fs::create_dir(&backup)?;
    let source_backup = backup.join(source.file_name().unwrap_or_default());
    if let Err(error) = std::fs::rename(&source, &source_backup) {
        let _ = std::fs::remove_dir_all(&backup);
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error.into());
    }
    let child_backup = backup.join(child.file_name().unwrap_or_default());
    if child.is_dir() {
        if let Err(error) = std::fs::rename(&child, &child_backup) {
            let _ = std::fs::rename(&source_backup, &source);
            let _ = std::fs::remove_dir_all(&backup);
            let _ = std::fs::remove_dir_all(&temp);
            return Err(error.into());
        }
    }

    let restore_source = || {
        if child_backup.exists() {
            let _ = std::fs::rename(&child_backup, &child);
        }
        if source_backup.exists() {
            let _ = std::fs::rename(&source_backup, &source);
        }
        let _ = std::fs::remove_dir_all(&backup);
    };

    let destination_is_empty = match destination.read_dir() {
        Ok(mut entries) => entries.next().is_none(),
        Err(error) => {
            restore_source();
            let _ = std::fs::remove_dir_all(&temp);
            return Err(error.into());
        }
    };
    if !destination_is_empty {
        restore_source();
        let _ = std::fs::remove_dir_all(&temp);
        return Err(Error::Vault(
            "创建期间目标文件夹出现了文件，已取消共享以免覆盖".into(),
        ));
    }
    if let Err(error) =
        std::fs::remove_dir(&destination).and_then(|_| std::fs::rename(&temp, &destination))
    {
        let _ = std::fs::create_dir_all(&destination);
        restore_source();
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error.into());
    }
    if let Err(error) = std::fs::remove_dir_all(&backup) {
        // 极少见，但仍恢复成「原文没动」。远端已有一份用户明确选择共享的内容，
        // 不会泄露额外文件；本机则不能在清理失败时悄悄留下两个真源。
        let rollback = parent.join(format!(".verso-share-rollback-{}", ulid::Ulid::new()));
        let _ = std::fs::rename(&destination, &rollback);
        restore_source();
        let _ = std::fs::create_dir_all(&destination);
        let _ = std::fs::remove_dir_all(&rollback);
        return Err(error.into());
    }
    Ok(destination)
}

/// 把一个私人内容节点加入已经存在的共享空间。现有空间可能正在被其他成员
/// 修改，所以先同步，再在临时克隆里完成新增与推送；成功前不碰原文和目标目录。
pub fn add_note_to(
    vault: &Vault,
    note: &str,
    destination: &Path,
    token: Option<String>,
    name: &str,
    email: &str,
) -> Result<PathBuf> {
    validate_identity(name, email)?;
    let preview = preview(vault, note)?;
    add_preview_to(vault, preview, destination, token, name, email)
}

fn add_preview_to(
    vault: &Vault,
    preview: SharePreview,
    destination: &Path,
    token: Option<String>,
    name: &str,
    email: &str,
) -> Result<PathBuf> {
    let destination = destination
        .canonicalize()
        .map_err(|_| Error::Vault("这个共享空间的位置已经不可用".into()))?;
    let source_root = vault.root.canonicalize().unwrap_or_else(|_| vault.root.clone());
    if destination.starts_with(&source_root) || source_root.starts_with(&destination) {
        return Err(Error::Vault("不能把当前空间加入它自己或它的子目录".into()));
    }
    space_info(&destination)
        .ok_or_else(|| Error::Vault("目标不是 Verso 创建或加入的共享空间".into()))?;

    let remote = super::sync::remote_get(&destination)?;
    let url = remote
        .url
        .ok_or_else(|| Error::Vault("这个共享空间还没有远端地址".into()))?;
    let before = super::sync::sync(&destination, token.clone())?;
    if !before.conflicts.is_empty() {
        return Err(Error::Vault(
            "共享空间有尚未解决的冲突，请先打开它完成同步".into(),
        ));
    }

    let parent = destination
        .parent()
        .ok_or_else(|| Error::Vault("共享空间没有可用的父目录".into()))?;
    let temp = parent.join(format!(".verso-share-add-{}", ulid::Ulid::new()));
    std::fs::create_dir(&temp)?;
    let staged = (|| -> Result<()> {
        super::sync::clone_remote(&url, &temp, token.clone())?;
        super::git::identity_set(&temp, name, email)?;

        for rel in preview.documents.iter().chain(preview.files.iter()) {
            let to = temp.join(rel);
            if to.exists() {
                return Err(Error::Vault(format!(
                    "共享空间里已经存在同名内容：{rel}"
                )));
            }
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(vault.resolve(rel)?, to)?;
        }
        for rel in &preview.attachments {
            let from = vault.resolve(rel)?;
            let to = temp.join(rel);
            if to.is_file() {
                if std::fs::read(&from)? == std::fs::read(&to)? {
                    continue;
                }
                return Err(Error::Vault(format!(
                    "共享空间里已有不同内容的同名附件：{rel}"
                )));
            }
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(from, to)?;
        }

        super::git::commit_all(&temp, Some("加入共享内容"))?;
        let outcome = super::sync::sync(&temp, token.clone())?;
        if !outcome.conflicts.is_empty() {
            return Err(Error::Vault("共享空间在加入期间出现冲突，已取消".into()));
        }
        Ok(())
    })();
    if let Err(error) = staged {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error);
    }

    // 远端成功后再同时切换源节点和本地共享空间。两个旧目录都先改成隐藏备份，
    // 任一步失败都能还原；远端那份已经安全存在，最坏也只是下次同步重新拉回。
    let source = vault.resolve(&preview.note)?;
    let child = vault.resolve(preview.note.strip_suffix(".md").unwrap_or(&preview.note))?;
    let source_parent = source
        .parent()
        .ok_or_else(|| Error::Vault("共享文档没有可用的父目录".into()))?;
    let source_backup = source_parent.join(format!(".verso-share-source-{}", ulid::Ulid::new()));
    std::fs::create_dir(&source_backup)?;
    let note_backup = source_backup.join(source.file_name().unwrap_or_default());
    if let Err(error) = std::fs::rename(&source, &note_backup) {
        let _ = std::fs::remove_dir_all(&source_backup);
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error.into());
    }
    let child_backup = source_backup.join(child.file_name().unwrap_or_default());
    if child.is_dir() {
        if let Err(error) = std::fs::rename(&child, &child_backup) {
            let _ = std::fs::rename(&note_backup, &source);
            let _ = std::fs::remove_dir_all(&source_backup);
            let _ = std::fs::remove_dir_all(&temp);
            return Err(error.into());
        }
    }
    let restore_source = || {
        if child_backup.exists() {
            let _ = std::fs::rename(&child_backup, &child);
        }
        if note_backup.exists() {
            let _ = std::fs::rename(&note_backup, &source);
        }
        let _ = std::fs::remove_dir_all(&source_backup);
    };

    let old_destination = parent.join(format!(".verso-share-old-{}", ulid::Ulid::new()));
    if let Err(error) = std::fs::rename(&destination, &old_destination) {
        restore_source();
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error.into());
    }
    if let Err(error) = std::fs::rename(&temp, &destination) {
        let _ = std::fs::rename(&old_destination, &destination);
        restore_source();
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error.into());
    }
    if let Err(error) = std::fs::remove_dir_all(&source_backup) {
        let rollback = parent.join(format!(".verso-share-rollback-{}", ulid::Ulid::new()));
        let _ = std::fs::rename(&destination, &rollback);
        let _ = std::fs::rename(&old_destination, &destination);
        restore_source();
        let _ = std::fs::remove_dir_all(&rollback);
        return Err(error.into());
    }
    let _ = std::fs::remove_dir_all(&old_destination);
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (PathBuf, Vault) {
        let root = std::env::temp_dir().join(format!("verso-share-source-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(root.join("项目/提案/实验")).unwrap();
        std::fs::create_dir_all(root.join("attachments")).unwrap();
        std::fs::write(
            root.join("项目/提案.md"),
            "![图](../attachments/a.png)\n[[私人记录]]\n[资料](../attachments/a.pdf)",
        )
        .unwrap();
        std::fs::write(
            root.join("项目/提案/实验记录.md"),
            "子文档引用 [[私人记录]] 和 ![[attachments/b.png]]",
        )
        .unwrap();
        std::fs::write(root.join("项目/提案/实验/数据.csv"), "a,b\n1,2").unwrap();
        std::fs::write(root.join("私人记录.md"), "不能分享").unwrap();
        std::fs::write(root.join("attachments/a.png"), b"png").unwrap();
        std::fs::write(root.join("attachments/a.pdf"), b"pdf").unwrap();
        std::fs::write(root.join("attachments/b.png"), b"png2").unwrap();
        let (vault, _) = Vault::open(root.clone()).unwrap();
        (root, vault)
    }

    #[test]
    fn preview_includes_the_whole_subtree_and_lists_private_notes() {
        let (root, source_vault) = vault();
        let got = preview(&source_vault, "项目/提案.md").unwrap();
        assert_eq!(
            got.attachments,
            vec![
                "attachments/a.pdf",
                "attachments/a.png",
                "attachments/b.png"
            ]
        );
        assert_eq!(got.documents, vec!["项目/提案.md", "项目/提案/实验记录.md"]);
        assert_eq!(got.files, vec!["项目/提案/实验/数据.csv"]);
        assert_eq!(got.linked_notes, vec!["私人记录.md"]);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn target_normalization_never_escapes_the_vault() {
        assert_eq!(
            normalize_target("项目/提案.md", "../attachments/a.png", false).as_deref(),
            Some("attachments/a.png")
        );
        assert!(normalize_target("提案.md", "../../secret.txt", false).is_none());
        assert!(normalize_target("提案.md", "https://example.com/a.png", false).is_none());
    }

    #[test]
    fn shared_marker_is_detected_without_opening_the_repo() {
        let root = std::env::temp_dir().join(format!("verso-share-marker-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(!is_shared_space(&root));
        std::fs::write(root.join(MARKER), "{}").unwrap();
        assert!(is_shared_space(&root));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn creates_a_small_repo_and_only_then_moves_the_source_note() {
        let (root, vault) = vault();
        let remote =
            std::env::temp_dir().join(format!("verso-share-remote-{}.git", ulid::Ulid::new()));
        let repo = git2::Repository::init_bare(&remote).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        let destination =
            std::env::temp_dir().join(format!("verso-share-dest-{}", ulid::Ulid::new()));
        std::fs::create_dir(&destination).unwrap();

        let made = create(
            &vault,
            CreateInput {
                note: "项目/提案.md",
                destination: &destination,
                url: remote.to_str().unwrap(),
                token: None,
                name: "林",
                email: "lin@example.com",
                members: &["person-1".to_string()],
                label: Some("与 @person-1 的共享"),
            },
        )
        .unwrap();

        assert_eq!(made, destination.canonicalize().unwrap());
        assert!(!root.join("项目/提案.md").exists(), "成功后原正文必须移走");
        assert!(destination.join("项目/提案.md").is_file());
        assert!(destination.join("attachments/a.png").is_file());
        assert!(destination.join("attachments/a.pdf").is_file());
        assert!(destination.join("attachments/b.png").is_file());
        assert!(destination.join("项目/提案/实验记录.md").is_file());
        assert!(destination.join("项目/提案/实验/数据.csv").is_file());
        assert!(!root.join("项目/提案").exists(), "同名子树必须一起移走");
        assert!(!destination.join("私人记录.md").exists());
        assert!(!destination.join("AGENTS.md").exists());
        assert!(destination.join(MARKER).is_file());
        let space = space_info(&destination).unwrap();
        assert_eq!(space.members, vec!["person-1"]);
        assert_eq!(space.name, "与 @person-1 的共享");

        std::fs::remove_dir_all(root).ok();
        std::fs::remove_dir_all(remote).ok();
        std::fs::remove_dir_all(destination).ok();
    }

    #[test]
    fn adds_another_note_to_an_existing_space_without_another_repo() {
        let (root, source_vault) = vault();
        let remote = std::env::temp_dir().join(format!("verso-share-reuse-{}.git", ulid::Ulid::new()));
        let repo = git2::Repository::init_bare(&remote).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        let destination = std::env::temp_dir().join(format!("verso-share-reuse-dest-{}", ulid::Ulid::new()));
        std::fs::create_dir(&destination).unwrap();
        create(
            &source_vault,
            CreateInput {
                note: "项目/提案.md",
                destination: &destination,
                url: remote.to_str().unwrap(),
                token: None,
                name: "林",
                email: "lin@example.com",
                members: &["person-1".to_string()],
                label: Some("与 @person-1 的共享"),
            },
        )
        .unwrap();

        let (other_root, other) = vault();
        let collision = add_note_to(
            &other,
            "项目/提案.md",
            &destination,
            None,
            "林",
            "lin@example.com",
        )
        .unwrap_err()
        .to_string();
        assert!(collision.contains("已经存在同名内容"), "{collision}");
        assert!(other_root.join("项目/提案.md").is_file(), "失败不能移走私人原文");

        std::fs::write(
            other_root.join("项目/补充.md"),
            "补充内容，复用 ![图](../attachments/a.png)",
        )
        .unwrap();
        let made = add_note_to(
            &other,
            "项目/补充.md",
            &destination,
            None,
            "林",
            "lin@example.com",
        )
        .unwrap();

        assert_eq!(made, destination.canonicalize().unwrap());
        assert!(destination.join("项目/提案.md").is_file());
        assert!(destination.join("项目/补充.md").is_file());
        assert!(!other_root.join("项目/补充.md").exists());
        assert_eq!(space_info(&destination).unwrap().members, vec!["person-1"]);

        std::fs::remove_dir_all(root).ok();
        std::fs::remove_dir_all(other_root).ok();
        std::fs::remove_dir_all(remote).ok();
        std::fs::remove_dir_all(destination).ok();
    }

    #[test]
    fn refuses_a_nonempty_remote_and_keeps_the_private_note() {
        let (root, vault) = vault();
        let remote =
            std::env::temp_dir().join(format!("verso-share-used-{}.git", ulid::Ulid::new()));
        let bare = git2::Repository::init_bare(&remote).unwrap();
        bare.set_head("refs/heads/main").unwrap();
        let seed = std::env::temp_dir().join(format!("verso-share-seed-{}", ulid::Ulid::new()));
        std::fs::create_dir(&seed).unwrap();
        super::super::git::ensure_repo(&seed).unwrap();
        std::fs::write(seed.join("已有.md"), "远端内容").unwrap();
        super::super::git::commit_all(&seed, Some("已有内容")).unwrap();
        super::super::sync::remote_set(&seed, remote.to_str().unwrap()).unwrap();
        super::super::sync::sync(&seed, None).unwrap();
        let destination =
            std::env::temp_dir().join(format!("verso-share-empty-{}", ulid::Ulid::new()));
        std::fs::create_dir(&destination).unwrap();

        let error = create(
            &vault,
            CreateInput {
                note: "项目/提案.md",
                destination: &destination,
                url: remote.to_str().unwrap(),
                token: None,
                name: "林",
                email: "lin@example.com",
                members: &[],
                label: None,
            },
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("已经有内容"), "{error}");
        assert!(root.join("项目/提案.md").is_file());
        assert!(destination.read_dir().unwrap().next().is_none());

        std::fs::remove_dir_all(root).ok();
        std::fs::remove_dir_all(remote).ok();
        std::fs::remove_dir_all(seed).ok();
        std::fs::remove_dir_all(destination).ok();
    }
}
