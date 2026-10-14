//! 常用 AI 适配器装在本机，不再每次经 npx 现解析。DESIGN.md §7.8
//!
//! 预设里的 Claude、Codex 适配器是 npm 包。直接写 `npx -y 包名` 能跑，但有
//! 两个实测出来的毛病：
//!
//! - **每开一次都慢一截**：npx 每次都要先解析一遍包（实测多 1.2–1.7 秒，网络
//!   慢的地方更久），而面板每开一次、每换一个 AI 都要起一次进程
//! - **装过一次就不再更新**：npx 缓存里有旧版就一直用旧版。Codex 适配器 0.15
//!   解析不了服务器新报的思考强度档位，退回内置模型表，思考强度那一格就没了；
//!   0.16 才有 —— 而 npx 一直给的是 0.15
//!
//! 所以人选了预设之后，由 Verso 用他自己的 npm 装一份到应用数据目录，之后直接
//! `node 入口` 运行；每天在后台看一次有没有新版，有就装进一个新目录、换指针，
//! 下次启动生效。装在新目录而不是原地覆盖：Windows 上正在运行的 `.exe` 是锁着的，
//! 原地升级会因为文件占用失败。
//!
//! 装什么仍然是人自己选的（§7.5）—— 这里只是把 npx 每次都在做的那件事做一次。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::error::{Error, Result};

/// 多久看一次新版。适配器跟着各家 CLI 走，一天一次足够跟上，又不至于每开一次
/// 面板都去问一遍 npm
const UPDATE_EVERY: Duration = Duration::from_secs(24 * 3600);

/// 只认 npm 包名的字符。这个名字会拼进一条 shell 命令，不能让它带进别的东西
fn valid_package(pkg: &str) -> bool {
    !pkg.is_empty()
        && pkg.len() <= 214
        && !pkg.contains("..")
        && pkg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '/' | '-' | '_' | '.'))
        && !pkg.starts_with('.')
        && !pkg.starts_with('-')
}

/// 每个包一个目录：`@zed-industries/codex-acp` → `zed-industries__codex-acp`
fn slug(pkg: &str) -> String {
    pkg.trim_start_matches('@').replace('/', "__")
}

/// 装好的那一版的入口脚本。读包自己的 `package.json` 里的 `bin`
fn entry_of(dir: &Path, pkg: &str) -> Option<PathBuf> {
    let mut pkg_dir = dir.join("node_modules");
    for part in pkg.split('/') {
        pkg_dir.push(part);
    }
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pkg_dir.join("package.json")).ok()?).ok()?;
    let bin = match &manifest["bin"] {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(m) => m.values().next()?.as_str()?.to_string(),
        _ => return None,
    };
    let entry = pkg_dir.join(bin);
    entry.is_file().then_some(entry)
}

fn installed_version(dir: &Path, pkg: &str) -> Option<String> {
    let mut manifest = dir.join("node_modules");
    for part in pkg.split('/') {
        manifest.push(part);
    }
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(manifest.join("package.json")).ok()?).ok()?;
    v["version"].as_str().map(str::to_string)
}

/// 现在用的是哪个目录（`current` 文件里记着名字）
fn current_dir(root: &Path, pkg: &str) -> Option<PathBuf> {
    let base = root.join(slug(pkg));
    let name = std::fs::read_to_string(base.join("current")).ok()?;
    let dir = base.join(name.trim());
    dir.is_dir().then_some(dir)
}

/// 交给 shell 的那一行：`node "入口"`
pub fn launch_command(entry: &Path) -> String {
    format!("node \"{}\"", entry.display())
}

/// 已经装过就给入口，没装过给 None
pub fn installed(root: &Path, pkg: &str) -> Option<PathBuf> {
    if !valid_package(pkg) {
        return None;
    }
    entry_of(&current_dir(root, pkg)?, pkg)
}

/// 用一行 shell 命令跑 npm，失败时把它最后几行输出带回来 —— 没装 Node、
/// 连不上 npm 源，人要能看见是哪一种
fn npm(line: &str, cwd: &Path) -> Result<String> {
    let out = crate::agent::shell_command(line)
        .current_dir(crate::winpath::for_external(cwd))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| Error::Vault(format!("运行 npm 失败：{e}")))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let tail: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = tail[tail.len().saturating_sub(6)..].join("\n");
    Err(Error::Vault(if tail.is_empty() {
        "npm 安装失败。要先装好 Node.js（它自带 npm）".into()
    } else {
        format!("npm 安装失败：\n{tail}")
    }))
}

/// 装最新版到一个新目录，装好了再把指针换过去。旧目录尽量清掉，删不掉的
/// （正在运行、文件被锁）留到下次
pub fn install(root: &Path, pkg: &str) -> Result<PathBuf> {
    if !valid_package(pkg) {
        return Err(Error::Vault(format!("不认识的包名：{pkg}")));
    }
    let base = root.join(slug(pkg));
    std::fs::create_dir_all(&base)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let name = format!("v{stamp}");
    let dir = base.join(&name);
    std::fs::create_dir_all(&dir)?;
    let line = format!(
        "npm install --prefix \"{}\" --no-audit --no-fund --loglevel=error {pkg}@latest",
        crate::winpath::for_external(&dir).display()
    );
    if let Err(e) = npm(&line, &dir) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    let Some(entry) = entry_of(&dir, pkg) else {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(Error::Vault(format!("{pkg} 装好了，却找不到它的入口")));
    };
    let previous = std::fs::read_to_string(base.join("current")).ok();
    let tmp = base.join("current.tmp");
    std::fs::write(&tmp, &name)?;
    std::fs::rename(&tmp, base.join("current"))?;

    // 留着上一版：它可能正在运行（另一个窗口、或者这次就是后台更新），
    // 删了会让那个进程读文件时失败。再早的都清掉
    let keep = [Some(name.as_str()), previous.as_deref().map(str::trim)];
    if let Ok(entries) = std::fs::read_dir(&base) {
        for e in entries.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if n.starts_with('v') && !keep.contains(&Some(n.as_str())) {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(entry)
}

/// 后台看一眼有没有新版。离上次看不到一天就什么都不做；npm 上的版本和装着的
/// 一样，只记一下「今天看过了」。返回是否装了新版（下次启动生效）
pub fn update(root: &Path, pkg: &str) -> Result<bool> {
    let Some(dir) = current_dir(root, pkg) else {
        return Ok(false);
    };
    let marker = root.join(slug(pkg)).join("current");
    let fresh = std::fs::metadata(&marker)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < UPDATE_EVERY);
    if fresh {
        return Ok(false);
    }
    let latest = npm(&format!("npm view {pkg}@latest version"), root)?;
    if installed_version(&dir, pkg).as_deref() == Some(latest.trim()) {
        // 碰一下指针文件的修改时间 = 记下「今天看过了」
        let name = std::fs::read_to_string(&marker)?;
        std::fs::write(&marker, name)?;
        return Ok(false);
    }
    install(root, pkg)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_names_cannot_smuggle_shell() {
        assert!(valid_package("@zed-industries/codex-acp"));
        assert!(valid_package("left-pad"));
        assert!(!valid_package("a && del /q *"));
        assert!(!valid_package("a\"b"));
        assert!(!valid_package("../x"));
        assert!(!valid_package("-g"));
        assert!(!valid_package(""));
    }

    #[test]
    fn entry_comes_from_the_packages_own_bin() {
        let dir = std::env::temp_dir().join(format!("verso-pkg-{}", ulid::Ulid::new()));
        let pkg_dir = dir.join("node_modules").join("@scope").join("tool");
        std::fs::create_dir_all(pkg_dir.join("dist")).unwrap();
        std::fs::write(
            pkg_dir.join("package.json"),
            r#"{"version":"1.2.3","bin":{"tool":"dist/index.js"}}"#,
        )
        .unwrap();
        std::fs::write(pkg_dir.join("dist").join("index.js"), "").unwrap();
        assert_eq!(entry_of(&dir, "@scope/tool"), Some(pkg_dir.join("dist").join("index.js")));
        assert_eq!(installed_version(&dir, "@scope/tool").as_deref(), Some("1.2.3"));

        // 指针指着它才算装好了
        let root = dir.join("root");
        let base = root.join(slug("@scope/tool"));
        std::fs::create_dir_all(&base).unwrap();
        assert!(installed(&root, "@scope/tool").is_none());
        std::fs::rename(dir.join("node_modules"), {
            let v = base.join("v1");
            std::fs::create_dir_all(&v).unwrap();
            v.join("node_modules")
        })
        .unwrap();
        std::fs::write(base.join("current"), "v1").unwrap();
        assert!(installed(&root, "@scope/tool").is_some());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn launch_quotes_the_path() {
        assert_eq!(launch_command(Path::new("C:/A B/x.js")), "node \"C:/A B/x.js\"");
    }
}

/// 真装一次 codex 的适配器、直接运行它握手，再走一遍「检查更新」。要联网、
/// 要装着 Node，默认不跑：
///
/// ```text
/// cargo test --lib real_install_and_launch -- --ignored --nocapture
/// ```
#[cfg(test)]
mod real {
    use super::*;
    use std::io::{BufRead, BufReader, Write};

    #[test]
    #[ignore]
    fn real_install_and_launch() {
        let root = std::env::temp_dir().join(format!("verso-agents-{}", ulid::Ulid::new()));
        let pkg = "@agentclientprotocol/codex-acp";
        let t = std::time::Instant::now();
        let entry = install(&root, pkg).expect("装得上");
        println!("装好用了 {:?}：{}", t.elapsed(), entry.display());
        assert_eq!(installed(&root, pkg).as_deref(), Some(entry.as_path()));

        let t = std::time::Instant::now();
        let mut child = crate::agent::shell_command(&launch_command(&entry))
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":1,"clientCapabilities":{{}}}}}}"#).unwrap();
        let line = BufReader::new(child.stdout.take().unwrap()).lines().next().unwrap().unwrap();
        println!("直接运行，握手用了 {:?}：{}", t.elapsed(), &line[..line.len().min(160)]);
        assert!(line.contains("\"protocolVersion\":1"));
        // 连根停：只杀外层 shell 的话，node 和 codex-acp 会占着输出管道不放
        crate::agent::kill_tree(&mut child);
        let _ = child.wait();

        // 刚装的，一天之内不会再去问
        assert!(!update(&root, pkg).unwrap());
        std::fs::remove_dir_all(&root).ok();
    }
}
