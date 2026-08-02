//! database 视图的查询。DESIGN.md §2.6
//!
//! 「不引入新的存储形态，全部建立在 frontmatter 之上。」
//! 数据来源是 `props` 表（frontmatter 摊平的结果），查询结果可写回 —— 这是
//! 它好不好用的分水岭：只能看不能改的表格，价值和一个静态列表差不多。

use std::collections::HashMap;

use rusqlite::{types::Value as SqlValue, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use super::local_rfc3339;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "kebab-case", default)]
pub struct ViewSpec {
    /// 路径 glob，如 `"论文/**"`
    pub from: Option<String>,
    /// 只要带这个标签的
    pub tag: Option<String>,
    /// 形如 `status != "已读" and 难度 >= 3`
    #[serde(rename = "where")]
    pub where_: Option<String>,
    /// 形如 `created desc`
    pub sort: Option<String>,
    /// table | board | list | gallery | calendar
    pub view: Option<String>,
    pub columns: Option<Vec<String>>,
    pub group_by: Option<String>,
    /// 日历视图按哪个日期属性摆。没写就用内置的 `created`
    pub date_field: Option<String>,
    /// 画廊视图拿哪一列当封面图（值是 vault 相对路径或 `![[图.png]]`）
    pub cover: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewRow {
    pub path: String,
    pub title: String,
    /// 只含 spec 里点名的列
    pub props: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewResult {
    pub rows: Vec<ViewRow>,
    pub columns: Vec<String>,
    pub view: String,
    pub group_by: Option<String>,
    /// 这批笔记身上出现过的**全部**属性（键 + 类型），按键名排序。
    ///
    /// 界面靠它做两件事：列头按类型显示图标（§2.6「UI 按类型渲染编辑控件」），
    /// 以及「加一列」时列出还没显示的那些。类型取该键出现最多的那种 ——
    /// 同一个键在不同笔记里可能一处写成数字一处写成文本，少数派不该决定图标。
    pub properties: Vec<PropMeta>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropMeta {
    pub key: String,
    /// 'string' | 'number' | 'bool' | 'date' | 'list'
    pub r#type: String,
}

#[derive(Debug, Clone, PartialEq)]
struct Condition {
    key: String,
    op: Op,
    value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
    Contains,
}

impl Op {
    fn parse(s: &str) -> Option<Op> {
        Some(match s {
            "=" | "==" => Op::Eq,
            "!=" => Op::Ne,
            ">" => Op::Gt,
            ">=" => Op::Ge,
            "<" => Op::Lt,
            "<=" => Op::Le,
            "contains" | "~" => Op::Contains,
            _ => return None,
        })
    }
}

/// 解析 `where` 表达式。
///
/// 只支持 `and` 连接的一串简单条件 —— 没有括号、没有 `or`。这不是偷懒：
/// 视图定义写在笔记里、由人手写，复杂表达式既难写对也难读懂。真需要复杂
/// 查询的场景，用几个视图分开表达更清楚。
fn parse_where(expr: &str) -> Result<Vec<Condition>> {
    let mut out = Vec::new();
    for part in split_top_level_and(expr) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        out.push(parse_condition(part)?);
    }
    Ok(out)
}

fn split_top_level_and(expr: &str) -> Vec<String> {
    // 引号里的 " and " 不算连接词
    let mut out = Vec::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut buf = String::new();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            buf.push(c);
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
            buf.push(c);
            i += 1;
            continue;
        }
        // 匹配独立的 " and "
        let rest: String = chars[i..].iter().take(5).collect();
        if rest.to_lowercase().starts_with(" and ") {
            out.push(buf.clone());
            buf.clear();
            i += 5;
            continue;
        }
        buf.push(c);
        i += 1;
    }
    out.push(buf);
    out
}

fn parse_condition(s: &str) -> Result<Condition> {
    // 从长到短匹配运算符，否则 `>=` 会被 `>` 抢走
    for op_str in [">=", "<=", "!=", "==", "contains", "~", "=", ">", "<"] {
        if let Some(idx) = find_op(s, op_str) {
            let key = s[..idx].trim();
            let value = s[idx + op_str.len()..].trim();
            if key.is_empty() {
                return Err(Error::Vault(format!("条件缺少属性名: {s}")));
            }
            return Ok(Condition {
                key: key.to_string(),
                op: Op::parse(op_str).unwrap(),
                value: unquote(value),
            });
        }
    }
    Err(Error::Vault(format!(
        "看不懂的条件: {s}（支持 = != > >= < <= contains）"
    )))
}

/// 找运算符位置，跳过引号内部。
///
/// **必须按 char 边界遍历**：属性名常常是中文（`难度`、`状态`），
/// 用字节下标做 `s[i..]` 会切在多字节字符中间直接 panic。
fn find_op(s: &str, op: &str) -> Option<usize> {
    let mut quote: Option<char> = None;
    for (i, c) in s.char_indices() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
            continue;
        }
        if !s[i..].starts_with(op) {
            continue;
        }
        // `contains` 这种词形运算符前后必须是空白，否则会在属性名里误匹配
        if op.chars().next().is_some_and(char::is_alphabetic) {
            let before_ok = s[..i].ends_with(' ');
            // op 全是 ASCII，所以 i + op.len() 仍是合法边界
            let after_ok = s[i + op.len()..].starts_with(' ');
            if before_ok && after_ok {
                return Some(i);
            }
        } else {
            return Some(i);
        }
    }
    None
}

fn unquote(s: &str) -> String {
    let t = s.trim();
    if t.len() >= 2 {
        let b = t.as_bytes();
        if (b[0] == b'"' && b[b.len() - 1] == b'"') || (b[0] == b'\'' && b[b.len() - 1] == b'\'') {
            return t[1..t.len() - 1].to_string();
        }
    }
    t.to_string()
}

/// 执行视图查询。
///
/// 所有用户输入都走参数绑定，绝不拼进 SQL —— 视图定义写在笔记里，
/// 而笔记可以来自分享或 AI 生成（§2.9、§7.5）。
pub fn query(conn: &Connection, spec: &ViewSpec) -> Result<ViewResult> {
    let mut sql = String::from(
        "SELECT n.id, n.path, n.title, n.created, n.updated, n.mtime_ms FROM notes n WHERE 1=1",
    );
    let mut args: Vec<SqlValue> = Vec::new();

    if let Some(from) = spec.from.as_deref().filter(|s| !s.trim().is_empty()) {
        sql.push_str(" AND n.path GLOB ?");
        args.push(SqlValue::Text(from.to_string()));
    }
    if let Some(tag) = spec.tag.as_deref().filter(|s| !s.trim().is_empty()) {
        sql.push_str(" AND n.id IN (SELECT note_id FROM tags WHERE tag = ?)");
        args.push(SqlValue::Text(tag.to_string()));
    }

    for c in parse_where(spec.where_.as_deref().unwrap_or(""))? {
        match c.op {
            // `!=` 要用 NOT IN：属性缺失的笔记也应当算「不等于」，
            // 用 `IN (… value != ?)` 会把它们漏掉
            Op::Ne => {
                sql.push_str(" AND n.id NOT IN (SELECT note_id FROM props WHERE key = ? AND value = ?)");
                args.push(SqlValue::Text(c.key));
                args.push(SqlValue::Text(c.value));
            }
            Op::Contains => {
                sql.push_str(
                    " AND n.id IN (SELECT note_id FROM props WHERE key = ? AND value LIKE '%' || ? || '%')",
                );
                args.push(SqlValue::Text(c.key));
                args.push(SqlValue::Text(c.value));
            }
            _ => {
                let cmp = match c.op {
                    Op::Eq => "=",
                    Op::Gt => ">",
                    Op::Ge => ">=",
                    Op::Lt => "<",
                    Op::Le => "<=",
                    _ => unreachable!(),
                };
                // 数值比较优先用 num 列 —— 按字符串比会得到 "10" < "9"
                let num = c.value.parse::<f64>().ok();
                if matches!(c.op, Op::Gt | Op::Ge | Op::Lt | Op::Le) && num.is_some() {
                    sql.push_str(&format!(
                        " AND n.id IN (SELECT note_id FROM props WHERE key = ? AND num IS NOT NULL AND num {cmp} ?)"
                    ));
                    args.push(SqlValue::Text(c.key));
                    args.push(SqlValue::Real(num.unwrap()));
                } else {
                    sql.push_str(&format!(
                        " AND n.id IN (SELECT note_id FROM props WHERE key = ? AND value {cmp} ?)"
                    ));
                    args.push(SqlValue::Text(c.key));
                    args.push(SqlValue::Text(c.value));
                }
            }
        }
    }

    // 排序
    let (sort_key, desc) = parse_sort(spec.sort.as_deref());
    match sort_key.as_deref() {
        None => sql.push_str(" ORDER BY n.title"),
        Some("title") => sql.push_str(if desc { " ORDER BY n.title DESC" } else { " ORDER BY n.title" }),
        Some("created") | Some("updated") => {
            let col = if sort_key.as_deref() == Some("created") { "created" } else { "updated" };
            sql.push_str(&format!(
                " ORDER BY n.{col} {}",
                if desc { "DESC" } else { "ASC" }
            ));
        }
        Some(k) => {
            // 自定义属性：num 优先，回退到字符串。NULL 一律排最后
            sql.push_str(
                " ORDER BY (SELECT num FROM props WHERE note_id = n.id AND key = ?1x) IS NULL,
                   (SELECT num FROM props WHERE note_id = n.id AND key = ?1x)",
            );
            sql.push_str(if desc { " DESC," } else { " ASC," });
            sql.push_str(" (SELECT value FROM props WHERE note_id = n.id AND key = ?1x)");
            sql.push_str(if desc { " DESC" } else { " ASC" });
            // ?1x 是占位记号，统一换成真正的参数序号
            let n = args.len() + 1;
            sql = sql.replace("?1x", &format!("?{n}"));
            args.push(SqlValue::Text(k.to_string()));
        }
    }

    sql.push_str(" LIMIT ?");
    args.push(SqlValue::Integer(spec.limit.unwrap_or(500) as i64));

    let mut stmt = conn.prepare(&sql)?;
    let mapped = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, i64>(5)?,
        ))
    })?;
    type Base = (String, String, String, Option<String>, Option<String>, i64);
    let base: Vec<Base> = mapped.collect::<std::result::Result<Vec<_>, _>>()?;

    // 需要展示哪些列
    let mut columns = spec.columns.clone().unwrap_or_else(|| vec!["title".into()]);
    // 分组、日历的日期、画廊的封面这三个键**必须**跟着一起取值 —— 下面只把
    // `columns` 里点名的属性放进每一行。漏了它们的话，看板会全部掉进
    // 「未设置」、日历一格都排不出来，而表面上看只是「视图空的」
    for extra in [&spec.group_by, &spec.date_field, &spec.cover] {
        if let Some(k) = extra.as_deref().filter(|s| !s.trim().is_empty()) {
            if !columns.iter().any(|c| c == k) {
                columns.push(k.to_string());
            }
        }
    }

    let ids: Vec<String> = base.iter().map(|b| b.0.clone()).collect();

    // 一次把所有行的属性取出来，避免 N+1 次查询
    let mut props_by_note: HashMap<String, HashMap<String, String>> = HashMap::new();
    if !base.is_empty() {
        let mut ps = conn.prepare("SELECT note_id, key, value FROM props")?;
        let rows = ps.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        for row in rows {
            let (id, k, v) = row?;
            let e = props_by_note.entry(id).or_default();
            // 同一个 key 有多行（数组展开）时用顿号连起来展示
            e.entry(k)
                .and_modify(|old| {
                    old.push('、');
                    old.push_str(&v);
                })
                .or_insert(v);
        }
    }

    // 这批笔记身上都有哪些属性 —— 「加一列」要从这里挑
    let mut kinds: HashMap<String, HashMap<String, usize>> = HashMap::new();
    if !ids.is_empty() {
        let ph = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
        let mut ts = conn.prepare(&format!(
            "SELECT key, type FROM props WHERE note_id IN ({ph})"
        ))?;
        let rows = ts.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (k, t) = row?;
            *kinds.entry(k).or_default().entry(t).or_insert(0) += 1;
        }
    }
    let mut properties: Vec<PropMeta> = kinds
        .into_iter()
        .map(|(key, ts)| {
            // 少数派不该决定这一列的图标
            let r#type = ts
                .into_iter()
                .max_by_key(|(_, n)| *n)
                .map(|(t, _)| t)
                .unwrap_or_else(|| "string".into());
            PropMeta { key, r#type }
        })
        .collect();
    properties.sort_by(|a, b| a.key.cmp(&b.key));
    // 内置的两列排在最后，和 frontmatter 里的属性分开
    for key in ["created", "updated"] {
        if !properties.iter().any(|p| p.key == key) {
            properties.push(PropMeta { key: key.into(), r#type: "date".into() });
        }
    }

    let rows = base
        .into_iter()
        .map(|(id, path, title, created, updated, mtime)| {
            let all = props_by_note.remove(&id).unwrap_or_default();
            let mut props = HashMap::new();
            // 文件本身的时间是**内置列**，不在 frontmatter 里 —— §2.3 起
            // Verso 不往笔记里写 created/updated 了，但索引一直有（没写
            // frontmatter 的就回落到文件系统 mtime）。这样「按创建时间排」
            // 开箱即用，不必先往每篇笔记里塞一个时间戳
            let fallback = local_rfc3339(mtime);
            for c in &columns {
                match c.as_str() {
                    "title" => {
                        props.insert(c.clone(), title.clone());
                    }
                    "created" => {
                        if let Some(v) = created.clone().or_else(|| fallback.clone()) {
                            props.insert(c.clone(), v);
                        }
                    }
                    "updated" => {
                        if let Some(v) = updated.clone().or_else(|| fallback.clone()) {
                            props.insert(c.clone(), v);
                        }
                    }
                    _ => {
                        if let Some(v) = all.get(c) {
                            props.insert(c.clone(), v.clone());
                        }
                    }
                }
            }
            ViewRow { path, title, props }
        })
        .collect();

    Ok(ViewResult {
        rows,
        columns,
        view: spec.view.clone().unwrap_or_else(|| "table".into()),
        group_by: spec.group_by.clone(),
        properties,
    })
}

fn parse_sort(sort: Option<&str>) -> (Option<String>, bool) {
    let Some(s) = sort.map(str::trim).filter(|s| !s.is_empty()) else {
        return (None, false);
    };
    let mut it = s.split_whitespace();
    let key = it.next().map(str::to_string);
    let desc = it.next().is_some_and(|d| d.eq_ignore_ascii_case("desc"));
    (key, desc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_conditions() {
        let c = parse_where("status = 在读").unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].key, "status");
        assert_eq!(c[0].op, Op::Eq);
        assert_eq!(c[0].value, "在读");
    }

    #[test]
    fn strips_quotes_from_values() {
        assert_eq!(parse_where(r#"status = "已读""#).unwrap()[0].value, "已读");
        assert_eq!(parse_where("status = '已读'").unwrap()[0].value, "已读");
    }

    #[test]
    fn parses_and_chains() {
        let c = parse_where(r#"status != "已读" and 难度 >= 3"#).unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].op, Op::Ne);
        assert_eq!(c[1].op, Op::Ge);
        assert_eq!(c[1].value, "3");
    }

    /// 引号里的 " and " 是内容不是连接词
    #[test]
    fn and_inside_quotes_is_not_a_separator() {
        let c = parse_where(r#"title = "black and white""#).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].value, "black and white");
    }

    /// `>=` 必须整体匹配，否则会被 `>` 抢走、剩下 `= 3` 当成值
    #[test]
    fn longer_operators_win() {
        assert_eq!(parse_where("难度 >= 3").unwrap()[0].op, Op::Ge);
        assert_eq!(parse_where("难度 <= 3").unwrap()[0].op, Op::Le);
        assert_eq!(parse_where("难度 != 3").unwrap()[0].op, Op::Ne);
    }

    #[test]
    fn parses_contains() {
        let c = parse_where("作者 contains 张").unwrap();
        assert_eq!(c[0].op, Op::Contains);
        assert_eq!(c[0].value, "张");
    }

    #[test]
    fn rejects_nonsense() {
        assert!(parse_where("这不是条件").is_err());
        assert!(parse_where("= 没有属性名").is_err());
    }

    #[test]
    fn parses_sort_direction() {
        assert_eq!(parse_sort(Some("created desc")), (Some("created".into()), true));
        assert_eq!(parse_sort(Some("难度")), (Some("难度".into()), false));
        assert_eq!(parse_sort(None), (None, false));
    }
}
