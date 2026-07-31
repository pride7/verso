# Folio

本地优先、排版考究、公式输入极快的笔记软件。设计文档见 [../DESIGN.md](../DESIGN.md)。

当前进度：**M0 地基**。

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
cd src-tauri && cargo test    # vault 逻辑：同名文件夹合并、frontmatter、路径越界
pnpm exec tsc --noEmit        # 前端类型检查
```

## M0 做了什么

| | 对应设计 |
|---|---|
| `VaultFs` 抽象（桌面 `std::fs` 实现） | §1.2 —— 移动端可以晚做，但文件层不能写死 |
| 同名文件夹文档树（`X.md` + `X/` 合并成一个节点） | §2.1 |
| 原子写入（`.tmp` → fsync → rename） | §2.7 —— 断电不留半个文件 |
| frontmatter 解析（ULID `id`、时间戳） | §2.3 |
| 打开 vault 时 `git init` + `.gitignore` | §2.8 |
| 路径越界拒绝（`resolve` 拒 `..`） | 前端传来的路径不可信 |
| 窗口聚焦时比对 mtime，检测外部修改 | §7.4 —— 用 AI 改完文件回来不能覆盖掉它 |

## M0 没做（有意的）

- 编辑器就是个 `<textarea>`。CodeMirror 6 + live preview 是 **M1**（§4）
- 没有搜索、没有索引、没有反向链接 —— **M3**
- 没有公式渲染 —— **M2**，也是整个项目的成败点
- 重命名、移动、删除节点还没做 —— §2.1 那张表列了全部边界情况，M1 补

## 目录

```
src-tauri/src/
├── error.rs          错误类型 + 序列化给前端
├── lib.rs            Tauri command 注册
└── vault/
    ├── fs.rs         VaultFs trait + DesktopFs
    ├── tree.rs       同名文件夹合并（含 FakeFs 单测）
    ├── note.rs       frontmatter 解析与序列化
    ├── git.rs        git init + .gitignore
    └── mod.rs        Vault：resolve / read / write / create

src/
├── api.ts            IPC 封装
├── types.ts          与 Rust 结构对应（改一边记得改另一边）
├── App.tsx           状态、自动保存、外部修改检测
├── styles.css        §6 排版与配色的基础部分
└── components/
    ├── Tree.tsx
    └── Editor.tsx
```
