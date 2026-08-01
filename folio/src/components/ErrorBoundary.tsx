import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
  stack: string | null;
}

/**
 * React 19 遇到未捕获错误会卸载整棵树，结果是一片白屏、没有任何线索。
 * 桌面应用里这是最糟的失败模式 —— 用户看不到错误，也没有浏览器地址栏
 * 可以刷新。至少要把错误显示出来。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Verso 崩溃:", error, info);
    this.setState({ stack: info.componentStack ?? null });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <h1>出错了</h1>
        <p className="crash-msg">{error.message}</p>
        <pre className="crash-stack">{error.stack}</pre>
        {stack && <pre className="crash-stack">{stack}</pre>}
        <button className="btn-primary" onClick={() => this.setState({ error: null, stack: null })}>
          重试
        </button>
      </div>
    );
  }
}
