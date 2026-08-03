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
| 里程碑被拆成两段（如 M5a/M5b） | 每段各占一个 minor，后面的里程碑顺延。**拆之前先确认前一段自己立得住** —— 它得有自己的验收标准，而不是「做了一半」 |
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
| ↳ 模板的默认键位 | `v0.5.27` ✅ |
| ↳ 思维导图（大纲的图形编辑视图） | `v0.5.28` ✅ |
| ↳ 项目日志：追加进展 + 旧的自动折起 | `v0.5.29` ✅ |
| ↳ 列表视图：属性挪到标题右边 | `v0.5.30` ✅ |
| ↳ 修属性条：箭头换行、tags 被数两遍 | `v0.5.31` ✅ |
| ↳ 视觉收敛：颜色只做重音 | `v0.5.32` ✅ |
| ↳ 简洁不等于褪色：淡彩底 + 中西文间距 | `v0.5.33` ✅ |
| ↳ 内置属性名显示成中文 | `v0.5.34` ✅ |
| ↳ 去掉「加一列」里那句多余的解释 | `v0.5.35` ✅ |
| ↳ 表格列宽可拖 | `v0.5.36` ✅ |
| ↳ 点列头弹菜单，不再一点就排序 | `v0.5.37` ✅ |
| ↳ 修：定宽表格把列头菜单裁掉了 | `v0.5.38` ✅ |
| ↳ 列头菜单带图标，改成 fixed 定位 | `v0.5.39` ✅ |
| ↳ 列宽拖杆对齐到列边界 | `v0.5.40` ✅ |
| ↳ 表头那一块和下面对齐 | `v0.5.41` ✅ |
| ↳ `/` 菜单可自定义 | `v0.5.42` ✅ |
| ↳ 自动记版本 + 状态栏那个点 | `v0.5.43` ✅ |
| ↳ 版本说明说得出「哪一篇」 | `v0.5.44` ✅ |
| ↳ 侧栏里翻历史、单篇回退 | `v0.5.45` ✅ |
| ↳ 关软件之前先落盘再记一版 | `v0.5.46` ✅ |
| **M5a 本地版本历史**（上面四步攒成） | **`v0.6.0`** ✅ |
| ↳ 远端：配地址 + 一个同步按钮 | `v0.6.1` ✅ |
| M5b 远端同步（差冲突 UI） | `v0.7.0` |
| ↳ 窄屏布局：侧栏变抽屉（M6 提前） | `v0.6.2` ✅ |
| ↳ 移动端公式工具条（§5.5） | `v0.6.3` ✅ |
| ↳ 文档图标（frontmatter `icon`，§2.3） | `v0.6.13` ✅ |
| ↳ 桌面自动更新 + 发布流水线（原属 M7，提前，§2.11） | `v0.6.14` ✅ |
| ↳ 行内格式快捷键：Ctrl+B 加粗等（§4.8） | `v0.6.15` ✅ |
| ↳ 修：「文件已被外部程序修改」点不掉 | `v0.6.16` ✅ |
| ↳ 渲染好的表格上直接插行插列（§4.9） | `v0.6.17` ✅ |
| ↳ 视觉收敛：科研感的中性层级与薄纸片标签 | `v0.6.18` ✅ |
| ↳ 设置面板重排、中文提示收敛 | `v0.6.19` ✅ |
| ↳ 表格单元格就地编辑，Tab/Enter 走格（§4.9） | `v0.6.20` ✅ |
| ↳ `---` 分割线渲染成水平线 | `v0.6.21` ✅ |
| ↳ 当前改动与历史版本逐行对比（§2.8） | `v0.6.22` ✅ |
| ↳ 表格行列操作入口、菜单与列宽拖动（§4.9） | `v0.6.23` ✅ |
| ↳ 记录并快速切换仓库（§2.1） | `v0.6.24` ✅ |
| ↳ 大纲用紧凑等级圆点显示 H1–H6（§6.3） | `v0.6.25` ✅ |
| ↳ 公式补全与斜杠菜单改用可编辑表格（§4.3 / §6.4） | `v0.6.26` ✅ |
| ↳ 正文段落节奏：显式回车与自动折行分层（§6.1） | `v0.6.27` ✅ |
| ↳ 修：行距与段距独立可调、段首光标对齐、Shift+Enter（§6.1） | `v0.6.28` ✅ |
| ↳ 有序列表删除后自动重排编号（§4.3） | `v0.6.29` ✅ |
| M6 移动端 | `v0.8.0` |
| M7 发布 | `v0.9.0` |

**版本号存在四个文件里，必须一致**（Tauri 不会帮你同步，不一致会做出版本号错乱的安装包）：

- `verso/package.json`
- `verso/src-tauri/Cargo.toml`
- `verso/src-tauri/tauri.conf.json`
- `verso/src-tauri/Cargo.lock`（`[[package]] name = "verso"` 那一段）

**`Cargo.lock` 要进版本库。** Rust 的规矩是二进制 crate 提交、库不提交，
Verso 是桌面应用。漏改它的话，下一次 `cargo` 跑起来会自己改掉，那一行 diff
就飘到后面某个不相干的提交里 —— 脚本已经把这一处一起管了。

别手改这三处，用脚本：

```bash
node scripts/version.mjs           # 查看当前版本，顺便检查三处是否一致
node scripts/version.mjs 0.2.0     # 三处一起改
```

### 每次改版本时必做

1. `node scripts/version.mjs <新版本>`
2. 在 [CHANGELOG.md](CHANGELOG.md) 顶部加一节，写清**用户能感知的变化**，不是 commit 流水账。
   **这一节会原样变成 release 正文，也就是用户在「检查更新」里读到的那段话**
   （`scripts/release-notes.mjs` 按 `## v0.6.14 —` 这个标题格式取，格式改了它就找不到）
3. 提交，然后打 tag：`git tag v0.2.0`

## 发布（§2.11）

推 tag 触发 [.github/workflows/release.yml](.github/workflows/release.yml)：编 Windows /
macOS(arm+intel) / Linux 四份桌面包 + 安卓 arm64 APK，传到一个**草稿** release，
最后由 finalize job 在正文末尾追加「下载哪一个」对照表（追加发生在 `latest.json`
上传之后，应用内「检查更新」读到的还是干净的更新日志）。
**不要改成给资产改名**：`latest.json` 记的是原始下载地址，资产一改名，
自动更新当场 404 —— 平台标注只能走正文对照表这条路。

```bash
node scripts/version.mjs 0.6.14
# 写 CHANGELOG，提交
# 这里两条都要。`--follow-tags` **只推带注释的 tag**，而这个仓库用的是轻量
# tag（`git tag v0.6.14`）—— 只推 main 的话 CI 根本不会触发，而且没有任何报错
git push && git push origin v0.6.14
# 十几分钟后去 GitHub 上检查那个草稿，确认没问题再点 Publish
```

**点 Publish 之前没有任何用户会更新到这一版** —— 客户端读的是
`releases/latest/download/latest.json`，那个地址只认已发布、非预发布的 release。

六件必须知道的事：

1. **`~/.tauri/verso.key` 是不可再生的。** 更新包用它签名，公钥编在
   `tauri.conf.json` 里。这把私钥丢了，所有已经装出去的客户端就**永远**收不到
   更新了 —— 只能重新发一个换了公钥的包，然后指望每个用户手动去装一次。
   备份它，同时它必须存在于 GitHub secret `TAURI_SIGNING_PRIVATE_KEY` 里
   （私钥文件的**内容**）。

   **密码不是 secret，是 workflow 里写死的空串**，这一条踩过：这把密钥没有
   密码，而 Windows 的 PowerShell 里 `gh secret set X --body ""` 会把**字面的
   两个引号**存进去。报出来的错是 `failed to decode secret key: incorrect
   updater private key password: Wrong password for that key` —— 编译跑满
   七分钟才到那一步，而错误信息看不出和引号有任何关系。
   顺带：那一行也**不能删**，删了 Tauri 会交互式地问密码，CI 里表现成 job 卡死。
2. **本地打桌面包现在要先给环境变量**，否则 `tauri build` 会因为「有公钥没私钥」
   直接失败（`createUpdaterArtifacts` 打开着）：

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\verso.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   ```

   安卓不受影响（updater 是 target 依赖，那边根本没编进去）。
3. **updater / process 的权限写在
   [capabilities/desktop.json](verso/src-tauri/capabilities/desktop.json)，
   带 `platforms` 字段。** 别顺手挪进 `default.json` —— 那样
   `tauri android build` 会在 ACL 解析阶段报「找不到 updater:default」，
   而那条错误看不出和自动更新有任何关系。`tauriConfig.test.ts` 钉住了这一点。
4. **macOS 上 git2 的 `https` 要 OpenSSL**，所以那个 target 单独开了
   `vendored-openssl`（从源码编）。Cargo.toml 里原来写着「macOS 走
   Security.framework」—— 是错的，第一次跑 CI 就撞上
   `Could not find directory of OpenSSL installation`。Homebrew 装的那份也不行：
   CI 要在 arm64 机器上顺带产出 x86_64 的包，而 brew 只有本机架构那一份。
5. **macOS 那两个包没签名也没公证**，Gatekeeper 会拦。要等有 Apple 开发者账号。
   CI 里那两个 job 编得出来，但装的人得手动放行。
6. **安卓的签名靠四个 GitHub secret**，来源都在这台开发机上：
   `ANDROID_KEYSTORE_B64`（`~/.verso-signing/verso-release.jks` 的 base64）、
   `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`
   （抄自 `verso/src-tauri/gen/android/keystore.properties`，那个文件被
   .gitignore 挡着）。这把 jks 和 `verso.key` 一样**不可再生** —— 丢了就只能
   换签名重发，已装的用户无法覆盖升级。secrets 没配时 CI 不会失败，只是产出
   **未签名的 APK（装不上）**并打一条 warning。给已发布的版本补 APK 用
   `gh workflow run release.yml -f tag=v0.6.21 -f only=android` —— 只跑安卓
   那一半，不会因为桌面包重传同名资产而失败。

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

### 移动端的按钮：`onPointerDown` 里必须 `preventDefault`

工具条、浮动按钮这类**点了之后焦点应当留在编辑器里**的控件，按下时不拦住
默认行为的话，浏览器会把焦点挪到按钮上 —— 真机上的后果是**软键盘收起、
光标位置丢失**，用户点一个符号的代价是键盘弹上弹下一轮。

桌面上完全看不出来（焦点回不回来无所谓，没有软键盘），所以这类问题只能靠
「写的时候就知道」来防。`components/MathBar.tsx` 里每一个按钮都加了。

### 安卓：libgit2 会拒绝共享存储里的仓库

`repository path '/storage/emulated/0/Verso' is not owned by current user;
class=Config (7); code=Owner (-36)` —— git 的 dubious-ownership 保护
（CVE-2022-24765）。安卓共享存储是一层 FUSE，它合成出来的属主和进程 uid
对不上，于是**那里的仓库必然被判成别人的**。

症状极具迷惑性：`Repository::init` 会成功（`.git/` 建得出来、内容齐全），
下一次**打开**它才失败 —— 看起来像「目录写了一半」「权限给了一半」，
会把人往存储权限的方向带很远。

解法是 `git2::opts::set_verify_owner_validation(false)`，**只在安卓上关**
（桌面那里的属主检查是真的安全边界）。见 `vault/git.rs` 的 `relax_owner_check`。

### 手机上没有日志就等于瞎猜

这一轮连着发了三个坏包，根因都是「失败被吞掉了」：`vault_reopen_last`
返回 `Option`，失败就是一个 None，手机上既没有终端也看不到原因。

两条现在都接好了，改移动端代码时别再拆掉：

1. **失败要走到界面上。** Rust 侧的非致命提示走 `index:error` 事件 ——
   注意它以前**发了但前端根本没人监听**，等于不存在（`onBackendNotice`）。
2. **同时 `eprintln!` 一份**。Tauri 把 stdout/stderr 接到 logcat 的
   `RustStdoutStderr`，`adb logcat -d | grep verso]` 一抓就到。上面那条
   owner 错误就是这么找到的，在那之前我猜了三轮全错。

**手机连 USB 打开调试之后**，整个循环是：`scripts/android-apk.ps1` →
`adb install -r <apk>` → `adb logcat -c` → `adb shell am start -n
app.verso.desktop/.MainActivity` → `adb logcat -d | grep`。比让作者手动传包
装包快一个数量级。**别用 `adb exec-out screencap` 去看界面** —— 那是作者
正在用的私人手机，截到的可能是任何东西；要验证就查文件系统。

### 手机上「界面在那儿但点不动」的两种成因

真机上第一次跑就撞到了，而两种在截图里都完全看不出来：

1. **系统栏压在界面上。安卓上这件事 CSS 修不好。**
   `env(safe-area-inset-*)` 在安卓 WebView 里**只反映挖孔/刘海，不含系统栏** ——
   照着 iOS 的经验写 `padding-top: env(safe-area-inset-top)` 会得到 0，
   而人会以为是媒体查询没生效、DPR 算错之类（我为此白改了两版）。
   安卓 15 起 `setDecorFitsSystemWindows(true)` 也已失效，只能在
   `MainActivity` 里听 `WindowInsetsCompat` 给内容视图加内边距 ——
   见 `fitSystemBars()`。底部记得取「手势条」和「输入法」的较大者，
   否则软键盘会盖住光标。
2. **浮层盖住了本该能点的东西。** 抽屉的遮罩 `inset: 0` 会连图标栏一起盖住 ——
   而图标栏是手机上唯一的导航。那一竖排图标看得见、点下去却只是关抽屉。

第 2 类只有**命中测试**抓得到：`document.elementFromPoint(x, y)` 拿到的是不是
你以为的那个元素。查 z-index、查类名、看截图，三者都会告诉你「没问题」。
`mobile.browser.test.tsx` 里有一条照着写。

### 安卓 release 包：见过一次没能复现的原生崩溃

v0.6.13 的 release APK 装上后第一次启动，约 6 秒时崩了一次：

```
F libc: FORTIFY: pthread_mutex_lock called on a destroyed mutex
```

**之后 4 次（3 次重启 + 1 次卸载重装）都没能复现**，debug 包也从没出现过。
没有栈，logcat 的 crash 缓冲里只有这两行。

留个记号，别当它不存在。可疑的方向按优先级：`notify` 的文件监听线程
（inotify 在安卓的 FUSE 共享存储上本来就不可靠，而 §2.7 给移动端规划的是
「从后台恢复时做一次全量 mtime 扫描」，不是长期监听）；其次是换 vault 时
`VaultWatcher` 的 Drop 与其线程的竞态。再遇到就往这两处查。

### release 签名

密钥在**仓库外面**（`~/.verso-signing/verso-release.jks`），
`gen/android/keystore.properties` 指向它、被 .gitignore 挡着。
`app/build.gradle.kts` 读不到那个文件就不配签名，产出未签名的 release 包 ——
别人 clone 下来不该因为没有密钥就构建不了。

打包：`scripts/android-apk.ps1 -Release`。release 的 `.so` 是 17 MB
（debug 172 MB），APK 19 MB（debug 172 MB）。

### 自适应图标：`tauri icon` 生成的前景图是满幅的，会被裁

安卓的自适应图标只保证 108dp 画布**中间 72dp** 可见 —— 等于把前景放大 1.5 倍
再按启动器的形状裁一刀。`tauri icon` 生成的 `ic_launcher_foreground.png` 是
满幅整图，进去之后自己的圆角被切掉、图案显得特别大。

`scripts/android-icon.py` 负责这一步，**每次跑完 `tauri icon` 都要重跑它**。
两个要点：

- **按图案自己的包围盒缩，不是按画布缩。** 图标四周本来就有一圈透明（圆角 +
  投影），照画布比例缩会让图案比安全区再小一圈，结果是「启动器的方块里套着
  一个更小的圆角方块，中间夹一圈底色」—— 比不缩还难看。按包围盒缩，图案的边
  正好落在遮罩上被裁掉，接缝就不存在了。
- 背景色取图案里**出现最多**的那个不透明色；定点采样会踩到高光或阴影。

改完先在本地合成一张预览（背景色 + 前景 → 圆角遮罩 → 裁中间 72/108 再放大），
比装到手机上再看快得多。

### `tauri android init` 会无视 `src-tauri/icons/android/`

它自己塞一套 Tauri 默认 logo（青黄那个双圈）进 `gen/android/.../res/mipmap-*`，
而真图标一直好好地躺在 `src-tauri/icons/android/` 里（`tauri icon` 生成的）。
`scripts/android-apk.ps1` 每次打包都覆盖一遍，重新 init 也不会退回去。

### 真机上调界面：连 WebView 的 devtools，别截屏

debug 包的 WebView 开着远程调试，可以直接在手机上跑的页面里执行 JS：

```bash
PID=$(adb shell pidof app.verso.desktop)
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s http://127.0.0.1:9222/json/list          # 拿 webSocketDebuggerUrl
# 然后往那个 ws 发 Runtime.evaluate（scratchpad 里那个 cdp.mjs 就是干这个的）
```

`getComputedStyle`、`getBoundingClientRect`、`elementFromPoint` 全都能问。
「抽屉打不开」那个 bug 就是这么一次定位的：DOM 里在、类名对、position 和
z-index 全对，一量高度是 0。**光看截图永远查不出来**，而截屏还会拍到作者
正在用的私人手机。

### 绝对定位的网格子元素，包含块是它那一格网格区域

窄屏下侧栏改成浮层时，`.app` 的 `grid-template-areas` 里已经没有 `sidebar`
那一格了，而 `.sidebar` 上还留着 `grid-area: sidebar` —— 于是它的包含块变成
一个**零高的隐式区域**，`top: 0; bottom: 0` 撑在零高的盒子里，整个抽屉掉到
视口下方、高度为 0。必须一起写 `grid-area: auto`。

**这类 bug 只有量纵向才看得出来。** 当时的测试只量了横向（左右重不重叠、
宽度够不够），全绿 —— 而真机上抽屉根本不存在。量布局时 x 和 y 都要量。

### 改窄屏布局时：视口是**整个浏览器实例共享的**

`page.viewport(390, 844)` 改的是那一个 Chromium 实例，不是当前这个测试文件的。
`afterEach` 里不还原成 1440×900 的话，**同一次运行里后跑的文件会在手机尺寸下
跑**，而它们的几何断言全是照桌面写的 —— 失败信息会指向一个完全无辜的文件。
`mobile.browser.test.tsx` 里已经还原了，照着写。

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

### Android 构建：踩过的四个坑，按顺序

工具链是 scoop 装的，**不需要 Android Studio**：
`scoop install java/openjdk17 android-clt perl` + `sdkmanager` 装
platform-tools / platforms;android-34 / build-tools;34.0.0 / ndk;27.2.12479018。
环境变量 `ANDROID_HOME`、`NDK_HOME`、`JAVA_HOME` 三个都要有（scoop 只会自动设
前面两个里的一个，`NDK_HOME` 得自己补）。

1. **别用裸 `cargo build --target aarch64-linux-android`。** 它不配 NDK 的
   编译器环境，`libsqlite3-sys` / `blake3` 会报「找不到 aarch64-linux-android-clang」。
   走 `pnpm tauri android build`，那条命令自己会设 CC/AR/PATH。
2. **`https` 只给桌面开，安卓那份 git2 不带它**（Cargo.toml 里有整段说明）。
   安卓上 libgit2 的 https 后端是 OpenSSL，而 vendored 编译在 Windows 主机上
   要一个「产生 Unix 风格路径**且** core 模块齐全」的 perl —— git 自带的 MSYS
   perl 被精简过（缺 `Locale::Maketext::Simple`、`ExtUtils::MakeMaker`…），
   Strawberry Perl 又会被 OpenSSL 的 Configure 以「路径风格不对」当场拒掉。
   **这是个死结，别再去补 perl 模块**；正解是给 libgit2 注册一个走 rustls 的
   自定义传输层（`git2::transport`）。
3. **`[target.'cfg(…)'.dependencies]` 必须放在 Cargo.toml 末尾。** TOML 里那张
   表一出现，**后面所有的裸依赖行都算进它**。把它插在 `[dependencies]` 中间的
   话，`rusqlite`、`notify`、`blake3`、`portable-pty` 会一起变成「只有安卓才有」，
   桌面构建当场报 `unresolved import rusqlite` —— 而错误信息和你刚改的那一行
   毫无关系。
4. **最后一步的符号链接需要开发者模式。** Tauri 要把 `.so` 从 target 目录软链
   到 `gen/android/app/src/main/jniLibs/`，Windows 上非管理员建符号链接要先开
   「开发者模式」（这台机器没开）。绕法是手动把 `.so` 拷过去，再
   `gradlew assembleArm64Debug -x rustBuildArm64Debug`（`-x` 跳过那一步，
   否则它会重跑 cargo 又撞上同一个链接）。

**debug 的 `.so` 有 164 MB**（没 strip），所以 debug APK 172 MB。这不是包大小
失控，release 会小一个量级。

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

### 这个仓库的行尾是混的，脚本替换会静默失配

有的文件 CRLF、有的 LF，**同一个文件里也可能混着**（被脚本改过的段落是一种、
原来的是另一种）。拿 python 做字符串替换时，`s.replace(old, new)` 找不到就
**什么都不做也不报错**，看起来像是改了。已经因此丢过好几次改动。

要么用 Edit 工具（它会明确报错），要么替换前先试 LF、再试 CRLF 两种写法，
并且**替换不到就抛异常**。

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

### `overflow: hidden` 会把「挂在里面的浮层」整个裁掉，而测试全绿

v0.5.38 踩的：给定宽表格的 `th` 加了 `overflow: hidden` 做截断，而列头菜单是
**绝对定位挂在那个 `th` 里**的 —— 菜单照常打开、事件照常派发、DOM 里查得到，
就是一个像素都看不见。作者报的是「点列头没反应」。

**裁剪不改变 `getBoundingClientRect`**，所以几何量不出来，查 DOM 的测试也一路
全绿。这类只能**钉声明**：`expect(getComputedStyle(th).overflow).not.toBe("hidden")`，
并在注释里写清楚删掉它会坏什么（和 `pageScroll.browser.test.tsx` 钉
`overscroll-behavior` 是同一招）。

规矩：**要截断就截里面那个具体元素，别截那个当定位基准的容器。**

**还有一层躲不掉的：滚动容器。** `overflow-x: auto` 会让另一个轴的 `visible`
**被强制成 auto**（CSS 明文规定），所以横向滚动的容器同样会纵向裁 —— 表格里
那个列头菜单一变长，下面几条就没了。浮层长在滚动容器里就只有一条干净的路：
**`position: fixed` + 打开那一刻算好坐标**（fixed 不受祖先 overflow 影响）。
代价是页面一滚它会留在原地，所以要顺手监听 `scroll` 把它关掉。

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

## 改 git 相关代码时必须知道的三件事

`src-tauri/src/vault/git.rs` + `src/components/HistoryView.tsx` + App 里那段
自动提交。DESIGN.md §2.8。

1. **暂存要 `add_all` 加 `update_all` 两步。** 前者收新增和修改，后者才收得到
   **删除**。只调 add_all 的话，删掉一篇笔记永远提交不上去，而这种漏提交要等到
   换台机器才发现。
2. **revwalk 必须 `Sort::TOPOLOGICAL | Sort::TIME`。** git 的提交时间只精确到秒，
   而自动提交完全可能在同一秒里连着来两个 —— 只按时间排的话，历史列表的顺序
   是随机的。拓扑序保证「后一个提交一定排在它的父提交前面」。
3. **前端调后端不存在的命令时，`invoke` 是同步抛的**，不是返回 rejected
   Promise。所以 `try { await api.gitStatus() } catch {}` 挡不住它，`.catch()`
   也挂不上去 —— 整个渲染函数直接崩。老测试里的 mock api 不会有新命令，
   于是加一个后端命令能把五个不相干的测试打挂。包住整个调用点，别只包 await。

**顺带一条不限于 git 的：给 `src/api.ts` 加一个具名导出（不是往 `api` 对象里
加方法），所有 App 级 browser 测试会当场挂掉**，报的是
`does not provide an export named 'x'` —— 因为它们的 `vi.mock("./api", …)` 是
工厂形式，工厂没返回的具名导出在 ESM 链接期就不存在了。加一个就得去那八九个
mock 里各补一行。所以能挂在 `api` 对象上的就别单独导出；确实要单独导出的
（`onXxx` 这类事件监听），改完记得 `pnpm test:browser` 全跑一遍。

### git2 的 `ssh` 特性会让二进制在这台机器上跑不起来

打开 `features = ["ssh"]` 之后，`cargo test` 报
**`应用程序控制策略已阻止此文件 (os error 4551)`** —— 是 Windows 的
Smart App Control（这台机器 `VerifiedAndReputablePolicyState = 1`，强制模式）
拦掉了链进 libssh2 的那个未签名二进制。换目录、换文件名都没用，它认的是文件
本身。只留 `["https"]` 就一切正常。

所以同步只做 https + 令牌。**别再顺手把 ssh 加回去** —— 它不会编译失败，
会在测试运行的那一刻才炸，而错误信息完全不像是依赖引起的。

### 令牌不许经过前端

`sync_token_set` / `sync_token_has` 有，**`sync_token_get` 故意没有**。
令牌一旦作为 IPC 返回值传给前端，它就会出现在 DevTools 的调用记录、任何
一次录屏、以及将来某个「把状态打日志」的调试代码里。同步时 Rust 自己从钥匙串
取（`vault/secret.rs`）。

### 关窗流程（改动前先读）

Rust 侧 `on_window_event` 拦下 `CloseRequested` → 发 `app:closing` → 前端落盘、
按设置提交 → 调 `close_now`（用 `destroy` 而不是 `close`，后者会再触发一次
`CloseRequested`）。两道保险缺一不可：**前端那边 `closeNow` 必须在 `finally`
里**，Rust 那边 5 秒后无论如何 `destroy`。任何一道漏掉，用户遇到的都是
「点 X 关不掉」—— 而那比丢一次自动提交严重得多。第二次点 X 直接放行。

## 当前状态

**v0.6.0 — M5a 本地版本历史已完成。**
详见 [CHANGELOG.md](CHANGELOG.md) 与 [verso/README.md](verso/README.md)。

M2 的公式手感盲测已通过（作者手测），项目最大的风险点在那时就过去了。
默认 snippet 库仍在长期迭代，待办记在 DESIGN.md §5.4 的表里 —— 用到不顺手
随时可以动，但动之前先读上面「改 snippet 时必须知道的三件事」。

**M5b 走了第一步**（v0.6.1）：配远端、一个同步按钮（提交 → 取 → 变基 → 推）、
令牌进系统钥匙串。**冲突只检测不解决**，撞上就原样退回并报出是哪几篇。
差的是冲突对比 UI，以及**真机对着 GitHub 跑一遍** —— 现在全部是本地裸仓库
测出来的（7 条），传输层没有被验证过。

**桌面自动更新已接上**（v0.6.14 写的，v0.6.15 第一次真的发出去，§2.11）：
updater 插件 + GitHub Releases，推 tag 就出四份包。

**流水线本身已经验过**：v0.6.15 那次四个 job 全绿，草稿 release 里
Windows(nsis+msi) / macOS(arm+intel) / Linux(deb+rpm+AppImage) 齐全，
`latest.json` 里十一个 target 各带一个签名。

**没验过的是客户端那一半**：检查、下载、装、重启这几步全靠 Tauri 运行时，
浏览器测试一步都够不着（见上面「browser 测试也有它够不着的一层」）。
第一次真的从旧版更到新版时要盯着看的是：**装完打开来版本号对不对**。

顺带一条会让人虚惊一场的：草稿 release 里 `latest.json` 的下载地址是
`api.github.com/repos/…/releases/assets/<id>` 这种形式，不是
`releases/download/…` —— 草稿的资产还没有公开地址。这是对的，能下下来：
updater 下载时会带 `Accept: application/octet-stream`
（`tauri-plugin-updater` 的 `updater.rs`），GitHub 认这个头就回二进制。

**M5a 已经落地**（v0.5.43–46 攒成 v0.6.0）：`git2-rs` 集成、状态栏的状态点、
按空闲 / 失焦 / 关窗聚合的自动提交、说得出篇名的提交说明、侧栏的版本历史与
单篇回退。**下一步是 M5b（`v0.7.0`）**：远端 push/pull、冲突解决 UI、凭据
钥匙串。验收是「两台桌面设备改同一个 vault 不丢数据」。

**有意不做未提交改动的 diff 视图** —— 逐字对比在 Markdown 上没那么有用
（改一个词整段标红），人真正要的是「回到昨天那版」，所以直接给回退。

M4 留下的一个尾巴：**macOS 的透明标题栏 + 交通灯留白没做**，因为需要在
真机上看红绿灯有没有压住侧栏内容，而这台开发机是 Windows。默认的原生
标题栏是安全的，不要凭想象改窗口装饰（DESIGN.md §6.5）。
