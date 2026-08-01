//! 文件监听。DESIGN.md §2.7
//!
//! 有了内嵌终端跑 AI 之后（§7.4），「文件被外部程序修改」从偶发边界情况
//! 变成了**日常主路径** —— AI 每跑一次就是一批外部修改。没有这一层，
//! 树和索引会悄悄和磁盘脱节。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;

use crate::error::Result;

/// 静默多久算一批。同步盘（OneDrive/iCloud）会产生事件风暴，
/// 太小会让索引反复重建。
const DEBOUNCE_MS: u64 = 300;
/// 事件持续不断时的强制刷新上限 —— 否则一次 `git checkout` 期间
/// 界面会一直不更新。
const MAX_WAIT_MS: u64 = 2000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultChanged {
    /// 变化的笔记相对路径
    pub paths: Vec<String>,
}

/// 自己写入的文件路径。写之前登记，监听到时丢弃 —— 否则每次保存都会
/// 触发一轮「外部修改」，索引白重建一次，界面还会闪一下提示。
#[derive(Default)]
pub struct SelfWrites(Mutex<HashSet<PathBuf>>);

impl SelfWrites {
    pub fn mark(&self, path: &Path) {
        if let Ok(mut s) = self.0.lock() {
            s.insert(path.to_path_buf());
        }
    }

    /// 是不是我们自己刚写的。是的话顺手移除登记。
    fn take(&self, path: &Path) -> bool {
        self.0.lock().map(|mut s| s.remove(path)).unwrap_or(false)
    }
}

pub struct VaultWatcher {
    _inner: RecommendedWatcher,
    stop: Arc<AtomicBool>,
}

impl Drop for VaultWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// 只关心 vault 里的 `.md`。`.verso/`（索引自己）和 `.git/` 必须排除 ——
/// 否则索引写自己的 db 会触发监听，触发重建，再写 db，无限循环。
fn interesting(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.starts_with(".verso/") || s.starts_with(".git/") || s.contains("/.git/") {
        return None;
    }
    if !s.ends_with(".md") {
        return None;
    }
    Some(s)
}

/// 启动监听。`on_batch` 在攒够一批之后被调用，参数是相对路径集合。
pub fn watch<F>(root: &Path, self_writes: Arc<SelfWrites>, on_batch: F) -> Result<VaultWatcher>
where
    F: Fn(Vec<String>) + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .map_err(|e| crate::error::Error::Vault(format!("启动文件监听失败: {e}")))?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| crate::error::Error::Vault(format!("监听目录失败: {e}")))?;

    let stop = Arc::new(AtomicBool::new(false));
    let root = root.to_path_buf();

    {
        let stop = stop.clone();
        std::thread::spawn(move || {
            let mut batch: HashSet<String> = HashSet::new();
            let mut first_seen: Option<Instant> = None;

            loop {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                    Ok(Ok(event)) => {
                        for p in &event.paths {
                            // 自己写的就丢弃 —— 避免「写入 → 监听 → 重建 → 写入」的回环
                            if self_writes.take(p) {
                                continue;
                            }
                            if let Some(rel) = interesting(&root, p) {
                                batch.insert(rel);
                            }
                        }
                        if !batch.is_empty() && first_seen.is_none() {
                            first_seen = Some(Instant::now());
                        }
                        // 事件流一直不断时也要定期吐一批出去，
                        // 否则 git checkout 期间界面会一直不更新
                        if first_seen.is_some_and(|t| t.elapsed().as_millis() as u64 >= MAX_WAIT_MS)
                        {
                            on_batch(batch.drain().collect());
                            first_seen = None;
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // 静默了 DEBOUNCE_MS，这一批算结束
                        if !batch.is_empty() {
                            on_batch(batch.drain().collect());
                            first_seen = None;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        });
    }

    Ok(VaultWatcher {
        _inner: watcher,
        stop,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_private_dirs_and_non_markdown() {
        let root = Path::new("/vault");
        let rel = |p: &str| interesting(root, &root.join(p));

        assert_eq!(rel("数学/线性代数.md").as_deref(), Some("数学/线性代数.md"));
        // 索引自己的 db 若被监听，会造成「写 db → 触发 → 重建 → 写 db」的死循环
        assert_eq!(rel(".verso/index.db"), None);
        assert_eq!(rel(".git/HEAD"), None);
        assert_eq!(rel("attachments/fig.png"), None);
        assert_eq!(rel("README.txt"), None);
    }

    #[test]
    fn self_writes_are_consumed_once() {
        let s = SelfWrites::default();
        let p = Path::new("/vault/a.md");
        s.mark(p);
        assert!(s.take(p), "登记过的应当被识别为自己写的");
        assert!(!s.take(p), "只能生效一次，否则真正的外部修改会被吞掉");
    }
}
