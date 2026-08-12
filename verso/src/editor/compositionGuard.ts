/**
 * 「输入法还在组词吗」这个判断本身的兜底。DESIGN.md §4.2
 *
 * ## 为什么需要它
 *
 * §4.2 的护栏是：组词期间一个 decoration 都不动（不然 CM 读回的是一段被我们
 * 换掉的 DOM，`$x$` 后面打个字会把整条公式顶掉）。判据取自 CM 的
 * `view.compositionStarted`，而它就是 `inputState.composing >= 0` ——
 * **只有 `compositionend` 事件能把它清回 -1**。
 *
 * 问题是这个事件不一定来。CodeMirror 自己在源码里写着：
 *
 * > Safari will occasionally forget to fire compositionend at the end of a
 * > dead-key composition
 *
 * 它只给「dead-key + insertText」那一种情况打了补丁。而 macOS 上跑的 WKWebView
 * 正是 Safari 的引擎 —— Windows 的 WebView2 是 Chromium，碰不到这条。
 *
 * 漏掉一次的后果不是「这次组词出错」，是**永久卡住**：标志再也不回落，之后
 * 每一次 decoration 更新都被跳过，公式不再渲染、加粗标记不再折叠、光标进出
 * 也不切源码，直到换一篇笔记（view 重建）为止。
 *
 * ## 判据取的是 composition 事件，不是文档变更
 *
 * 这两者的区别正是整件事的关键。标志卡住之后，人会**继续正常打字** ——
 * 文档变更一直在来，拿「多久没有变更」当判据的话永远判不出卡住，编辑器
 * 就在他打字的全程冻着。
 *
 * 而 `compositionupdate` 只在**真的在组词**时每敲一下发一次。所以：
 *
 * - 真在组词 → 事件一直在来 → 永远不判卡住，护栏照常生效；
 * - 漏了 `compositionend` → 之后再没有 composition 事件 → 到点解除。
 *
 * 另加一条立刻生效的：**编辑器没有焦点就不可能在组词**（点到别处去了是最
 * 常见的漏发场景，不必等那几秒）。
 *
 * 写成纯函数是为了能在 Node 里把这些时序穷举着测：真机上这类问题要靠一个
 * 特定输入法在特定时刻漏一个事件才复现，而复现不了的 bug 只会一直在。
 */
import { StateEffect, StateField, type Extension, type Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/**
 * 举着组词的旗、又这么久没有任何 composition 事件，就当它卡住了。
 *
 * 3 秒是照「一次组词里两次按键之间的间隔」定的：停下来挑候选词也就一两秒，
 * 想久了的那种本来也早就把候选框放下了。而卡住的那一种是**永远**没有下一次，
 * 所以这个门槛只影响「多久之后恢复」，不影响判得准不准。
 */
export const COMPOSITION_IDLE_MS = 3_000;

export interface CompositionProbe {
  /** CM 说现在是不是在组词（`view.compositionStarted`） */
  flagged: boolean;
  /** 编辑器现在有没有焦点 */
  hasFocus: boolean;
  /**
   * 最后一次 composition 事件（start / update）的时刻。
   * 从没有过就是 null —— 那说明这面旗压根不是我们看着升起来的。
   */
  lastEventAt: number | null;
  now: number;
}

/**
 * CM 的组词标志现在还可信吗。`true` = 已经不可信，按「没在组词」处理。
 *
 * 没举旗时永远返回 `false` —— 这个函数只负责判「举着的旗是不是烂的」。
 */
export function compositionStale(probe: CompositionProbe): boolean {
  if (!probe.flagged) return false;
  // 没焦点还说在组词，只可能是漏了 compositionend
  if (!probe.hasFocus) return true;
  // 举着旗却一次 composition 事件都没见过：这面旗不是这一轮升的，不可信
  if (probe.lastEventAt === null) return true;
  return probe.now - probe.lastEventAt >= COMPOSITION_IDLE_MS;
}

/**
 * 每个 view 最后一次 composition 事件的时刻。
 *
 * 用 WeakMap 而不是把它挂在某个插件的实例上：`livePreview`、`parseRefresh`
 * 和 `typography` 都要用同一个判断。各记各的迟早会分叉，而分叉的表现是
 * 「公式解冻了，中西文间距还在改组词 DOM」之类的半好半坏，比全冻住更难查。
 */
const lastCompositionEvent = new WeakMap<EditorView, number>();

/**
 * DOM composition 事件对应的编辑器状态。
 *
 * 不能只查事务的 `input.type.compose` 标签：WebKit 写入临时拼音之后，CM6 会
 * 紧跟一笔普通 `select` 事务。那笔事务仍发生在组词窗口内，却没有 compose
 * 标签；块级 StateField 若因此重建 widget，下一次 DOM read 就会读坏正文。
 */
const setCompositionState = StateEffect.define<boolean>();

const compositionStateField = StateField.define<boolean>({
  create: () => false,
  update(active, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCompositionState)) active = effect.value;
    }
    return active;
  },
});

/** 这笔事务执行时，输入法是否仍占着 contentDOM。 */
export function transactionDuringComposition(transaction: Transaction): boolean {
  let active = transaction.startState.field(compositionStateField, false) ?? false;
  for (const effect of transaction.effects) {
    if (effect.is(setCompositionState)) active = effect.value;
  }
  return active || transaction.isUserEvent("input.type.compose");
}

/**
 * 把 composition 事件记下来。所有会改编辑器 DOM 的插件共用这一份账。
 *
 * 挂成 `domEventHandlers` 而不是某个插件的 `eventHandlers`：它不属于任何
 * 一个插件，谁先谁后也不该影响它。
 */
export const compositionTracker: Extension = [
  compositionStateField,
  EditorView.domEventHandlers({
    compositionstart(_event, view) {
      lastCompositionEvent.set(view, Date.now());
      return false;
    },
    compositionupdate(_event, view) {
      lastCompositionEvent.set(view, Date.now());
      return false;
    },
  }),
];

/**
 * 把输入法的确认键留给输入法，不让正文再执行一遍 Enter / Space。
 *
 * WebKit 的事件顺序有两种：确认键先到时，必须保留默认行为让输入法上屏；
 * `compositionend` 先到时，紧跟着的 Enter / Space 已经是第二次编辑动作，
 * 必须取消。后一种里 `isComposing` 已是 false，Space 的 keyCode 也是普通 32，
 * 只查 229 会漏掉。
 *
 * 必须用原生 capture listener：capture 比 CodeMirror 挂在 contentDOM 上的
 * 冒泡监听先到。仍在组词时只阻断传播、不 preventDefault；已经 end 的重复
 * 确认键才连默认行为一起取消。
 */
export const compositionKeyGuard: Extension = ViewPlugin.fromClass(class {
  private composing = false;
  private endedAt = 0;

  private readonly compositionstart = () => {
    this.composing = true;
    this.endedAt = 0;
    this.view.dispatch({ effects: setCompositionState.of(true) });
  };

  private readonly compositionend = () => {
    this.composing = false;
    this.endedAt = Date.now();
    this.view.dispatch({ effects: setCompositionState.of(false) });
  };

  private readonly keydown = (event: KeyboardEvent) => {
    const recentEnd = this.endedAt > 0 && Date.now() - this.endedAt < 100;
    const confirm = event.key === "Enter" || event.key === " " || event.key === "Spacebar" || event.code === "Space";

    // compositionend 已经把候选词上屏：后面这发只是 WebKit 重放出来的普通键。
    if (recentEnd && (confirm || event.keyCode === 229)) {
      this.endedAt = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    // 这发仍属于输入法。只挡编辑器监听器，默认行为必须留下来完成上屏。
    if (this.composing || event.isComposing || event.keyCode === 229) {
      event.stopImmediatePropagation();
      return;
    }

    // compositionend 后第一发并不是确认键，说明那轮已经正常结束。
    if (recentEnd) this.endedAt = 0;
  };

  constructor(readonly view: EditorView) {
    view.contentDOM.addEventListener("compositionstart", this.compositionstart, true);
    view.contentDOM.addEventListener("compositionend", this.compositionend, true);
    view.contentDOM.addEventListener("keydown", this.keydown, true);
  }

  destroy() {
    this.view.contentDOM.removeEventListener("compositionstart", this.compositionstart, true);
    this.view.contentDOM.removeEventListener("compositionend", this.compositionend, true);
    this.view.contentDOM.removeEventListener("keydown", this.keydown, true);
  }
});

/**
 * 输入法现在**真的**在组词吗。
 *
 * 这是 `view.compositionStarted` 该有的样子：CM 那面旗加上一条兜底，
 * 免得 WebKit 漏发一次 `compositionend` 就把编辑器冻到换笔记为止。
 */
export function compositionActive(view: EditorView): boolean {
  if (!view.compositionStarted) return false;
  return !compositionStale({
    flagged: true,
    hasFocus: view.hasFocus,
    lastEventAt: lastCompositionEvent.get(view) ?? null,
    now: Date.now(),
  });
}
