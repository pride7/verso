# AGENTS.md

给在本仓库工作的 AI agent 的说明。人类读者请直接看 [DESIGN.md](DESIGN.md)。

## 这是什么

**Folio** —— 本地优先、排版考究、公式输入极快的笔记软件。Tauri 2 + React + CodeMirror 6，
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
| M2 公式 | `v0.3.0` |
| M3 索引与 database | `v0.4.0` |
| M4 打磨 | `v0.5.0` |
| M5 同步与终端 | `v0.6.0` |
| M6 移动端 | `v0.7.0` |
| M7 发布 | `v0.8.0` |

**版本号存在三个文件里，必须一致**（Tauri 不会帮你同步，不一致会做出版本号错乱的安装包）：

- `folio/package.json`
- `folio/src-tauri/Cargo.toml`
- `folio/src-tauri/tauri.conf.json`

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
cd folio
pnpm install
pnpm tauri dev                 # 跑起来

cd src-tauri && cargo test     # Rust：树合并、frontmatter、重命名事务、路径越界
pnpm exec tsc --noEmit         # 前端类型检查
pnpm exec vitest run           # 前端：Markdown 解析器、模糊匹配
```

**提交前这三条都要过。**

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

### Windows 工具链的坑

Rust 是 scoop 装的，`RUSTUP_HOME` / `CARGO_HOME` 指向 scoop 的 persist 目录。
新终端会自动继承，但**装 scoop 包之前就已打开的终端不会** —— 那种情况下 `cargo`
会报 "could not choose a version of rustc to run"。补：

```powershell
$env:RUSTUP_HOME = 'D:\Scoop\persist\rustup-msvc\.rustup'
$env:CARGO_HOME  = 'D:\Scoop\persist\rustup-msvc\.cargo'
$env:Path = "D:\Scoop\apps\rustup-msvc\current\.cargo\bin;$env:Path"
```

### 截图验证 UI 时

这台机器 DPI 缩放是 2×。用 `PrintWindow` 截图前必须先调
`SetProcessDpiAwarenessContext(-4)`，否则 `GetWindowRect` 返回逻辑坐标而
`PrintWindow` 按设备像素绘制，位图开小了只能截到左上角四分之一 ——
会让完全正常的布局看起来像是错乱的。

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
6. **`.folio/` 必须可以整个删掉后重建。** 它只放派生数据。往里存唯一真源即为违规。

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

## 终端相关的两个坑

改 `src/components/TerminalPanel.tsx` 时会撞上，两者都表现为「面板打开但一片空白」
且不报任何错：

1. **`term.onData` 必须在 `pty_open` 之前注册。** shell 启动时先发 DSR（`ESC[6n`），
   收到回答才打印提示符；xterm 的回答从 `onData` 出来，晚注册就丢了。
2. **不要在 `term.open()` 之后立刻 `fit()`。** 布局还没完成，算出 0 列 0 行。
   用 `ResizeObserver`，拿到真实尺寸再开 PTY。

`cargo test` 里的 `pty::tests::shell_starts_and_echoes_back` 会覆盖第 1 点 ——
它自己扮演终端去应答 DSR。这个测试当初就是这么把 bug 抓出来的。

## 当前状态

**v0.2.1 — M1 编辑器 + 内嵌终端已完成。** 详见 [CHANGELOG.md](CHANGELOG.md) 与 [folio/README.md](folio/README.md)。

下一步是 **M2 公式输入**，也是**整个项目的成败点**：snippet 引擎、数学模式检测、
tabout、默认 snippet 库、符号面板。验收是盲测 ——「抄一页教材公式，比在 Obsidian
里快」。过不了就该停下来重新想，而不是继续往后做。

M1 已经把地基铺好了：`mathContextAt()`（`src/editor/index.ts`）走语法树判断光标
是否在公式内，正是 §5.2 要求的实现，M2 的 snippet 引擎直接用。
