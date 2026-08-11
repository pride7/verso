/**
 * 打印视图 —— 把一篇（或一支）笔记渲染成一份能按出 PDF 的文档。
 *
 * ## 为什么不是「生成一个独立的 HTML 文件」
 *
 * KaTeX 的样式表和它那套字体已经由 App 加载了（`import "katex/dist/katex.min.css"`），
 * §6 的排版变量也都在这份文档里。生成独立文件的话，这些全部要内联进去 ——
 * 字体还得 base64 —— 而公式的排版差一点点就整个错位。挂进应用自己的 DOM，
 * 这些一个都不用管。
 *
 * 顺带回答「那导出 HTML 呢」：交出去的通用格式是 PDF，不是 `.html`。
 * 一个 `.html` 附件在微信里可能直接被拦，在手机上点开是浏览器新标签，
 * 没人会归档它。
 *
 * ## 为什么用 portal 挂到 `body` 而不是放进 `#root`
 *
 * 打印时要把界面其余部分整个藏掉。挂在 body 下面，这条规则就是
 * `body > *:not(.print-doc) { display: none }` —— 不依赖 App 内部的结构，
 * 以后布局怎么改都不会把它带塌。
 *
 * ## 为什么要等图片
 *
 * `window.print()`（以及 macOS 的 NSPrintOperation）抓的是**当下**的渲染结果。
 * 图片还在加载就按下去，纸上那一块就是空的 —— 而且这种失败在屏幕上完全看不
 * 出来，等发现时 PDF 已经发出去了。所以等，但不无限等：超时了宁可缺图也要把
 * 对话框弹出来，否则用户按了「打印」之后什么都不会发生。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** 图片最多等这么久。超了就照常打印 —— 卡住不弹对话框比缺一张图更糟 */
const IMAGE_TIMEOUT_MS = 3000;

/** 打印对话框里能调的两个量 */
export interface PrintLayout {
  /** 正文字号，pt */
  fontSize: number;
  /** 左右页边距，mm */
  margin: number;
}

/**
 * 由左右页边距推出四边。
 *
 * 上边比左右**小一点**、下边等于左右：版心略微偏上，视觉重心才稳 ——
 * 四边等宽的版面看起来是往下坠的，这是排版里的老规矩（光学中心高于几何中心）。
 *
 * 预览的 padding 和打印的 `@page margin` 都从这里取，只有一个数就不会漂。
 */
export function pageMargins(margin: number) {
  return { top: Math.max(6, margin - 2), side: margin, bottom: margin };
}

/** 版式 → CSS 变量。预览那张纸和真正的打印容器吃的是同一组 */
export function layoutVars(layout: PrintLayout): Record<string, string> {
  const m = pageMargins(layout.margin);
  return {
    "--print-font": `${layout.fontSize}pt`,
    "--print-margin-top": `${m.top}mm`,
    "--print-margin-side": `${m.side}mm`,
    "--print-margin-bottom": `${m.bottom}mm`,
  };
}

export interface PrintViewProps {
  /** 打印出来的第一行标题。null = 不印（正文里已经写了大标题的人不需要） */
  title: string | null;
  /**
   * 正文。**必须是 `editor/exportHtml.ts` 的产物** —— 那里保证了每一段文本
   * 都转义过（§7.5），这里才敢用 `dangerouslySetInnerHTML`。别的地方拼出来的
   * HTML 不要往这里传。
   */
  html: string;
  layout: PrintLayout;
  /** 存 PDF 时的默认文件名。通常就是笔记名，和 `title` 分开是因为标题可以不印 */
  fileName: string;
  /** 内容真的可以打印了（图片加载完或已超时） */
  onReady: () => void;
}

export function PrintView({ title, html, layout, fileName, onReady }: PrintViewProps) {
  const ref = useRef<HTMLDivElement>(null);

  // onReady 走 ref：App 那边每次渲染都是新函数，直接进依赖数组会让这个
  // effect 反复重跑，于是打印对话框弹两次
  const ready = useRef(onReady);
  ready.current = onReady;

  /**
   * 打印任务名 = 存 PDF 时的默认文件名。
   *
   * 系统从页面标题取，而这个应用从来没设过 `document.title` —— 它一直是
   * `index.html` 里那个「Verso」，于是每一篇笔记都存成 `Verso.pdf`，
   * 存三篇就得手动改三次名。
   *
   * **必须在打印操作创建之前设好**，也就是要早于 `onReady`：任务名是
   * NSPrintOperation 建的那一刻从标题抓的，之后再改没用。effect 按声明顺序
   * 跑，所以这一个放在等图片那个前面。
   *
   * 卸载时还原。Tauri 的原生窗口标题不跟着 `document.title` 走，所以这期间
   * 界面上看不出任何变化。
   */
  useEffect(() => {
    if (!fileName) return;
    const prev = document.title;
    document.title = fileName;
    return () => {
      document.title = prev;
    };
  }, [fileName]);

  useEffect(() => {
    const el = ref.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ready.current();
    };

    const pending = el
      ? [...el.querySelectorAll("img")].filter((img) => !img.complete)
      : [];

    if (!pending.length) {
      // 内容刚插进 DOM，布局还没算完。等两帧 —— 一帧只保证样式算过，
      // 不保证已经画过
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(finish);
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    let left = pending.length;
    const tick = () => {
      if (--left <= 0) finish();
    };
    // error 也算一张 —— 加载失败的图不该把整次打印卡到超时
    for (const img of pending) {
      img.addEventListener("load", tick);
      img.addEventListener("error", tick);
    }
    const timer = setTimeout(finish, IMAGE_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      for (const img of pending) {
        img.removeEventListener("load", tick);
        img.removeEventListener("error", tick);
      }
    };
  }, [html]);

  const m = pageMargins(layout.margin);

  return createPortal(
    <>
      {/**
       * 页边距只能这样给。
       *
       * `@page` 里不能可靠地用 CSS 自定义属性 —— 各引擎支持不一，而我们的
       * 目标之一正是 WKWebView。所以现场注入一段带字面值的规则，盖掉
       * styles.css 里那份默认的。字号不受这个限制（它挂在元素上），走变量。
       */}
      <style>{`@media print{@page{margin:${m.top}mm ${m.side}mm ${m.bottom}mm}}`}</style>
      <div className="print-doc" ref={ref} style={layoutVars(layout) as React.CSSProperties}>
        {title && <h1 className="print-doc-title">{title}</h1>}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </>,
    document.body,
  );
}
