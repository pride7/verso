/**
 * 图片。DESIGN.md §4.2 / §4.3 的 `pasteHandler`
 *
 * `![[图.png]]` 在光标离开时渲染成真图，光标进去就退回源码 —— 和公式、表格、
 * callout 同一套规矩。
 *
 * ## 尺寸写在哪
 *
 * `![[图.png|300]]`，也就是 Obsidian 的写法。**不自创语法**（AGENTS.md 第 3 条）
 * ：宽度是内容的一部分，它得跟着 `.md` 走，而且拖进 Obsidian 也要能看。
 * 解析上不用额外做什么 —— `|` 后面那段在语法树里本来就是 `WikiLinkAlias`。
 *
 * ## 为什么要一个 resolver 而不是自己拼路径
 *
 * webview 里显示本地文件要过 Tauri 的 asset 协议（`convertFileSrc`），而
 * 编辑器这一层不该知道 Tauri 的存在 —— 浏览器测试里没有那套东西。所以由
 * 应用层注入一个「目标名 → 可显示的 URL」的函数，和 `setViewRenderer` 一个路子。
 */
import { EditorView, WidgetType } from "@codemirror/view";

/** 目标名 → 能直接塞进 `<img src>` 的 URL。返回 null = 不是能显示的图片 */
export type ImageResolver = (target: string) => string | null;

let resolver: ImageResolver | null = null;

export function setImageResolver(fn: ImageResolver | null) {
  resolver = fn;
}

export function imageSrc(target: string): string | null {
  return resolver ? resolver(target.trim()) : null;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** `![[x.png]]` 里的目标是不是图片。不是的话仍然按普通嵌入链接处理 */
export function looksLikeImage(target: string): boolean {
  return IMAGE_EXT.test(target.trim());
}

/**
 * `![[图.png|300]]` 的别名段解析成宽度。
 *
 * 认 `300` 和 `300x200`（Obsidian 两种都支持），只取宽度 —— 高度让浏览器
 * 按比例算，手写的高宽比几乎总是错的。别的写法（`![[图.png|说明文字]]`）
 * 当成没写尺寸。
 */
export function parseWidth(alias: string | null): number | null {
  if (!alias) return null;
  const m = /^\s*(\d{1,5})\s*(?:x\s*\d{1,5}\s*)?$/.exec(alias);
  if (!m) return null;
  const w = Number(m[1]);
  return w > 0 ? w : null;
}

/** 拖出来的宽度夹在这个范围里 —— 0 宽的图片没法再拖回来 */
const MIN_W = 40;

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly target: string,
    readonly width: number | null,
    /** 源码里 `![[...]]` 的范围。点击回源码、拖拽改尺寸都要写回这里 */
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return (
      other.src === this.src &&
      other.width === this.width &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = "cm-img";

    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.target;
    // 关掉原生拖拽：那会和下面的改尺寸抢鼠标
    img.draggable = false;
    if (this.width) img.style.width = `${this.width}px`;
    img.addEventListener("error", () => {
      // 找不到就退化成一行可读的提示，而不是一个碎图标 ——
      // 用户得知道是**哪个**文件没找到
      box.classList.add("is-missing");
      box.dataset.name = this.target;
    });
    box.appendChild(img);

    // 右边缘的把手。宽度写回源码，所以拖完是**存进文件**的，不是界面状态
    const handle = document.createElement("span");
    handle.className = "cm-img-handle";
    handle.title = "拖动改变宽度";
    // pointer 事件而不是 mouse：触屏上把手是常显的（styles.css 的
    // hover:none 块），但 mousedown 在手指下永远不来 —— 看得见拖不动。
    // 表格列宽（table.ts）用的就是 pointerdown，这里保持同一套
    handle.addEventListener("pointerdown", (e) => this.startResize(e, view, img));
    box.appendChild(handle);

    // 点图片把光标送回源码 —— 和公式 widget 一致，这是唯一能改到 `![[]]` 的路
    img.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });

    return box;
  }

  private startResize(e: PointerEvent, view: EditorView, img: HTMLImageElement) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    let next = Math.round(startW);

    const move = (ev: PointerEvent) => {
      next = Math.max(MIN_W, Math.round(startW + (ev.clientX - startX)));
      img.style.width = `${next}px`;
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      // 宽度和原来一样就别写文件 —— 只是点了一下把手不该产生一次修改
      if (next === this.width) return;
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: `![[${this.target}|${next}]]` },
        userEvent: "input.image.resize",
      });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    // 触屏上系统手势（滚动、返回）可能中途抢走指针 —— cancel 也要收尾
    document.addEventListener("pointercancel", up);
  }

  /** 事件由 widget 自己处理，别让 CM6 再去动光标 */
  ignoreEvent() {
    return true;
  }
}
