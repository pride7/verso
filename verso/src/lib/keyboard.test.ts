import { describe, expect, it } from "vitest";

import { KEYBOARD_MIN_SHRINK, initialKeyboard, stepKeyboard, type ViewportSize } from "./keyboard";

/** 把一串视口尺寸依次喂进去，返回每一步的判定 */
const run = (sizes: ViewportSize[]) => {
  let state = initialKeyboard();
  return sizes.map((s) => {
    state = stepKeyboard(state, s);
    return state.up;
  });
};

const PHONE = { width: 390, height: 844 };
/** 中文键盘（带候选词条）大约这么高 */
const WITH_KEYBOARD = { width: 390, height: 844 - 336 };

describe("软键盘在不在", () => {
  it("第一帧不算键盘 —— 那时量到的就是基线", () => {
    expect(run([PHONE])).toEqual([false]);
  });

  it("视口缩掉一个键盘的高度就算它上来了，涨回去就算收了", () => {
    expect(run([PHONE, WITH_KEYBOARD, PHONE])).toEqual([false, true, false]);
  });

  /**
   * 判据是视口，不是焦点 —— 正是为了这一条：安卓的返回手势、iOS 的收起键
   * 都能在**不改焦点**的情况下收起键盘。那时导航必须回来
   */
  it("焦点没动、键盘自己收了，也认得出来", () => {
    let state = initialKeyboard();
    state = stepKeyboard(state, PHONE);
    state = stepKeyboard(state, WITH_KEYBOARD);
    expect(state.up).toBe(true);
    // 编辑器仍然是焦点，只有高度涨了回来
    state = stepKeyboard(state, PHONE);
    expect(state.up).toBe(false);
  });

  it("地址栏、手势条那种几十像素的收缩不算", () => {
    const shrunk = { width: 390, height: 844 - (KEYBOARD_MIN_SHRINK - 1) };
    expect(run([PHONE, shrunk])).toEqual([false, false]);
  });

  /**
   * **转屏不能误判。** 横屏的高度天然比竖屏矮几百像素，沿用竖屏的基线
   * 会一转屏就判成「键盘开着」—— 那意味着导航在整个横屏期间都不见了
   */
  it("转屏重新取基线，不会一转就把导航吃掉", () => {
    const landscape = { width: 844, height: 390 };
    expect(run([PHONE, landscape])).toEqual([false, false]);
    // 横屏里照样量得出键盘
    expect(run([PHONE, landscape, { width: 844, height: 390 - 200 }])).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("转回竖屏时基线跟着回来", () => {
    const landscape = { width: 844, height: 390 };
    expect(run([PHONE, landscape, PHONE, WITH_KEYBOARD])).toEqual([false, false, false, true]);
  });

  /**
   * 键盘开着的时候换一个更高的键盘（切输入法、展开手写面板），
   * 基线不该被这几帧带偏 —— 它取的是见过的最大值
   */
  it("键盘高度变化不影响基线", () => {
    const taller = { width: 390, height: 844 - 420 };
    expect(run([PHONE, WITH_KEYBOARD, taller, WITH_KEYBOARD, PHONE])).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});
