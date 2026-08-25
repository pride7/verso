/**
 * 剪贴板。**要读写剪贴板一律走这里。**
 *
 * 为什么值得单独一个文件：这两件事在 webview 里都可能失败，而失败的样子是
 * 「点了没反应也没提示」—— 最难自查的一类。写和读各有一条兜底/说法，摊在
 * 一处比在每个调用点各写一遍靠谱。
 */

/**
 * 写。成功返回 true。
 *
 * `navigator.clipboard` 要安全上下文 + 用户手势，任一不满足就抛。
 * `execCommand` 早已废弃，但它是那种情况下唯一还能兜底的路。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 读。读不到返回 null（调用方该说一句「用 Ctrl+V」，不要静默）。
 *
 * **读没有兜底**：`execCommand("paste")` 在 Chromium 系里被明令禁掉了
 * （网页能读剪贴板等于能偷走用户刚复制的密码），所以 `navigator.clipboard`
 * 这条路不通就是不通。真正的粘贴快捷键走的是浏览器自己的通道，不受影响 ——
 * 也就是说菜单里的「粘贴」失败时，Ctrl/⌘+V 仍然是好的。
 */
export async function readText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/**
 * 写一张图。成功返回 true。
 *
 * **只能写 PNG。** 系统剪贴板里的位图格式就是这一种，`ClipboardItem` 的规范
 * 也只要求实现支持 `image/png` —— 传 JPEG 进去多数引擎直接抛。所以「复制」
 * 一律走 PNG，格式的选择只在「保存为文件」那条路上有意义。
 *
 * **参数收的是 Promise，而且调用点必须别 await 它。** 剪贴板写入要「用户手势
 * 还热着」，Chromium 给的窗口是几秒；而渲染一张长图（等字体、内联整份样式表）
 * 很容易花掉这几秒。先 await 出 Blob 再来写，按下按钮到写入之间已经隔了几个
 * 事件循环，手势早就凉了 —— 表现是偶尔成功、笔记一长就失败。把还没决议的
 * Promise 直接交给 `ClipboardItem` 就没有这个缝：`write` 是在点击那一拍上
 * 同步发出去的，图什么时候画完由浏览器自己等。WebKit 更是只认这一种写法。
 *
 * 没有 `execCommand` 那样的兜底：图片从来就不在那条老路上。失败时调用方要说
 * 一句「改用保存」，不能静默 —— 剪贴板失败的样子正是「点了没反应」。
 */
export async function copyImage(png: Promise<Blob>): Promise<boolean> {
  try {
    // `ClipboardItem` 在旧引擎里可能压根不存在，先探再用
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}
