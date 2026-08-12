/**
 * 输入法组词与 live preview 的冲突 —— 必须在真实 Chromium 里跑。
 *
 * 中文输入法在 contentDOM 里**就地**组词，CM 靠读回那段 DOM 才知道用户输入了
 * 什么。这期间只要我们动了 decoration，读回的就是一段被我们改过的 DOM。
 *
 * 用英文键盘打字**永远复现不了**（没有组词这一步），所以这条只能靠模拟
 * composition 事件来守。
 */
import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import "../../../src/ui/styles.css";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
    }),
  });
  views.push(view);
  return view;
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

describe("组词期间不动 decoration", () => {
  it("compositionend 后重放的 Enter / Space 不会再次编辑正文", async () => {
    const view = mount("标题");
    view.focus();
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    for (const [key, code] of [["Enter", 229], [" ", 32]] as const) {
      view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "啊" }));
      const confirm = new KeyboardEvent("keydown", { key, code: key === " " ? "Space" : "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(confirm, "keyCode", { value: code });
      const allowed = view.contentDOM.dispatchEvent(confirm);
      expect(allowed, `${key === " " ? "Space" : "Enter"} 的第二次默认动作没有被取消`).toBe(false);
      expect(view.state.doc.toString()).toBe("标题");
      expect(view.state.doc.lines).toBe(1);
    }
  });

  it("仍在组词时的确认键保留默认行为，让输入法完成上屏", () => {
    const view = mount("标题");
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const confirm = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true, isComposing: true });
    Object.defineProperty(confirm, "keyCode", { value: 32 });
    expect(view.contentDOM.dispatchEvent(confirm)).toBe(true);
  });

  it("在标题里组词时，不重建同一篇里的折叠箭头和块公式", async () => {
    const view = mount("## 标题\n\n- 第一项\n- 第二项\n\n$$\n\\alpha = 1\n$$\n");
    await settle(300);
    view.focus();
    view.dispatch({ selection: EditorSelection.cursor(5) });
    await settle();
    const arrow = view.contentDOM.querySelector(".cm-fold-arrow");
    const math = view.contentDOM.querySelector(".cm-math-block");
    expect(arrow, "标题下面有正文，应当有折叠箭头").not.toBeNull();
    expect(math, "块公式应当已渲染").not.toBeNull();

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dispatch({
      changes: { from: 5, insert: "f'e" },
      selection: EditorSelection.cursor(8),
      annotations: Transaction.userEvent.of("input.type.compose.start"),
    });
    await settle(250);

    // 这正是截图里的结构：第一行标题正在选词，下面有多条渲染公式。WebKit
    // 维护 marked text 时，只要同一个编辑器里的 decoration DOM 被换掉，候选
    // 词就可能提交失败，最后把 f'e 留在文档里。
    expect(view.contentDOM.querySelector(".cm-fold-arrow")).toBe(arrow);
    expect(view.contentDOM.querySelector(".cm-math-block")).toBe(math);
    expect(
      [...view.contentDOM.querySelectorAll(".cm-bullet")].map((bullet) => bullet.closest(".cm-line")?.textContent),
      "标题里的拼音变长时，下面列表的装饰必须跟着映射，不能跑到行尾",
    ).toEqual(["• 第一项", "• 第二项"]);

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "反而" }),
    );
    view.dispatch({
      changes: { from: 5, to: 8, insert: "反而" },
      selection: EditorSelection.cursor(7),
      annotations: Transaction.userEvent.of("input.type.compose"),
    });
    await settle(250);
    expect(view.state.doc.toString()).toContain("## 标题反而");
    expect(view.state.doc.toString()).not.toContain("f'e");
  });

  it("普通正文里的拼音不加中西文间距，避免 WebKit 固化组词文本", async () => {
    const view = mount("中文");
    await settle(250);
    view.focus();
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const provisional = "aa'aa'a'a";
    view.dispatch({
      changes: { from: view.state.doc.length, insert: provisional },
      selection: EditorSelection.cursor(view.state.doc.length + provisional.length),
      annotations: Transaction.userEvent.of("input.type.compose.start"),
    });
    await settle();

    // 旧实现此时会给拼音套 `.cm-hs` span。WebKit 正在维护 marked text，
    // 替换这段 DOM 会让拼音固化，候选汉字随后只能追加在它后面。
    expect(
      view.contentDOM.querySelector(".cm-hs"),
      "组词中的拼音被 typography decoration 改写了",
    ).toBeNull();

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "啊啊啊" }),
    );
    view.dispatch({
      changes: {
        from: view.state.doc.length - provisional.length,
        to: view.state.doc.length,
        insert: "啊啊啊",
      },
      selection: EditorSelection.cursor(view.state.doc.length - provisional.length + 3),
      annotations: Transaction.userEvent.of("input.type.compose"),
    });
    await settle();
    expect(view.state.doc.toString()).toBe("中文啊啊啊");
  });

  it("空行里组词时不插入段间距块，避免 WebKit 把候选确认读成换行", async () => {
    const view = mount("前文\n\n\n这是第一行\n这是第二行");
    await settle(300);
    view.focus();

    const blank = view.state.doc.line(3);
    view.dispatch({ selection: EditorSelection.cursor(blank.from) });
    await settle();
    expect(
      view.contentDOM.querySelectorAll(".cm-paragraph-space"),
      "原有两行正文之间应当只有一个段间距块",
    ).toHaveLength(1);

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dispatch({
      changes: { from: blank.from, insert: "a" },
      selection: EditorSelection.cursor(blank.from + 1),
      annotations: Transaction.userEvent.of("input.type.compose.start"),
    });
    // 真机上 CM6 会在写入临时拼音后另发一笔普通 select 事务。它没有 compose
    // 标签，但仍处于同一轮 composition；此前正是它绕过事务级护栏重建了 widget。
    view.dispatch({
      selection: EditorSelection.cursor(blank.from + 1),
      annotations: Transaction.userEvent.of("select"),
    });
    await settle(250);

    // 真机的事件序列已经证明：若这里在临时拼音和下一行之间新建 block widget，
    // WebKit 随后的 deleteCompositionText 会把 widget 边界读成一个换行。表现为
    // 文档长度不变、行数却 +1，候选词确认后下方凭空多出一行。
    expect(
      view.contentDOM.querySelectorAll(".cm-paragraph-space"),
      "组词期间新增的段间距块会被 WebKit 读成换行",
    ).toHaveLength(1);

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "啊" }),
    );
    view.dispatch({
      changes: { from: blank.from, to: blank.from + 1, insert: "啊" },
      selection: EditorSelection.cursor(blank.from + 1),
      annotations: Transaction.userEvent.of("input.type.compose"),
    });
    await settle(350);

    expect(view.state.doc.toString()).toBe("前文\n\n啊\n这是第一行\n这是第二行");
    expect(view.state.doc.lines).toBe(5);
    expect(
      view.contentDOM.querySelectorAll(".cm-paragraph-space"),
      "组词结束后段间距应恢复正常刷新",
    ).toHaveLength(2);
  });

  it("在行内公式后面用输入法打字，公式不会被顶掉", async () => {
    const view = mount("行内 $x$");
    await settle(250);
    view.focus();

    // 光标停在公式末尾：这时按 §4.2 显示的是源码
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    await settle();
    // 只看正文：公式输入预览那个 tooltip 里也有一份 KaTeX（§5.3）
    expect(view.contentDOM.querySelector(".katex")).toBeNull();

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(view.compositionStarted).toBe(true);
    // 输入法把组词中的字送进来：CM 读回 DOM 之后就是这样一次事务
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "啊" },
      selection: EditorSelection.cursor(view.state.doc.length + 1),
    });
    await settle(400);

    // **组词还没结束，公式必须仍然是源码。** 这里要是切成了渲染态，CM 读回的
    // 就是一段被我们换掉的 DOM —— 用户看到的是整条公式被那个字顶掉，
    // `$x$` 变成 `$啊`
    expect(view.contentDOM.querySelector(".katex"), "组词期间公式被切成了渲染态").toBeNull();

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "啊" }),
    );
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    await settle(300);

    // 组词结束之后照常渲染，而且一个字都没丢
    expect(view.state.doc.toString()).toBe("行内 $x$啊");
    expect(view.contentDOM.querySelector(".katex")).not.toBeNull();
  });

  /**
   * **`compositionend` 不一定来。** CodeMirror 自己在源码里写着
   * "Safari will occasionally forget to fire compositionend"，而它只给
   * dead-key 那一种情况打了补丁 —— macOS 的 WKWebView 正是 Safari 的引擎。
   *
   * 上面那条测试永远碰不到这个：它自己把 compositionend 发全了。
   * 而漏掉一次的后果不是「这次组词出错」，是 live preview **从此**冻住 ——
   * 护栏只认 `view.compositionStarted`，那面旗只有 compositionend 能清。
   *
   * 所以这一条只发 compositionstart，然后照着「人接着往下打字」的样子走，
   * 看它能不能自己缓过来（判据见 `editor/compositionGuard.ts`）。
   */
  it("compositionend 没来：接着打字也能自己解冻，不会冻到换笔记", async () => {
    const view = mount("行内 $x$");
    await settle(250);
    view.focus();
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    await settle();

    // 组词开始 —— 之后**再也不发 compositionend**
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "啊" }),
    );
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "啊" },
      selection: EditorSelection.cursor(view.state.doc.length + 1),
    });
    await settle(300);
    // 这一刻护栏仍然该生效：CM 说在组词，而且刚刚才有过 composition 事件
    expect(view.compositionStarted, "CM 的旗应当还举着").toBe(true);
    expect(view.contentDOM.querySelector(".katex"), "组词期间不该切成渲染态").toBeNull();

    // 人接着正常打字：文档一直在变，但**不会再有 composition 事件**
    for (let i = 0; i < 8; i++) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "a" },
        selection: EditorSelection.cursor(view.state.doc.length + 1),
      });
      await settle(500);
    }

    // 旗还卡着（没人清得掉它），但 decoration 必须已经恢复更新
    expect(view.compositionStarted, "这一条测的正是旗卡住的情形").toBe(true);
    expect(
      view.contentDOM.querySelector(".katex"),
      "compositionend 漏发之后 live preview 冻住了 —— 这正是 Mac 上打中文的症状",
    ).not.toBeNull();
    expect(view.state.doc.toString()).toBe("行内 $x$啊aaaaaaaa");
  });
});
