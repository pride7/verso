/**
 * 代码块的围栏隐藏。光标在外面时 ``` 该消失 —— 和 `#`、`**`、`>`
 * 那些标记一样，这是 live preview 的统一规则。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./index";
import { applySettings, DEFAULT_SETTINGS } from "../settings";
import "../styles.css";

const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

/** 光标默认放在文末，不碰被测的块 */
function mount(doc: string) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  parent.style.cssText = "position:fixed;inset:0";
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    selection: { anchor: doc.length },
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
      sourceMode: false,
    }),
  });
  views.push(view);
  return view;
}

const settle = () => new Promise((r) => setTimeout(r, 250));
const DOC = "正文\n\n```rust\nfn main() {}\n```\n\n结尾";

describe("代码块围栏", () => {
  it("光标在外面时围栏藏起来", async () => {
    const v = mount(DOC);
    await settle();
    const shown = v.contentDOM.innerText;
    expect(shown).toContain("fn main() {}");
    expect(shown).not.toContain("```");
    // 语言标注也一起藏掉
    expect(shown).not.toContain("rust");
  });

  it("光标进去就露出源码", async () => {
    const v = mount(DOC);
    await settle();
    v.dispatch({ selection: { anchor: DOC.indexOf("fn main") } });
    await settle();
    const shown = v.contentDOM.innerText;
    expect(shown).toContain("```rust");
    expect(shown).toContain("fn main() {}");
  });

  it("移开又藏回去", async () => {
    const v = mount(DOC);
    await settle();
    v.dispatch({ selection: { anchor: DOC.indexOf("fn main") } });
    await settle();
    v.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(v.contentDOM.innerText).not.toContain("```");
  });

  // 正在敲一个新代码块时，围栏还没闭合。这时藏掉半个会很怪
  it("围栏没闭合时不藏", async () => {
    const doc = "正文\n\n```rust\nfn main() {}";
    const v = mount(doc);
    // 光标放开头，确保不是因为"碰到了"才显示
    v.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(v.contentDOM.innerText).toContain("```");
  });

  it("底色仍然覆盖整块", async () => {
    const v = mount("正文\n\n```rust\na\nb\nc\n```\n\n结尾");
    await settle();
    const lines = v.dom.querySelectorAll<HTMLElement>(".cm-code");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) {
      expect(getComputedStyle(l).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  it("database 视图那种代码块不受影响", async () => {
    const v = mount('正文\n\n```verso-view\nfrom: "*"\n```\n\n结尾');
    await settle();
    // 它整块交给 viewBlock 渲染，这里不该给它加底色
    expect(v.dom.querySelector(".cm-code")).toBeNull();
  });
});
