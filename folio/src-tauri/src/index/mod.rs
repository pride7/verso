//! SQLite 索引。DESIGN.md §2.5
//!
//! 全部是派生数据 —— `.folio/index.db` 删掉后会重建，只丢时间不丢内容。
//! 这是「Markdown 是唯一真源」那条原则的可执行定义。

pub mod parse;
pub mod schema;
pub mod view;

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::vault::{note, tree::NodeKind, NoteRef, Vault};

pub struct Index {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    /// 命中处的上下文片段，已用 <mark> 标出
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub path: String,
    pub title: String,
    pub line: i64,
    /// 出处那一行的原文
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub notes: usize,
    pub links: usize,
    pub tags: usize,
    pub elapsed_ms: u64,
}

/// 一篇笔记在索引里的完整快照，写库时一次性传进去
struct NoteRecord {
    id: String,
    path: String,
    parent_id: Option<String>,
    title: String,
    created: Option<String>,
    updated: Option<String>,
    mtime_ms: i64,
    size: i64,
    content_hash: String,
    body: String,
    parsed: parse::Parsed,
    props: Vec<parse::Prop>,
}

impl Index {
    pub fn open(vault_root: &Path) -> Result<Self> {
        let dir = vault_root.join(".folio");
        std::fs::create_dir_all(&dir)?;
        let conn = Connection::open(dir.join("index.db"))?;
        schema::init(&conn)?;
        Ok(Index { conn })
    }

    #[cfg(test)]
    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        schema::init(&conn)?;
        Ok(Index { conn })
    }

    /// 全量重建。打开 vault 时跑一次。
    ///
    /// 验收目标是 5000 篇 < 10s，所以整个过程包在一个事务里 —— 逐条提交
    /// 的话每次写入都要 fsync，慢一个数量级。
    pub fn rebuild(&mut self, vault: &Vault) -> Result<IndexStats> {
        let started = std::time::Instant::now();
        let records = collect_records(vault)?;

        let tx = self.conn.transaction()?;
        tx.execute_batch(
            "DELETE FROM props; DELETE FROM tags; DELETE FROM links;
             DELETE FROM notes; DELETE FROM notes_fts; DELETE FROM fts_map;",
        )?;
        for (i, rec) in records.iter().enumerate() {
            write_record(&tx, rec, i as i64 + 1)?;
        }
        resolve_links(&tx)?;
        tx.commit()?;

        Ok(IndexStats {
            notes: records.len(),
            links: records.iter().map(|r| r.parsed.links.len()).sum(),
            tags: records.iter().map(|r| r.parsed.tags.len()).sum(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    /// 单篇更新。保存、或监听到外部修改时调用。
    pub fn update_note(&mut self, vault: &Vault, rel: &str) -> Result<()> {
        let abs = vault.resolve(rel)?;
        if !abs.is_file() {
            return self.remove_note(rel);
        }
        let rec = read_record(vault, rel, &abs)?;

        let tx = self.conn.transaction()?;
        let old_rowid: Option<i64> = tx
            .query_row(
                "SELECT m.rowid FROM fts_map m JOIN notes n ON n.id = m.note_id WHERE n.path = ?",
                [rel],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("DELETE FROM notes WHERE path = ?", [rel])?;
        if let Some(rid) = old_rowid {
            tx.execute("DELETE FROM notes_fts WHERE rowid = ?", [rid])?;
            tx.execute("DELETE FROM fts_map WHERE rowid = ?", [rid])?;
        }

        let rowid = old_rowid.unwrap_or_else(|| {
            tx.query_row("SELECT IFNULL(MAX(rowid), 0) + 1 FROM fts_map", [], |r| r.get(0))
                .unwrap_or(1)
        });
        write_record(&tx, &rec, rowid)?;
        resolve_links(&tx)?;
        tx.commit()?;
        Ok(())
    }

    pub fn remove_note(&mut self, rel: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        let rowid: Option<i64> = tx
            .query_row(
                "SELECT m.rowid FROM fts_map m JOIN notes n ON n.id = m.note_id WHERE n.path = ?",
                [rel],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("DELETE FROM notes WHERE path = ?", [rel])?;
        if let Some(rid) = rowid {
            tx.execute("DELETE FROM notes_fts WHERE rowid = ?", [rid])?;
            tx.execute("DELETE FROM fts_map WHERE rowid = ?", [rid])?;
        }
        resolve_links(&tx)?;
        tx.commit()?;
        Ok(())
    }

    /// 全文搜索。验收目标 < 50ms。
    ///
    /// **两条路径**：trigram 分词器要求查询至少 3 个字符，而「矩阵」「线性」
    /// 「函数」这些两字词恰恰是中文里最常见的搜索词 —— 只走 FTS 的话它们
    /// 一个都搜不到。短查询退回 LIKE 全表扫描：慢一个数量级，但万级笔记的
    /// 正文总量也就几 MB，实测仍在验收线内。
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        if q.chars().count() < 3 {
            return self.search_like(q, limit);
        }
        self.search_fts(q, limit)
    }

    /// 短查询用 LIKE。没有 snippet()，自己截一段上下文出来。
    fn search_like(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let pattern = format!("%{}%", query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let mut stmt = self.conn.prepare(
            "SELECT n.path, n.title, f.body
             FROM notes_fts f
             JOIN fts_map m ON m.rowid = f.rowid
             JOIN notes n   ON n.id = m.note_id
             WHERE f.body LIKE ?1 ESCAPE '\\' OR f.title LIKE ?1 ESCAPE '\\'
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        let collected: std::result::Result<Vec<_>, _> = rows.collect();
        Ok(collected?
            .into_iter()
            .map(|(path, title, body)| SearchHit {
                snippet: excerpt(&body, query),
                path,
                title,
            })
            .collect())
    }

    fn search_fts(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut stmt = self.conn.prepare(
            "SELECT n.path, n.title,
                    snippet(notes_fts, 1, '<mark>', '</mark>', '…', 24)
             FROM notes_fts
             JOIN fts_map m ON m.rowid = notes_fts.rowid
             JOIN notes n   ON n.id = m.note_id
             WHERE notes_fts MATCH ?
             ORDER BY bm25(notes_fts, 4.0, 1.0)
             LIMIT ?",
        )?;
        // 必须先绑到局部变量：collect 产生的临时值借用了 stmt，
        // 直接作为块的尾表达式会让它活得比 stmt 还久
        let rows = stmt.query_map(params![schema::escape_fts(query), limit as i64], |r| {
            Ok(SearchHit {
                path: r.get(0)?,
                title: r.get(1)?,
                snippet: r.get(2)?,
            })
        })?;
        let out: std::result::Result<Vec<_>, _> = rows.collect();
        Ok(out?)
    }

    /// 反向链接：谁引用了这篇笔记（§2.2）
    #[allow(clippy::needless_lifetimes)]
    pub fn backlinks(&self, rel: &str) -> Result<Vec<Backlink>> {
        let mut stmt = self.conn.prepare(
            "SELECT src.path, src.title, l.line
             FROM links l
             JOIN notes tgt ON tgt.id = l.target_id
             JOIN notes src ON src.id = l.src_id
             WHERE tgt.path = ? AND src.path != ?
             ORDER BY src.title, l.line",
        )?;
        let mapped = stmt.query_map(params![rel, rel], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        let rows: Vec<(String, String, i64)> =
            mapped.collect::<std::result::Result<Vec<_>, _>>()?;
        // 上下文那一行的原文留给调用方补 —— 索引里不存正文，省空间
        Ok(rows
            .into_iter()
            .map(|(path, title, line)| Backlink {
                path,
                title,
                line,
                context: String::new(),
            })
            .collect())
    }

    /// 悬空链接：指向不存在的笔记。写作时用来发现打错的名字。
    pub fn dangling_links(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT src.path, l.target_text
             FROM links l JOIN notes src ON src.id = l.src_id
             WHERE l.target_id IS NULL
             ORDER BY src.path",
        )?;
        let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let out: std::result::Result<Vec<_>, _> = mapped.collect();
        Ok(out?)
    }

    pub fn all_tags(&self) -> Result<Vec<(String, i64)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT tag, count(*) FROM tags GROUP BY tag ORDER BY count(*) DESC, tag")?;
        let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let out: std::result::Result<Vec<_>, _> = mapped.collect();
        Ok(out?)
    }

    /// 带某个标签的笔记。标签面板点一下就列出来。
    ///
    /// 嵌套标签（§2.4 的 `#嵌套/标签`）要连子标签一起算：点「数学」应当
    /// 也看到「数学/线性代数」下的笔记，否则父标签点开永远是空的，
    /// 嵌套就白分了。
    ///
    /// `LIKE` 的模式串里 `%` `_` 要转义 —— 标签是用户写的，含这两个字符时
    /// 不转义会匹配到无关的标签。
    pub fn notes_by_tag(&self, tag: &str) -> Result<Vec<NoteRef>> {
        let prefix = format!("{}/", escape_like(tag));
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT n.path, n.title
             FROM tags t JOIN notes n ON n.id = t.note_id
             WHERE t.tag = ?1 OR t.tag LIKE ?2 ESCAPE '\\'
             ORDER BY n.title",
        )?;
        let mapped = stmt.query_map(params![tag, format!("{prefix}%")], |r| {
            Ok(NoteRef {
                path: r.get(0)?,
                name: r.get(1)?,
            })
        })?;
        let out: std::result::Result<Vec<_>, _> = mapped.collect();
        Ok(out?)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

/// `LIKE` 的通配符转义。与 `schema::escape_fts` 同一类东西，
/// 都是「用户输入要进 SQL 的特殊语法位置」时的必要处理。
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

// --------------------------------------------------------------------------

/// LIKE 路径没有 FTS 的 snippet()，自己在命中处前后截一段，
/// 并用同样的 `<mark>` 标记，好让前端只处理一种格式。
fn excerpt(body: &str, needle: &str) -> String {
    let chars: Vec<char> = body.chars().collect();
    let lower: String = body.to_lowercase();
    let Some(byte_at) = lower.find(&needle.to_lowercase()) else {
        return chars.iter().take(60).collect();
    };
    // 字节位置换成字符位置
    let hit = body[..byte_at].chars().count();
    let start = hit.saturating_sub(20);
    let end = (hit + needle.chars().count() + 30).min(chars.len());

    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.extend(&chars[start..hit]);
    s.push_str("<mark>");
    s.extend(&chars[hit..(hit + needle.chars().count()).min(chars.len())]);
    s.push_str("</mark>");
    s.extend(&chars[(hit + needle.chars().count()).min(chars.len())..end]);
    if end < chars.len() {
        s.push('…');
    }
    s
}

fn collect_records(vault: &Vault) -> Result<Vec<NoteRecord>> {
    let mut out = Vec::new();
    let mut stack: Vec<(String, Option<String>)> = Vec::new();

    // 先把树扁平化，顺便记住 parent 关系
    fn walk(
        nodes: &[crate::vault::tree::TreeNode],
        parent: Option<String>,
        acc: &mut Vec<(String, Option<String>)>,
    ) {
        for n in nodes {
            let me = if n.kind == NodeKind::Document {
                acc.push((n.path.clone(), parent.clone()));
                Some(n.path.clone())
            } else {
                parent.clone()
            };
            walk(&n.children, me, acc);
        }
    }
    walk(&vault.tree()?, None, &mut stack);

    for (rel, parent_path) in stack {
        let abs = vault.resolve(&rel)?;
        if !abs.is_file() {
            continue;
        }
        let mut rec = read_record(vault, &rel, &abs)?;
        // parent 存的是路径，稍后统一换成 id
        rec.parent_id = parent_path;
        out.push(rec);
    }

    // 把 parent 的路径换成 id
    let by_path: std::collections::HashMap<String, String> =
        out.iter().map(|r| (r.path.clone(), r.id.clone())).collect();
    for r in &mut out {
        r.parent_id = r.parent_id.as_ref().and_then(|p| by_path.get(p).cloned());
    }
    Ok(out)
}

fn read_record(vault: &Vault, rel: &str, abs: &PathBuf) -> Result<NoteRecord> {
    let raw = vault.fs.read_to_string(abs)?;
    let (fm, body) = note::parse_frontmatter(&raw);
    let meta = vault.fs.metadata(abs)?;

    let stem = Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut parsed = parse::scan_body(&body);
    // frontmatter 里的 tags 与正文里的 #标签 合并（§2.3）
    if let Some(serde_yaml::Value::Sequence(items)) = fm.get("tags") {
        for it in items {
            if let Some(s) = it.as_str() {
                parsed.tags.push(s.to_string());
            }
        }
    }
    parsed.tags.sort();
    parsed.tags.dedup();

    Ok(NoteRecord {
        // 没有 id 的外来笔记用路径兜底 —— 首次保存时会补上真正的 ULID
        id: note::get_str(&fm, "id").unwrap_or_else(|| format!("path:{rel}")),
        path: rel.to_string(),
        parent_id: None,
        title: note::get_str(&fm, "title").unwrap_or(stem),
        created: note::get_str(&fm, "created"),
        updated: note::get_str(&fm, "updated"),
        mtime_ms: meta.mtime_ms,
        size: meta.size as i64,
        content_hash: blake3::hash(raw.as_bytes()).to_hex().to_string(),
        props: parse::flatten_props(&fm),
        parsed,
        body,
    })
}

fn write_record(tx: &Connection, rec: &NoteRecord, rowid: i64) -> Result<()> {
    tx.execute(
        "INSERT OR REPLACE INTO notes
         (id, path, parent_id, title, created, updated, mtime_ms, size, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            rec.id,
            rec.path,
            rec.parent_id,
            rec.title,
            rec.created,
            rec.updated,
            rec.mtime_ms,
            rec.size,
            rec.content_hash
        ],
    )?;

    for l in &rec.parsed.links {
        tx.execute(
            "INSERT INTO links (src_id, target_text, target_id, block_id, kind, line)
             VALUES (?1,?2,NULL,?3,?4,?5)",
            params![rec.id, l.target_text, l.block_id, l.kind.as_str(), l.line as i64],
        )?;
    }
    for t in &rec.parsed.tags {
        tx.execute("INSERT INTO tags (note_id, tag) VALUES (?1,?2)", params![rec.id, t])?;
    }
    for p in &rec.props {
        tx.execute(
            "INSERT INTO props (note_id, key, value, num, type) VALUES (?1,?2,?3,?4,?5)",
            params![rec.id, p.key, p.value, p.num, p.kind],
        )?;
    }

    tx.execute(
        "INSERT INTO fts_map (rowid, note_id) VALUES (?1, ?2)",
        params![rowid, rec.id],
    )?;
    tx.execute(
        "INSERT INTO notes_fts (rowid, title, body) VALUES (?1, ?2, ?3)",
        params![rowid, rec.title, rec.body],
    )?;
    Ok(())
}

/// 把 `[[目标]]` 的文本解析成真正的 note id。
///
/// 解析顺序照 §2.3：先按标题，再按路径（去掉 .md）。都找不到就留 NULL ——
/// 那是悬空链接，UI 上应当提示，而不是悄悄丢掉。
fn resolve_links(tx: &Connection) -> Result<()> {
    tx.execute(
        "UPDATE links SET target_id = (
            SELECT n.id FROM notes n WHERE n.title = links.target_text LIMIT 1
         )",
        [],
    )?;
    tx.execute(
        "UPDATE links SET target_id = (
            SELECT n.id FROM notes n
            WHERE n.path = links.target_text || '.md'
               OR replace(n.path, '.md', '') = links.target_text
            LIMIT 1
         ) WHERE target_id IS NULL",
        [],
    )?;
    Ok(())
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Vault(format!("索引操作失败: {e}"))
    }
}

#[cfg(test)]
mod tests;
