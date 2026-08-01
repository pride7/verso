import type { Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { cleanupWidgetRoots } from "./Editor";

function fakeRoot() {
  return { unmount: vi.fn() } as unknown as Root;
}

describe("database widget 的 React root 清理", () => {
  it("StrictMode 再挂载的新 root 不会被旧 cleanup 卸载", async () => {
    const oldRoot = fakeRoot();
    const newRoot = fakeRoot();
    const roots = new Map<HTMLElement, Root>([[{} as HTMLElement, oldRoot]]);

    cleanupWidgetRoots(roots);
    // 模拟 StrictMode 在旧 cleanup 的微任务执行前立即再挂载。
    roots.set({} as HTMLElement, newRoot);
    await Promise.resolve();

    expect(oldRoot.unmount).toHaveBeenCalledOnce();
    expect(newRoot.unmount).not.toHaveBeenCalled();
    expect([...roots.values()]).toEqual([newRoot]);
  });
});
