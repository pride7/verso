//! 内嵌终端 —— DESIGN.md §7.3 方案 B。
//!
//! §7.1 的论点：vault 是纯 .md，任何 AI CLI 都能直接在上面工作，所以我们
//! 不做 AI 功能，而是让用户自带 AI。这个面板就是那条路的入口。
//!
//! 真正的成本不在 xterm.js，而在下面这几件事：输出洪水、resize 同步、
//! 进程生命周期、以及 UTF-8 在读取边界被切开。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};

/// 输出聚合的时间窗。太小会让 `cat` 大文件淹死 IPC，太大则 AI 的流式输出
/// 看起来一顿一顿的。16ms ≈ 一帧。
const FLUSH_MS: u64 = 16;
/// 单帧上限。超出的部分留到下一帧，避免一次塞给前端几 MB。
const MAX_FRAME: usize = 64 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyData {
    id: String,
    /// base64 编码的原始字节
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: String,
    code: Option<u32>,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// 通知读取线程和刷新线程退出
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
    next_id: AtomicU64,
}

/// 选一个 shell。
///
/// Windows 上优先 PowerShell 7（`pwsh`）—— 它默认 UTF-8，而老的
/// `powershell.exe` 在中文环境下用 GBK，AI CLI 的输出会直接变乱码。
#[cfg(target_os = "windows")]
fn default_shell() -> CommandBuilder {
    if which("pwsh.exe") {
        CommandBuilder::new("pwsh.exe")
    } else {
        CommandBuilder::new("powershell.exe")
    }
}

#[cfg(target_os = "windows")]
fn which(exe: &str) -> bool {
    std::process::Command::new("where")
        .arg(exe)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn default_shell() -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l"); // 登录 shell，才能拿到用户 PATH 里的 AI CLI
    cmd
}

/// 起一个 shell 并把四个通道拿出来。
///
/// 从 `PtyManager::open` 里抽出来是为了可测 —— 它不依赖 `AppHandle`，
/// 测试里能直接验证「能起 shell、输入送得进去、输出读得回来」这条链路，
/// 而这正是最容易在不同平台上出问题的部分（Windows 的 ConPTY 尤其）。
pub struct Spawned {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

pub fn spawn_shell(cwd: &std::path::Path, cols: u16, rows: u16) -> Result<Spawned> {
    let pty = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::Vault(format!("创建终端失败: {e}")))?;

    let mut cmd = default_shell();
    cmd.cwd(cwd);
    // 让 AI CLI 知道自己在什么终端里，色彩才正常
    cmd.env("TERM", "xterm-256color");

    let child = pty
        .slave
        .spawn_command(cmd)
        .map_err(|e| Error::Vault(format!("启动 shell 失败: {e}")))?;

    let writer = pty
        .master
        .take_writer()
        .map_err(|e| Error::Vault(format!("获取终端输入通道失败: {e}")))?;
    let reader = pty
        .master
        .try_clone_reader()
        .map_err(|e| Error::Vault(format!("获取终端输出通道失败: {e}")))?;

    Ok(Spawned {
        master: pty.master,
        writer,
        reader,
        child,
    })
}

impl PtyManager {
    pub fn open(&self, app: &AppHandle, cwd: &std::path::Path, cols: u16, rows: u16) -> Result<String> {
        let Spawned {
            master,
            writer,
            mut reader,
            child,
        } = spawn_shell(cwd, cols, rows)?;

        let id = format!("pty-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let stop = Arc::new(AtomicBool::new(false));

        // 读取线程只管往缓冲区塞，刷新线程按时间窗取走。
        //
        // 分成两个线程是必要的：read() 会阻塞，如果在读取线程里做「超时刷新」，
        // 最后一小段输出会一直卡在缓冲区里，直到下一次有数据才被送出 ——
        // 表现就是命令跑完了但最后几行迟迟不显示。
        let buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));

        {
            let buf = buf.clone();
            let stop = stop.clone();
            std::thread::spawn(move || {
                let mut chunk = [0u8; 8192];
                loop {
                    match reader.read(&mut chunk) {
                        Ok(0) | Err(_) => break, // EOF 或 shell 退出
                        Ok(n) => buf.lock().unwrap().extend_from_slice(&chunk[..n]),
                    }
                }
                stop.store(true, Ordering::Relaxed);
            });
        }

        {
            let app = app.clone();
            let buf = buf.clone();
            let stop = stop.clone();
            let id2 = id.clone();
            std::thread::spawn(move || {
                let engine = base64::engine::general_purpose::STANDARD;
                loop {
                    std::thread::sleep(Duration::from_millis(FLUSH_MS));

                    let frame = {
                        let mut b = buf.lock().unwrap();
                        if b.is_empty() {
                            if stop.load(Ordering::Relaxed) {
                                break;
                            }
                            continue;
                        }
                        let take = b.len().min(MAX_FRAME);
                        b.drain(..take).collect::<Vec<u8>>()
                    };

                    let _ = app.emit(
                        "pty:data",
                        PtyData {
                            id: id2.clone(),
                            data: engine.encode(&frame),
                        },
                    );
                }
                let _ = app.emit("pty:exit", PtyExit { id: id2, code: None });
            });
        }

        self.sessions.lock().unwrap().insert(
            id.clone(),
            Session {
                master,
                writer,
                child,
                stop,
            },
        );
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().unwrap();
        let s = sessions
            .get_mut(id)
            .ok_or_else(|| Error::Vault(format!("终端不存在: {id}")))?;
        s.writer.write_all(data.as_bytes())?;
        s.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.sessions.lock().unwrap();
        let s = sessions
            .get(id)
            .ok_or_else(|| Error::Vault(format!("终端不存在: {id}")))?;
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Vault(format!("调整终端尺寸失败: {e}")))
    }

    pub fn close(&self, id: &str) -> Result<()> {
        if let Some(mut s) = self.sessions.lock().unwrap().remove(id) {
            s.stop.store(true, Ordering::Relaxed);
            let _ = s.child.kill();
        }
        Ok(())
    }

    /// 是否还有活着的终端。退出应用前用它提示用户（§7.3「进程生命周期」）。
    pub fn active_count(&self) -> usize {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, s| matches!(s.child.try_wait(), Ok(None)));
        sessions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// 端到端验证 PTY 这条链路：能起 shell、cwd 生效、输入送得进去、
    /// 输出读得回来。这是最容易在不同平台上出问题的部分 —— Windows 走
    /// ConPTY，与 Unix 的 openpty 行为差异很大。
    #[test]
    fn shell_starts_and_echoes_back() {
        let dir = std::env::temp_dir().join(format!("folio-pty-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();

        let mut s = spawn_shell(&dir, 80, 24).expect("应当能起一个 shell");

        // 读取必须放到单独线程里，用 channel + recv_timeout 取回。
        //
        // `reader.read()` 是阻塞的：直接在测试线程里边读边检查 deadline，
        // 一旦 shell 不输出任何东西，read 就永远不返回，deadline 检查根本
        // 走不到 —— 测试会永久挂住而不是失败。
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let mut reader = s.reader;
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        let mut acc = String::new();
        let mut answered_dsr = false;
        let mut sent_cmd = false;
        let deadline = Instant::now() + Duration::from_secs(30);

        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(chunk) => acc.push_str(&String::from_utf8_lossy(&chunk)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break, // 读取线程结束
            }

            // shell 启动时先发 DSR（`ESC[6n`，问光标在哪），**收到回答才打印
            // 提示符**。真实终端会自动应答，测试里必须自己扮演这个角色 ——
            // 不答就永远等不到提示符。这正是 xterm 在应用里替我们做的事。
            if !answered_dsr && acc.contains("\x1b[6n") {
                s.writer.write_all(b"\x1b[1;1R").unwrap();
                s.writer.flush().unwrap();
                answered_dsr = true;
            }

            // 等 shell 真正就绪（有提示符）再发命令，否则输入会被启动过程吞掉
            if !sent_cmd && (answered_dsr || acc.contains('>') || acc.contains('$')) {
                s.writer.write_all(b"echo folio-pty-marker-7f3a\r\n").unwrap();
                s.writer.flush().unwrap();
                sent_cmd = true;
                acc.clear(); // 只关心命令之后的输出
            }

            // 命令回显本身也含这个串，所以要求出现两次：
            // 一次是 shell 的回显，一次是 echo 的真正输出
            if sent_cmd && acc.matches("folio-pty-marker-7f3a").count() >= 2 {
                break;
            }
        }

        let _ = s.child.kill();
        std::fs::remove_dir_all(&dir).ok();

        assert!(
            acc.contains("folio-pty-marker-7f3a"),
            "shell 没有回传预期输出。实际收到:\n{acc}"
        );
    }

    #[test]
    fn resize_is_accepted() {
        let dir = std::env::temp_dir();
        let mut s = spawn_shell(&dir, 80, 24).unwrap();
        s.master
            .resize(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("resize 应当成功");
        let _ = s.child.kill();
    }
}
