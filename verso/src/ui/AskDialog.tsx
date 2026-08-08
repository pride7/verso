/**
 * 问一行字。**全项目要一句输入时只走这里，不要用 `window.prompt`。**
 *
 * 为什么不能用 `window.prompt`：它在 WebView2（Windows 上 Tauri 用的内核）里
 * 压根没实现，在安卓 WebView 里也可能被直接吞掉 —— 返回 `null`，等于用户按了
 * 取消。表现是**按钮点下去什么都不发生**，而不是报错。
 *
 * 和 `window.confirm` 那件事一样，浏览器测试查不出来：Playwright 起的
 * Chromium 有原生的 prompt，测试里怎么写都对。所以由
 * `tests/unit/app/noGlobalDialog.test.ts` 扫源码兜底。
 *
 * `host/dialog.ts` 里没有对应的东西：Tauri 的 dialog 插件只有消息 / 确认 /
 * 选文件，没有文本输入，所以只能自绘。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface AskOptions {
  /** 问句，例如「这一版做了什么？」 */
  question: string;
  /** 输入框初值。打开时全选，直接打字就是覆盖 */
  initial?: string;
  placeholder?: string;
  /** 确定键上的字。默认「确定」；动作有后果时写清楚，比如「改名」 */
  okLabel?: string;
  /** 问句下面那行小字：这次输入会造成什么 */
  hint?: string;
}

interface Pending extends AskOptions {
  resolve: (value: string | null) => void;
}

/**
 * 用法：
 *
 * ```tsx
 * const { ask, askUI } = useAsk();
 * const name = await ask({ question: "叫什么？", initial: old });
 * if (!name) return;                 // 取消 / 空串
 * return <>{...}{askUI}</>;          // 别忘了把 askUI 挂进去
 * ```
 *
 * 做成 hook 而不是全局 context：database 视图是挂在 CodeMirror 的 widget 里的
 * 另一棵 React 树，够不到 App 的 provider。浮层本身是 `position: fixed`，
 * 挂在哪棵树里都盖得住整屏。
 */
export function useAsk(): { ask: (opts: AskOptions) => Promise<string | null>; askUI: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  // resolve 是副作用，不能在 setState 的 updater 里调（StrictMode 会跑两遍）
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((value: string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  const ask = useCallback(
    (opts: AskOptions) =>
      new Promise<string | null>((resolve) => {
        // 上一个还没答就又问一次：前一个按取消收掉，否则那个 promise 永远挂着
        pendingRef.current?.resolve(null);
        const next = { ...opts, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  return {
    ask,
    askUI: pending ? <AskDialog opts={pending} onDone={settle} /> : null,
  };
}

function AskDialog({ opts, onDone }: { opts: AskOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // 捕获阶段收 Escape：输入框上有 stopPropagation（挡全局快捷键），
  // 冒泡阶段的监听收不到
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onDone(null);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onDone]);

  const text = value.trim();

  return (
    <div
      className="overlay overlay-top"
      onMouseDown={(event) => event.target === event.currentTarget && onDone(null)}
    >
      <form
        className="ask"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-question"
        onSubmit={(event) => {
          event.preventDefault();
          if (text) onDone(text);
        }}
      >
        <label className="ask-question" id="ask-question" htmlFor="ask-input">
          {opts.question}
        </label>
        {opts.hint && <p className="ask-hint">{opts.hint}</p>}
        <input
          id="ask-input"
          ref={inputRef}
          className="ask-input"
          value={value}
          placeholder={opts.placeholder}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          // 别让打字冒泡到全局快捷键上去（单键快捷键会把输入吃掉）
          onKeyDown={(event) => event.stopPropagation()}
        />
        <div className="ask-actions">
          <button type="button" className="btn-quiet" onClick={() => onDone(null)}>
            取消
          </button>
          <button type="submit" className="btn-primary" disabled={!text}>
            {opts.okLabel ?? "确定"}
          </button>
        </div>
      </form>
    </div>
  );
}
