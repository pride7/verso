//! AI 会话面板背后的那个进程 —— DESIGN.md §7.8。
//!
//! 面板说的是 ACP（Agent Client Protocol）：一行一条 JSON-RPC，走子进程的
//! stdin / stdout。协议本身全在前端（`core/acp.ts`），这里只做三件前端做不了
//! 的事：起进程、把 stdout 一行一行转成事件、把一行写进 stdin。
//!
//! 和终端（`pty.rs`）是两条路：终端要的是一块屏幕（PTY、按帧聚合字节），这里
//! 要的是一条消息流 —— 行就是消息的边界，聚合反而会把一条消息切成两半。
//!
//! **跑什么由用户的设置决定，Verso 不内置、不下载任何 AI**（§7.5）。设置里那
//! 一行交给系统 shell 去跑，所以 `npx …`、装在 PATH 里的命令、带参数的写法
//! 都和在终端里敲一样。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLine {
    id: String,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentExit {
    id: String,
    code: Option<i32>,
}

struct Proc {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct AgentManager {
    procs: Arc<Mutex<HashMap<String, Proc>>>,
    next_id: AtomicU64,
}

/// 只属于「外面那个 Claude Code 会话」的环境变量。
///
/// Verso 是从一个 Claude Code 会话的终端里拉起来的时候（开发时天天如此），
/// 这几个会被继承下去，子进程里的 Claude Code 会把自己当成那个会话的子会话，
/// 起不来。只摘这几个**会话身份**相关的 —— `CLAUDE_CODE_USE_BEDROCK` 这类是
/// 用户自己的配置，必须原样传下去。
const PARENT_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS",
    "CLAUDE_PID",
];

/// 用户自己装的那个 `claude`。
///
/// Claude 的 ACP 适配器自带一份 Claude Code，版本落后，而且**在 Windows 上
/// 没装 Git Bash 就直接退出**（退出码 1，适配器那边只报一句 `Query closed
/// before response received`）。用户装的新版本没有这个要求。所以只要找得到，
/// 就经 `CLAUDE_CODE_EXECUTABLE` 让适配器用它 —— 这也正是「用户自带 AI」：
/// 面板里跑的和他在终端里敲 `claude` 得到的是同一个程序、同一份设置。
///
/// 只认 `.exe`：npm 装出来的是 `claude.cmd`，Node 不经 shell 起不了 `.cmd`
/// （适配器正是这么起的），指过去反而更糟。
#[cfg(windows)]
fn own_claude() -> Option<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // 官方安装脚本放在这里，而它不一定已经进了这个进程看到的 PATH
    if let Some(home) = std::env::var_os("USERPROFILE") {
        dirs.push(Path::new(&home).join(".local").join("bin"));
    }
    dirs.into_iter().map(|d| d.join("claude.exe")).find(|p| p.is_file())
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 用系统 shell 跑那一行命令。
///
/// - Windows：`cmd /d /s /c "<命令>"`。`npx` 是个 `.cmd`，不经 shell 起不来；
///   `/s` 让 cmd 只剥最外面那对引号，命令里自己的引号原样保留。不开控制台
///   窗口 —— 否则每开一次面板就闪一个黑框
/// - 其余：`$SHELL -l -c`。登录 shell 才读得到用户的 PATH：从 Dock / 访达
///   启动的应用拿到的 PATH 只有系统那几个目录，`npx` 都找不到
pub(crate) fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd.exe");
        cmd.raw_arg(format!("/d /s /c \"{command}\""));
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut cmd = Command::new(shell);
        cmd.args(["-l", "-c", command]);
        // 自成一个进程组，停的时候整组一起停：shell 下面还挂着 node，
        // 只杀 shell 的话 node 会变成孤儿接着跑
        cmd.process_group(0);
        cmd
    }
}

/// 连同子进程一起停掉。shell → npx → node → Claude Code 是一整串，只杀
/// 最上面那个，下面几层会留在后台继续占着内存和登录态。
pub(crate) fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

/// 拼出要起的那个进程：shell、工作目录、三条管道、环境变量。
fn prepare(command: &str, cwd: &Path) -> Command {
    let mut cmd = shell_command(command);
    cmd.current_dir(crate::winpath::for_external(cwd))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for k in PARENT_SESSION_VARS {
        cmd.env_remove(k);
    }
    #[cfg(windows)]
    if std::env::var_os("CLAUDE_CODE_EXECUTABLE").is_none() {
        if let Some(exe) = own_claude() {
            cmd.env("CLAUDE_CODE_EXECUTABLE", exe);
        }
    }
    cmd
}

impl AgentManager {
    /// 起一个 agent 进程，返回它的 id。之后的 stdout 每一行发一个
    /// `agent:line`，stderr 每一行发一个 `agent:stderr`，退出时发 `agent:exit`。
    pub fn start(&self, app: &AppHandle, command: &str, cwd: &Path) -> Result<String> {
        let command = command.trim();
        if command.is_empty() {
            return Err(Error::Vault("还没有设置要启动的 AI 命令".into()));
        }
        let mut child = prepare(command, cwd)
            .spawn()
            .map_err(|e| Error::Vault(format!("启动 AI 失败：{e}")))?;
        let stdin = child.stdin.take().expect("stdin 是 piped 的");
        let stdout = child.stdout.take().expect("stdout 是 piped 的");
        let stderr = child.stderr.take().expect("stderr 是 piped 的");

        let id = format!("agent-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        self.procs
            .lock()
            .unwrap()
            .insert(id.clone(), Proc { child, stdin });

        // stderr 是诊断信息：适配器的日志、起不来时的原因。前端留最后几行，
        // 进程意外退出时摆出来；同时进 logcat / 控制台（AGENTS.md「没有日志
        // 就等于瞎猜」）
        {
            let app = app.clone();
            let id = id.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    let Ok(line) = line else { break };
                    eprintln!("[verso agent] {line}");
                    let _ = app.emit("agent:stderr", AgentLine { id: id.clone(), line });
                }
            });
        }

        // stdout 读到头 = 进程没了（自己退出，或者被 `stop` 杀掉）。那时才
        // 去收它的退出码 —— 在这之前 `wait` 会一直卡着读不到的那一端
        {
            let app = app.clone();
            let id = id.clone();
            let procs = self.procs.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
                    }
                    let _ = app.emit("agent:line", AgentLine { id: id.clone(), line });
                }
                let code = procs
                    .lock()
                    .unwrap()
                    .remove(&id)
                    .and_then(|mut p| p.child.wait().ok())
                    .and_then(|s| s.code());
                let _ = app.emit("agent:exit", AgentExit { id, code });
            });
        }

        Ok(id)
    }

    /// 往 stdin 写一条消息。消息本身不能带换行 —— 换行就是消息的边界，
    /// 前端用 `JSON.stringify` 出来的本来也不会有
    pub fn send(&self, id: &str, line: &str) -> Result<()> {
        let mut procs = self.procs.lock().unwrap();
        let p = procs
            .get_mut(id)
            .ok_or_else(|| Error::Vault("AI 进程已经结束了".into()))?;
        let mut buf = line.replace(['\r', '\n'], " ");
        buf.push('\n');
        p.stdin
            .write_all(buf.as_bytes())
            .and_then(|_| p.stdin.flush())
            .map_err(|e| Error::Vault(format!("发给 AI 失败：{e}")))
    }

    /// 停掉。不在了也不算错 —— 面板关掉时进程可能早就自己退了
    pub fn stop(&self, id: &str) {
        let proc = self.procs.lock().unwrap().remove(id);
        if let Some(mut p) = proc {
            kill_tree(&mut p.child);
            // 收尸，不留僵尸进程。读 stdout 的那个线程会因为管道断开自己结束
            let _ = p.child.wait();
        }
    }

    /// 应用退出时全停掉。面板的卸载清理在关窗那一刻不一定跑得到
    pub fn stop_all(&self) {
        let ids: Vec<String> = self.procs.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 起一个真进程走一遍 shell 那条路：命令行里的引号和空格要原样到达。
    /// 不经 Tauri —— 这里测的是 `shell_command` 拼出来的东西 shell 认不认
    #[test]
    fn shell_runs_the_line_as_typed() {
        let out = shell_command(r#"echo "a  b""#)
            .stdout(Stdio::piped())
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("a  b"), "实际输出：{text:?}");
    }

    /// 真起一个 Claude 的 ACP 适配器，握手、开会话，然后停掉。**不发问**，
    /// 所以不花钱；但要联网、要装着 Node 和登录过的 Claude Code，默认不跑：
    ///
    /// ```text
    /// cargo test --lib real_agent_handshake -- --ignored --nocapture
    /// ```
    ///
    /// 盯的是测试替身覆盖不到的那几处：Windows 上 `cmd /s /c` 的引号、摘掉
    /// 外层会话的环境变量、把用户自己的 `claude` 交给适配器 —— 最后这条漏了
    /// 的话，在没装 Git Bash 的 Windows 上 `session/new` 会失败
    #[test]
    #[ignore]
    fn real_agent_handshake() {
        use std::io::{BufRead, BufReader, Write};
        let dir = std::env::temp_dir().join(format!("verso-agent-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut child = prepare("npx -y @zed-industries/claude-agent-acp", &dir).spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let cwd = crate::winpath::for_external(&dir);
        for msg in [
            serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": 1, "clientCapabilities": {
                    "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } },
            }),
            serde_json::json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": { "cwd": cwd, "mcpServers": [] },
            }),
        ] {
            writeln!(stdin, "{msg}").unwrap();
        }
        let mut answered = 0;
        while answered < 2 {
            let line = lines.next().expect("进程提前退出了").unwrap();
            println!("{line}");
            let v: serde_json::Value = serde_json::from_str(&line).unwrap();
            if v.get("id").is_some() && v.get("method").is_none() {
                assert!(v.get("error").is_none(), "握手失败：{line}");
                answered += 1;
            }
        }
        kill_tree(&mut child);
        let _ = child.wait();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stopping_twice_is_harmless() {
        let m = AgentManager::default();
        m.stop("agent-404");
        m.stop("agent-404");
    }
}
