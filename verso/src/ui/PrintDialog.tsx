/**
 * 打印对话框：左边版式预览，右边几个旋钮。
 *
 * ## 预览为什么可信
 *
 * 预览里那张纸和真正的打印容器**吃同一份 CSS**（styles.css 里排版规则写在
 * `@media print` 外面，就是为了这个），宽度写的是 A4 的 210mm、页边距就是它的
 * padding，字号按 pt。所以哪个字在哪儿换行，纸上就是哪儿 —— 预览和结果不一致
 * 的预览比没有预览更糟。
 *
 * **不做分页预览。** 浏览器视口里没有「页」这个概念，要在应用内算出分页就得引
 * 一个分页引擎（paged.js 之类），而那意味着两套引擎各算一次，不一致的时候更难
 * 解释。分页交给系统打印面板 —— 它左边那栏本来就是准确的分页预览。
 * 所以这里叫「版式预览」而不是「打印预览」。
 *
 * ## 内容为什么在打开对话框之前就备好
 *
 * 子文档要读盘、database 视图要过 IPC 查询，都是异步的；而勾选框一改就要重排
 * 预览。所以 App 在打开这个对话框之前把**所有**可能用到的素材一次性备齐
 * （见 `PrintSource`），这里只做同步的取舍和拼装 —— 点一下勾选框不该等 IPC。
 */
import { useEffect, useMemo } from "react";

import { renderMarkdown, renderViewTable } from "../editor/exportHtml";
import type { ViewResult } from "../core/types";

import { Icon } from "./Icon";
import { layoutVars, type PrintLayout } from "./PrintView";

/** 要印的一篇。`depth` 0 是本篇，1 起是子文档 */
export interface PrintPart {
  title: string;
  body: string;
  depth: number;
}

/** App 备好的全部素材。对话框只从这里取，不再发起任何异步 */
export interface PrintSource {
  title: string;
  parts: PrintPart[];
  /** `verso-view` 的 YAML 源码 → 查询结果。查不到的那些不在表里 */
  views: Map<string, ViewResult>;
  /**
   * `![[图.png]]` → webview 能加载的地址。
   *
   * 放在素材里而不是当参数传：预览和真正打印是两次 `composePrintHtml` 调用，
   * 少传一次就会变成「预览里有图、印出来没有」。
   */
  resolveImage: (target: string) => string | null;
}

export interface PrintOptions extends PrintLayout {
  title: boolean;
  children: boolean;
  viewResults: boolean;
}

/** 三档字号。中间那档是 §6.1 推出来的默认值 */
const FONT_SIZES: { label: string; value: number }[] = [
  { label: "小", value: 10 },
  { label: "中", value: 11 },
  { label: "大", value: 12.5 },
];

/**
 * 三档页边距（左右，mm）。
 *
 * 标准那档 22mm 是照「一行不超过 40 汉字」倒推的；宽的那档留给要打孔装订的人，
 * 窄的那档给「省纸，自己看」。
 */
const MARGINS: { label: string; value: number }[] = [
  { label: "窄", value: 14 },
  { label: "标准", value: 22 },
  { label: "宽", value: 30 },
];

/**
 * 素材 + 选项 → 最终 HTML。
 *
 * 导出，因为 App 真正打印时要用**同一个函数**再算一遍 —— 预览和打印各拼各的
 * 才是这类功能最典型的漂移来源。
 */
export function composePrintHtml(source: PrintSource, opts: PrintOptions): string {
  const renderView = opts.viewResults
    ? (src: string) => {
        const result = source.views.get(src) ?? source.views.get(src.trim());
          return result
          ? renderViewTable(result)
          : `<div class="dbview-placeholder"><p>database 视图（未获取到查询结果）</p></div>`;
      }
    : undefined;

  const parts = opts.children ? source.parts : source.parts.slice(0, 1);

  return parts
    .map((part) => {
      const body = renderMarkdown(part.body, {
        headingOffset: part.depth,
        renderView,
        resolveImage: source.resolveImage,
      });
      if (part.depth === 0) return body;
      // 子文档自己的标题也要有一行 —— 否则几篇接在一起，读的人分不出
      // 哪一段属于哪一篇
      const level = Math.min(6, part.depth + 1);
      const head = `<h${level}>${escapeText(part.title)}</h${level}>`;
      return head + body;
    })
    .join("");
}

/** 只用在子文档标题上。正文那一路的转义在 `exportHtml.ts` 里 */
function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

interface Props {
  source: PrintSource;
  options: PrintOptions;
  onChange: (next: PrintOptions) => void;
  onPrint: () => void;
  onClose: () => void;
}

export function PrintDialog({ source, options, onChange, onPrint, onClose }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  // 素材是备好的，所以这一步是纯同步计算 —— 勾一下不用等
  const html = useMemo(() => composePrintHtml(source, options), [source, options]);

  const set = <K extends keyof PrintOptions>(key: K, value: PrintOptions[K]) =>
    onChange({ ...options, [key]: value });

  const hasChildren = source.parts.length > 1;
  const hasViews = source.views.size > 0;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="print-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-dialog-title"
      >
        <header className="vault-manager-head">
          <div>
            <h2 id="print-dialog-title">打印或导出 PDF</h2>
            <p>{source.title}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="print-dialog-body">
          {/* 预览。`aria-hidden`：读屏软件读正文本身没有意义，右边的选项才是
              这个对话框的可操作内容 */}
          <div className="print-preview" aria-hidden="true">
            <div className="print-page" style={layoutVars(options) as React.CSSProperties}>
              <div className="print-doc">
                {options.title && <h1 className="print-doc-title">{source.title}</h1>}
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </div>
          </div>

          <div className="print-options">
            <div className="print-option">
              <label id="print-font-label">正文字号</label>
              <div className="print-seg" role="group" aria-labelledby="print-font-label">
                {FONT_SIZES.map((f) => (
                  <button
                    key={f.value}
                    aria-pressed={options.fontSize === f.value}
                    onClick={() => set("fontSize", f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="print-option">
              <label id="print-margin-label">页边距</label>
              <div className="print-seg" role="group" aria-labelledby="print-margin-label">
                {MARGINS.map((m) => (
                  <button
                    key={m.value}
                    aria-pressed={options.margin === m.value}
                    onClick={() => set("margin", m.value)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="print-option">
              <label>打印内容</label>

              <label className="print-check">
                <input
                  type="checkbox"
                  checked={options.title}
                  onChange={(e) => set("title", e.target.checked)}
                />
                <span>
                  在第一页显示笔记标题
                  <span className="print-check-hint">正文开头已有标题时，可关闭此选项</span>
                </span>
              </label>

              <label className="print-check">
                <input
                  type="checkbox"
                  checked={options.children}
                  disabled={!hasChildren}
                  onChange={(e) => set("children", e.target.checked)}
                />
                <span>
                  同时打印子文档
                  <span className="print-check-hint">
                    {hasChildren
                      ? `包含 ${source.parts.length - 1} 篇子文档，标题层级整体下移一级`
                      : "当前笔记没有子文档"}
                  </span>
                </span>
              </label>

              <label className="print-check">
                <input
                  type="checkbox"
                  checked={options.viewResults}
                  disabled={!hasViews}
                  onChange={(e) => set("viewResults", e.target.checked)}
                />
                <span>
                  打印 database 视图结果
                  <span className="print-check-hint">
                    {hasViews
                      ? "打印当前查询结果（内容为当前时刻的快照）"
                      : "当前笔记没有 database 视图"}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <footer className="print-dialog-foot">
          <span className="print-dialog-count">
            {options.children && hasChildren ? `共 ${source.parts.length} 篇文档` : ""}
          </span>
          <button className="btn-quiet" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={onPrint}>
            打印…
          </button>
        </footer>
      </section>
    </div>
  );
}
