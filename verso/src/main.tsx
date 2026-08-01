import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lockPageScroll } from "./shell";

// 在 React 之前装 —— 首次挂载时的 focus / scrollIntoView 就已经能把页面顶走
lockPageScroll();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
