//! 在系统终端中打开目录 —— DESIGN.md §7.3 方案 A。
//!
//! 内嵌终端面板（xterm.js + portable-pty）是 M5。这里先用几行代码把
//! 「快捷键调起终端跑 AI」这条路打通 —— §7.1 的核心论点是让用户自带 AI，
//! 而 vault 是纯 .md，任何 AI CLI 都能直接在上面工作。

use std::path::Path;
use std::process::Command;

use crate::error::{Error, Result};

/// 依次尝试各个终端，第一个成功的就用。
///
/// Windows 上优先 Windows Terminal —— 它是唯一支持 UTF-8 和真彩色的，
/// AI CLI 的流式输出在老的 conhost 里会花屏。
#[cfg(target_os = "windows")]
fn spawn_terminal(dir: &Path) -> Result<()> {
    let candidates: [(&str, Vec<String>); 3] = [
        ("wt.exe", vec!["-d".into(), dir.display().to_string()]),
        (
            "pwsh.exe",
            vec!["-NoExit".into(), "-Command".into(), format!("Set-Location -LiteralPath '{}'", dir.display())],
        ),
        (
            "powershell.exe",
            vec!["-NoExit".into(), "-Command".into(), format!("Set-Location -LiteralPath '{}'", dir.display())],
        ),
    ];

    for (exe, args) in candidates {
        if Command::new(exe).args(&args).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(Error::Vault("找不到可用的终端（试过 wt / pwsh / powershell）".into()))
}

#[cfg(target_os = "macos")]
fn spawn_terminal(dir: &Path) -> Result<()> {
    // -a Terminal 而不是直接 open：后者会用「默认打开文件夹的程序」，
    // 也就是访达，那不是我们想要的
    Command::new("open")
        .args(["-a", "Terminal"])
        .arg(dir)
        .spawn()
        .map_err(|e| Error::Vault(format!("打开终端失败: {e}")))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_terminal(dir: &Path) -> Result<()> {
    for exe in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
        if Command::new(exe).current_dir(dir).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(Error::Vault("找不到可用的终端".into()))
}

pub fn open_at(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Err(Error::Vault(format!("不是目录: {}", dir.display())));
    }
    // 和内嵌终端同一个理由：`\\?\D:\…` 递给 wt / PowerShell 之后，
    // 那个窗口里的 `cd` 就废了（详见 `winpath`）
    spawn_terminal(&crate::winpath::for_external(dir))
}
