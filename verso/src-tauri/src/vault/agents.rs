//! 给 vault 里的 AI CLI 写一份约定说明。DESIGN.md §7.7
//!
//! §7.1 的立场是「不是我们做 AI 功能，而是让用户自带 AI」。但自带的那个 AI
//! 打开 vault 只看见一堆普通 markdown —— `verso-view` 代码块会被当成看不懂的
//! YAML 重排掉，笔记会被顺手补上一堆 frontmatter，`.verso/` 会被当成要维护的
//! 东西。这些都不是模型不聪明，是**没人告诉过它这里的规矩**。
//!
//! 而这件事根本不需要我们做「识别」：AI CLI 早就会自动读仓库根目录的约定
//! 文件。我们要做的只是把那份文件放进去。

use std::path::Path;

use crate::error::Result;

/// 跨工具的约定文件名（Codex 等直接读它）。
const AGENTS: &str = "AGENTS.md";

/// Claude Code 读的是这个名字。内容只有一行指针 —— §7.1 说了不绑定任何工具，
/// 但**文件名是各家自己定的**，漏掉这一行就等于对最常用的那个 CLI 无效。
/// 一行指针的成本比「让用户自己发现要再建一个文件」低得多。
const CLAUDE: &str = "CLAUDE.md";

const CLAUDE_DOC: &str = "\
本仓库的协作规则见 [AGENTS.md](AGENTS.md)。开始工作前，请先阅读并遵守其中的说明。

> 此文件由 Verso 创建，用来让读取 `CLAUDE.md` 的工具找到同一份规则。
> 请不要在这里维护另一份副本。
";

/// 正文里的 `{VERSION}` 由 [`render`] 换成当前版本号。
///
/// 有意**不列 vault 的内容摘要**（有哪些标签、哪些 database 视图）：那种东西
/// 写进去的第一天就开始过期，而 AI 自己 grep 一遍比读一份陈旧的清单准得多。
/// 这里只写不看文件就猜不出来的**约定**和**边界**。
const AGENTS_DOC: &str = r##"# AGENTS.md

这是一个由 **Verso** 管理的本地笔记仓库（vault）。每篇笔记都是独立的 Markdown
文件，可以直接读写，不需要调用 Verso API。修改内容前，请先遵守下面的约定。

## 目录

| 路径 | 是什么 |
|---|---|
| `任意.md` | 一篇普通笔记 |
| `甲.md` + `甲/` | `甲/` 存放 `甲.md` 的子文档；例如 `甲/乙.md` 会显示为「甲」的子节点 |
| `attachments/` | 附件目录；粘贴到笔记里的图片通常保存在这里 |
| `templates/` | 模板目录；其中的模板也是普通 Markdown 文件 |
| `.verso/` | Verso 生成的索引缓存和界面状态。不要编辑；整个目录都可以删除并重建，且已被 Git 忽略 |

## 正文里的特殊语法

- `[[笔记名]]`、`[[笔记名|显示文本]]`、`[[笔记名#标题]]` —— 内部链接，写人类可读的名字
- `![[文件名]]` —— 嵌入图片或另一篇笔记
- `#标签`、`#嵌套/标签`
- `$行内公式$`、`$$块级公式$$`（KaTeX）
- `==高亮==`、`> [!note] 标题`（callout）
- 信息字符串为 `verso-view` 的围栏代码块 —— **这不是普通代码块**，而是数据库
  视图的定义：

  ```verso-view
  from: "论文/**"
  where: status != "已读"
  sort: created desc
  view: table
  columns: [title, 作者, status]
  ```

  Verso 会把它渲染成可编辑的表格、看板或日历。修改时请保留结构和字段含义；
  不要仅为统一格式而重排，也不要因为不认识这种代码块就将它删除。

## frontmatter：只保留需要的字段

Verso 不会主动给笔记补字段。新建笔记是空文件，保存后也不会自动出现 `id`、
`title` 或 `created`。除非用户明确要求，否则**不要主动补齐元数据**；多余字段会
制造噪音，也会在版本对比中掩盖真正的修改。

| 字段 | 说明 |
|---|---|
| `title` | 可选；缺省时使用文件名 |
| `created` / `updated` | 使用带时区的 RFC 3339 格式；只有原本存在 `updated` 时，Verso 才会刷新它 |
| `tags` | 数组；会与正文中的 `#标签` 合并 |
| `icon` | 一个 emoji 字符，显示在文档树上 |
| `id` | ULID，可选，不自动写入 |
| 其他任意键 | 都会进入索引，供 `verso-view` 查询和展示 |

请保留 frontmatter 中原有的键名。界面把 `tags` 显示成「标签」只是本地化展示，
写回文件时仍应使用 `tags`；不要把键名翻译成中文。

## 改完之后

- **不需要重建索引，也不需要通知 Verso。** Verso 会监听外部文件变化
- 这个 vault 同时是 Git 仓库。用户会在 Verso 中逐行查看改动并按篇恢复，因此
  **不要改写 Git 历史**：不要 rebase、amend 或自行创建分支
- 是否提交由用户决定；除非用户明确要求，否则不要替用户提交、同步或发布

## 边界

通常只修改用户指定的笔记。除非任务明确要求，否则不要修改本说明，也不要改动
`.verso/` 或 `.git/` 的内部结构。

---

*本文件由 Verso v{VERSION} 初次生成，可以按项目需要修改。删除后，Verso 会在下次
打开仓库时重新创建；「设置 → AI 协作 → 恢复默认说明」会在确认后覆盖现有内容。*
"##;

fn render() -> String {
    AGENTS_DOC.replace("{VERSION}", env!("CARGO_PKG_VERSION"))
}

/// 写了哪几个文件。两个都可能因为「已经在了」而没写。
#[derive(Debug, Default, Clone, Copy)]
pub struct Written {
    pub agents: bool,
    pub claude: bool,
}

/// 打开 vault 时调：缺了就补，**已经有了绝不覆盖**。
///
/// 和 `.gitignore` 同一条规矩（`git.rs`）。用户很可能在里面加了自己的话 ——
/// 那正是这份文件该有的样子，静默覆盖用户写过的东西是这个项目的铁律不允许的。
/// 想要最新版的人走设置里的「恢复默认说明」（[`rewrite`]）。
pub fn ensure(root: &Path) -> Result<Written> {
    let mut w = Written::default();
    let agents = root.join(AGENTS);
    if !agents.exists() {
        std::fs::write(&agents, render())?;
        w.agents = true;
    }
    let claude = root.join(CLAUDE);
    if !claude.exists() {
        std::fs::write(&claude, CLAUDE_DOC)?;
        w.claude = true;
    }
    Ok(w)
}

/// 用当前版本覆盖两份文件。**只由用户在设置里确认后主动触发**。
pub fn rewrite(root: &Path) -> Result<()> {
    std::fs::write(root.join(AGENTS), render())?;
    std::fs::write(root.join(CLAUDE), CLAUDE_DOC)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(std::path::PathBuf);
    impl Tmp {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("verso-agents-{name}"));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writes_both_files_on_a_fresh_vault() {
        let t = Tmp::new("fresh");
        let w = ensure(&t.0).unwrap();
        assert!(w.agents && w.claude);
        assert!(t.0.join("AGENTS.md").exists());
        assert!(t.0.join("CLAUDE.md").exists());
    }

    /// 用户很可能在里面加了自己的话。第二次打开 vault 就把它冲掉的话，
    /// 这个功能就从「帮忙」变成了「会吃掉用户文字的东西」。
    #[test]
    fn never_overwrites_what_the_user_wrote() {
        let t = Tmp::new("keep");
        std::fs::write(t.0.join("AGENTS.md"), "我自己写的规矩").unwrap();
        let w = ensure(&t.0).unwrap();
        assert!(!w.agents, "覆盖了用户已有的 AGENTS.md");
        assert!(w.claude, "另一份缺着就该补上");
        assert_eq!(
            std::fs::read_to_string(t.0.join("AGENTS.md")).unwrap(),
            "我自己写的规矩"
        );
    }

    #[test]
    fn rewrite_is_the_only_thing_that_overwrites() {
        let t = Tmp::new("rewrite");
        std::fs::write(t.0.join("AGENTS.md"), "旧的").unwrap();
        rewrite(&t.0).unwrap();
        assert!(std::fs::read_to_string(t.0.join("AGENTS.md"))
            .unwrap()
            .contains("Verso"));
    }

    /// 这几条是「不写进去 AI 就一定会做错」的那些 —— 掉了任何一条，
    /// 这份文件就白生成了。
    #[test]
    fn says_the_things_an_ai_cannot_guess() {
        let doc = render();
        for must in [
            "verso-view", // 当成普通代码块重排 / 删掉
            ".verso/",    // 当成要维护的东西
            "frontmatter",
            "不要主动补齐元数据",
            "不要改写 Git 历史",
            "attachments/",
        ] {
            assert!(doc.contains(must), "生成的说明里缺了「{must}」");
        }
        // 版本号得真的被替换掉，不能留着占位符
        assert!(!doc.contains("{VERSION}"));
        assert!(doc.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn claude_file_points_at_the_real_one() {
        assert!(CLAUDE_DOC.contains("AGENTS.md"));
    }
}
