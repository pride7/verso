/**
 * 导出长图（§2.12）。
 *
 * 这条链路只有在**真的浏览器**里才成立：`<foreignObject>` 要由排版引擎算一遍，
 * `canvas.toBlob` 要有光栅化后端 —— happy-dom 两样都没有，在那里写多少断言
 * 都是假绿。
 *
 * 钉住的是三件会静默失败的事：
 *
 * 1. **图上真的有字。** 内联少了一条样式、SVG 序列化坏了一个字符，结果都是
 *    一张纯白的图 —— 不报错、不抛异常，等发出去才发现。所以这里数非白像素。
 * 2. **高度随内容走**，不是 A4 那个 297mm 的最小高度：图片没有「页」。
 * 3. **JPG 那条路也通**，而且底是白的（JPG 没有透明通道，不铺底就是一片黑）。
 */
import { describe, expect, it } from "vitest";

import "../../../src/ui/styles.css";
import "katex/dist/katex.min.css";
import { renderMarkdown } from "../../../src/editor/exportHtml";
import { renderPrintImage } from "../../../src/ui/exportImage";

const LAYOUT = { fontSize: 11, margin: 22 };

const SHORT = renderMarkdown("## 一个标题\n\n一段中文正文，混着 English words。\n");
const LONG = renderMarkdown(
  Array.from({ length: 60 }, (_, i) => `## 第 ${i + 1} 节\n\n这一节的正文。\n`).join("\n"),
);

/** 把 Blob 画回 canvas，好数像素 */
async function decode(blob: Blob): Promise<ImageData> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((done, fail) => {
      img.onload = done;
      img.onerror = () => fail(new Error("解码失败"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 明显不是白的那些像素占多少。空白页是 0 */
function inkRatio(data: ImageData): number {
  let ink = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    const [r, g, b] = [data.data[i], data.data[i + 1], data.data[i + 2]];
    if (r < 200 || g < 200 || b < 200) ink++;
  }
  return ink / (data.width * data.height);
}

describe("导出长图", () => {
  it("画出来的图上真的有字", async () => {
    const blob = await renderPrintImage({ title: "线性代数", html: SHORT, layout: LAYOUT }, "png");
    expect(blob.type).toBe("image/png");

    const data = await decode(blob);
    // 一页纸上稀稀拉拉几行字，占比很小 —— 但绝不该是 0
    expect(inkRatio(data)).toBeGreaterThan(0.001);
  }, 30_000);

  it("高度随内容走，不是 A4 的最小高度", async () => {
    const short = await decode(
      await renderPrintImage({ title: null, html: SHORT, layout: LAYOUT }, "png"),
    );
    const long = await decode(
      await renderPrintImage({ title: null, html: LONG, layout: LAYOUT }, "png"),
    );
    expect(long.width).toBe(short.width);
    expect(long.height).toBeGreaterThan(short.height * 3);
  }, 60_000);

  it("JPG 也导得出来，底是白的不是黑的", async () => {
    const blob = await renderPrintImage({ title: "线性代数", html: SHORT, layout: LAYOUT }, "jpeg");
    expect(blob.type).toBe("image/jpeg");

    const data = await decode(blob);
    // 左上角那一格是页边距，一定是纸的底色
    const [r, g, b] = [data.data[0], data.data[1], data.data[2]];
    expect(Math.min(r, g, b)).toBeGreaterThan(240);
  }, 30_000);

  it("导完把屏外那张纸拆掉，不在 DOM 里越攒越多", async () => {
    const before = document.body.childElementCount;
    await renderPrintImage({ title: null, html: SHORT, layout: LAYOUT }, "png");
    expect(document.body.childElementCount).toBe(before);
  }, 30_000);
});
