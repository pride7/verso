/**
 * 用系统浏览器打开一个外部页面。
 *
 * 走 `plugin-opener`；在 browser test / 纯网页预览里那个 import 会失败，所以
 * 退回 `window.open`。**失败不能静默** —— 链接打不开的样子和「授权失败」
 * 「保存失败」一模一样，调用方该说一句，而不是让人对着没反应的按钮猜。
 */
export function openExternalPage(url: string): void {
  void import("@tauri-apps/plugin-opener")
    .then(({ openUrl }) => openUrl(url))
    .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}
