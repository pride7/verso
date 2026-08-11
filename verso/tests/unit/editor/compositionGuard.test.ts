import { describe, expect, it } from "vitest";

import {
  COMPOSITION_IDLE_MS,
  compositionStale,
  type CompositionProbe,
} from "../../../src/editor/compositionGuard";

const probe = (over: Partial<CompositionProbe> = {}): CompositionProbe => ({
  flagged: true,
  hasFocus: true,
  lastEventAt: 1_000,
  now: 1_000,
  ...over,
});

describe("组词标志的兜底", () => {
  it("没举旗时永远不判卡住", () => {
    // 这个函数只管「举着的旗是不是烂的」。没举旗还回 true 的话，
    // 调用方会把「本来就没在组词」当成一次异常恢复
    expect(compositionStale(probe({ flagged: false, hasFocus: false, lastEventAt: null }))).toBe(
      false,
    );
  });

  it("正在组词、事件一直在来，就一直不判卡住", () => {
    // 拼音打一整句能敲十几下，中间还会停下来挑候选词 —— 这期间护栏必须
    // 一直生效，判早了就等于把当初那个「公式被顶掉」的 bug 放回来
    let now = 1_000;
    for (let i = 0; i < 30; i++) {
      now += COMPOSITION_IDLE_MS - 500;
      expect(compositionStale(probe({ lastEventAt: now, now }))).toBe(false);
    }
  });

  it("没焦点还说在组词，立刻判卡住", () => {
    // 最常见的漏发场景：组词组到一半点到别处去了。没焦点就不可能在组词，
    // 这条不必等那几秒
    expect(compositionStale(probe({ hasFocus: false }))).toBe(true);
  });

  it("太久没有 composition 事件就判卡住", () => {
    const now = 1_000 + COMPOSITION_IDLE_MS;
    expect(compositionStale(probe({ lastEventAt: 1_000, now }))).toBe(true);
    expect(compositionStale(probe({ lastEventAt: 1_000, now: now - 1 }))).toBe(false);
  });

  /**
   * 这一条是整个模块存在的理由。
   *
   * WebKit 漏掉 `compositionend` 之后，人会**继续正常打字** —— 文档变更一直
   * 在来，只有 composition 事件不会再来。拿「多久没有文档变更」当判据的话
   * 永远判不出卡住，编辑器就在他打字的全程冻着。
   */
  it("旗卡住之后继续打字：文档一直在变，仍然判得出卡住", () => {
    const startedAt = 1_000;
    // 之后每 200ms 敲一个字（这些都是文档变更，不是 composition 事件）
    for (let tick = 200; tick <= COMPOSITION_IDLE_MS * 2; tick += 200) {
      const stale = compositionStale(probe({ lastEventAt: startedAt, now: startedAt + tick }));
      expect(stale).toBe(tick >= COMPOSITION_IDLE_MS);
    }
  });

  it("举着旗却一次 composition 事件都没见过，按不可信处理", () => {
    // 这面旗不是这一轮升起来的（view 在组词中途重建之类）。宁可多重建
    // 一次，也不要让编辑器冻在一个我们没看见过开头的状态里
    expect(compositionStale(probe({ lastEventAt: null }))).toBe(true);
  });
});
