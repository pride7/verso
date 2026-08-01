use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("读写文件失败: {0}")]
    Io(#[from] std::io::Error),

    #[error("frontmatter 解析失败: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("git 操作失败: {0}")]
    Git(#[from] git2::Error),

    /// 路径逃出了 vault 根目录。任何来自前端的相对路径都要过 `Vault::resolve`，
    /// 这是唯一的防线 —— 前端传 `../../..` 不应该能读到 vault 以外的文件。
    #[error("路径越界: {0}")]
    PathEscape(String),

    #[error("{0}")]
    Vault(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Tauri command 的错误必须可序列化。统一序列化成人类可读的字符串，
/// 前端直接拿去展示，不需要认识错误类型。
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
