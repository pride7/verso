use std::path::PathBuf;
use std::sync::Arc;

use super::*;
use crate::vault::fs::DesktopFs;

struct Tmp(PathBuf);
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 建一个真实的 vault，写入若干笔记，返回已索引好的 (目录, vault, index)
fn setup(files: &[(&str, &str)]) -> (Tmp, Vault, Index) {
    let dir = std::env::temp_dir().join(format!("verso-idx-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&dir).unwrap();

    for (rel, content) in files {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
    }

    let vault = Vault {
        root: dir.clone(),
        fs: Arc::new(DesktopFs::new()),
    };
    let mut index = Index::open_memory().unwrap();
    index.rebuild(&vault).unwrap();
    (Tmp(dir), vault, index)
}

const LINALG: &str = "---\nid: 01AAAAAAAAAAAAAAAAAAAAAAAA\ntitle: 线性代数\ntags: [数学]\n难度: 3\nstatus: 在读\n---\n\n矩阵分解的入口。见 [[奇异值分解]] 与 [[特征值|特征向量]]。\n\n标签：#矩阵论\n";
const SVD: &str = "---\nid: 01BBBBBBBBBBBBBBBBBBBBBBBB\ntitle: 奇异值分解\ntags: [数学, 矩阵]\n难度: 5\nstatus: 未读\n---\n\n任意矩阵都可以分解为 $A = U \\Sigma V^T$。\n\n回到 [[线性代数]]。也提到 [[不存在的笔记]]。\n";
const EIGEN: &str = "---\nid: 01CCCCCCCCCCCCCCCCCCCCCCCC\ntitle: 特征值\n难度: 4\nstatus: 在读\n---\n\n特征值与特征向量。\n\n```md\n这是代码块里的 [[假链接]] 和 #假标签\n```\n";

fn sample() -> (Tmp, Vault, Index) {
    setup(&[
        ("数学/线性代数.md", LINALG),
        ("数学/线性代数/奇异值分解.md", SVD),
        ("数学/线性代数/特征值.md", EIGEN),
    ])
}

#[test]
fn indexes_all_notes() {
    let (_t, _v, idx) = sample();
    let n: i64 = idx
        .conn()
        .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 3);
}

#[test]
fn records_parent_from_same_named_folder() {
    let (_t, _v, idx) = sample();
    let parent: Option<String> = idx
        .conn()
        .query_row(
            "SELECT p.title FROM notes n LEFT JOIN notes p ON p.id = n.parent_id
             WHERE n.path = '数学/线性代数/奇异值分解.md'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(parent.as_deref(), Some("线性代数"));
}

// ------------------------------------------------------------------ 搜索

#[test]
fn full_text_search_finds_chinese_substrings() {
    let (_t, _v, idx) = sample();
    let hits = idx.search("矩阵分解", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "线性代数");
    assert!(hits[0].snippet.contains("<mark>"), "应当标出命中处");
}

#[test]
fn search_matches_titles_too() {
    let (_t, _v, idx) = sample();
    let hits = idx.search("奇异值", 10).unwrap();
    assert!(hits.iter().any(|h| h.title == "奇异值分解"));
}

#[test]
fn search_with_no_match_returns_empty() {
    let (_t, _v, idx) = sample();
    assert!(idx.search("泛函分析", 10).unwrap().is_empty());
    assert!(idx.search("   ", 10).unwrap().is_empty());
}

/// 搜索框里打这些不该让查询炸掉
#[test]
fn search_survives_fts_operators() {
    let (_t, _v, idx) = sample();
    for q in ["AND", "\"", "*", "NEAR(a b)", "矩阵 OR 特征"] {
        assert!(idx.search(q, 10).is_ok(), "查询 {q:?} 不该报错");
    }
}

// -------------------------------------------------------------- 反向链接

#[test]
fn backlinks_finds_referencing_notes() {
    let (_t, _v, idx) = sample();
    let back = idx.backlinks("数学/线性代数.md").unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].title, "奇异值分解");
}

#[test]
fn alias_links_still_resolve_to_the_target() {
    let (_t, _v, idx) = sample();
    // 线性代数 里写的是 [[特征值|特征向量]]，反向链接要算在「特征值」头上
    let back = idx.backlinks("数学/线性代数/特征值.md").unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].title, "线性代数");
}

#[test]
fn dangling_links_are_reported_not_dropped() {
    let (_t, _v, idx) = sample();
    let d = idx.dangling_links().unwrap();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].1, "不存在的笔记");
}

/// 代码块里的示例链接被索引进去的话，反向链接面板会全是噪音
#[test]
fn code_blocks_are_not_indexed() {
    let (_t, _v, idx) = sample();
    let n: i64 = idx
        .conn()
        .query_row("SELECT count(*) FROM links WHERE target_text = '假链接'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0);
    let t: i64 = idx
        .conn()
        .query_row("SELECT count(*) FROM tags WHERE tag = '假标签'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(t, 0);
}

// ---------------------------------------------------------------- 标签

#[test]
fn merges_frontmatter_tags_with_inline_tags() {
    let (_t, _v, idx) = sample();
    let tags: Vec<String> = idx
        .conn()
        .prepare("SELECT tag FROM tags t JOIN notes n ON n.id = t.note_id WHERE n.title='线性代数' ORDER BY tag")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    // frontmatter 的「数学」+ 正文里的 #矩阵论
    assert_eq!(tags, vec!["数学", "矩阵论"]);
}

#[test]
fn all_tags_counts_usage() {
    let (_t, _v, idx) = sample();
    let tags = idx.all_tags().unwrap();
    let math = tags.iter().find(|(t, _)| t == "数学").unwrap();
    assert_eq!(math.1, 2);
}

// ---------------------------------------------------------------- 属性

#[test]
fn props_are_flattened_for_database_views() {
    let (_t, _v, idx) = sample();
    let n: i64 = idx
        .conn()
        .query_row("SELECT count(*) FROM props WHERE key='status' AND value='在读'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(n, 2);
}

#[test]
fn numeric_props_keep_a_sortable_number() {
    let (_t, _v, idx) = sample();
    let titles: Vec<String> = idx
        .conn()
        .prepare(
            "SELECT n.title FROM props p JOIN notes n ON n.id = p.note_id
             WHERE p.key='难度' ORDER BY p.num DESC",
        )
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(titles, vec!["奇异值分解", "特征值", "线性代数"]);
}

/// 日历的日期字段、画廊的封面必须**跟着一起取值**。
///
/// 每一行只装 `columns` 里点名的属性，而这两个键是视图自己用的、通常不在
/// `columns` 里 —— 漏了它们的表现是「日历一格都排不出来」「封面全空」，
/// 而查询本身还成功着，极难往「取值时被过滤掉了」上想。看板的 group-by
/// 早就这么处理，这两个是补齐。
#[test]
fn calendar_and_gallery_keys_are_fetched_even_when_not_listed() {
    let (_t, _v, idx) = setup(&[(
        "论文.md",
        "---\nid: 01DDDDDDDDDDDDDDDDDDDDDDDD\ntitle: 论文\n读于: 2026-03-04\n封面: attachments/cover.png\n---\n\n正文\n",
    )]);

    let spec: view::ViewSpec = serde_yaml::from_str(
        "columns: [title]\nview: calendar\ndate-field: 读于\ncover: 封面\n",
    )
    .unwrap();
    let r = view::query(idx.conn(), &spec).unwrap();

    assert_eq!(r.rows.len(), 1);
    assert_eq!(r.rows[0].props.get("读于").map(String::as_str), Some("2026-03-04"));
    assert_eq!(
        r.rows[0].props.get("封面").map(String::as_str),
        Some("attachments/cover.png")
    );
}

/// `*` 和 `**` 在路径来源里必须有不同含义。SQLite GLOB 原生的 `*` 会跨过
/// `/`，如果不额外排除下一段路径，用户根本无法只看项目的一级文档。
#[test]
fn view_source_distinguishes_direct_children_from_all_descendants() {
    let (_t, _v, idx) = setup(&[
        ("项目.md", "项目主页\n"),
        ("项目/直属.md", "直属文档\n"),
        ("项目/实验/嵌套.md", "嵌套文档\n"),
        ("别处.md", "无关文档\n"),
    ]);

    let direct: view::ViewSpec = serde_yaml::from_str("from: \"项目/*\"\n").unwrap();
    let direct_paths: Vec<String> = view::query(idx.conn(), &direct)
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(direct_paths, vec!["项目/直属.md".to_string()]);

    let recursive: view::ViewSpec = serde_yaml::from_str("from: \"项目/**\"\n").unwrap();
    let recursive_paths: Vec<String> = view::query(idx.conn(), &recursive)
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(recursive_paths.len(), 2);
    assert!(recursive_paths.iter().any(|path| path == "项目/直属.md"));
    assert!(recursive_paths.iter().any(|path| path == "项目/实验/嵌套.md"));
}

/// 相对时间：`updated < 90d ago`。
///
/// 写死日期的筛选下个月就过期，于是「长期未更新」那张清单无法长期维护
/// —— 而这正是知识库容易失效的地方（§2.6）。
#[test]
fn relative_time_values_resolve_at_query_time() {
    assert_eq!(view::relative_modifier("90d ago").as_deref(), Some("-90 days"));
    assert_eq!(view::relative_modifier("2w ago").as_deref(), Some("-14 days"));
    assert_eq!(view::relative_modifier("3m ago").as_deref(), Some("-3 months"));
    assert_eq!(view::relative_modifier("1y ago").as_deref(), Some("-1 years"));
    // 认不出来就当字面值 —— 用户可能真想找 `updated = "2026-05-01"`
    assert_eq!(view::relative_modifier("2026-05-01"), None);
    assert_eq!(view::relative_modifier("很久以前"), None);
    assert_eq!(view::relative_modifier("-5d ago"), None);
}

/// `created` / `updated` 是 notes 的列，不在 props 表里（§2.6 把它们排除在
/// 用户属性之外）——不单独接入的话，`where updated < …` 会返回空表，但查询本身
/// 不会报错。
#[test]
fn builtin_time_columns_are_filterable_and_fall_back_to_mtime() {
    let (_t, _v, idx) = setup(&[
        (
            "老笔记.md",
            "---
id: 01EEEEEEEEEEEEEEEEEEEEEEEE
title: 老笔记
updated: 2020-01-02T10:00:00+08:00
---

很久没碰
",
        ),
        // 没写 updated：要回落到文件的 mtime（刚写出来的，也就是「今天」），
        // 否则一条相对时间筛选会把整个 vault 判成「很久没碰」
        ("新笔记.md", "---
id: 01FFFFFFFFFFFFFFFFFFFFFFFF
title: 新笔记
---

刚写的
"),
    ]);

    let stale: view::ViewSpec = serde_yaml::from_str("where: updated < \"90d ago\"
").unwrap();
    let paths: Vec<String> = view::query(idx.conn(), &stale)
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(paths, vec!["老笔记.md".to_string()]);

    let fresh: view::ViewSpec = serde_yaml::from_str("where: updated >= \"90d ago\"
").unwrap();
    let paths: Vec<String> = view::query(idx.conn(), &fresh)
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(paths, vec!["新笔记.md".to_string()]);

    // 绝对日期仍然照旧
    let before: view::ViewSpec = serde_yaml::from_str("where: updated < \"2021-01-01\"
").unwrap();
    let paths: Vec<String> = view::query(idx.conn(), &before)
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(paths, vec!["老笔记.md".to_string()]);
}

/// 普通日期属性上也能用相对时间 —— 「三个月前读的论文」和内置列一个道理。
#[test]
fn relative_time_works_on_date_properties() {
    let (_t, _v, idx) = setup(&[
        (
            "旧论文.md",
            "---
id: 01GGGGGGGGGGGGGGGGGGGGGGGG
title: 旧论文
读于: 2020-03-04
---


",
        ),
        (
            "新论文.md",
            "---
id: 01HHHHHHHHHHHHHHHHHHHHHHHH
title: 新论文
读于: 2999-01-01
---


",
        ),
    ]);

    let spec: view::ViewSpec = serde_yaml::from_str("where: 读于 < \"1y ago\"
").unwrap();
    let paths: Vec<String> = view::query(idx.conn(), &spec)
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(paths, vec!["旧论文.md".to_string()]);
}

// -------------------------------------------------------------- 增量更新

#[test]
fn update_note_reindexes_a_single_file() {
    let (t, v, mut idx) = sample();
    std::fs::write(
        t.0.join("数学/线性代数.md"),
        "---\nid: 01AAAAAAAAAAAAAAAAAAAAAAAA\ntitle: 线性代数\n---\n\n换了内容，提到泛函分析。\n",
    )
    .unwrap();

    idx.update_note(&v, "数学/线性代数.md").unwrap();

    assert!(idx.search("泛函分析", 10).unwrap().len() == 1);
    assert!(idx.search("矩阵分解", 10).unwrap().is_empty(), "旧内容应当被替换掉");
    // 笔记数不变，不能因为更新多出一条
    let n: i64 = idx
        .conn()
        .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 3);
}

#[test]
fn root_ai_instructions_stay_out_of_incremental_indexing() {
    let (t, v, mut idx) = setup(&[
        ("AGENTS.md", "只给 AI 看的独特规则词\n"),
        ("正文.md", "普通笔记\n"),
    ]);
    assert!(idx.search("独特规则词", 10).unwrap().is_empty());

    // 编辑器保存和文件监听都会走 update_note；不能因为改了一次就重新出现在搜索里。
    std::fs::write(t.0.join("AGENTS.md"), "只给 AI 看的另一个独特词\n").unwrap();
    idx.update_note(&v, "AGENTS.md").unwrap();

    assert!(idx.search("另一个独特词", 10).unwrap().is_empty());
    let n: i64 = idx
        .conn()
        .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn removing_a_note_clears_its_index_entries() {
    let (_t, _v, mut idx) = sample();
    idx.remove_note("数学/线性代数/奇异值分解.md").unwrap();

    // 注意不能断言「搜不到奇异值」—— 线性代数 的正文里写着 [[奇异值分解]]，
    // 那是合法命中。要断言的是**这篇笔记本身**不再出现在结果里。
    let hits = idx.search("奇异值", 10).unwrap();
    assert!(!hits.iter().any(|h| h.path == "数学/线性代数/奇异值分解.md"));

    // 它指向线性代数的那条反向链接也要跟着消失
    assert!(idx.backlinks("数学/线性代数.md").unwrap().is_empty());
}

/// trigram 要求查询至少 3 个字符，而中文最常搜的恰恰是两字词。
/// 短查询必须能通过 LIKE 回退搜到。
#[test]
fn two_character_chinese_queries_still_work() {
    let (_t, _v, idx) = sample();

    let hits = idx.search("矩阵", 10).unwrap();
    assert!(!hits.is_empty(), "「矩阵」这种两字词必须搜得到");
    assert!(hits[0].snippet.contains("<mark>"), "回退路径也要标出命中处");

    assert!(!idx.search("特征", 10).unwrap().is_empty());
    assert!(idx.search("泛函", 10).unwrap().is_empty());
}

/// LIKE 回退路径里，用户输入的 `%` `_` 不能被当成通配符
#[test]
fn like_wildcards_in_query_are_escaped() {
    let (_t, _v, idx) = setup(&[("a.md", "含有百分号 50% 的笔记\n"), ("b.md", "毫无关系\n")]);
    // `%x` 若不转义会匹配一切
    assert_eq!(idx.search("%的", 10).unwrap().len(), 0);
    assert_eq!(idx.search("0%", 10).unwrap().len(), 1);
}

/// 外部程序（AI CLI）新建的笔记通常没有 frontmatter，不能因此索引失败
#[test]
fn indexes_foreign_notes_without_frontmatter() {
    let (_t, _v, idx) = setup(&[("外来.md", "别处拿来的，提到 [[某篇]]\n")]);
    let n: i64 = idx
        .conn()
        .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
    // 标题回退到文件名
    let title: String = idx
        .conn()
        .query_row("SELECT title FROM notes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "外来");
}

// -------------------------------------------------------------- 性能

/// §7 的验收标准：5000 篇冷启动索引 < 10s。
/// CI 上跑 500 篇取十分之一的预算，够发现数量级上的退化。
#[test]
fn indexing_is_fast_enough() {
    let dir = std::env::temp_dir().join(format!("verso-perf-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&dir).unwrap();
    let _guard = Tmp(dir.clone());

    for i in 0..500 {
        std::fs::write(
            dir.join(format!("笔记{i}.md")),
            format!(
                "---\nid: 01{i:024}\ntitle: 笔记{i}\ntags: [批量]\n---\n\n\
                 第 {i} 篇，提到 [[笔记{}]]。内容用来撑起全文索引的体量，\
                 让 trigram 分词器有东西可切。\n",
                (i + 1) % 500
            ),
        )
        .unwrap();
    }

    let vault = Vault {
        root: dir.clone(),
        fs: Arc::new(DesktopFs::new()),
    };
    let mut idx = Index::open_memory().unwrap();
    let stats = idx.rebuild(&vault).unwrap();

    assert_eq!(stats.notes, 500);
    assert!(stats.elapsed_ms < 1000, "500 篇索引用了 {}ms，太慢", stats.elapsed_ms);

    let t = std::time::Instant::now();
    let hits = idx.search("trigram 分词器", 20).unwrap();
    let ms = t.elapsed().as_millis();
    assert!(!hits.is_empty());
    assert!(ms < 50, "搜索用了 {ms}ms，超过 50ms 的验收线");
}

// ---------------------------------------------------------------- 按标签查

#[test]
fn notes_by_tag_finds_both_frontmatter_and_inline_tags() {
    let (_t, _v, idx) = sample();
    // 「数学」来自 frontmatter，「矩阵论」来自正文里的 #矩阵论
    let math: Vec<_> = idx
        .notes_by_tag("数学")
        .unwrap()
        .into_iter()
        .map(|n| n.name)
        .collect();
    assert_eq!(math, vec!["奇异值分解", "线性代数"]);

    let inline: Vec<_> = idx
        .notes_by_tag("矩阵论")
        .unwrap()
        .into_iter()
        .map(|n| n.name)
        .collect();
    assert_eq!(inline, vec!["线性代数"]);
}

#[test]
fn notes_by_tag_ignores_tags_inside_code_blocks() {
    // 特征值.md 的代码块里有 #假标签。一篇讲 Markdown 语法的笔记
    // 不该把自己的示例全变成标签
    let (_t, _v, idx) = sample();
    assert!(idx.notes_by_tag("假标签").unwrap().is_empty());
}

#[test]
fn notes_by_tag_includes_nested_children() {
    // §2.4 的 #嵌套/标签。点父标签要能看到子标签下的笔记，
    // 否则父标签永远是空的，嵌套就白分了
    let (_t, _v, idx) = setup(&[
        ("a.md", "---\nid: 01AAAAAAAAAAAAAAAAAAAAAAAA\ntitle: 甲\ntags: [项目/写作]\n---\n\n正文\n"),
        ("b.md", "---\nid: 01BBBBBBBBBBBBBBBBBBBBBBBB\ntitle: 乙\ntags: [项目]\n---\n\n正文\n"),
        ("c.md", "---\nid: 01CCCCCCCCCCCCCCCCCCCCCCCC\ntitle: 丙\ntags: [项目管理]\n---\n\n正文\n"),
    ]);
    let names: Vec<_> = idx
        .notes_by_tag("项目")
        .unwrap()
        .into_iter()
        .map(|n| n.name)
        .collect();
    // 「项目管理」是另一个标签，不是「项目」的子标签 —— 前缀匹配必须
    // 带上分隔符，否则会把它误收进来
    assert_eq!(names, vec!["乙", "甲"]);
}

#[test]
fn notes_by_tag_escapes_like_wildcards() {
    // 标签是用户写的。含 % 或 _ 时不转义，LIKE 会把它当通配符，
    // 于是点一个标签列出一堆无关笔记
    let (_t, _v, idx) = setup(&[
        ("a.md", "---\nid: 01AAAAAAAAAAAAAAAAAAAAAAAA\ntitle: 甲\ntags: [\"a_b/x\"]\n---\n\n正文\n"),
        ("b.md", "---\nid: 01BBBBBBBBBBBBBBBBBBBBBBBB\ntitle: 乙\ntags: [\"axb/y\"]\n---\n\n正文\n"),
    ]);
    let names: Vec<_> = idx
        .notes_by_tag("a_b")
        .unwrap()
        .into_iter()
        .map(|n| n.name)
        .collect();
    assert_eq!(names, vec!["甲"]);
}

#[test]
fn notes_by_tag_returns_empty_for_unknown_tag() {
    let (_t, _v, idx) = sample();
    assert!(idx.notes_by_tag("不存在的标签").unwrap().is_empty());
}

/// 文档树上的图标走索引（§2.3 的 `icon`），不逐篇读 frontmatter
#[test]
fn icons_come_from_frontmatter() {
    let (_t, _v, idx) = setup(&[
        ("甲.md", "---\nicon: 📘\n---\n\n正文\n"),
        ("乙.md", "---\ntitle: 乙\n---\n\n正文\n"),
    ]);
    let icons = idx.icons().unwrap();
    assert_eq!(icons, vec![("甲.md".to_string(), "📘".to_string())]);
}

/// `icon:` 被写成空串或数组时不能让树少一行、更不能报错 —— 图标是装饰
#[test]
fn icons_tolerate_odd_values() {
    let (_t, _v, idx) = setup(&[
        ("空.md", "---\nicon: \"\"\n---\n\n正文\n"),
        ("多.md", "---\nicon: [📘, 📗]\n---\n\n正文\n"),
    ]);
    let icons = idx.icons().unwrap();
    assert!(!icons.iter().any(|(p, _)| p == "空.md"), "空值不该算图标");
    let multi: Vec<_> = icons.iter().filter(|(p, _)| p == "多.md").collect();
    assert!(!multi.is_empty(), "数组至少要给出一个值，由调用方取第一个");
}
