/**
 * 设置真的作用到界面上了吗 —— 在真实浏览器里跑。
 *
 * 这些断言全都依赖**层叠与计算样式**：变量有没有被继承、深色的媒体查询和
 * 属性选择器谁盖得住谁、CodeMirror 的主题有没有跟着变。没有布局引擎的
 * 模拟 DOM 这些一个都验不了。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import { applySettings, DEFAULT_SETTINGS, type Settings } from "../../../src/app/settings";
import "../../../src/ui/styles.css";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  root.removeAttribute("style");
});

function withSettings(patch: Partial<Settings>) {
  applySettings({ ...DEFAULT_SETTINGS, ...patch });
}

function mountEditor() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc: "正文",
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
    }),
  });
  views.push(view);
  return view;
}

const rootVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

describe("设置作用到界面", () => {
  it("正文字号会传到编辑器里，而不是只写进变量", () => {
    withSettings({ bodyFontSize: 22 });
    const v = mountEditor();
    // 读 CodeMirror 自己那层的计算样式 —— 变量写对了但主题没引用它，
    // 这条就会失败
    expect(getComputedStyle(v.dom).fontSize).toBe("22px");
  });

  it("行高同样要落到编辑器", () => {
    withSettings({ bodyFontSize: 20, lineHeight: 2 });
    const v = mountEditor();
    const scroller = v.dom.querySelector(".cm-scroller")!;
    expect(getComputedStyle(scroller).lineHeight).toBe("40px");
  });

  it("字体名带空格时要加引号，否则整条 font-family 都会失效", () => {
    withSettings({ bodyFont: "Microsoft YaHei" });
    expect(rootVar("--font-body")).toContain('"Microsoft YaHei"');
  });

  it("能改写样式的字体名被丢掉，回退栈保持完整", () => {
    withSettings({ bodyFont: 'x"; } body { display: none } .y {' });
    const stack = rootVar("--font-body");
    expect(stack).not.toContain("display");
    expect(stack).toContain("Inter");
  });

  it("终端字体留空时跟随等宽字体", () => {
    withSettings({ monoFont: "Fira Code", terminalFont: "" });
    expect(rootVar("--term-font")).toContain('"Fira Code"');
  });
});

describe("主题切换", () => {
  it("选浅色/深色时打上 data-theme，跟随系统时不打", () => {
    const root = document.documentElement;
    withSettings({ theme: "dark" });
    expect(root.getAttribute("data-theme")).toBe("dark");
    withSettings({ theme: "system" });
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  // 关键的一条：深色和浅色必须真的算出不同的背景色。
  // 变量写在了 :root 上但选择器优先级不对的话，属性加上了颜色却不变
  it("深浅两套算出来的背景色不同", () => {
    withSettings({ theme: "light" });
    const light = rootVar("--bg");
    withSettings({ theme: "dark" });
    const dark = rootVar("--bg");
    expect(light).not.toBe("");
    expect(dark).not.toBe(light);
  });

  it("明确选浅色要能盖过系统的深色偏好", () => {
    // 属性选择器写在媒体查询之后才有这个效果，顺序反了就盖不住。
    //
    // 断言「不等于深色值」而不是「等于某个具体色值」—— 后者每次微调
    // 配色都会挂，那种测试只会训练人去改断言而不是去看问题
    withSettings({ theme: "light" });
    expect(rootVar("--bg")).not.toBe(rootVar("--d-bg"));
    expect(rootVar("--d-bg")).not.toBe(""); // 深色调色板确实存在，不是拿空值蒙混过关
  });

  // 深色的色值只写在 --d-* 那一组里，两个入口（媒体查询 / data-theme）
  // 都只做转接。这条钉住转接没漏行 —— 漏了不会报错，只是某个主题下
  // 某个颜色悄悄退回浅色
  it("data-theme=dark 时每一项都接到了深色调色板", () => {
    withSettings({ theme: "dark" });
    for (const name of [
      "bg",
      "surface",
      "rail",
      "raised",
      "text",
      "muted",
      "muted-2",
      "border",
      "hairline",
      "accent",
      "selected-bg",
      "hover-bg",
    ]) {
      expect(rootVar(`--${name}`), `--${name} 没接到深色值`).toBe(rootVar(`--d-${name}`));
    }
  });
});
