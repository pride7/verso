import { describe, expect, it } from "vitest";

import { keyLabel } from "./platform";

// 测的是非 Mac 分支 —— 测试跑在 Windows/Linux 上，`isMac` 是编译期常量，
// Mac 那半边只能靠 `keyLabel` 的实现本身保证。这里至少钉住 Windows 的写法。
describe("快捷键提示文字", () => {
  it("Mod 在非 Mac 上显示为 Ctrl", () => {
    expect(keyLabel("Mod+P")).toBe("Ctrl+P");
  });

  it("修饰键按 Ctrl→Alt→Shift 排序，与系统菜单一致", () => {
    expect(keyLabel("Mod+Shift+F")).toBe("Ctrl+Shift+F");
  });

  it("不带修饰键时原样返回", () => {
    expect(keyLabel("Escape")).toBe("Escape");
  });

  it("反引号这种非字母键也要能显示", () => {
    expect(keyLabel("Mod+`")).toBe("Ctrl+`");
  });

  it("Ctrl 和 Mod 同时写不会重复", () => {
    expect(keyLabel("Mod+Ctrl+K")).toBe("Ctrl+K");
  });
});
