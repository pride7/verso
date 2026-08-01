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

  // 藏了围栏之后，只有一行内容的块会整个塌成**一个**可视行，
  // 而合并后只有开头那份行装饰活着 —— 它要一个人担起上下两头的圆角
  it("只有一行内容时上下都是圆角", async () => {
    const v = mount("正文\n\n```python\ndef f(): pass\n```\n\n结尾");
    await settle();
    const rows = [...v.dom.querySelectorAll<HTMLElement>(".cm-code")];
    expect(rows.length).toBe(1);
    const s = getComputedStyle(rows[0]);
    expect(s.borderTopLeftRadius).toBe(s.borderBottomLeftRadius);
    expect(s.borderTopRightRadius).toBe(s.borderBottomRightRadius);
    expect(parseFloat(s.borderBottomLeftRadius)).toBeGreaterThan(0);
    // 内边距同理：少了下面那半截，文字会贴着块的下沿
    expect(s.paddingBottom).toBe(s.paddingTop);
    expect(parseFloat(s.paddingBottom)).toBeGreaterThan(0);
  });

  it("database 视图那种代码块不受影响", async () => {
    const v = mount('正文\n\n```verso-view\nfrom: "*"\n```\n\n结尾');
    await settle();
    // 它整块交给 viewBlock 渲染，这里不该给它加底色
    expect(v.dom.querySelector(".cm-code")).toBeNull();
  });
});

/**
 * 语法高亮。**必须在真实浏览器里测** —— 嵌套语言是异步 import 进来的，
 * 树变了才重新上色，纯 Node 里连解析都跑不完整。
 */
describe("代码块语法高亮", () => {
  it("认得出 python 的关键字", async () => {
    const v = mount("正文\n\n```python\ndef f(x):\n    return x\n```\n\n结尾");
    // 语言包是动态 import 的，比其他渲染晚一拍
    await new Promise((r) => setTimeout(r, 800));
    const kw = [...v.contentDOM.querySelectorAll("span")].filter((s) => s.textContent === "def");
    expect(kw.length).toBe(1);
    // 上了色才算高亮 —— 只切出 token 不改颜色等于没做
    expect(getComputedStyle(kw[0]).color).not.toBe(getComputedStyle(v.contentDOM).color);
  });

  // 高亮色是 CSS 变量，深色一套单独配。变量的转接漏一行不会报错，
  // 只是深底上出现一片压暗的颜色 —— 眼睛在缩略图上分不出来，得量
  it("深色主题下换成另一套颜色", async () => {
    const doc = "正文\n\n```python\ndef f(x):\n    return x\n```\n\n结尾";
    const v = mount(doc);
    await new Promise((r) => setTimeout(r, 800));
    const kw = () =>
      getComputedStyle(
        [...v.contentDOM.querySelectorAll("span")].find((s) => s.textContent === "def")!,
      ).color;
    const light = kw();
    document.documentElement.setAttribute("data-theme", "dark");
    const dark = kw();
    document.documentElement.removeAttribute("data-theme");
    expect(dark).not.toBe(light);
    // 深色版必须更亮，否则在深底上等于看不见
    const lum = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).reduce((a, b) => a + Number(b), 0);
    expect(lum(dark)).toBeGreaterThan(lum(light));
  });

  it("语言标注不认识时不报错，仍然是等宽的一块", async () => {
    const v = mount("正文\n\n```不存在的语言\nabc\ndef\n```\n\n结尾");
    await settle();
    expect(v.contentDOM.innerText).toContain("abc");
    expect(v.dom.querySelectorAll(".cm-code").length).toBeGreaterThanOrEqual(2);
  });
});

describe("代码块行号", () => {
  const THREE = "正文\n\n```python\na = 1\nb = 2\nc = 3\n```\n\n结尾";

  it("内容行从 1 开始编号，围栏行不占号", async () => {
    const v = mount(THREE);
    await settle();
    const nums = [...v.dom.querySelectorAll<HTMLElement>(".cm-code[data-ln]")].map(
      (l) => l.dataset.ln,
    );
    // 围栏藏起来时首行围栏和第一行代码合成一个可视行，两边都挂着「1」，
    // 所以这里是 1,1,2,3 而不是 1,2,3 —— 关键是**渲染出来的号码**连续
    expect(nums.filter((n, i) => i === 0 || n !== nums[i - 1])).toEqual(["1", "2", "3"]);
  });

  it("光标进块之后号码不跳", async () => {
    const v = mount(THREE);
    await settle();
    v.dispatch({ selection: { anchor: THREE.indexOf("b = 2") } });
    await settle();
    const rows = [...v.dom.querySelectorAll<HTMLElement>(".cm-code")];
    // 围栏露出来了，它们不该有号
    const fences = rows.filter((r) => r.textContent?.includes("```"));
    expect(fences.length).toBe(2);
    for (const f of fences) expect(f.dataset.ln).toBeUndefined();
    expect(rows.filter((r) => r.dataset.ln).map((r) => r.dataset.ln)).toEqual(["1", "2", "3"]);
  });

  it("只有一行内容就不编号", async () => {
    const v = mount("正文\n\n```bash\npnpm i\n```\n\n结尾");
    await settle();
    expect(v.dom.querySelector(".cm-code[data-ln]")).toBeNull();
  });

  it("行号不进正文的可选内容", async () => {
    const v = mount(THREE);
    await settle();
    // 生成内容不该被算进 innerText，否则框选复制会带上号码
    expect(v.contentDOM.innerText).not.toContain("1a = 1");
  });
});

describe("代码块复制按钮", () => {
  const DOC2 = "正文\n\n```python\na = 1\nb = 2\n```\n\n结尾";

  it("每个块一个按钮，光标在外在内都有", async () => {
    const v = mount(DOC2);
    await settle();
    expect(v.dom.querySelectorAll(".cm-code-copy").length).toBe(1);
    v.dispatch({ selection: { anchor: DOC2.indexOf("a = 1") } });
    await settle();
    expect(v.dom.querySelectorAll(".cm-code-copy").length).toBe(1);
  });

  it("点了把代码放进剪贴板，不含围栏", async () => {
    const v = mount(DOC2);
    await settle();
    let copied = "";
    // 无头环境里没有剪贴板权限，桩掉它 —— 这里要验的是「递过去的是什么」
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t: string) => {
          copied = t;
          return Promise.resolve();
        },
      },
    });
    const btn = v.dom.querySelector<HTMLElement>(".cm-code-copy")!;
    btn.click();
    await settle();
    expect(copied).toBe("a = 1\nb = 2");
    expect(btn.dataset.state).toBe("done");
  });

  it("按钮不越出正文栏", async () => {
    const v = mount(DOC2);
    await settle();
    const btn = v.dom.querySelector<HTMLElement>(".cm-code-copy")!.getBoundingClientRect();
    const content = v.contentDOM.getBoundingClientRect();
    // 越出去就会被 .cm-scroller 裁掉，表现是「按钮时有时无」
    expect(btn.right).toBeLessThanOrEqual(content.right + 0.5);
    expect(btn.left).toBeGreaterThanOrEqual(content.left - 0.5);
  });
});
