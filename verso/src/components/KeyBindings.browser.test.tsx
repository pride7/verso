/**
 * 快捷键设置。在真实浏览器里跑 —— 录键位这件事全靠 KeyboardEvent 的
 * `code`、修饰键标志和事件传播，这些在 node 里造不出来。
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { KeyOverrides } from "../lib/keymap";
import { KeyBindings } from "./KeyBindings";
import type { Command } from "./CommandPalette";

const CMDS: Command[] = [
  { id: "note.new", group: "笔记", label: "新建文档", defaultKeys: "Mod+N", run: () => {} },
  { id: "note.save", group: "笔记", label: "立即保存", defaultKeys: "Mod+S", run: () => {} },
  { id: "view.theme", group: "外观", name: "切换主题", label: "主题：切换到深色", run: () => {} },
];

let root: Root | null = null;
let overrides: KeyOverrides = {};

afterEach(() => {
  root?.unmount();
  root = null;
  overrides = {};
  document.body.innerHTML = "";
});

function draw(next: KeyOverrides) {
  overrides = next;
  root!.render(<KeyBindings commands={CMDS} overrides={next} onChange={draw} />);
}

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  draw({});
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** 第 i 行那个键位按钮 */
const cap = (i: number) => document.querySelectorAll<HTMLElement>(".key-cap")[i];

function press(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

describe("快捷键设置", () => {
  it("默认键位照着命令表显示", async () => {
    render();
    await tick();
    expect(cap(0).textContent).toBe("Ctrl+N");
    expect(cap(1).textContent).toBe("Ctrl+S");
    // 没绑的那条不能显示成空按钮 —— 那看着像坏了
    expect(cap(2).textContent).toBe("未绑定");
  });

  it("点一下开始录，按什么就是什么", async () => {
    render();
    await tick();
    cap(0).click();
    await tick();
    expect(cap(0).textContent).toBe("按下组合键…");

    press({ code: "KeyK", ctrlKey: true, altKey: true });
    await tick();
    expect(overrides["note.new"]).toBe("Mod+Alt+K");
    expect(cap(0).textContent).toBe("Ctrl+Alt+K");
  });

  it("光按着修饰键不算数，等后面那个真正的键", async () => {
    render();
    await tick();
    cap(0).click();
    await tick();
    press({ code: "ControlLeft", key: "Control", ctrlKey: true });
    await tick();
    // 还在录，没被这一发按键收尾
    expect(cap(0).textContent).toBe("按下组合键…");
  });

  it("不带 Ctrl/Alt 的键会把打字吃掉，不收", async () => {
    render();
    await tick();
    cap(0).click();
    await tick();
    press({ code: "KeyA", key: "a" });
    await tick();
    expect(overrides["note.new"]).toBeUndefined();
    expect(document.querySelector(".set-keys-warn")).not.toBeNull();
    expect(cap(0).textContent).toBe("按下组合键…");
  });

  it("Backspace 解绑，和「没改过」不是一回事", async () => {
    render();
    await tick();
    cap(0).click();
    await tick();
    press({ code: "Backspace" });
    await tick();
    expect(overrides["note.new"]).toBe("");
    expect(cap(0).textContent).toBe("未绑定");
  });

  it("Esc 取消录制，什么都不改", async () => {
    render();
    await tick();
    cap(0).click();
    await tick();
    press({ code: "Escape" });
    await tick();
    expect(overrides).toEqual({});
    expect(cap(0).textContent).toBe("Ctrl+N");
  });

  it("撞键不拦，两条都标出来", async () => {
    render();
    await tick();
    cap(1).click();
    await tick();
    press({ code: "KeyN", ctrlKey: true });
    await tick();
    expect(document.querySelectorAll(".key-cap.is-conflict").length).toBe(2);
  });

  it("改回默认那条要从存下来的覆盖表里消失", async () => {
    render();
    await tick();
    cap(0).click();
    await tick();
    press({ code: "KeyK", ctrlKey: true });
    await tick();
    expect(overrides["note.new"]).toBe("Mod+K");

    // ↺ 恢复默认
    document.querySelectorAll<HTMLElement>(".key-row .set-reset")[0].click();
    await tick();
    expect(overrides).toEqual({});
    expect(cap(0).textContent).toBe("Ctrl+N");
  });

  it("筛选按命令名和分组走", async () => {
    render();
    await tick();
    const box = document.querySelector<HTMLInputElement>(".set-keys-filter")!;
    // React 记着 input 的上一个值，直接赋 value 会让它以为没变过。
    // 必须走原生 setter，这是往受控输入框里"打字"的唯一办法
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "主题");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    const names = [...document.querySelectorAll(".key-name")].map((e) => e.textContent);
    // 状态在变的那条命令，这里显示的是稳定名字而不是「切换到深色」
    expect(names).toEqual(["切换主题"]);
  });
});
