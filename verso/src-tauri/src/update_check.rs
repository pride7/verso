//! 「有没有新版本」——**只查，不装**。DESIGN.md §2.11
//!
//! ## 为什么不复用 updater 插件
//!
//! 那个插件在移动端根本不存在（它是 target 依赖，安卓包里没编进去），理由
//! 也成立：一个应用没有权限就地替换自己，安卓的包由应用商店或系统安装器管。
//!
//! **但「装不了」不等于「不该知道」。** 手机上那个「检查更新」按钮一直是灰的，
//! 用户连「现在有没有新版本」都问不出来 —— 而这件事只需要一个 HTTPS GET，
//! 和能不能就地安装毫无关系。
//!
//! 所以这里绕过插件，直接读同一个清单文件（`tauri.conf.json` 里 updater
//! 的 endpoint），把版本号和更新说明拿回来交给界面。桌面仍然走插件那条完整
//! 的路 —— 它还要验签名、下载、重启，那些这里一样都不做。
//!
//! ## 给的是安装包的直链，不是发布页
//!
//! 发布页上挂着十几个文件（各平台的安装包、各自的 `.sig`、清单本身），手机
//! 上还得先展开 Assets 再从里面挑对的那一个 —— 那不是「下载」，那是一道
//! 阅读理解题。所以直接指向 arm64 的 APK，点一下浏览器就开始下，下完系统
//! 安装器接手。
//!
//! **但直链是拼出来的，拼错就是一个 404 页面** —— 比发布页还糟。所以拼完
//! 先 HEAD 一次确认它真的在；不在就退回发布页，那个地址永远有效。
//!
//! ## 不验签名要紧吗
//!
//! 不要紧，因为这里**不产生任何可执行的东西**，也不决定装什么 —— 地址是
//! 本文件里写死的 GitHub 仓库，清单只能影响里面那个版本号。最坏情况是有人
//! 骗你「有新版本」，而下一步下到的仍然是我们自己发布页上的那个包（GitHub
//! 的 https 保证），装不装还要过一遍安卓的安装器。签名校验属于「装」那一半，
//! 那一半在移动端本来就不发生。

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::error::{Error, Result};

/// 和 `tauri.conf.json` 里 `plugins.updater.endpoints[0]` 是同一个文件。
///
/// **两处必须一致**，否则手机查到的版本和桌面装到的版本会是两回事。没做成
/// 从配置里读：那个值要经过 tauri 的配置解析才拿得到，而这里只需要一个常量，
/// 多绕一层反而多一处会坏的地方。
const MANIFEST: &str = "https://github.com/pride7/verso/releases/latest/download/latest.json";

/// 发布页。直链拿不到时的退路 —— 这个地址不依赖任何命名约定，永远有效。
const RELEASES: &str = "https://github.com/pride7/verso/releases/latest";

/// 安装包直链的前缀。`/releases/latest/download/<文件名>` 是 GitHub 的固定
/// 跳转，不用先查一遍 API 拿 asset id。
const DOWNLOAD: &str = "https://github.com/pride7/verso/releases/latest/download";

/// updater 清单里我们用得上的那几项。其余字段（`platforms`、签名…）
/// 属于「装」那一半，这里不碰。
#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default, rename = "pub_date")]
    pub_date: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    pub version: String,
    pub notes: String,
    pub date: String,
    /// 比当前跑着的这一版新吗。
    ///
    /// **比较在这边做，不在前端。** 一开始两边各写了一份同样的规则，结果
    /// Rust 那份从来没被调用过（`dead_code` 警告抓出来的）—— 两份规则里
    /// 有一份是死的，而死的那份不会跟着另一份一起改。当前版本从
    /// `CARGO_PKG_VERSION` 取，和 `package.json` 由 `scripts/version.mjs`
    /// 保证一致。
    pub newer: bool,
    /// 安装包直链。**确认过存在**才会有值，拿不到就是 `None`，界面退回发布页
    pub download_url: Option<String>,
    /// 发布页。永远有值 —— 让前端不必自己拼 URL，改发布地址时只动这个文件
    pub page_url: String,
}

/// 这个平台的安装包在发布页上叫什么。
///
/// 只认安卓：iOS 还没打包（M6b），而桌面走 updater 插件那条完整的路，
/// 根本不会走到这里。不认识的平台返回 `None`，界面退回发布页。
fn asset_name(version: &str) -> Option<String> {
    if cfg!(target_os = "android") {
        // 和 `scripts/android-apk.ps1` 里改名那一段是同一个格式。
        // 两处必须一致 —— 不一致的表现是点「下载」跳到一个 404
        Some(format!("Verso_{version}_arm64.apk"))
    } else {
        None
    }
}

/// 直链真的在吗。拼错一个字就是个 404 页面，而那比直接给发布页更糟 ——
/// 用户会以为是发布出了问题。
fn verify(url: &str) -> bool {
    ureq::head(url)
        .timeout(Duration::from_secs(15))
        .set("User-Agent", "Verso")
        .call()
        .is_ok()
}

pub fn fetch_latest() -> Result<LatestRelease> {
    let manifest: Manifest = ureq::get(MANIFEST)
        .timeout(Duration::from_secs(20))
        .set("User-Agent", "Verso")
        .call()
        .map_err(humanize)?
        .into_json()
        .map_err(|e| Error::Vault(format!("更新清单读不出来：{e}")))?;

    let version = manifest.version.trim().trim_start_matches('v').to_string();
    let newer = is_newer(&version, env!("CARGO_PKG_VERSION"));
    // 不比当前新就不必再去确认安装包在不在 —— 那一次 HEAD 是白花的
    let download_url = if newer {
        asset_name(&version)
            .map(|name| format!("{DOWNLOAD}/{name}"))
            .filter(|url| verify(url))
    } else {
        None
    };

    Ok(LatestRelease {
        version,
        newer,
        notes: manifest.notes,
        date: manifest.pub_date,
        download_url,
        page_url: RELEASES.to_string(),
    })
}

fn humanize(error: ureq::Error) -> Error {
    match error {
        ureq::Error::Status(code, _) => {
            Error::Vault(format!("检查更新失败：服务器返回 HTTP {code}"))
        }
        ureq::Error::Transport(_) => Error::Vault("连不上更新服务器，请检查网络连接".into()),
    }
}

/// 语义化版本比较，只认 `主.次.修`。**只有这一份** —— 前端读 `newer` 的结论，
/// 不自己再比一遍（那样其中一份迟早成为不会跟着改的死代码）。
///
/// **不用字符串比大小**：`"0.10.0" < "0.9.0"` 在字典序下成立，而那正是
/// 版本号跨过 x.10 时最容易出现的一次静默错判 —— 表现是「明明有新版本，
/// 却一直说已是最新」，而且要等到真的发到 0.10 才现形。
///
/// 认不出来的（预发布后缀、位数不对）一律当作「不比现在新」：宁可漏报，
/// 也不要因为解析不了就天天弹一个更新提示。
pub fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |s: &str| -> Option<[u32; 3]> {
        let core = s.trim().trim_start_matches('v');
        // 预发布/构建后缀切掉再比：`0.8.0-beta.1` 按 `0.8.0` 算
        let core = core.split(['-', '+']).next().unwrap_or(core);
        let mut parts = core.split('.');
        let mut out = [0u32; 3];
        for slot in out.iter_mut() {
            *slot = parts.next()?.parse().ok()?;
        }
        if parts.next().is_some() {
            return None;
        }
        Some(out)
    };
    match (parse(candidate), parse(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{asset_name, is_newer};

    /// 文件名和 `scripts/android-apk.ps1` 改名那一段是同一个格式。
    /// 漂了的表现是手机上点「下载」跳到一个 404，而那一步没人会去测。
    #[test]
    #[cfg(target_os = "android")]
    fn 安卓的包名和打包脚本一致() {
        assert_eq!(
            asset_name("0.7.21").as_deref(),
            Some("Verso_0.7.21_arm64.apk")
        );
    }

    /// 桌面走 updater 插件，不该拼安装包直链
    #[test]
    #[cfg(not(target_os = "android"))]
    fn 非安卓不拼直链() {
        assert_eq!(asset_name("0.7.21"), None);
    }

    /// 当前版本从 `CARGO_PKG_VERSION` 取，和 `package.json` 由
    /// `scripts/version.mjs` 保证一致 —— 这条钉住「取的确实是本包的版本」
    #[test]
    fn 当前版本取的是本包的版本() {
        assert!(!is_newer(env!("CARGO_PKG_VERSION"), env!("CARGO_PKG_VERSION")));
        assert!(is_newer("99.0.0", env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn 按数值比而不是按字典序() {
        // 这一条是这个函数存在的理由：字典序下 "0.10.0" 比 "0.9.0" 小
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(!is_newer("0.9.0", "0.10.0"));
    }

    #[test]
    fn 相同版本不算新() {
        assert!(!is_newer("0.7.21", "0.7.21"));
    }

    #[test]
    fn 各段都要比到() {
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(is_newer("0.7.22", "0.7.21"));
        assert!(!is_newer("0.7.20", "0.7.21"));
    }

    #[test]
    fn 前缀v和预发布后缀都能认() {
        assert!(is_newer("v0.8.0", "0.7.21"));
        assert!(is_newer("0.8.0-beta.1", "0.7.21"));
    }

    #[test]
    fn 认不出来的当作不新() {
        assert!(!is_newer("", "0.7.21"));
        assert!(!is_newer("latest", "0.7.21"));
        assert!(!is_newer("0.7", "0.7.21"));
        assert!(!is_newer("0.7.21.1", "0.7.21"));
    }
}
