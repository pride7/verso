import { describe, expect, it } from "vitest";

import { keyLabel } from "../../../src/core/platform";

/**
 * 平台**显式传**，不靠跑测试那台机器的系统。
 *
 * 原来这里只钉了非 Mac 那一半，注释写着「Mac 那半边只能靠实现本身保证」——
 * 于是开发机从 Windows 换到 Mac 之后，五条用例一起变红，而代码一个字没改。
 * 一个跟环境走的套件，红了也说明不了任何事。
 */
describe("快捷键提示文字（非 Mac）", () => {
  it("Mod 显示为 Ctrl", () => {
    expect(keyLabel("Mod+P", false)).toBe("Ctrl+P");
  });

  it("修饰键按 Ctrl→Alt→Shift 排序，与系统菜单一致", () => {
    expect(keyLabel("Mod+Shift+F", false)).toBe("Ctrl+Shift+F");
    expect(keyLabel("Mod+Alt+Shift+F", false)).toBe("Ctrl+Alt+Shift+F");
  });

  it("不带修饰键时原样返回", () => {
    expect(keyLabel("Escape", false)).toBe("Escape");
  });

  it("反引号这种非字母键也要能显示", () => {
    expect(keyLabel("Mod+`", false)).toBe("Ctrl+`");
  });

  it("Ctrl 和 Mod 同时写不会重复", () => {
    expect(keyLabel("Mod+Ctrl+K", false)).toBe("Ctrl+K");
  });
});

/**
 * Mac 那一半以前一条用例都没有。§6 的排版规范之外，这也是用户最容易一眼
 * 看出「这软件没在 Mac 上认真跑过」的地方：写着 Ctrl+P 的按钮按不动。
 */
describe("快捷键提示文字（Mac）", () => {
  it("Mod 显示为 ⌘，且修饰键之间不加分隔符", () => {
    expect(keyLabel("Mod+P", true)).toBe("⌘P");
  });

  it("按系统惯例的 ⌃⌥⇧⌘ 次序排，与写的顺序无关", () => {
    expect(keyLabel("Mod+Shift+F", true)).toBe("⇧⌘F");
    expect(keyLabel("Shift+Alt+Mod+F", true)).toBe("⌥⇧⌘F");
  });

  it("不带修饰键时原样返回", () => {
    expect(keyLabel("Escape", true)).toBe("Escape");
  });

  it("反引号这种非字母键也要能显示", () => {
    expect(keyLabel("Mod+`", true)).toBe("⌘`");
  });

  it("⌃ 和 ⌘ 是两个键，同时写就都显示（v0.7.48）", () => {
    // 非 Mac 那边会把这两个折成一个 Ctrl，Mac 上不能折 —— ⌃K 和 ⌘K
    // 在 macOS 上是两回事，前者还是系统级的文本编辑键
    expect(keyLabel("Mod+Ctrl+K", true)).toBe("⌃⌘K");
  });
});
