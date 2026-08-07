import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lockPageScroll } from "./shell";

// 在 React 之前装 —— 首次挂载时的 focus / scrollIntoView 就已经能把页面顶走
lockPageScroll();

/**
 * 指针是手指还是鼠标，**在 React 之前就得有答案**。
 *
 * 尺寸令牌（`--tap`）晚一帧无所谓，但「打开笔记要不要抢焦点」不行 ——
 * 编辑器在第一帧就可能挂载，那时若还不知道这是触摸设备，软键盘已经弹起来
 * 了（Editor.tsx / styles.css 里各有一段说明）。App 挂载后会按平台标志再
 * 校一次，那一次只用于「屏幕不是触摸屏但平台是手机」这种少见组合。
 */
if (window.matchMedia?.("(hover: none)").matches) {
  document.documentElement.dataset.touch = "on";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
