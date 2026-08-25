/**
 * 把一篇笔记导出成**一张长图**（PNG / JPG），可以直接贴进聊天窗口。
 *
 * ## 为什么不是「截个屏」
 *
 * 屏幕上看得见的只有视口那么高，而要交出去的往往是整篇。CodeMirror 又只渲染
 * 视口（§2.12 同一条理由），所以这里和打印走**同一条渲染链**：
 * `exportHtml.ts` 出 HTML → 挂进一个屏外的 `.print-page` → 光栅化。
 * 纸上什么样，图上就什么样，只是不分页 —— 图片没有「页」这个概念，
 * 硬切成 A4 一段一段反而更难读。
 *
 * ## 光栅化只有一条路：SVG 的 `<foreignObject>`
 *
 * webview 里没有「把这个 DOM 画进 canvas」的 API。唯一能用的是把一段 XHTML
 * 塞进 `<svg><foreignObject>`，当成图片交给 `drawImage` —— 浏览器自己的排版
 * 引擎照常算一遍，所以公式、表格、CJK 断行都和屏幕上一致。html2canvas 那类
 * 库是自己**重写了一遍 CSS 布局**，KaTeX 那种堆了几百个绝对定位 span 的结构
 * 正是它们最容易错的地方，所以不用。
 *
 * 代价是这张 SVG 当图片加载时**够不着任何外部资源**（同源也不行）：
 *
 * - 样式表要整份内联 —— 于是这里把 `document.styleSheets` 序列化进去
 * - `@font-face` 的字体文件要 base64 内联。只内联**真的用到**的那几族：
 *   KaTeX 有二十来族，全塞进去每导一张图都要多背几百 KB
 * - 系统字体（`Segoe UI`、`Noto Serif CJK`…）不受影响，它们不是外部资源，
 *   按名字引用就能画出来
 * - 笔记里的图片要 fetch 回来转成 data URI
 *
 * ## 尺寸上限
 *
 * canvas 有硬上限（各引擎不同，边长普遍在 16384 上下，面积另有一条）。一篇长
 * 笔记 2× 之后很容易顶到，顶到的表现是 `toBlob` 给出一张全空的图 —— 又是那种
 * 看不出失败的失败。所以这里**主动降倍率**，宁可清晰度低一点也要有图。
 */
import { layoutVars, type PrintLayout } from "./PrintView";

export type ImageFormat = "png" | "jpeg";

export interface PrintImageInput {
  /** 图上第一行标题。null = 不画（和打印的那个选项同一个值） */
  title: string | null;
  /** **必须是 `editor/exportHtml.ts` 的产物** —— 转义由那边保证（§7.5） */
  html: string;
  layout: PrintLayout;
}

/** 视网膜清晰度。1× 的字在手机上放大看边缘就糊了 */
const SCALE = 2;

/** 单边上限。Chromium/WebKit 都在 16384 附近，留一点余量 */
const MAX_SIDE = 16000;

/** 面积上限（像素）。比单边那条更容易先撞上，长图尤其 */
const MAX_AREA = 96_000_000;

/** JPG 的质量。0.92 之后再往上体积涨得比画质快 */
const JPEG_QUALITY = 0.92;

/** 图片等这么久。加载不完宁可缺一张图，也不能让「复制」按下去没反应 */
const ASSET_TIMEOUT_MS = 5000;

/**
 * 渲染成一张长图。
 *
 * 全程在屏外完成：建节点 → 等资源 → 光栅化 → 拆掉。调用方只拿到一个 Blob，
 * 复制到剪贴板还是存成文件由它决定。
 */
export async function renderPrintImage(
  input: PrintImageInput,
  format: ImageFormat = "png",
): Promise<Blob> {
  const host = mountOffscreen(input);
  try {
    await waitForAssets(host);
    return await rasterize(host.firstElementChild as HTMLElement, format);
  } finally {
    host.remove();
  }
}

/**
 * 屏外的那张「纸」。
 *
 * 位置用 `left: -20000px` 而不是 `display: none` / `visibility: hidden`：
 * 后两者要么不排版、要么不加载图片，量出来的高度是错的。
 */
function mountOffscreen(input: PrintImageInput): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;top:0;left:-20000px;width:210mm;pointer-events:none";

  const page = document.createElement("div");
  // `print-page-image`：去掉阴影和 297mm 的最小高度 —— 图的高度由内容决定
  page.className = "print-page print-page-image";
  for (const [k, v] of Object.entries(layoutVars(input.layout))) page.style.setProperty(k, v);

  const doc = document.createElement("div");
  doc.className = "print-doc";
  if (input.title) {
    const h1 = document.createElement("h1");
    h1.className = "print-doc-title";
    h1.textContent = input.title;
    doc.appendChild(h1);
  }
  const body = document.createElement("div");
  // 传进来的 HTML 由 `exportHtml.ts` 逐段转义过，和 `PrintView` 用的是同一份
  body.innerHTML = input.html;
  doc.appendChild(body);

  page.appendChild(doc);
  host.appendChild(page);
  document.body.appendChild(host);
  return host;
}

/** 图片和字体都就位了才量高度 —— 早一步量出来的是没有图、没有字体的那个高度 */
async function waitForAssets(host: HTMLElement): Promise<void> {
  const images = [...host.querySelectorAll("img")].filter((img) => !img.complete);
  const loaded = images.map(
    (img) =>
      new Promise<void>((done) => {
        // error 也算数：加载失败的一张不该把整次导出拖到超时
        img.addEventListener("load", () => done(), { once: true });
        img.addEventListener("error", () => done(), { once: true });
      }),
  );
  const timeout = new Promise<void>((done) => setTimeout(done, ASSET_TIMEOUT_MS));
  await Promise.race([Promise.all([...loaded, document.fonts.ready]), timeout]);
}

// ------------------------------------------------------------ 光栅化

async function rasterize(page: HTMLElement, format: ImageFormat): Promise<Blob> {
  const width = Math.ceil(page.offsetWidth);
  const height = Math.ceil(page.offsetHeight);
  if (!width || !height) throw new Error("导出内容为空");

  const clone = page.cloneNode(true) as HTMLElement;
  // 克隆体在 SVG 里是根，不再有外面那个定宽容器给它撑着
  clone.style.width = `${width}px`;
  clone.style.margin = "0";

  await inlineImages(page, clone);
  const css = await collectCss(usedFontFamilies(page));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<foreignObject x="0" y="0" width="100%" height="100%">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeAttr(rootVars())}">`,
    `<style>${escapeXml(css)}</style>`,
    new XMLSerializer().serializeToString(clone),
    `</div></foreignObject></svg>`,
  ].join("");

  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const scale = fitScale(width, height);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  // JPG 没有透明通道，不铺底就是一片黑。PNG 也铺 —— 纸是白的
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return await toBlob(canvas, format);
}

/** 顶到 canvas 上限就降倍率。宁可糊一点，也不要一张空白图 */
function fitScale(width: number, height: number): number {
  let scale = SCALE;
  const side = Math.max(width, height);
  if (side * scale > MAX_SIDE) scale = MAX_SIDE / side;
  if (width * height * scale * scale > MAX_AREA) {
    scale = Math.sqrt(MAX_AREA / (width * height));
  }
  return Math.max(1, scale);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // 这里失败几乎只有一个原因：序列化出来的 XHTML 不合法。说清楚比抛一个
    // 空 Event 有用 —— 后者在日志里什么都看不出来
    img.onerror = () => reject(new Error("渲染图片失败"));
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement, format: ImageFormat): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("导出图片失败：内容可能太长"))),
      `image/${format}`,
      format === "jpeg" ? JPEG_QUALITY : undefined,
    );
  });
}

// ------------------------------------------------------------ 内联外部资源

/**
 * 笔记里的图片换成 data URI。
 *
 * 按下标一一对应：克隆体和原件的 `img` 顺序完全一致。取不回来的保持原样 ——
 * 它在图上会缺一块，但缺一张图比整次导出失败好。
 */
async function inlineImages(source: HTMLElement, clone: HTMLElement): Promise<void> {
  const from = [...source.querySelectorAll("img")];
  const to = [...clone.querySelectorAll("img")];
  await Promise.all(
    from.map(async (img, i) => {
      const target = to[i];
      if (!target || !img.currentSrc) return;
      if (img.currentSrc.startsWith("data:")) return;
      const data = await fetchDataUri(img.currentSrc);
      if (data) target.setAttribute("src", data);
    }),
  );
}

async function fetchDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await blobToDataUri(retype(await res.blob(), url));
  } catch {
    return null;
  }
}

/**
 * 类型为空的 Blob 补一个。
 *
 * data URI 里没有类型，字体在 `src:url()` 里就可能被当成未知格式丢掉 ——
 * 而丢掉的表现是公式改用回退字体排版，位置全错，却不报任何错。
 */
function retype(blob: Blob, url: string): Blob {
  if (blob.type) return blob;
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
  const type = ext && MIME[ext];
  return type ? new Blob([blob], { type }) : blob;
}

const MIME: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

/**
 * Blob → `data:` URI。
 *
 * 走 `FileReader` 而不是自己拼 base64：几百 KB 的字体在主线程上手写一遍
 * 循环是看得见的一顿（`editor/paste.ts` 的 `toBase64` 同一个理由）。
 */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取资源失败"));
    reader.readAsDataURL(blob);
  });
}

// ------------------------------------------------------------ 样式与字体

/**
 * 这棵子树里真的用到的字体族（小写、去引号）。
 *
 * 只看 `font-family` 一个属性，一个节点一次 —— 便宜。用它筛 `@font-face`：
 * KaTeX 有二十来族，一篇没有公式的笔记一族都不需要。
 */
function usedFontFamilies(node: HTMLElement): Set<string> {
  const out = new Set<string>();
  const add = (el: Element) => {
    for (const name of getComputedStyle(el).fontFamily.split(",")) {
      out.add(normalizeFamily(name));
    }
  };
  add(node);
  for (const el of node.querySelectorAll("*")) add(el);
  return out;
}

function normalizeFamily(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
}

/**
 * 整份样式表，序列化成一段能塞进 SVG 的 CSS。
 *
 * 结果按「用到的字体族」缓存：同一次会话里连导几张图不必反复 fetch 字体。
 */
const cssCache = new Map<string, Promise<string>>();

function collectCss(used: Set<string>): Promise<string> {
  const key = [...used].sort().join("|");
  let cached = cssCache.get(key);
  if (!cached) {
    cached = buildCss(used);
    cssCache.set(key, cached);
  }
  return cached;
}

async function buildCss(used: Set<string>): Promise<string> {
  const plain: string[] = [];
  const faces: Promise<string | null>[] = [];

  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // 跨源的表读不了。应用自己的样式表都是同源的，走到这里的只可能是
      // 外部注入的东西，跳过就是
      continue;
    }
    for (const rule of [...rules]) {
      if (rule instanceof CSSFontFaceRule) {
        faces.push(embedFace(rule, used, sheet.href));
      } else {
        plain.push(rule.cssText);
      }
    }
  }

  const embedded = (await Promise.all(faces)).filter((s): s is string => !!s);
  return [...embedded, ...plain].join("\n");
}

/**
 * 一条 `@font-face` → 字体内联进去的那一条。用不到的返回 null。
 *
 * 只取 `src` 里的第一个 url（打包出来的顺序是 woff2 在前，那是最小的一个），
 * 其余格式一并丢掉：SVG 里加载不了，留着只是让字符串更长。
 */
async function embedFace(
  rule: CSSFontFaceRule,
  used: Set<string>,
  base: string | null,
): Promise<string | null> {
  const family = rule.style.getPropertyValue("font-family");
  if (!family || !used.has(normalizeFamily(family))) return null;

  const src = rule.style.getPropertyValue("src");
  const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(src);
  if (!match) return null;

  let url: string;
  try {
    url = new URL(match[1], base || document.baseURI).href;
  } catch {
    return null;
  }
  const data = await fetchDataUri(url);
  if (!data) return null;

  const decl = [`font-family:${family}`, `src:url(${data})`];
  for (const prop of ["font-style", "font-weight", "font-stretch", "unicode-range"]) {
    const value = rule.style.getPropertyValue(prop);
    if (value) decl.push(`${prop}:${value}`);
  }
  return `@font-face{${decl.join(";")}}`;
}

/**
 * `:root` 上那些自定义属性，抄成一段内联样式。
 *
 * SVG 文档里的 `:root` 是那个 `<svg>` 元素，`html` / `body` 选择器一个都不匹配
 * —— 而字体、圆角、间距这些变量恰恰都定义在那儿。抄成内联的还有一个好处：
 * 它盖得住 `@media (prefers-color-scheme: dark)`，深色主题下导出的也是白纸黑字。
 */
function rootVars(): string {
  const style = getComputedStyle(document.documentElement);
  const out: string[] = [];
  for (const name of style) {
    if (name.startsWith("--")) out.push(`${name}:${style.getPropertyValue(name)}`);
  }
  return out.join(";");
}

/** XML 文本节点里只有这三个字符必须转 */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 属性值还多一个引号 —— 漏掉它整段 XML 就在那里断开 */
function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;");
}
