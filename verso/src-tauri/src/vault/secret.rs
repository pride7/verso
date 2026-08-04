//! 同步用的访问令牌。DESIGN.md §2.8。
//!
//! **令牌不进设置文件。** 那是一份明文 JSON，会被备份工具抄走、会被用户为了
//! 分享排版设置整个发出去，而一个仓库令牌等于那个仓库的写权限。系统钥匙串
//! （Windows 凭据管理器 / macOS 钥匙串 / Linux secret-service）是这台机器上
//! 唯一为这件事设计的地方。
//!
//! **按远端 URL 存，不按 vault 路径存。** 令牌是「这个仓库的通行证」而不是
//! 「这个文件夹的通行证」—— 同一个仓库在两处各克隆一份是常见做法（家里一份、
//! 办公室一份），按路径存的话第二份要重新填一遍。
//!
//! 钥匙串本身可能不可用（Linux 上没跑 secret-service、或者用户锁了）。那时
//! **读当作「没存过」、写才报错** —— 读失败就退回「这个远端要令牌」的提示，
//! 比整个同步功能起不来强。
//!
//! ## 安卓走文件，不走 keyring
//!
//! keyring 没有安卓后端，会**静默退回内存 mock**：`set` 成功、`get` 也成功，
//! 应用一重启令牌就没了 —— 表现是「每次打开都要重填令牌」，而且哪一层都
//! 不报错。安卓上把令牌落在**应用私有目录**（`/data/data/<包名>/…`，按 uid
//! 隔离，其他应用读不到）。要更强的保护得上 Android Keystore + JNI，等真有
//! 需求再说；明文进私有目录是绝大多数安卓应用存令牌的基线做法。

use crate::error::Result;
#[cfg(target_os = "android")]
use crate::error::Error;

use std::path::PathBuf;
use std::sync::OnceLock;

/// 应用私有数据目录，启动时由 lib.rs 的 setup 塞进来。
/// 桌面用不上（走系统钥匙串），安卓的文件后端靠它定位。
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}

// ---------------------------------------------------------------------------
// 桌面：系统钥匙串
// ---------------------------------------------------------------------------

/// 钥匙串里的服务名。改它等于让所有人的令牌失效，别动
#[cfg(not(target_os = "android"))]
const SERVICE: &str = "Verso 同步";

#[cfg(not(target_os = "android"))]
fn entry(url: &str) -> Result<keyring::Entry> {
    use crate::error::Error;
    keyring::Entry::new(SERVICE, url).map_err(|e| Error::Vault(format!("打不开系统钥匙串：{e}")))
}

/// 存一个令牌。空串 = 删掉。
#[cfg(not(target_os = "android"))]
pub fn token_set(url: &str, token: &str) -> Result<()> {
    use crate::error::Error;
    let e = entry(url)?;
    if token.is_empty() {
        // 本来就没有时删除会报 NoEntry —— 那不是错误，是本来就没有
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Vault(format!("删不掉旧令牌：{e}"))),
        };
    }
    e.set_password(token)
        .map_err(|e| Error::Vault(format!("存不进系统钥匙串：{e}")))
}

/// 取令牌。没存过、或者钥匙串读不了，都返回 None
#[cfg(not(target_os = "android"))]
pub fn token_get(url: &str) -> Option<String> {
    entry(url).ok()?.get_password().ok()
}

// ---------------------------------------------------------------------------
// 安卓：应用私有目录里的一个 JSON（url → 令牌）
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
fn tokens_path() -> Option<PathBuf> {
    DATA_DIR.get().map(|d| d.join("sync-tokens.json"))
}

#[cfg(target_os = "android")]
fn load() -> std::collections::BTreeMap<String, String> {
    tokens_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[cfg(target_os = "android")]
pub fn token_set(url: &str, token: &str) -> Result<()> {
    let path = tokens_path().ok_or_else(|| {
        // 正常启动不会走到：setup 里第一件事就是 init。真走到了要说清楚
        Error::Vault("应用数据目录还没初始化，存不了令牌".into())
    })?;
    let mut map = load();
    if token.is_empty() {
        map.remove(url);
    } else {
        map.insert(url.to_string(), token.to_string());
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_string_pretty(&map)
        .map_err(|e| Error::Vault(format!("令牌序列化失败：{e}")))?;
    std::fs::write(&path, json).map_err(|e| Error::Vault(format!("存不进令牌文件：{e}")))
}

#[cfg(target_os = "android")]
pub fn token_get(url: &str) -> Option<String> {
    load().remove(url)
}

// ---------------------------------------------------------------------------

/// 存过没有。**界面只问这个，永远不把令牌本身传给前端** ——
/// 传出去它就会出现在 IPC 日志、DevTools 的网络面板、以及任何一次截图里
pub fn token_has(url: &str) -> bool {
    token_get(url).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真的写进这台机器的钥匙串再删掉。用一个明显是测试的 URL 当键，
    /// 万一没删干净，用户在凭据管理器里也一眼看得出这是什么
    #[test]
    fn token_round_trips_and_deletes() {
        let url = format!("https://verso.test/{}.git", ulid::Ulid::new());
        // 这台机器没有可用的钥匙串后端时直接跳过：那是环境问题，
        // 不是代码问题，而 CI 容器里很常见
        if token_set(&url, "abc123").is_err() {
            eprintln!("跳过：这台机器没有可用的钥匙串");
            return;
        }
        assert_eq!(token_get(&url).as_deref(), Some("abc123"));
        assert!(token_has(&url));

        // 同一个 URL 再存一次是覆盖，不是报错
        token_set(&url, "def456").unwrap();
        assert_eq!(token_get(&url).as_deref(), Some("def456"));

        token_set(&url, "").unwrap();
        assert!(!token_has(&url), "删掉之后不该还在");
        // 删两次也不该报错
        token_set(&url, "").unwrap();
    }

    #[test]
    fn unknown_url_is_none_not_an_error() {
        let url = format!("https://verso.test/never-stored-{}", ulid::Ulid::new());
        assert_eq!(token_get(&url), None);
        assert!(!token_has(&url));
    }
}
