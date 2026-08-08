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
