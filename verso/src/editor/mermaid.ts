/**
 * Mermaid 图渲染。DESIGN.md §4.11
 *
 * ## 为什么动态 import
 *
 * mermaid 是整个前端里最大的一个依赖（连流程图、时序图、甘特图那几套布局
 * 引擎一起）。这里 `await import("mermaid")`，Vite 会把它切成单独的 chunk ——
 * 一篇笔记里真的出现 ` ```mermaid ` 才去拉，不画图的人一个字节都不付。
 *
 * ## 为什么主题从 DOM 上读，而不是从 App 传进来
 *
 * 深色有两个入口（styles.css §主题）：`system` 走媒体查询，明确选深浅走
 * `data-theme` 属性。渲染器直接看这两个入口，就不必把主题从 App 一路传进
 * CodeMirror 再传进 widget —— 那条链上任何一环忘了传，图就会在深色底上留
 * 一块白。
 *
 * ## 安全
 *
 * `securityLevel: "strict"`：mermaid 关掉标签里的 HTML、关掉 `click` 交互，
 * 并用 DOMPurify 洗一遍产出的 SVG。和 KaTeX 那边 `trust: false` 是同一个
 * 位置的同一个决定 —— 笔记可能来自分享、协作者或 AI（§7.5）。
 */

/** 渲染结果。出错时给出 mermaid 的原话，让人知道是哪一行写错了 */
export type MermaidResult = { svg: string; error?: undefined } | { svg?: undefined; error: string };

let mermaidModule: Promise<typeof import("mermaid").default> | null = null;
/** 已经按哪个主题初始化过。主题变了要重新 initialize */
let initializedDark: boolean | null = null;

/** 当前实际生效的是不是深色。两个入口都认，和 styles.css 一致 */
export function mermaidIsDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 主题变了就叫一声。图是渲染成 SVG 存下来的，不像 CSS 那样自己会跟着变色，
 * 挂在屏幕上的每张图都得重画一遍。
 */
export function onMermaidThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  // 明确选了深浅时系统主题与我们无关，但那时 `data-theme` 在，上面那条会先
  // 拦住 —— 所以这里无条件监听也不会多画
  media?.addEventListener("change", callback);

  return () => {
    observer.disconnect();
    media?.removeEventListener("change", callback);
  };
}

/** 图里的字跟着正文走。取不到就交给 mermaid 自己的默认值 */
function fontFamily(): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim();
  return value || undefined;
}

async function load(dark: boolean) {
  mermaidModule ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidModule;
  if (initializedDark !== dark) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      fontFamily: fontFamily(),
    });
    initializedDark = dark;
  }
  return mermaid;
}

/**
 * 渲染结果缓存。
 *
 * 与公式预览那边（mathPreview.ts 有意不缓存）相反：这里缓存是必要的。滚动
 * 时同一张图会被反复建 widget，而一张 mermaid 图要跑一遍布局，不是毫秒级。
 * key 带主题 —— 同一份源码在深浅色下是两张不同的图。
 */
const cache = new Map<string, MermaidResult>();
const CACHE_LIMIT = 64;

let seq = 0;

/**
 * 缓存里现成的那一份，同步拿。
 *
 * widget 每次重建都先问它 —— 滚动回来、或者在图下面敲字导致整块重建时，
 * 图是立刻在的。只走 `renderMermaid` 的话，即便命中缓存也要等一个 microtask，
 * 屏幕上就是明晃晃闪一下占位。
 */
export function cachedMermaid(source: string, dark = mermaidIsDark()): MermaidResult | null {
  return cache.get(`${dark ? "d" : "l"}:${source.trim()}`) ?? null;
}

export async function renderMermaid(source: string, dark = mermaidIsDark()): Promise<MermaidResult> {
  const code = source.trim();
  if (!code) return { error: "空的图表" };

  const key = `${dark ? "d" : "l"}:${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let result: MermaidResult;
  // id 必须每次都不同：mermaid 拿它当临时 DOM 的 id，重名会互相踩
  const id = `verso-mermaid-${(seq += 1)}`;
  try {
    const mermaid = await load(dark);
    result = { svg: (await mermaid.render(id, code)).svg };
  } catch (e) {
    result = { error: (e as Error)?.message?.trim() || "图表语法有误" };
  } finally {
    // 渲染失败时 mermaid 会把那个临时容器留在 body 上（成功时它自己收拾）。
    // 不清的话，每敲错一个字符文档末尾就多一块看不见的残渣
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }

  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return result;
}
