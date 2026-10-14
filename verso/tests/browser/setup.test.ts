/**
 * `setup.ts` 真的把 localStorage 隔开了：这里写的，别的测试文件（共用的那份
 * 浏览器 localStorage）看不见。否则并行跑时界面偏好会串到别的文件里去。
 *
 * 「共用的那份」从父页面拿：测试跑在 iframe 里，父页面同源、没被替换。
 */
import { expect, it } from "vitest";

it("写进去的只在这个文件里", () => {
  expect(window.parent, "测试应当跑在 iframe 里").not.toBe(window);
  const shared = window.parent.localStorage;
  localStorage.setItem("verso.sidebarView", "outline");
  expect(localStorage.getItem("verso.sidebarView")).toBe("outline");
  expect(shared.getItem("verso.sidebarView")).toBeNull();
  localStorage.clear();
});
