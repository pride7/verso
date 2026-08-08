/**
 * 守住分层：**`src/core/` 必须是平台无关的**。
 *
 * 这一层是唯一有希望被鸿蒙版（ArkTS）直接搬走的 TS 代码 —— ArkUI 不是 React，
 * CodeMirror 也过不去，编辑器那层注定要重写；能跨过去的只有解析、匹配、
 * 排序、snippet 表这些纯逻辑。所以 core 一旦混进 `react` 或 `document`，
 * 少的不是一个 import，而是「这个文件还能不能搬」这件事本身。
 *
 * 靠约定守不住：加一个 `useState` 太顺手了，而代价要到开第二个端的时候才显形。
 * 项目里没有 eslint（AGENTS.md），所以这条规则由测试来执行。
 *
 * 反过来的方向**有意不管**：core 之外的层想用 core 随便用，那正是它的用途。
 */
import { describe, expect, it } from "vitest";

/** `?raw` 拿源码文本 —— 这个 tsconfig 里没有 node 的类型，用不了 fs */
const sources = import.meta.glob("../../../src/core/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 注释里写「不许 import react」不该把测试自己搞挂 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const files = Object.entries(sources).map(([path, src]) => [path, stripComments(src)] as const);

/**
 * 每条都写清楚为什么它过不去，而不只是「禁止」。
 *
 * `exempt` 是**欠账清单，只许变短**：`localStorage` 是 Web API，鸿蒙上没有，
 * 但这三处都只是「记一下最近用过什么」的尾巴，丢了不影响正确性。正确的修法
 * `mathbar.ts` 已经示范过 —— 把 Storage 作为带默认值的参数注入
 * （`store: Pick<Storage, "getItem"> = localStorage`），调用方一行都不用改，
 * 而鸿蒙那边换个实现传进来就行。剩下两处照着改即可，不该再添新的。
 */
const FORBIDDEN: { what: RegExp; why: string; exempt?: string[] }[] = [
  { what: /from "react"|from "react\//, why: "ArkUI 不是 React" },
  { what: /from "@codemirror\//, why: "编辑器那层鸿蒙上要重写" },
  { what: /from "@tauri-apps\//, why: "Tauri 不支持鸿蒙，宿主调用走 src/host/" },
  { what: /\bdocument\./, why: "没有 DOM" },
  { what: /\bwindow\./, why: "没有 window" },
  {
    what: /\blocalStorage\b/,
    why: "没有 localStorage，改成注入 Storage",
    exempt: [
      "../../../src/core/collaboration.ts",
      "../../../src/core/emoji.ts",
      "../../../src/core/mathbar.ts",
    ],
  },
];

describe("src/core 是平台无关层", () => {
  it("扫到了源码（glob 没写错）", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { what, why, exempt = [] } of FORBIDDEN) {
    it(`不出现 ${what.source}（${why}）`, () => {
      const bad = files
        .filter(([path, src]) => !exempt.includes(path) && what.test(src))
        .map(([path]) => path);
      expect(bad, `这些文件该挪去 src/host、src/ui 或 src/editor：${why}`).toEqual([]);
    });
  }

  // 豁免名单只许变短。留着一条早已修好的豁免，下一个人会以为那样写是允许的
  it("欠账清单里的文件都还欠着（修好了就从名单里删掉）", () => {
    for (const { what, exempt = [] } of FORBIDDEN) {
      const stale = exempt.filter((path) => {
        const hit = files.find(([p]) => p === path);
        return !hit || !what.test(hit[1]);
      });
      expect(stale, `这些已经不需要豁免了：${what.source}`).toEqual([]);
    }
  });
});
