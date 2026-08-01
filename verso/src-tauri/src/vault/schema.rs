//! 属性 schema —— 用户**指定**的类型和选项。DESIGN.md §2.6
//!
//! ## 为什么不放 `.verso/`
//!
//! 铁律第 6 条：`.verso/` 只放派生数据，必须能整个删掉重建。「这一列是单选，
//! 选项是这三个」是用户的决定，推断不出来，删了就没了 —— 它不属于那里。
//!
//! 所以和手动排序一样落在 **vault 根的 `.verso-props.json`**：进 git、跟着
//! 仓库走、换台机器还在。删掉它也不丢任何笔记数据，只是退回按值推断类型
//! （索引里的 `props.type`），编辑控件退化成文本框。
//!
//! ## 为什么不写进 frontmatter
//!
//! 它描述的是「属性」而不是「某一篇笔记」，写进每篇笔记就是把同一份定义抄
//! 几百遍；而且笔记是可以单独分享出去的（§2.9），不该带着全库的 schema。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

use super::Vault;

pub const FILE: &str = ".verso-props.json";

/// `error.rs` 里没有 JSON 变体，也不值得为一个 UI 提示文件加一个
fn to_json(schema: &Schema) -> Result<String> {
    serde_json::to_string_pretty(schema)
        .map(|s| s + "\n")
        .map_err(|e| Error::Vault(format!("写 {FILE} 失败: {e}")))
}

/// 支持的类型。**刻意只做 Markdown 装得下的那几种** ——
/// 关联关系、函数、汇总要一套表达式引擎和跨笔记引用，那是另一个量级的东西，
/// 也超出「纯 `.md` 文件」能承载的范围（§0 第 1 条）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PropType {
    Text,
    Number,
    Date,
    Checkbox,
    Select,
    Multi,
    Url,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PropDef {
    pub r#type: Option<PropType>,
    /// 单选 / 多选的候选值。别的类型忽略
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
}

/// 整份 schema：属性名 → 定义。用 BTreeMap 是为了**写出去的键序稳定** ——
/// HashMap 每次序列化顺序都可能不同，git diff 会无端抖动
pub type Schema = BTreeMap<String, PropDef>;

impl Vault {
    /// 读 schema。文件不在、或者内容坏了都返回空的 —— 它是 UI 提示，
    /// 不该因为一个坏 JSON 就让整个 database 视图打不开
    pub fn prop_schema(&self) -> Schema {
        let Ok(abs) = self.resolve(FILE) else {
            return Schema::new();
        };
        self.fs
            .read_to_string(&abs)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// 改一个属性的定义。`def` 为 None = 把这条删掉（回到按值推断）
    pub fn set_prop_def(&self, key: &str, def: Option<PropDef>) -> Result<()> {
        let mut schema = self.prop_schema();
        match def {
            None => {
                schema.remove(key);
            }
            Some(d) => {
                schema.insert(key.to_string(), d);
            }
        }
        let abs = self.resolve(FILE)?;
        if schema.is_empty() {
            // 空了就把文件删掉，别在 vault 根留一个 `{}`
            if self.fs.exists(&abs) {
                self.fs.remove_file(&abs)?;
            }
            return Ok(());
        }
        self.fs
            .write_atomic(&abs, &to_json(&schema)?)
    }

    /// schema 里跟着改名。属性重命名时和笔记一起动，否则定义会指向一个
    /// 不再存在的键
    pub fn rename_prop_def(&self, from: &str, to: &str) -> Result<()> {
        let mut schema = self.prop_schema();
        if let Some(def) = schema.remove(from) {
            schema.insert(to.to_string(), def);
            let abs = self.resolve(FILE)?;
            self.fs
                .write_atomic(&abs, &to_json(&schema)?)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_at(dir: &std::path::Path) -> Vault {
        Vault::open(dir.to_path_buf()).unwrap().0
    }

    #[test]
    fn round_trips_and_cleans_up_after_itself() {
        let dir = std::env::temp_dir().join(format!("verso-schema-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        assert!(v.prop_schema().is_empty(), "没有文件时是空 schema，不是报错");

        v.set_prop_def(
            "status",
            Some(PropDef {
                r#type: Some(PropType::Select),
                options: vec!["未读".into(), "在读".into(), "已读".into()],
            }),
        )
        .unwrap();
        let s = v.prop_schema();
        assert_eq!(s["status"].r#type, Some(PropType::Select));
        assert_eq!(s["status"].options.len(), 3);

        v.rename_prop_def("status", "阅读状态").unwrap();
        assert!(v.prop_schema().contains_key("阅读状态"));

        // 删光之后不该在 vault 根留一个 `{}`
        v.set_prop_def("阅读状态", None).unwrap();
        assert!(!dir.join(FILE).exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// schema 是 UI 提示，坏了也不能让 database 视图打不开
    #[test]
    fn broken_json_degrades_to_empty() {
        let dir = std::env::temp_dir().join(format!("verso-schema-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), "{ 这不是 json").unwrap();
        assert!(vault_at(&dir).prop_schema().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }
}
