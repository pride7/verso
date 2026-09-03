/**
 * 用系统浏览器打开一个外部地址。**要开外链一律走这里。**
 *
 * ## 两条路，两种失败
 *
 * 动态 import `plugin-opener` 是有意的，而它失败和 `openUrl` 失败是**两件
 * 不同的事**，早先两处各写各的，正是把它们混成了一件：
 *
 * - **import 失败 = 根本不在 Tauri 里**（纯网页预览、浏览器测试）。那种
 *   环境里 `window.open` 是通的，退回去就行，不算出错。
 * - **`openUrl` 失败 = 在 Tauri 里但系统没打开**（没有默认浏览器、地址被
 *   拒）。这时 `window.open` 救不了场，而**吞掉它就等于点了没反应** ——
 *   最难自查的一类问题（AGENTS.md）。所以这一条往外抛，由调用方说一句。
 */
export async function openExternal(url: string): Promise<void> {
  let open: (u: string) => Promise<unknown>;
  try {
    ({ openUrl: open } = await import("@tauri-apps/plugin-opener"));
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await open(url);
}

/**
 * 不等结果的版本，给「界面上没有地方显示这条错误」的调用点用
 * （GitHub 设备授权、设置面板里那几个外链）。
 *
 * 失败仍然留一条控制台记录 —— 报不到界面上是那些调用点的处境，
 * 不是把错误丢掉的理由。
 */
export function openExternalPage(url: string): void {
  void openExternal(url).catch((e) => console.error("打不开外部链接", url, e));
}

/** 错误对象 → 能给人看的一句话 */
export function describeOpenError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
