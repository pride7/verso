import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { api, onPtyData, onPtyExit } from "../api";
import "@xterm/xterm/css/xterm.css";

interface Props {
  /** 面板高度（像素），由 App 管理以便持久化 */
  height: number;
  onHeightChange: (h: number) => void;
  onClose: () => void;
  /** 设置里的终端字号 */
  fontSize: number;
  /** 主题标识。值本身不用，变了就重新取色 —— 见下面的 effect */
  theme: string;
}

/**
 * 从 CSS 变量取色/取字体，让终端跟随主题和设置。
 *
 * 注意必须**取计算值**再交给 xterm，不能把 `var(--term-font)` 直接塞进去：
 * xterm 要拿字体串去 canvas 里量字符宽度，那个上下文解析不了 CSS 变量，
 * 结果是列宽算错、整屏错位。
 */
function styleFromCss() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  const mono = '"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace';
  return {
    fontFamily: v("--term-font", mono),
    theme: {
      background: v("--surface", "#f7f6f3"),
      foreground: v("--text", "#22252b"),
      cursor: v("--accent", "#3b6fd4"),
      selectionBackground: "rgba(120,150,220,0.32)",
    },
  };
}

/**
 * 内嵌终端面板 —— DESIGN.md §7.3 方案 B。
 *
 * §7.1：vault 是纯 .md，任何 AI CLI 都能直接在上面工作。这个面板就是那条路
 * 的入口 —— 不用切窗口，一边让 AI 改笔记，一边在编辑器里看结果。
 */
export function TerminalPanel({ height, onHeightChange, onClose, fontSize, theme }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dead, setDead] = useState(false);

  // 初值放 ref：终端只建一次，字号变化走下面那个 effect。
  // 直接读 props 的话得把它们写进依赖数组，改一次字号就重建终端、
  // 跑着的进程全没了
  const initial = useRef({ fontSize });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      ...styleFromCss(),
      fontSize: initial.current.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      // AI CLI 一次输出几百行是常态，默认的 1000 行回滚不够回看
      scrollback: 10000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    termRef.current = term;
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);

    let disposed = false;
    let starting = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    /**
     * 键盘输入必须在 PTY 建立**之前**就接上。
     *
     * shell 启动时会先发一个 DSR 查询（`ESC[6n`，问光标在哪），**收到回答
     * 才会打印提示符**。xterm 会自动生成回答，但那份回答是从 `onData`
     * 出来的 —— 如果等 `ptyOpen` 返回后才注册 onData，这段窗口里的回答就
     * 丢了，结果是终端一片空白、看不到提示符。
     *
     * 所以先注册，PTY 还没就绪时把输入攒起来。
     */
    const pending: string[] = [];
    term.onData((data) => {
      const id = idRef.current;
      if (id) void api.ptyWrite(id, data).catch(() => setDead(true));
      else pending.push(data);
    });

    const start = async () => {
      if (starting || disposed) return;
      starting = true;
      try {
        const id = await api.ptyOpen(term.cols, term.rows, null);
        if (disposed) {
          void api.ptyClose(id);
          return;
        }
        idRef.current = id;
        // 补发建立期间攒下的输入（通常就是那个 DSR 回答）
        for (const d of pending.splice(0)) {
          void api.ptyWrite(id, d).catch(() => {});
        }

        unlistenData = await onPtyData((e) => {
          if (e.id !== id) return;
          // Rust 侧传的是 base64 的原始字节。必须解成 Uint8Array 交给 xterm
          // 自己解码 —— 直接按字符串传，一个中文字被读取边界切开就会变乱码。
          const bin = atob(e.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          term.write(bytes);
        });

        unlistenExit = await onPtyExit((e) => {
          if (e.id !== id) return;
          setDead(true);
          term.write("\r\n\x1b[2m[进程已结束]\x1b[0m\r\n");
        });

        term.focus();
      } catch (e) {
        setError((e as Error).message);
      }
    };

    /**
     * ResizeObserver 统一处理三件事：首次布局完成、拖拽改高、窗口缩放。
     *
     * 关键是**不能**在 `term.open()` 之后立刻 fit —— 那时面板刚插入 DOM，
     * 布局还没完成，算出来是 0 列 0 行，PTY 会以 2×2 启动，屏幕上什么都没有。
     * 必须等第一次真实布局到位再开 PTY。
     */
    const ro = new ResizeObserver(() => {
      if (disposed || host.clientHeight < 20 || host.clientWidth < 20) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols < 2 || term.rows < 2) return;
      if (!idRef.current) void start();
      else void api.ptyResize(idRef.current, term.cols, term.rows).catch(() => {});
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      unlistenData?.();
      unlistenExit?.();
      // 关闭面板时**杀掉**进程。设计文档原本写「关闭面板不杀进程」，但那样会
      // 留下用户看不见也管不到的孤儿 shell —— 想让 AI 长跑就别关面板。
      if (idRef.current) void api.ptyClose(idRef.current);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  /**
   * 字号、字体、主题变了就地更新，不重建终端 —— 重建等于把跑着的进程杀掉。
   *
   * 改完必须 `fit()` 再把新尺寸告诉 PTY：字号一变，同样的像素宽度装下的
   * 列数就变了，不同步的话 shell 会按旧列数折行，输出看着像错位。
   */
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const style = styleFromCss();
    term.options.fontSize = fontSize;
    term.options.fontFamily = style.fontFamily;
    term.options.theme = style.theme;
    try {
      fitRef.current?.fit();
    } catch {
      return;
    }
    if (idRef.current && term.cols >= 2 && term.rows >= 2) {
      void api.ptyResize(idRef.current, term.cols, term.rows).catch(() => {});
    }
  }, [fontSize, theme]);

  // 拖拽调整高度
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(Math.max(startH + (startY - ev.clientY), 120), window.innerHeight - 200);
      onHeightChange(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="term" style={{ height }}>
      <div className="term-resizer" onMouseDown={startDrag} />
      <header className="term-head">
        <span className="term-title">终端{dead && " · 已结束"}</span>
        <button className="term-close" onClick={onClose} title="关闭终端 (Ctrl+`)">
          ✕
        </button>
      </header>
      {error ? <div className="term-error">{error}</div> : <div className="term-host" ref={hostRef} />}
    </div>
  );
}
