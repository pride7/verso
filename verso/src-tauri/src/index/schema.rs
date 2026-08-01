//! SQLite 索引的 schema。DESIGN.md §2.5
//!
//! **这里的一切都是派生数据**，可以从 `.md` 文件完整重建。整个
//! `.verso/` 删掉后下次打开会重新索引一遍 —— 这是「Markdown 是唯一真源」
//! 那条原则的可执行定义（§2.1）。

use rusqlite::Connection;

use crate::error::Result;

/// schema 版本。改了 SQL 就 +1，旧库会被直接删掉重建 ——
/// 反正全是派生数据，写迁移脚本是浪费。
pub const SCHEMA_VERSION: i32 = 1;

const SCHEMA: &str = r#"
CREATE TABLE notes (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,   -- vault 相对路径，正斜杠
  parent_id     TEXT,                   -- 同名文件夹推导出的父文档
  title         TEXT NOT NULL,
  created       TEXT,
  updated       TEXT,
  mtime_ms      INTEGER NOT NULL,       -- 快速判断是否需要重解析
  size          INTEGER NOT NULL,
  content_hash  TEXT NOT NULL           -- blake3，mtime 不可信时的兜底
);
CREATE INDEX idx_notes_parent ON notes(parent_id);
CREATE INDEX idx_notes_path ON notes(path);

CREATE TABLE links (
  src_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_text TEXT NOT NULL,            -- [[]] 里的原始文本
  target_id   TEXT,                     -- 解析成功的 note id；NULL = 悬空链接
  block_id    TEXT,                     -- 块引用时的 ^id
  kind        TEXT NOT NULL,            -- 'wiki' | 'embed'
  line        INTEGER NOT NULL
);
CREATE INDEX idx_links_target ON links(target_id);
CREATE INDEX idx_links_src ON links(src_id);

CREATE TABLE tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL
);
CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_tags_note ON tags(note_id);

-- frontmatter 展开成键值对 —— database 视图的查询基础（§2.6）
CREATE TABLE props (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  num     REAL,                         -- 能转成数字的同时存一份，排序才对
  type    TEXT NOT NULL                 -- 'string'|'number'|'bool'|'date'|'list'
);
CREATE INDEX idx_props_key ON props(key, value);
CREATE INDEX idx_props_note ON props(note_id);

-- 全文检索。tokenize='trigram' 是为中文选的，见下方说明。
--
-- 有意**不用** `content=''`（contentless 表）：那种表不支持 snippet()，
-- 而搜索结果需要显示命中上下文；删除也得改用 `INSERT ... VALUES('delete', …)`
-- 的特殊语法。让 FTS 自己存一份正文，多占的空间相对 trigram 索引本身
-- 微不足道，而索引整体本就是可以随时删掉重建的派生数据。
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body,
  tokenize='trigram'
);

-- fts 的 rowid 与 notes.id 的映射。fts5 只认整数 rowid。
CREATE TABLE fts_map (
  rowid   INTEGER PRIMARY KEY,
  note_id TEXT NOT NULL UNIQUE
);
"#;

/// 建库或重建。
///
/// 版本不符就整个删掉重来 —— 全是派生数据，没有迁移的必要。
pub fn init(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    let has_tables: bool = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='notes'",
            [],
            |r| r.get::<_, i32>(0),
        )
        .map(|n| n > 0)?;

    if has_tables && version == SCHEMA_VERSION {
        return Ok(());
    }

    if has_tables {
        conn.execute_batch(
            "DROP TABLE IF EXISTS notes_fts;
             DROP TABLE IF EXISTS fts_map;
             DROP TABLE IF EXISTS props;
             DROP TABLE IF EXISTS tags;
             DROP TABLE IF EXISTS links;
             DROP TABLE IF EXISTS notes;",
        )?;
    }

    conn.execute_batch(SCHEMA)?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

/// FTS5 的查询串需要转义。
///
/// 用户输入的 `AND` `OR` `NEAR` `"` `*` 在 FTS5 里都有语法含义，直接拼进去
/// 轻则报错重则查出莫名其妙的结果。把整段包成一个短语，让它按字面匹配。
/// trigram 分词器下这正是我们要的行为。
pub fn escape_fts(query: &str) -> String {
    let cleaned = query.replace('"', "\"\"");
    format!("\"{cleaned}\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_creates_schema_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        init(&conn).unwrap(); // 再来一次不该出错
        let n: i32 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0))
            .unwrap();
        assert!(n >= 5);
    }

    /// FTS5 内置的 unicode61/porter 不切分中文，整段中文会变成一个 token，
    /// 搜索基本失效。trigram 做三字符切分，天然支持中文子串检索。
    #[test]
    fn trigram_tokenizer_matches_chinese_substrings() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute(
            "INSERT INTO notes_fts(rowid, title, body) VALUES (1, ?, ?)",
            ["线性代数", "任意矩阵都可以做奇异值分解"],
        )
        .unwrap();

        let hit = |q: &str| -> i32 {
            conn.query_row(
                "SELECT count(*) FROM notes_fts WHERE notes_fts MATCH ?",
                [escape_fts(q)],
                |r| r.get(0),
            )
            .unwrap()
        };

        assert_eq!(hit("奇异值"), 1, "中文子串应当能搜到");
        assert_eq!(hit("可以做奇异"), 1, "跨词的连续子串也能搜到");
        assert_eq!(hit("泛函分析"), 0);

        // trigram 的硬限制：**查询短于 3 个字符时永远匹配不到**。
        // 而「矩阵」「线性」这些两字词恰恰是中文里最常见的搜索词，
        // 所以 Index::search 对短查询走 LIKE 回退，见 index/mod.rs。
        assert_eq!(hit("矩阵"), 0, "两字查询在 FTS 层匹配不到 —— 这正是要回退的原因");
    }

    /// 用户搜索框里打 `"` 或 `AND` 不该让查询炸掉
    #[test]
    fn escaping_survives_fts_operators() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute(
            "INSERT INTO notes_fts(rowid, title, body) VALUES (1, ?, ?)",
            ["测试", "a AND b 以及 \"引号\""],
        )
        .unwrap();

        for q in ["AND", "\"引号\"", "a AND b", "*", "NEAR"] {
            let r = conn.query_row(
                "SELECT count(*) FROM notes_fts WHERE notes_fts MATCH ?",
                [escape_fts(q)],
                |r| r.get::<_, i32>(0),
            );
            assert!(r.is_ok(), "查询 {q:?} 不该报错: {:?}", r.err());
        }
    }
}
