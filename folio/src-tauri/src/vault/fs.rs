//! 文件系统抽象层。
//!
//! DESIGN.md §1.2：桌面走 `std::fs`，iOS 走 iCloud ubiquity container，
//! Android 走 SAF。业务代码**只依赖这个 trait**，不直接碰 `std::fs` ——
//! 移动端本身可以晚做，但不能到 M6 才发现文件层写死了。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

#[derive(Debug, Clone)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct FileMeta {
    pub mtime_ms: i64,
    pub size: u64,
}

pub trait VaultFs: Send + Sync {
    fn read_to_string(&self, path: &Path) -> Result<String>;

    /// 原子写入：`写 .tmp → fsync → rename`。
    ///
    /// DESIGN.md §2.7 —— 断电或崩溃时绝不能留下半个文件。笔记软件丢数据
    /// 只要发生一次，用户就再也不会信任它了。
    fn write_atomic(&self, path: &Path, contents: &str) -> Result<()>;

    fn create_dir_all(&self, path: &Path) -> Result<()>;
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>>;
    fn rename(&self, from: &Path, to: &Path) -> Result<()>;
    fn remove_file(&self, path: &Path) -> Result<()>;
    fn remove_dir_all(&self, path: &Path) -> Result<()>;
    fn remove_dir_if_empty(&self, path: &Path) -> Result<bool>;
    fn exists(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn metadata(&self, path: &Path) -> Result<FileMeta>;
}

pub struct DesktopFs;

impl VaultFs for DesktopFs {
    fn read_to_string(&self, path: &Path) -> Result<String> {
        Ok(fs::read_to_string(path)?)
    }

    fn write_atomic(&self, path: &Path, contents: &str) -> Result<()> {
        let parent = path
            .parent()
            .ok_or_else(|| Error::Vault(format!("没有父目录: {}", path.display())))?;
        fs::create_dir_all(parent)?;

        // 临时文件必须和目标在同一个目录 —— 跨卷 rename 不是原子操作，
        // 而系统临时目录很可能在另一个盘上。
        let tmp = tmp_path_for(path);

        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(contents.as_bytes())?;
            // fsync 之后才 rename。少了这步，崩溃后可能 rename 已生效
            // 但内容还在页缓存里没落盘，得到一个长度为 0 的文件。
            f.sync_all()?;
        }

        // std::fs::rename 在 Windows 上用 MoveFileEx + MOVEFILE_REPLACE_EXISTING，
        // 对文件是覆盖语义，与 Unix 一致。
        match fs::rename(&tmp, path) {
            Ok(()) => Ok(()),
            Err(e) => {
                let _ = fs::remove_file(&tmp); // 别把临时文件留在 vault 里
                Err(e.into())
            }
        }
    }

    fn create_dir_all(&self, path: &Path) -> Result<()> {
        Ok(fs::create_dir_all(path)?)
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
        let mut out = Vec::new();
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            // file_type() 不跟随符号链接，避免符号链接成环导致递归扫描挂死
            let is_dir = entry.file_type()?.is_dir();
            out.push(DirEntry { name, is_dir });
        }
        Ok(out)
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<()> {
        Ok(fs::rename(from, to)?)
    }

    fn remove_file(&self, path: &Path) -> Result<()> {
        Ok(fs::remove_file(path)?)
    }

    fn remove_dir_all(&self, path: &Path) -> Result<()> {
        Ok(fs::remove_dir_all(path)?)
    }

    /// 删空的同名文件夹用（DESIGN.md §2.1「子文档为空时」）。
    /// 返回是否真的删掉了。
    fn remove_dir_if_empty(&self, path: &Path) -> Result<bool> {
        if !path.is_dir() {
            return Ok(false);
        }
        if fs::read_dir(path)?.next().is_some() {
            return Ok(false);
        }
        fs::remove_dir(path)?;
        Ok(true)
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn metadata(&self, path: &Path) -> Result<FileMeta> {
        let m = fs::metadata(path)?;
        let mtime_ms = m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Ok(FileMeta {
            mtime_ms,
            size: m.len(),
        })
    }
}

fn tmp_path_for(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "tmp".into());
    name.push_str(".folio-tmp");
    path.with_file_name(name)
}
