//! 安卓的 https 传输层。DESIGN.md §2.8。
//!
//! ## 为什么存在
//!
//! 安卓那份 libgit2 没编 https 后端：它的 https 靠 OpenSSL，而在 Windows
//! 主机上给安卓交叉编 vendored OpenSSL 是条死路（要一个「产生 Unix 风格
//! 路径且 core 模块齐全」的 perl，Cargo.toml 那段写了全过程）。正解就是
//! 这里：给 libgit2 注册一个自定义 smart 传输层，HTTP 走 ureq、TLS 走
//! rustls —— 纯 Rust，NDK 直接编，连 OpenSSL 的影子都没有，包还更小。
//!
//! ## 它做的事
//!
//! git 的 smart HTTP 协议只有两种请求（stateless-rpc）：
//!
//!   - 列引用：`GET  {url}/info/refs?service=git-upload-pack`（fetch）
//!     或 `?service=git-receive-pack`（push）
//!   - 传数据：`POST {url}/git-upload-pack`（fetch 协商与取包）
//!     或 `POST {url}/git-receive-pack`（推包）
//!
//! libgit2 负责整个协议内容，这里只当「信使」：把它写进流里的字节原样
//! POST 出去，把响应体原样读回来。每一轮协商都会重新走一次 `action()`，
//! 所以一个流只承载一次请求-响应。
//!
//! ## 认证自己带
//!
//! libgit2 的凭据回调（`RemoteCallbacks::credentials`）**不会为自定义
//! 传输层工作** —— 那条链在内置 http 后端里。令牌由 `sync()` 在动手前
//! 塞进来，这里直接放进 `Authorization` 头（GitHub / GitLab 都接受
//! 「任意用户名 + 令牌当密码」的 Basic）。
//!
//! ## 请求体整个缓存在内存里
//!
//! 推送的包是「本地新增的那几个提交」压出来的，笔记库里就是几 KB 到几 MB，
//! 为它做流式上传不值得。真在手机上推出百兆的包，先该问的是为什么。

use std::io::{self, Read, Write};
use std::sync::{Mutex, Once};
use std::time::Duration;

use base64::Engine;
use git2::transport::{Service, SmartSubtransport, SmartSubtransportStream, Transport};

/// 这次同步用的令牌。走全局是因为 `register` 的工厂函数没有别的通道
/// 能把它递进来 —— 同步是串行的（一个按钮），不存在两份令牌抢一个槽
static TOKEN: Mutex<Option<String>> = Mutex::new(None);

pub fn set_token(token: Option<String>) {
    if let Ok(mut t) = TOKEN.lock() {
        *t = token;
    }
}

/// 注册 https/http 两个 scheme。进程生命周期内一次；重复调用是空操作。
pub fn ensure_registered() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        for scheme in ["https", "http"] {
            // 安卓的 libgit2 没编任何 http 后端，这两个 scheme 是空位。
            // unsafe 的含义是「不要和别的 register 并发」—— Once 挡住了
            let _ = unsafe {
                git2::transport::register(scheme, |remote| {
                    Transport::smart(remote, true, HttpSubtransport::new())
                })
            };
        }
    });
}

struct HttpSubtransport {
    agent: ureq::Agent,
}

impl HttpSubtransport {
    fn new() -> Self {
        Self {
            agent: ureq::AgentBuilder::new()
                .timeout_connect(Duration::from_secs(15))
                // 不设总超时：取包/推包的耗时由数据量决定，设死了大仓库必超。
                // 有的服务器按 UA 分流 git 客户端，报成 git 的样子最稳妥
                .user_agent("git/2.0 (Verso)")
                .build(),
        }
    }
}

impl SmartSubtransport for HttpSubtransport {
    fn action(
        &self,
        url: &str,
        action: Service,
    ) -> Result<Box<dyn SmartSubtransportStream>, git2::Error> {
        Ok(Box::new(HttpStream {
            agent: self.agent.clone(),
            url: url.trim_end_matches('/').to_string(),
            action,
            body: Vec::new(),
            response: None,
        }))
    }

    fn close(&self) -> Result<(), git2::Error> {
        Ok(())
    }
}

struct HttpStream {
    agent: ureq::Agent,
    url: String,
    action: Service,
    /// libgit2 写进来的请求体，第一次 read 时整个 POST 出去
    body: Vec<u8>,
    response: Option<Box<dyn Read + Send + Sync>>,
}

fn service_name(action: Service) -> &'static str {
    match action {
        Service::UploadPackLs | Service::UploadPack => "git-upload-pack",
        Service::ReceivePackLs | Service::ReceivePack => "git-receive-pack",
    }
}

/// HTTP 状态码翻译成人话。libgit2 的 "request failed with status code: 403;
/// class=Http (34)" 只会让人以为地址填错了 —— 桌面那边也该这么做（M5b 待办）
fn friendly(code: u16) -> String {
    match code {
        401 | 403 => format!(
            "远端不接受这个令牌（HTTP {code}）。检查令牌是否过期、\
             Contents 权限是不是 Read and write、仓库有没有勾选"
        ),
        404 => "仓库不存在，或令牌无权看到它（HTTP 404）。检查仓库地址".into(),
        _ => format!("远端返回 HTTP {code}"),
    }
}

impl HttpStream {
    fn send(&mut self) -> io::Result<()> {
        let service = service_name(self.action);
        let ls = matches!(self.action, Service::UploadPackLs | Service::ReceivePackLs);

        let auth = TOKEN.lock().ok().and_then(|t| t.clone()).map(|t| {
            let cred = base64::engine::general_purpose::STANDARD.encode(format!("verso:{t}"));
            format!("Basic {cred}")
        });

        let result = if ls {
            let mut req = self
                .agent
                .get(&format!("{}/info/refs?service={service}", self.url));
            if let Some(a) = &auth {
                req = req.set("Authorization", a);
            }
            req.call()
        } else {
            let mut req = self
                .agent
                .post(&format!("{}/{service}", self.url))
                .set("Content-Type", &format!("application/x-{service}-request"))
                .set("Accept", &format!("application/x-{service}-result"));
            if let Some(a) = &auth {
                req = req.set("Authorization", a);
            }
            req.send_bytes(&self.body)
        };

        match result {
            Ok(resp) => {
                self.response = Some(Box::new(resp.into_reader()));
                Ok(())
            }
            Err(ureq::Error::Status(code, _)) => Err(io::Error::other(friendly(code))),
            Err(e) => Err(io::Error::other(format!("连不上远端：{e}"))),
        }
    }
}

impl Read for HttpStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        // libgit2 先把请求写完、再开始读响应 —— 第一次读就是发请求的时机
        if self.response.is_none() {
            self.send()?;
        }
        self.response.as_mut().unwrap().read(buf)
    }
}

impl Write for HttpStream {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.body.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
