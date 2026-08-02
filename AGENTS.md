# AGENTS.md

给在本仓库工作的 AI agent 的说明。人类读者请直接看 [DESIGN.md](DESIGN.md)。

## 这是什么

**Verso** —— 本地优先、排版考究、公式输入极快的笔记软件。Tauri 2 + React + CodeMirror 6，
纯 Markdown 文件存储。

**[DESIGN.md](DESIGN.md) 是唯一真源。** 动手前先读相关章节；实现与设计冲突时，
要么按设计改实现，要么先改设计再改实现 —— 不要让两者悄悄分叉。

## 版本号

格式 `vMAJOR.MINOR.PATCH`，例如 `v0.1.0`。

| 什么时候 | 怎么改 |
|---|---|
| 完成一个里程碑（M0/M1/M2…） | minor +1 |
| 里程碑内的修复、小改进 | patch +1 |
| 从后续里程碑提前拿来的功能 | patch +1，并在表里标注来源。**不要**占用后续里程碑的 minor 号 —— 那个映射关系比严格的语义化版本更有用 |
| 公开发布 | 由作者决定何时上 `v1.0.0`，agent 不要自作主张 |

里程碑与版本的对应：

| 里程碑 | 版本 |
|---|---|
| M0 地基 | `v0.1.0` ✅ |
| M1 编辑器 | `v0.2.0` ✅ |
| ↳ 内嵌终端（原属 M5，提前） | `v0.2.1` ✅ |
| ↳ vault git 分支改 main | `v0.2.2` ✅ |
| M2 公式 | `v0.3.0` ✅ |
| M3 索引与 database | `v0.4.0` ✅ |
| M4 打磨 | `v0.5.0` ✅ |
| ↳ 左侧图标栏 | `v0.5.1` ✅ |
| ↳ 改名 Folio → Verso | `v0.5.2` ✅ |
| ↳ 界面与正文渲染大修 | `v0.5.6` ✅ |
| ↳ 标题折叠 / 属性可编辑 | `v0.5.10` ✅ |
| ↳ 文档树排序（手动 + 规则） | `v0.5.13` ✅ |
| ↳ 拖动直接生效，不必先选手动排序 | `v0.5.14` ✅ |
| ↳ 关掉 Tauri 的 OS 层拖放，拖拽才真的能用 | `v0.5.15` ✅ |
| ↳ 外壳钉死：页面不滚、不橡皮筋 | `v0.5.16` ✅ |
| ↳ 侧栏头部重排、宽度可拖 | `v0.5.17` ✅ |
| ↳ 快捷键可改：命令表成唯一真源 | `v0.5.18` ✅ |
| ↳ 多标签页 | `v0.5.19` ✅ |
| ↳ 终端：`cd` 可用、配色可读 | `v0.5.20` ✅ |
| ↳ 标签可固定、标签栏等宽 | `v0.5.21` ✅ |
| ↳ 新建文档就地改名，不弹窗 | `v0.5.22` ✅ |
| ↳ 代码块：语法高亮、行号、复制 | `v0.5.23` ✅ |
| ↳ database 补齐列表 / 画廊 / 日历视图 | `v0.5.24` ✅ |
| ↳ 模板 | `v0.5.25` ✅ |
| ↳ 模板面板进侧栏 | `v0.5.26` ✅ |
| M5 同步 | `v0.6.0` |
| M6 移动端 | `v0.7.0` |
| M7 发布 | `v0.8.0` |

**版本号存在三个文件里，必须一致**（Tauri 不会帮你同步，不一致会做出版本号错乱的安装包）：

- `verso/package.json`
- `verso/src-tauri/Cargo.toml`
- `verso/src-tauri/tauri.conf.json`

别手改这三处，用脚本：

```bash
node scripts/version.mjs           # 查看当前版本，顺便检查三处是否一致
node scripts/version.mjs 0.2.0     # 三处一起改
```

### 每次改版本时必做

1. `node scripts/version.mjs <新版本>`
2. 在 [CHANGELOG.md](CHANGELOG.md) 顶部加一节，写清**用户能感知的变化**，不是 commit 流水账
3. 提交，然后打 tag：`git tag v0.2.0`

## 构建与测试

```bash
cd verso
pnpm install
pnpm tauri dev                 # 跑起来

cd src-tauri && cargo test     # Rust：树合并、frontmatter、重命名事务、路径越界
pnpm exec tsc --noEmit         # 前端类型检查
pnpm test                      # 前端（Node）：解析器、模糊匹配、snippet 匹配
pnpm test:browser              # 前端（真实 Chromium）：补全、live preview、database 视图
```

**提交前这四条都要过。** `pnpm test:all` 把后两条串起来跑。

### 什么时候必须写 browser 测试

`pnpm test` 跑在纯 Node 里，没有 DOM 也没有布局。凡是**依赖真实布局引擎**的
行为，它一律给不出答案，而且给的是**假阴性**（测试通过，应用里坏的）：

- CodeMirror 的补全（`autocompletion`）—— 没有布局时连显式 `startCompletion`
  都拿不到补全状态
- tooltip / 补全面板的定位与裁剪
- 块级 decoration 的**解析时序**（CM6 的语法解析是 view 建立后异步进行的）

这类东西写进 `src/**/*.browser.test.ts`，由 `vitest.browser.config.ts` 用
Playwright 拉真实 Chromium 跑。Tauri 在 Windows 上用的就是 WebView2（Chromium
内核），所以结论和应用里高度一致。

判断标准很简单：**如果一个函数单测通过、应用里却坏了，说明缺的是 browser
测试，不是更多单测。** `/` 命令菜单的 bug 就是这么找出来的（见下）。

### browser 测试也有它够不着的一层：Tauri 运行时

Playwright 起的是**干净的 Chromium**，Tauri 在它和网页之间加的那一层不在里面。
所以「浏览器里全绿、应用里没反应」这种事仍然可能发生，而且更难查 —— 前端代码
从头到尾都是对的。

已经栽过一次：**Tauri 默认在操作系统层接管拖放**（`dragDropEnabled` 默认 true），
webview 里的 `dragstart` / `drop` 根本收不到。tauri-utils 的 `config.rs` 原话是
「Disabling it is required to use HTML5 drag and drop on the frontend on Windows」。
文档树的拖拽移动和拖拽排序全靠 HTML5 拖放，于是这两个功能在真 app 里一直是
死的，而 5 条 browser 测试从头到尾全绿。

**要点：功能依赖浏览器和宿主之间的边界（拖放、剪贴板、文件、协议、窗口）时，
先去 `tauri.conf.json` 和 Tauri 的 config 文档确认一遍默认值。** 没法自动测的，
就在 `src/tauriConfig.test.ts` 里把配置钉住，并写清楚删掉它会坏什么。

还有更下面一层够不着的：**合成器**。弹性 overscroll（橡皮筋）直接把整页平移
再弹回来，`overflow` 和 `scrollTop` 都感知不到，headless 里根本不发生 ——
作者报「界面上下左右都能滑、还回弹」，我按 DOM 滚动查了一整轮，量到的布局
全是好的，因为布局本来就没错。这类只能钉声明（`pageScroll.browser.test.tsx`
钉的是 `overscroll-behavior`，不是行为）。

### App 级的 browser 测试要挂进 `#root`，走正常文档流

`position:fixed;inset:0` 的宿主容器等于给 App 罩了一层「绝对撑不开 body」的壳，
**所有页面级的溢出问题都会被完整屏蔽**。这条踩过：整个界面能被顶出视口，而
诊断测试一路全绿。照着 `index.html` 来：`<div id="root">`，别的什么都不加。

### ⚠️ 不要用 `cargo check`

这台机器开着 **Smart App Control**（`HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy`
的 `VerifiedAndReputablePolicyState = 1`），它会拦截新编译出的、没有信誉记录的
未签名可执行文件。

`cargo check` 与 `cargo build` 的 fingerprint 不同，会为 `libgit2-sys` 生成一个
**全新的** `build-script-build.exe`，随即被拦，报
「应用程序控制策略已阻止此文件 (os error 4551)」。

`cargo test` / `cargo build` 复用已经成功执行过的构建脚本产物，不受影响 ——
**用它们代替 `cargo check`**。若 `cargo clean` 之后连 build 也被拦，那才需要
跟作者讨论（关闭 Smart App Control 是不可逆的，关掉后不重装 Windows 就开不回来，
这个决定不该由 agent 做）。

**首次执行的拦截往往是临时的，先重试一次再下结论。** v0.5.3 改名后新生成的
`verso.exe` 第一次运行被拦（os error 4551），第二次就正常了 —— SAC 在向云端
查信誉期间会先拒绝。看到 4551 不要立刻断定"被永久封杀"，也不要因此去建议
关掉 SAC。

### 移动过项目目录之后，Rust 构建会报「系统找不到指定的路径」

Tauri 的构建脚本把**绝对路径**写进了 `target/debug/build/*/out`（权限清单
那些 `.toml`）。目录一改名，`cargo test` 就会去找旧路径，报
`failed to read plugin permissions ... (os error 3)`。

**不要用 `cargo clean` 解决**：那会连构建脚本的可执行文件一起删掉，重编译
出来的新二进制正是 Smart App Control 要拦的东西（见上一节），可能把构建
彻底卡死。

只删「输出目录」，保留已编译的 `build-script-build.exe`：

```powershell
cd verso\src-tauri
$out = Get-ChildItem target\debug\build -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'out') }
$out | Where-Object {
  Test-Path (Join-Path $_.FullName 'output')
} | Where-Object {
  Select-String -Path (Join-Path $_.FullName 'output') -Pattern '旧目录名' -Quiet
} | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
```

cargo 会用**现有的**构建脚本二进制重跑一遍，输出里的路径就对了。

另外 pnpm 的 `node_modules` 也是路径绑定的，改名后要
`CI=true pnpm install` 重装（非交互环境下它不敢自己清目录）。

### Windows 工具链的坑

Rust 是 scoop 装的，`RUSTUP_HOME` / `CARGO_HOME` 指向 scoop 的 persist 目录。
新终端会自动继承，但**装 scoop 包之前就已打开的终端不会** —— 那种情况下 `cargo`
会报 "could not choose a version of rustc to run"，或者干脆 "program not found"
（`pnpm tauri dev` 会以 `failed to run 'cargo metadata'` 的形式报出来）。补：

```powershell
$env:RUSTUP_HOME = 'D:\Scoop\persist\rustup-msvc\.rustup'
$env:CARGO_HOME  = 'D:\Scoop\persist\rustup-msvc\.cargo'
$env:Path = "D:\Scoop\apps\rustup-msvc\current\.cargo\bin;$env:Path"
```

### ⚠️ 不要截屏来验证 UI

**别写「抓屏幕上某块区域」的脚本。** 试过一次，`SetForegroundWindow` 没能把
Verso 提到前台（Windows 有前台锁，后台进程调它经常无效），于是抓到的是当时
盖在上面的另一个应用 —— 作者的微信聊天窗口。截图工具会拍到作者屏幕上任何
东西，这个风险不该由 agent 去承担。

要验证行为，用 `pnpm test:browser`：Playwright 起的是独立的 headless Chromium，
只画自己的页面，既能复现问题又碰不到屏幕上的任何东西。

如果确实需要看画面（比如调排版），请作者自己截图发过来。

另外记一笔历史教训：这台机器 DPI 缩放是 2×，`GetWindowRect` 返回逻辑坐标而
`PrintWindow` 按设备像素绘制。当初没先调 `SetProcessDpiAwarenessContext(-4)`，
位图开小了只截到左上角四分之一，**被我误判成「布局错乱」报给了作者**。
截图这条路既容易拍错东西，又容易看错东西。

## 不可动摇的东西

来自 DESIGN.md §0 与 §9。要突破任何一条，先跟作者确认，不要自行决定：

1. **用户数据永远能脱离本软件存在。** 纯 `.md`，记事本能读，拖进 Obsidian 能用。
   这条否决一切「内容进数据库」的方案。
2. **不做插件系统**（v1）。这正是 Obsidian 变丑变慢的原因。
3. **不自创 Markdown 语法。** 扩展只用 Obsidian 已有的那几种（见 §2.4）。
   每加一条自创语法就多欠一份可移植性的债。
4. **不内置 AI 功能。** 用户通过终端自带 AI CLI，我们不绑模型、不管 API key。
5. **不做笔记内容触发的代码执行。** 不要「代码块运行按钮」—— 笔记可被分享和发布，
   那等于把「打开一篇笔记」变成「运行一个陌生程序」。
6. **`.verso/` 必须可以整个删掉后重建。** 它只放派生数据。往里存唯一真源即为违规。

## 代码约定

- **注释用中文，写「为什么」不写「是什么」。** 代码本身说得清的不要重复。
  涉及设计决策的地方标注章节号，例如 `// §2.7 断电不能留下半个文件`。
- **Rust 结构体跨 IPC 时加 `#[serde(rename_all = "camelCase")]`** —— 前端用
  camelCase。`src/types.ts` 与 Rust 结构一一对应，改一边必须改另一边。
- **业务代码只依赖 `VaultFs` trait，不直接用 `std::fs`。** 移动端要靠它换实现（§1.2）。
- **任何来自前端的路径都要过 `Vault::resolve`**，它拒绝 `..` 和绝对路径。这是唯一的防线。
- **交互不能假设有键盘。** 只能用快捷键完成的操作，必须有等价的可点击入口 —— 移动端要用。

## 提交

- 一个提交做一件事，说明写清「为什么」
- 只在作者要求时提交或推送
- 不要跳过 hook（`--no-verify`）

## CodeMirror 6 的两条硬约束

写 live preview 时会撞上，先知道能省很多时间（`src/editor/livePreview.ts` 里有详解）：

1. **跨行的 replace decoration 和块级 decoration 都不能由 ViewPlugin 产出**，
   只能来自 StateField。报错是 `Decorations that replace line breaks may not be
   specified via plugins`。
2. 而「只扫 `view.visibleRanges`」的性能优化**只有 ViewPlugin 能做到**。

两者不可兼得，所以按是否跨行分工：跨行块级公式走 StateField（数量少，全文扫描
可接受），行内的一切走 ViewPlugin（只扫可视区）。

## 终端相关的三个坑

改 `src/components/TerminalPanel.tsx` / `src-tauri/src/pty.rs` 时会撞上。前两个
都表现为「面板打开但一片空白」且不报任何错：

1. **`term.onData` 必须在 `pty_open` 之前注册。** shell 启动时先发 DSR（`ESC[6n`），
   收到回答才打印提示符；xterm 的回答从 `onData` 出来，晚注册就丢了。
2. **不要在 `term.open()` 之后立刻 `fit()`。** 布局还没完成，算出 0 列 0 行。
   用 `ResizeObserver`，拿到真实尺寸再开 PTY。
3. **递给外部进程的路径要先过 `winpath::for_external`。** vault 根是
   `canonicalize()` 出来的，Windows 上那是 `\\?\D:\…`；PowerShell 拿它当 cwd
   之后会切进 provider 限定名状态，**每一次 `cd` 都报
   「the value of argument "path" is not valid」**，提示符还变成
   `Microsoft.PowerShell.Core\FileSystem::\\?\…`。同样适用于「在系统终端中打开」。

`cargo test` 里的 `pty::tests::shell_starts_and_echoes_back` 覆盖第 1 点、
`cd_works_from_a_canonicalized_cwd` 覆盖第 3 点，两个都自己扮演终端去应答 DSR。

**写这类 PTY 测试时先确认它会失败。** 第 3 点的测试第一版是「数标记词出现了
几次」，结果在没修的代码上照样通过 —— PSReadLine 会为了上色和补全把已经打进去
的那行反复重画，一条命令在流里出现三四遍，凑够次数太容易了。现在认的是「标记
后面**同一行**里带着那个临时目录名」，只有真正的输出才满足。

## 改 snippet 时必须知道的三件事

`src/editor/snippets/` 里的东西是这个项目的核心竞争力，改动前先读这三条：

1. **英文词形的触发词一定要带 `w`（词边界）。** 否则在公式里写 `point`
   会变成 `p\oint`、`print` 变成 `pr\int`。例外只有 `sr` `cb` `inv` `trn`
   这类**故意紧贴前一个 token** 的缩写（`xsr` → `x^{2}` 正是它们的用法）。
   `match.test.ts` 里有一条钉住 23 个常见标识符的回归测试。
2. **短触发词是长触发词的前缀时，短的必须放弃 `A`。** `pmat` 和 `pmat3x3`
   都自动展开的话，打到第 5 个字符就先炸了。改成 Tab 触发即可共存。
3. **数学模式检测是混合方案，不是纯语法树。** 正在输入中的公式没有闭合的
   `$`，语法树里根本没有 InlineMath 节点。见 `src/editor/mathContext.ts`
   的注释和 DESIGN.md §5.2。

## 改 CodeMirror 补全时必须知道的一件事

**自定义补全来源如果自己做了过滤，一定要返回 `filter: false`。**

CM6 会拿 `result.from` 到光标之间的**整段文本**去模糊匹配每个选项的 `label`，
在你的过滤之后再滤一遍。`/` 命令菜单的 `from` 指在 `/` 上，于是 CM6 拿
`"/标题"` 去匹配「一级标题」—— 因为多了个 `/` 而全部落空，表现是
**打 `/` 什么都不弹**。`[[` 补全没这毛病，纯属因为它的 `from` 指在 `[[` 之后。

关掉 CM6 的过滤之后 `validFor` 也必须去掉：`validFor` 会让它复用旧结果只做
本地过滤，而本地过滤已经关了，打字就不再收窄。选项只有十几条，每次重查
无所谓。

这个 bug 的教训写在上面「什么时候必须写 browser 测试」里：`slashSource`
自己的 10 个单测全过，因为它们直接调函数看返回值，**CM6 的二次过滤根本没
参与**。要覆盖这类问题，测试必须走真实的 `EditorView`。

## 改编辑器样式时必须知道的两件事

**1. CodeMirror 渲染到编辑器 DOM 之外的东西，`EditorView.theme` 够不到。**

补全面板、tooltip 这些默认是 `position: fixed`，挂在 `document.body` 下。
`EditorView.theme` 生成的规则带着编辑器根节点的作用域类名，对它们一条都
不生效 —— 必须写进 `styles.css`。

失效的表现很有迷惑性：面板字号看着是对的，那不是样式起作用，是它继承了
body 的字号恰好一样。真正露馅的是圆角、阴影全没有。而且全局 CSS 还要压过
CodeMirror 自带的基础主题（同特异度靠源码顺序决胜，而它注入得更晚），
类名写两三遍是最省事的办法。

**2. 别用负外边距把块"外扩"到正文栏之外。**

`margin: 0 -14px` 会让行盒比 `.cm-content` 宽，编辑器出现横向滚动条，而
**左侧色条恰好画在被推出可视区的那一段上** —— 表现是"竖线怎么调都看不见"，
极难联想到是宽度问题。`callout.browser.test.ts` 里有两条断言钉死它：
`.cm-scroller` 不许横向溢出，行盒左边缘不许越过 `.cm-content` 左边缘。

### 调这类细节时，量，不要盯着截图猜

这一节的两个 bug 都曾经被误判。整屏截图里分辨不出几个像素的圆角和色条，
而"看不见"有至少三种原因：没生效、太淡、被裁掉。**先量计算值，再改。**

两个趁手的办法：

- `visual.browser.test.tsx` 里有 2 倍放大的场景，专门看这类细节
- 拿不准就做**决定性实验**：把半径调到 24px、把颜色调成纯红，一次就能
  分清"规则没生效"和"值不够显眼"

## CodeMirror 的样式与几何：三个已经栽过的坑

1. **主题对象里同一个选择器只能出现一次。** 那是 JS 对象字面量，同名键后面
   的会把前面的**整个**覆盖掉。`.cm-line` 曾经被写了两处（一处 `padding: 0`、
   一处 `position: relative`），结果 padding 悄悄没了，还连累了一条不相干的
   测试。

2. **绝对定位的装饰别伸到 `.cm-content` 盒子外面。** 会被 `.cm-scroller` 整个
   裁掉，表现是「东西完全不显示」。要往左放东西（折叠箭头、色条），先给
   `.cm-content` 加左内边距腾地方，再用**普通 div** 的负外边距把正文挪回来 ——
   不要动 `.cm-line` 的外边距（见下）。

3. **`transform: rotate` 会把包围盒撑大。** 一个 16px 宽、跟行等高的容器旋转
   90° 之后，包围盒变成「行高那么宽」，向左多探出近十个像素 —— 视觉上看不出来
   （里面的图标很小且居中），但它真的伸出去了，然后被裁掉。**旋转里面的 svg，
   不要旋转容器。**

另外重申一条已经写在下面的：**行装饰不能用纵向 margin**，CodeMirror 的高度图
测的是盒高，margin 不计入，坐标反查会整体偏移一行。

### 这类问题：量，不要盯着截图猜

「看不见」至少有三种原因：样式没生效、太淡、被裁掉。三种的修法完全不同，而
截图分不出来。这一节的每一条都是先猜错了一两轮、最后靠把数字打出来才定位的 ——
`scroller / content / line / arrow` 的 `getBoundingClientRect` 一起 dump，
差值会直接指向原因。

`visual.browser.test.tsx` 里有 2 倍放大的场景，专门看几个像素量级的细节。

## 改设置相关代码时必须知道的三件事

1. **设置要写成 CSS 变量挂在 `<html>` 上，不要逐个组件传参。** 排版尺度散布
   在侧栏、编辑器、终端和各种浮层里，传参一定会漏。唯一的例外是 xterm ——
   它的配色和字体是 JS 对象，不参与级联，必须把变量的**计算值**读出来再给它
   （直接塞 `var(--term-font)` 会让它的字符宽度测量失败、整屏错位）。
2. **数值一律夹紧（clamp）而不是报错，`NaN` 单独挡一道。** 字号填成 0 之后，
   唯一能改回来的地方恰恰是那个已经看不见的设置界面。`NaN` 的所有比较都是
   `false`，普通范围检查穿得过去。Rust 和前端两边都要夹，且**范围必须一致**
   —— 不一致的话界面显示的和存下去的会是两个值。
3. **自定义 snippet 一条坏了不能连累其他。** 逐条校验，坏的跳过并报告。
   用户的表会有几百条，为第 87 条的拼写错误让前 86 条失效，等于让人在最熟的
   输入法上突然失去手感，还完全不知道为什么。

### database 视图的解析时序（已解决，别再动）

`viewBlock.ts` + `parseRefresh.ts`。曾经的症状是「打开笔记看到源码，点一下
才渲染」，根因是 `EditorState.create` 那一刻文档还没解析。现在的方案是用
ViewPlugin 监测语法树变化后派发 `parseAdvanced` effect 通知 StateField 重算，
`viewBlock.browser.test.ts` 的 5 个测试在真实 Chromium 里钉住了这个行为。

两条**已证伪**的思路不要重走 —— 它们会让视图彻底消失而不是晚出现，因为
StateField 的更新顺序不保证语言字段已就绪，读到空树就等于算出空 decoration 集：

1. 在 StateField 的 `update` 里比较 `syntaxTree(tr.state) !== syntaxTree(tr.startState)`
2. 在 `build()` 里用 `ensureSyntaxTree` 强制解析整篇

## 当前状态

**v0.4.2 — M3 索引与 database 已完成，`/` 菜单与视图渲染已确认正常。**
详见 [CHANGELOG.md](CHANGELOG.md) 与 [verso/README.md](verso/README.md)。

M2 的公式手感盲测已通过（作者手测），项目最大的风险点在那时就过去了。
默认 snippet 库仍在长期迭代，待办记在 DESIGN.md §5.4 的表里 —— 用到不顺手
随时可以动，但动之前先读上面「改 snippet 时必须知道的三件事」。

下一步是 **M5 同步**：`git2-rs` 集成、同步按钮与状态、自动 commit 聚合、
冲突解决 UI、凭据钥匙串、版本历史、未提交改动 diff 入口。验收是「两台桌面
设备改同一个 vault 不丢数据；用 AI 改完能一眼 diff、一键回退」。

M4 留下的一个尾巴：**macOS 的透明标题栏 + 交通灯留白没做**，因为需要在
真机上看红绿灯有没有压住侧栏内容，而这台开发机是 Windows。默认的原生
标题栏是安全的，不要凭想象改窗口装饰（DESIGN.md §6.5）。
