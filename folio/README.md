# Folio

本地优先、排版考究、公式输入极快的笔记软件。设计文档见 [../DESIGN.md](../DESIGN.md)。

当前进度：**M1 编辑器**（v0.2.0）。

## 跑起来

```bash
pnpm install
pnpm tauri dev
```

### Windows 工具链的坑

Rust 是用 scoop 装的，它把 `RUSTUP_HOME` / `CARGO_HOME` 指向了自己的 persist 目录。
**新开的终端会自动继承，但安装 scoop 包之前就已经打开的终端不会** —— 那种情况下
`cargo` 会找不到工具链，报 "could not choose a version of rustc to run"。

手动补：

```powershell
$env:RUSTUP_HOME = 'D:\Scoop\persist\rustup-msvc\.rustup'
$env:CARGO_HOME  = 'D:\Scoop\persist\rustup-msvc\.cargo'
$env:Path = "D:\Scoop\apps\rustup-msvc\current\.cargo\bin;$env:Path"
```

| 组件 | 位置 |
|---|---|
| Rust 1.97.1（scoop `rustup-msvc`） | `D:\Scoop\persist\rustup-msvc\` |
| MSVC v14.44 生成工具 | `D:\Programs\VSBuildTools` |
| Windows SDK 10.0.26100 | `C:\Program Files (x86)\Windows Kits`（微软写死，改不了） |

## 测试

```bash
cd src-tauri && cargo test    # vault 逻辑：树合并、frontmatter、重命名事务、路径越界
pnpm exec tsc --noEmit        # 前端类型检查
pnpm exec vitest run          # Markdown 解析器、模糊匹配
```

**不要用 `cargo check`** —— Smart App Control 会拦它新生成的构建脚本二进制。
原因见 [../AGENTS.md](../AGENTS.md)。

## 快捷键

| | |
|---|---|
| `Ctrl+P` | 快速跳转到笔记 |
| `Ctrl+/` | 符号面板（中文可搜：「积分」「叉乘」「属于」） |
| `Tab` | 公式里：下一个跳转点 → tabout 跳出括号；非自动 snippet 展开 |
| `Shift+Tab` | 退回 snippet 起点 |
| `Ctrl+S` | 立即保存（平时会自动保存） |
| ``Ctrl+` `` | 开关底部终端面板（用来跑 AI CLI）。侧栏终端按钮**右键** = 调起独立的系统终端窗口 |
| 右键文档树节点 | 新建子文档 / 重命名 / 移到顶层 / 删除 |
| 拖拽文档树节点 | 移动到另一个文档之下 |

## 已完成

**M0 地基**（v0.1.0）

| | 对应设计 |
|---|---|
| `VaultFs` 抽象（桌面 `std::fs` 实现） | §1.2 —— 移动端可以晚做，但文件层不能写死 |
| 同名文件夹文档树（`X.md` + `X/` 合并成一个节点） | §2.1 |
| 原子写入（`.tmp` → fsync → rename） | §2.7 —— 断电不留半个文件 |
| frontmatter 解析（ULID `id`、时间戳） | §2.3 |
| 打开 vault 时 `git init` + `.gitignore` | §2.8 |
| 路径越界拒绝（`resolve` 拒 `..`） | 前端传来的路径不可信 |
| 窗口聚焦时比对 mtime，检测外部修改 | §7.4 —— 用 AI 改完文件回来不能覆盖掉它 |

**M1 编辑器**（v0.2.0）

| | 对应设计 |
|---|---|
| `markdownExtended` 解析器（公式/链接/嵌入/标签/高亮/callout） | §2.4、§5.2 |
| Live preview：光标移开渲染、移进露源码 | §4.2 |
| KaTeX 渲染 + LRU 缓存 | §4.2、§5.3 |
| frontmatter 属性条 | §2.3 |
| 快速切换器 `Ctrl+P`（本地模糊匹配） | §2.2 |
| 可点击面包屑、`[[链接]]` 跳转 | §2.2 |
| 重命名/移动/删除（含事务与边界情况） | §2.1 |
| `Ctrl+\`` 在系统终端打开 | §7.3 |

**M2 公式快速输入**（v0.3.0）

| | 对应设计 |
|---|---|
| snippet 引擎（Latex Suite 兼容格式） | §5.1 |
| 数学模式检测（语法树 + 计数的混合方案） | §5.2 |
| 跳转点、tabout、Tab 触发的非自动 snippet | §5.1 |
| 135 条默认库、矩阵按尺寸生成 | §5.4、§5.3 |
| 符号面板 `Ctrl+/`，中文可搜 | §5.3 |

⚠️ M2 的验收是**人来做的盲测**：抄一页教材公式，比在 Obsidian 里快。
测试单见 `test-vault/数学/公式手感盲测.md`。

## 还没做

- 搜索、索引、反向链接、database 视图 —— **M3**
- callout 外观、代码块语言高亮、图片嵌入 —— **M4**
- git 同步、内嵌终端 —— **M5**；移动端 —— **M6**；发布 —— **M7**

## 目录

```
src-tauri/src/
├── error.rs          错误类型 + 序列化给前端
├── lib.rs            Tauri command 注册
├── recent.rs         记住上次的 vault 与笔记
├── terminal.rs       在系统终端中打开（§7.3 方案 A）
└── vault/
    ├── fs.rs         VaultFs trait + DesktopFs
    ├── tree.rs       同名文件夹合并（含 FakeFs 单测）
    ├── note.rs       frontmatter 解析与序列化
    ├── ops.rs        重命名/移动/删除，§2.1 的边界情况
    ├── git.rs        git init + .gitignore
    └── mod.rs        Vault：resolve / read / write / create

src/
├── api.ts            IPC 封装
├── types.ts          与 Rust 结构对应（改一边记得改另一边）
├── App.tsx           状态、自动保存、快捷键、外部修改检测
├── styles.css        §6 排版与配色的基础部分
├── editor/
│   ├── index.ts            CM6 组装
│   ├── mathContext.ts      数学模式检测（§5.2 的混合方案）
│   ├── markdownExtended.ts Markdown 方言解析器
│   ├── livePreview.ts      两层 decoration 引擎
│   ├── widgets.ts          KaTeX widget
│   ├── theme.ts            §6 排版落到编辑器
│   └── snippets/           ← 项目的核心竞争力，改前先读 AGENTS.md
│       ├── types.ts        Snippet 模型与选项标志
│       ├── match.ts        触发词匹配、展开、tabout（纯函数）
│       ├── defaults.ts     135 条默认库
│       ├── tabstops.ts     跳转点状态
│       └── index.ts        CM6 接线（transactionFilter + Tab 键）
├── lib/fuzzy.ts      快速切换器的模糊匹配
└── components/
    ├── Tree.tsx      文档树（右键菜单、拖拽）
    ├── Editor.tsx    CM6 的 React 宿主
    ├── Properties.tsx frontmatter 属性条
    ├── QuickSwitcher.tsx
    └── ErrorBoundary.tsx
```
