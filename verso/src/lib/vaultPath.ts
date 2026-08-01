/**
 * vault 里的文件路径 → 能交给 `convertFileSrc` 的那一种写法。
 *
 * ## 为什么需要这一步
 *
 * Rust 侧的 `Vault::open` 会 `canonicalize` 根目录，而 **Windows 上
 * `canonicalize` 返回的是扩展长度路径**：`\\?\D:\Notes\vault`。直接把它
 * 和相对路径拼起来交给 asset 协议，得到的是一个既有 `\\?\` 前缀又混着两种
 * 分隔符的东西，协议那边解析不出来 —— 表现就是「图片找不到」，而文件明明
 * 就在那儿。
 *
 * 这一段拿出来单独放，是因为它**只能靠单测保证**：它踩在 webview 与宿主的
 * 边界上，浏览器测试里没有 Tauri，跑不到真正的 asset 协议（AGENTS.md
 * 「功能依赖浏览器和宿主之间的边界时……」那一节）。
 */

/** `\\?\D:\Notes` → `D:/Notes`；`\\?\UNC\srv\share` → `//srv/share` */
export function normalizeRoot(root: string): string {
  return root
    .replace(/^\\\\\?\\UNC\\/, "//")
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/**
 * `![[目标]]` 的目标 → vault 里的绝对路径（正斜杠）。null = 不该去取。
 *
 * 目标不带斜杠时按 §2.3 的约定去 `attachments/` 找：粘贴插入的是完整相对
 * 路径，手写的通常只有个文件名，两种都要认。
 *
 * `..` 直接拒绝。asset 协议的作用域已经只放行了 vault 根，这里再挡一道 ——
 * 笔记可以来自分享（§2.9），`![[../../秘密.png]]` 连试都不该试。
 */
export function attachmentPath(root: string, target: string): string | null {
  const t = target.trim();
  if (!root || !t) return null;
  const rel = t.replace(/\\/g, "/");
  if (rel.split("/").includes("..") || /^[a-zA-Z]:/.test(rel) || rel.startsWith("/")) return null;
  return `${normalizeRoot(root)}/${rel.includes("/") ? rel : `attachments/${rel}`}`;
}
