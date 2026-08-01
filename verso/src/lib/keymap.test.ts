import { describe, expect, it } from "vitest";

import {
  bindingMap,
  bindingOf,
  conflictIds,
  eventSpec,
  isUsableSpec,
  normalizeSpec,
  pruneOverrides,
} from "./keymap";

/**
 * 造一个按键事件。这个测试跑在 node 环境里（没有 DOM），而 `eventSpec`
 * 只读这几个字段，凑一个对象比拉起一整个 jsdom 划算。
 */
function press(code: string, mods: Partial<KeyboardEventInit> = {}, key?: string): KeyboardEvent {
  return { code, key: key ?? "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods } as KeyboardEvent;
}

describe("键位规范化", () => {
  it("修饰键按 Mod→Alt→Shift 排序，写的顺序无所谓", () => {
    expect(normalizeSpec("Shift+Mod+p")).toBe("Mod+Shift+P");
    expect(normalizeSpec("Mod+Shift+P")).toBe("Mod+Shift+P");
  });

  it("Ctrl / Cmd / Meta 一律折成 Mod，Mac 上存的配置到 Windows 也认", () => {
    expect(normalizeSpec("Ctrl+S")).toBe("Mod+S");
    expect(normalizeSpec("Cmd+S")).toBe("Mod+S");
    expect(normalizeSpec("Meta+Alt+s")).toBe("Mod+Alt+S");
  });

  it("功能键和方向键的大小写写法都收", () => {
    expect(normalizeSpec("f2")).toBe("F2");
    expect(normalizeSpec("Mod+arrowup")).toBe("Mod+Up");
    expect(normalizeSpec("Mod+escape")).toBe("Mod+Escape");
  });

  it("符号键原样保留", () => {
    expect(normalizeSpec("Mod+`")).toBe("Mod+`");
    expect(normalizeSpec("Mod+Shift+[")).toBe("Mod+Shift+[");
  });
});

describe("按键 → 键位", () => {
  it("认物理键位而不是字符：Shift+[ 不会变成 {", () => {
    // 这正是用 code 不用 key 的理由 —— key 在按下 Shift 时报的是上档字符
    expect(eventSpec(press("BracketLeft", { ctrlKey: true, shiftKey: true }, "{"))).toBe(
      "Mod+Shift+[",
    );
  });

  it("字母统一大写，Ctrl 与 Cmd 都算 Mod", () => {
    expect(eventSpec(press("KeyP", { ctrlKey: true }))).toBe("Mod+P");
    expect(eventSpec(press("KeyP", { metaKey: true }))).toBe("Mod+P");
  });

  it("只按修饰键不算一次按键", () => {
    expect(eventSpec(press("ControlLeft", { ctrlKey: true }, "Control"))).toBeNull();
    expect(eventSpec(press("ShiftLeft", { shiftKey: true }, "Shift"))).toBeNull();
  });

  it("输入法占用按键时不误判成快捷键", () => {
    // 中文输入法激活时 key 会变成 Process；漏掉它的话，一边打字一边
    // 随机触发命令
    expect(eventSpec(press("", {}, "Process"))).toBeNull();
  });

  it("没有 code 的事件退回 key", () => {
    expect(eventSpec(press("", { ctrlKey: true }, "e"))).toBe("Mod+E");
  });
});

describe("能不能当全局快捷键", () => {
  it("不带 Ctrl/Alt 的普通键会把打字吃掉，不允许", () => {
    expect(isUsableSpec("A")).toBe(false);
    expect(isUsableSpec("Shift+A")).toBe(false);
  });

  it("F 键不带修饰键也行", () => {
    expect(isUsableSpec("F2")).toBe(true);
  });

  it("带 Ctrl 或 Alt 就行", () => {
    expect(isUsableSpec("Mod+S")).toBe(true);
    expect(isUsableSpec("Alt+Shift+F")).toBe(true);
  });
});

const CMDS = [
  { id: "a", defaultKeys: "Mod+A" },
  { id: "b", defaultKeys: "Mod+B" },
  { id: "c" },
];

describe("生效键位", () => {
  it("没改过就用默认", () => {
    expect(bindingOf(CMDS[0], {})).toBe("Mod+A");
    expect(bindingOf(CMDS[2], {})).toBe("");
  });

  it("空串是显式解绑，不是「没改过」", () => {
    expect(bindingOf(CMDS[0], { a: "" })).toBe("");
  });

  it("覆盖值也走规范化", () => {
    expect(bindingOf(CMDS[0], { a: "shift+ctrl+k" })).toBe("Mod+Shift+K");
  });

  it("撞键时先定义的赢，两条都算冲突", () => {
    const overrides = { b: "Mod+A" };
    expect(bindingMap(CMDS, overrides).get("Mod+A")).toBe("a");
    expect([...conflictIds(CMDS, overrides)].sort()).toEqual(["a", "b"]);
  });

  it("都解绑了就不算撞", () => {
    expect(conflictIds(CMDS, { a: "", b: "" }).size).toBe(0);
  });
});

describe("存下来的覆盖表", () => {
  it("改回默认的那条要删掉，将来调默认值时才不会被钉死", () => {
    expect(pruneOverrides(CMDS, { a: "ctrl+a", b: "Mod+K" })).toEqual({ b: "Mod+K" });
  });

  it("显式解绑要留着", () => {
    expect(pruneOverrides(CMDS, { a: "" })).toEqual({ a: "" });
  });

  it("默认就没绑的命令，解绑不算改动", () => {
    expect(pruneOverrides(CMDS, { c: "" })).toEqual({});
  });

  it("认不出的 id 原样留着，不替用户丢配置", () => {
    expect(pruneOverrides(CMDS, { "plugin.x": "Mod+9" })).toEqual({ "plugin.x": "Mod+9" });
  });
});
