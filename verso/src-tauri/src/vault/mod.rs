pub mod agents;
pub mod attach;
pub mod fs;
pub mod git;
pub mod github;
pub mod note;
pub mod order;
pub mod ops;
pub mod review;
pub mod schema;
pub mod secret;
pub mod share;
pub mod sync;
// 安卓的 https 传输层。桌面不编它：那边 libgit2 自带 https；ureq 虽然也供
// 桌面的 GitHub API 使用，但传输层注册只能发生在安卓。
#[cfg(target_os = "android")]
pub mod transport;
pub mod tree;

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_yaml::Mapping;

use crate::error::{Error, Result};
use fs::{DesktopFs, VaultFs};
use note::NoteContent;
use tree::TreeNode;

pub struct Vault {
    pub root: PathBuf,
    pub fs: Arc<dyn VaultFs>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
    pub created_repo: bool,
    pub created_gitignore: bool,
    /// 把早期版本建出来的空仓库从 master 迁到了 main
    pub renamed_branch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub path: String,
    /// 新建的笔记没有 id —— frontmatter 里有什么全由用户决定（§2.3）
    pub id: Option<String>,
    pub title: String,
}

/// 快速切换器用的轻量条目。不含 id/时间戳 —— 那些数据量在大 vault 里
/// 会让一次性全量传输变得昂贵，而模糊匹配只需要名字和路径。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub path: String,
    pub name: String,
}

/// `甲、乙` / `甲, 乙` → YAML 数组。多选列和 tags 都用它
fn split_list(v: &str) -> Vec<serde_yaml::Value> {
    v.split(['、', ','])
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| serde_yaml::Value::String(s.to_string()))
        .collect()
}

impl Vault {
    /// 用共享的「自己写入」登记表打开 —— 文件监听靠它区分「我改的」和
    /// 「外部程序改的」（§2.7）
    pub fn open_watched(
        root: PathBuf,
        self_writes: std::sync::Arc<crate::watcher::SelfWrites>,
    ) -> Result<(Self, VaultInfo)> {
        let (mut v, info) = Self::open(root)?;
        v.fs = Arc::new(DesktopFs::with_self_writes(self_writes));
        Ok((v, info))
    }

    pub fn open(root: PathBuf) -> Result<(Self, VaultInfo)> {
        if !root.is_dir() {
            return Err(Error::Vault(format!("不是一个目录: {}", root.display())));
        }
        // 规范化，否则 `..` 之类会让后面的越界检查失效。
        //
        // **失败不算致命**：安卓的共享存储（`/storage/emulated/0/…`）是一层
        // FUSE，`canonicalize` 要沿路每一级都读得动，而中间那几级 App 往往
        // 没权限 —— 于是一个明明建得出来、写得进去的目录会在这里被判死，
        // 表现是「vault 打不开」而完全看不出为什么。
        //
        // 规范化失败时退回原路径。安全性不靠这一步：越界检查在 `resolve()`
        // 里对每一次访问单独做，而这里的 root 要么来自目录选择器、要么是
        // 我们自己拼的，本来就不是不可信输入。
        let root = root.canonicalize().unwrap_or(root);

        let g = git::ensure_repo(&root)?;
        // 给 vault 里的 AI CLI 补一份约定说明（§7.7）。和 .gitignore 一样是
        // 幂等的：缺了就补，有了不碰。
        //
        // **写不成不算致命** —— 只读介质、权限不足都可能失败，而那时正确的
        // 行为是照常打开 vault。一份说明文件不该成为「笔记打不开」的理由。
        // 共享空间只包含用户确认过的内容子树和附件。AGENTS.md 虽然在普通
        // vault 里是基础设施，放进这里却会变成额外共享内容。
        if !share::is_shared_space(&root) {
            let _ = agents::ensure(&root);
        }
        let info = VaultInfo {
            // 报给前端的是「人话」写法：canonicalize 在 Windows 上给的是
            // `\\?\D:\…`，那个前缀会原样出现在欢迎页、仓库管理器和 recent.json
            // 里。内部 I/O 仍用上面的 verbatim `root`，只有跨出边界这一份剥掉
            root: crate::winpath::for_external(&root).to_string_lossy().into_owned(),
            name: root
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "vault".into()),
            created_repo: g.created_repo,
            created_gitignore: g.created_gitignore,
            renamed_branch: g.renamed_branch,
        };

        Ok((
            Vault {
                root,
                fs: Arc::new(DesktopFs::new()),
            },
            info,
        ))
    }

    /// 把前端传来的相对路径解析成绝对路径，并**拒绝任何越界**。
    ///
    /// 这是唯一的防线。前端传 `../../Windows/System32/...` 不应该能读到
    /// vault 以外的东西 —— 尤其考虑到笔记内容可以来自分享和发布（§2.9），
    /// 路径不能当作可信输入。
    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let rel_path = Path::new(rel);
        if rel_path.is_absolute() {
            return Err(Error::PathEscape(rel.to_string()));
        }

        let mut out = self.root.clone();
        for comp in rel_path.components() {
            match comp {
                Component::Normal(c) => out.push(c),
                Component::CurDir => {}
                // 不做「弹出上一级」的宽容处理：正常操作不会产生 `..`，
                // 出现即视为攻击或 bug，直接拒绝。
                Component::ParentDir => return Err(Error::PathEscape(rel.to_string())),
                Component::RootDir | Component::Prefix(_) => {
                    return Err(Error::PathEscape(rel.to_string()))
                }
            }
        }
        Ok(out)
    }

    pub fn tree(&self) -> Result<Vec<TreeNode>> {
        tree::scan(self.fs.as_ref(), &self.root, "")
    }

    pub fn read_note(&self, rel: &str) -> Result<NoteContent> {
        let abs = self.resolve(rel)?;
        let raw = self.fs.read_to_string(&abs)?;
        let (fm, body) = note::parse_frontmatter(&raw);
        let meta = self.fs.metadata(&abs)?;

        let title = note::get_str(&fm, "title").unwrap_or_else(|| stem_of(rel));

        Ok(NoteContent {
            path: rel.to_string(),
            id: note::get_str(&fm, "id"),
            title,
            frontmatter: mapping_to_json(&fm),
            // 源码模式要看文件里真实的那几行，不是解析完再拼回去的
            frontmatter_text: note::split_frontmatter(&raw).0.map(str::to_string),
            body,
            mtime_ms: meta.mtime_ms,
        })
    }

    /// 保存正文。frontmatter 从磁盘上的旧版本继承 —— M0 的编辑器只编辑正文，
    /// 属性表单是 M1 的事。
    ///
    /// 返回写入后的 mtime，前端存下来用于「窗口重新聚焦时比对是否被外部改过」
    /// （§7.4 —— 有了终端跑 AI 之后，这是会丢数据的路径）。
    pub fn write_note(&self, rel: &str, body: &str) -> Result<i64> {
        let abs = self.resolve(rel)?;

        let mut fm: Mapping = if self.fs.exists(&abs) {
            let raw = self.fs.read_to_string(&abs)?;
            note::parse_frontmatter(&raw).0
        } else {
            Mapping::new()
        };
        // 只维护文件里**已经有**的字段，不补任何东西 —— 一篇没写过
        // frontmatter 的笔记，保存一百次也还是纯正文（§2.3）
        note::touch_updated(&mut fm);

        let out = note::serialize_note(&fm, body)?;
        self.fs.write_atomic(&abs, &out)?;
        Ok(self.fs.metadata(&abs)?.mtime_ms)
    }

    /// 新建文档。`parent_doc` 是父节点的相对路径（None = 建在 vault 根）。
    ///
    /// 父节点是文档（`X.md`）时按 §2.1 建出同名文件夹，子文档放进 `X/`；
    /// 是纯文件夹节点时它自己就是那个目录 —— 纯文件夹同样要能建子文档，
    /// 否则它在树上就是个死节点。
    pub fn create_note(&self, parent_doc: Option<&str>, title: &str) -> Result<NoteMeta> {
        let title = ops::validate_title(title)?;

        let dir_rel = match parent_doc {
            None => String::new(),
            Some(p) => {
                // 父文档 `数学/线性代数.md` → 子文档目录 `数学/线性代数`
                let d = match p.strip_suffix(".md") {
                    Some(s) => s.to_string(),
                    // 没有 .md 后缀：只认磁盘上真实存在的目录。随便一个字符串
                    // 都当目录建下去的话，前端传错路径会静悄悄造出一堆文件夹
                    None if self.fs.is_dir(&self.resolve(p)?) => p.to_string(),
                    None => return Err(Error::Vault(format!("父节点不是文档: {p}"))),
                };
                self.fs.create_dir_all(&self.resolve(&d)?)?;
                d
            }
        };

        let rel = if dir_rel.is_empty() {
            format!("{title}.md")
        } else {
            format!("{dir_rel}/{title}.md")
        };

        let abs = self.resolve(&rel)?;
        if self.fs.exists(&abs) {
            return Err(Error::Vault(format!("已存在同名文档: {rel}")));
        }

        // 空文件。§2.3：新建一篇笔记不该先替用户写好五行他没要求的 YAML
        self.fs.write_atomic(&abs, "")?;

        Ok(NoteMeta {
            path: rel,
            id: None,
            title: title.to_string(),
        })
    }

    /// 建一篇「未命名」，重名就往后编号。
    ///
    /// 和 `create_note` 分开，因为**同名的处理方式正好相反**：显式给了标题却
    /// 撞名，那是要报错的（改名时尤其如此，静悄悄给个别的名字等于没听懂）；
    /// 而「新建」这个动作里名字本来就是占位符，撞了就该自己让开。
    ///
    /// 让路径由后端定，前端不必先去数一遍有哪些文件 —— 那个数法在文件被
    /// 外部程序改动时会算错，而这里是**建之前的一瞬间**才检查的。
    pub fn create_untitled(&self, parent_doc: Option<&str>) -> Result<NoteMeta> {
        const BASE: &str = "未命名";
        for n in 1..1000 {
            let title = if n == 1 {
                BASE.to_string()
            } else {
                format!("{BASE} {n}")
            };
            match self.create_note(parent_doc, &title) {
                // 只有「已存在」才继续往后试。路径越界、目录建不出来这些
                // 得原样抛上去 —— 循环一千次再报错只会把真正的原因埋掉
                Err(Error::Vault(m)) if m.starts_with("已存在同名文档") => continue,
                other => return other,
            }
        }
        Err(Error::Vault("同一个目录下未命名文档太多了".into()))
    }

    /// 在模板目录里直接建一篇模板。§4.6
    ///
    /// 模板目录可能还不存在，所以不能直接走 `create_untitled(Some(dir))`：
    /// 普通新建有意拒绝凭空出现的父目录，而模板面板里的「新建模板」本来就
    /// 应当负责把配置好的目录建出来。路径仍先过 `resolve`，不能因为要建目录
    /// 就绕开 vault 的越界防线。
    pub fn create_template(&self, dir: &str) -> Result<NoteMeta> {
        let raw = dir.trim().replace('\\', "/");
        let clean = raw.trim_matches('/');
        if clean.is_empty() {
            return Err(Error::Vault("请先在设置里填写模板目录".into()));
        }
        let abs = self.resolve(clean)?;
        // `模板/./每日`、重复斜杠这类写法落盘后应当回到统一的 vault 相对路径，
        // 否则新文件虽然建出来了，却和前端按 `/` 匹配的模板目录对不上。
        let normalized = Path::new(clean)
            .components()
            .filter_map(|c| match c {
                Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("/");
        if normalized.is_empty() {
            return Err(Error::Vault("模板目录不能是笔记库根目录".into()));
        }
        self.fs.create_dir_all(&abs)?;

        const BASE: &str = "未命名模板";
        for n in 1..1000 {
            let title = if n == 1 {
                BASE.to_string()
            } else {
                format!("{BASE} {n}")
            };
            match self.create_note(Some(&normalized), &title) {
                Err(Error::Vault(m)) if m.starts_with("已存在同名文档") => continue,
                other => return other,
            }
        }
        Err(Error::Vault("同一个目录下未命名模板太多了".into()))
    }

    /// 源码模式（§4.2）里手改 frontmatter：用一段 YAML 原文换掉文件里那一段，
    /// **正文一个字节都不动**。
    ///
    /// 两条保险：
    ///
    /// 1. **解析不通过就不写。** YAML 缩进错一格是常事，那一刻文件里的旧内容
    ///    仍然是好的 —— 报错让人自己改，比写进去一个空 frontmatter 强得多。
    /// 2. **正文来自磁盘**，不从前端传。正文有它自己的保存路径（`write_note`），
    ///    两边各写各的一半，谁也不会盖掉谁。
    ///
    /// 交回一段空 YAML = **把整块删干净**，文件里连 `---` 都不留。以前这里会
    /// 把 `id` / `created` 补回来，现在不补了：frontmatter 里有什么由用户决定
    /// （§2.3）。
    pub fn write_frontmatter(&self, rel: &str, yaml: &str) -> Result<i64> {
        let abs = self.resolve(rel)?;
        let raw = self.fs.read_to_string(&abs)?;
        let (_, body) = note::parse_frontmatter(&raw);

        let mut fm = if yaml.trim().is_empty() {
            Mapping::new()
        } else {
            match serde_yaml::from_str::<serde_yaml::Value>(yaml) {
                Ok(serde_yaml::Value::Mapping(m)) => m,
                Ok(_) => return Err(Error::Vault("frontmatter 必须是「键: 值」的形式".into())),
                Err(e) => return Err(Error::Vault(format!("YAML 解析失败：{e}"))),
            }
        };

        note::touch_updated(&mut fm);
        self.fs.write_atomic(&abs, &note::serialize_note(&fm, &body)?)?;
        Ok(self.fs.metadata(&abs)?.mtime_ms)
    }

    /// 一个属性在多少篇笔记里出现过。重命名前要拿它去问用户
    pub fn count_prop(&self, key: &str) -> Result<usize> {
        let mut n = 0;
        for rel in self.note_list()?.into_iter().map(|n| n.path) {
            let abs = self.resolve(&rel)?;
            let raw = self.fs.read_to_string(&abs)?;
            if note::parse_frontmatter(&raw)
                .0
                .contains_key(serde_yaml::Value::String(key.to_string()))
            {
                n += 1;
            }
        }
        Ok(n)
    }

    /// **全库**重命名一个属性，返回改了多少篇。
    ///
    /// 属性是 vault 级的概念（类型也存在 vault 根的 `.verso-props.json`），
    /// 只改「当前视图收到的那些」会留下两个同义的键，比不改还乱。
    ///
    /// 真在动用户的文件，所以：前端必须先确认；这里逐篇走 `rename_prop`，
    /// 它保留原值、原类型、原位置（不是删旧建新）。中途某篇失败就停下并
    /// 把已改的篇数报回去 —— 说不清改到哪了是最糟的。
    pub fn rename_prop_everywhere(&self, from: &str, to: &str) -> Result<usize> {
        let mut n = 0;
        for rel in self.note_list()?.into_iter().map(|n| n.path) {
            let abs = self.resolve(&rel)?;
            let raw = self.fs.read_to_string(&abs)?;
            if !note::parse_frontmatter(&raw)
                .0
                .contains_key(serde_yaml::Value::String(from.to_string()))
            {
                continue;
            }
            self.rename_prop(&rel, from, to)?;
            n += 1;
        }
        self.rename_prop_def(from, to)?;
        Ok(n)
    }

    /// 改写一条 frontmatter 属性。DESIGN.md §2.6
    ///
    /// **这是 database 视图「可写」的实现基础** —— 在表格里改一个单元格
    /// 就是走这条路径改对应笔记的 frontmatter，然后文件落盘。设计文档说
    /// 「必须可写，这是它好不好用的分水岭」。
    ///
    /// `value` 为 None 表示删除该属性。
    pub fn set_prop(&self, rel: &str, key: &str, value: Option<&str>) -> Result<()> {
        // 这几个是内部字段，不能让 database 视图改掉 —— 改了 id 就等于
        // 把这篇笔记的身份换了，所有指向它的链接都会断
        if matches!(key, "id" | "created") {
            return Err(Error::Vault(format!("{key} 是内部字段，不能修改")));
        }

        let abs = self.resolve(rel)?;
        let raw = self.fs.read_to_string(&abs)?;
        let (mut fm, body) = note::parse_frontmatter(&raw);

        match value {
            None => {
                fm.remove(serde_yaml::Value::String(key.to_string()));
            }
            Some(v) => {
                let k = serde_yaml::Value::String(key.to_string());
                // **schema 说了算**（`.verso-props.json`）：用户把这一列指成
                // 「多选」，第一次填值就该写成数组，而不是等它碰巧已经是数组。
                // 指成「文本」的列也不该因为填了 `3` 就悄悄变成数字 ——
                // 那会让 `where 编号 = "3"` 之类的条件莫名其妙地不匹配
                let declared = self.prop_schema().get(key).and_then(|d| d.r#type);
                if let Some(t) = declared {
                    use schema::PropType::*;
                    let val = match t {
                        Multi => serde_yaml::Value::Sequence(split_list(v)),
                        Checkbox => serde_yaml::Value::Bool(v == "true" || v == "是"),
                        Number => v
                            .parse::<i64>()
                            .map(|n| serde_yaml::Value::Number(n.into()))
                            .or_else(|_| {
                                v.parse::<f64>()
                                    .map(|f| serde_yaml::Value::Number(serde_yaml::Number::from(f)))
                            })
                            // 数字列里填了非数字：留成文本而不是报错或吞掉 ——
                            // 用户看得见自己写了什么，才知道要改哪
                            .unwrap_or_else(|_| serde_yaml::Value::String(v.to_string())),
                        Text | Date | Select | Url => serde_yaml::Value::String(v.to_string()),
                    };
                    fm.insert(k, val);
                    note::touch_updated(&mut fm);
                    self.fs.write_atomic(&abs, &note::serialize_note(&fm, &body)?)?;
                    return Ok(());
                }
                // 没声明类型就还是按值猜（§2.6：schema 只是提示，删了不丢数据）
                let was_seq = matches!(fm.get(&k), Some(serde_yaml::Value::Sequence(_)));
                let new_val = if was_seq {
                    serde_yaml::Value::Sequence(split_list(v))
                } else if let Ok(n) = v.parse::<i64>() {
                    serde_yaml::Value::Number(n.into())
                } else if let Ok(f) = v.parse::<f64>() {
                    serde_yaml::Value::Number(serde_yaml::Number::from(f))
                } else if v == "true" || v == "false" {
                    serde_yaml::Value::Bool(v == "true")
                } else {
                    serde_yaml::Value::String(v.to_string())
                };
                fm.insert(k, new_val);
            }
        }

        note::touch_updated(&mut fm);
        self.fs.write_atomic(&abs, &note::serialize_note(&fm, &body)?)?;
        Ok(())
    }

    /// 给属性改名，**保留原值和原位置**。
    ///
    /// 不能用「删旧键 + 建新键」凑：
    ///
    /// 1. `set_prop` 只收字符串，新键没有原值可参考，`tags: [a, b]` 会被
    ///    压成字符串 `"a、b"` —— 类型丢了。
    /// 2. 删完再插，键会跑到 frontmatter 末尾。用户手写的顺序是有意义的，
    ///    重排会在 git diff 里显示成一大片改动。
    ///
    /// 所以这里整个重建 mapping，逐项搬过去，只把那一个键换掉。
    pub fn rename_prop(&self, rel: &str, from: &str, to: &str) -> Result<()> {
        let to = to.trim();
        if to.is_empty() {
            return Err(Error::Vault("属性名不能为空".into()));
        }
        if from == to {
            return Ok(());
        }
        for k in [from, to] {
            if matches!(k, "id" | "created") {
                return Err(Error::Vault(format!("{k} 是内部字段，不能修改")));
            }
        }

        let abs = self.resolve(rel)?;
        let raw = self.fs.read_to_string(&abs)?;
        let (fm, body) = note::parse_frontmatter(&raw);

        let from_key = serde_yaml::Value::String(from.to_string());
        let to_key = serde_yaml::Value::String(to.to_string());
        if !fm.contains_key(&from_key) {
            return Err(Error::Vault(format!("没有属性 {from}")));
        }
        // 覆盖等于悄悄删掉另一个属性 —— 宁可报错让用户自己决定
        if fm.contains_key(&to_key) {
            return Err(Error::Vault(format!("已经有一个属性叫 {to} 了")));
        }

        let mut next = serde_yaml::Mapping::new();
        for (k, v) in fm {
            if k == from_key {
                next.insert(to_key.clone(), v);
            } else {
                next.insert(k, v);
            }
        }

        note::touch_updated(&mut next);
        self.fs.write_atomic(&abs, &note::serialize_note(&next, &body)?)?;
        Ok(())
    }

    /// 只读取 mtime，用于「窗口重新聚焦时检查文件是否被外部程序改过」。
    /// 见 §7.4 —— 用 AI 改完文件回到编辑器，不能一保存就覆盖掉它的修改。
    pub fn stat(&self, rel: &str) -> Result<i64> {
        Ok(self.fs.metadata(&self.resolve(rel)?)?.mtime_ms)
    }
}

fn stem_of(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未命名".into())
}

fn mapping_to_json(m: &Mapping) -> serde_json::Value {
    serde_json::to_value(m).unwrap_or(serde_json::Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_at(root: &Path) -> Vault {
        Vault {
            root: root.to_path_buf(),
            fs: Arc::new(DesktopFs::new()),
        }
    }

    #[test]
    fn resolve_rejects_traversal() {
        let v = vault_at(Path::new("/vault"));
        for bad in ["../secret", "数学/../../secret", "..", "/etc/passwd"] {
            assert!(
                matches!(v.resolve(bad), Err(Error::PathEscape(_))),
                "应当拒绝: {bad}"
            );
        }
    }

    #[test]
    fn resolve_accepts_normal_paths() {
        let v = vault_at(Path::new("/vault"));
        assert_eq!(
            v.resolve("数学/线性代数.md").unwrap(),
            Path::new("/vault").join("数学").join("线性代数.md")
        );
        assert_eq!(v.resolve("./a.md").unwrap(), Path::new("/vault").join("a.md"));
    }

    /// 报给前端的 root 必须是人话写法：Windows 上 canonicalize 给的是
    /// `\\?\D:\…`，那个前缀曾经原样出现在欢迎页的 vault 列表里
    #[test]
    fn info_root_has_no_verbatim_prefix() {
        let dir = std::env::temp_dir().join(format!("verso-open-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();

        let (v, info) = Vault::open(dir.clone()).unwrap();

        assert!(
            !info.root.starts_with(r"\\?\"),
            "前端看到的 root 不该带 verbatim 前缀：{}",
            info.root
        );
        // 剥前缀只动报给前端的那一份；内部 I/O 仍用 canonicalize 的结果
        assert!(v.root.is_dir());
        assert_eq!(
            std::fs::canonicalize(&info.root).unwrap(),
            std::fs::canonicalize(&v.root).unwrap(),
            "两种写法必须指向同一个目录"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 建一个临时 vault，写入一篇带 frontmatter 的笔记
    fn vault_with(front: &str) -> (std::path::PathBuf, Vault) {
        let dir = std::env::temp_dir().join(format!("verso-prop-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), format!("---
{front}---

正文
")).unwrap();
        let v = vault_at(&dir);
        (dir, v)
    }

    #[test]
    fn rename_prop_keeps_value_type_and_position() {
        // 「删旧键 + 建新键」会把数组压成字符串、还把键挪到末尾。
        // 这两点正是这个命令存在的理由
        let (dir, v) = vault_with("id: 01AAAAAAAAAAAAAAAAAAAAAAAA
tags: [甲, 乙]
难度: 4
status: 在读
");
        v.rename_prop("a.md", "难度", "评分").unwrap();

        let raw = std::fs::read_to_string(dir.join("a.md")).unwrap();
        assert!(raw.contains("评分: 4"), "值和类型都要保留，实际：
{raw}");
        assert!(!raw.contains("难度"), "旧键要没了");
        // 顺序：tags 在前、评分在中、status 在后
        let t = raw.find("tags").unwrap();
        let r = raw.find("评分").unwrap();
        let st = raw.find("status").unwrap();
        assert!(t < r && r < st, "键的顺序不该被打乱：
{raw}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_prop_keeps_arrays_as_arrays() {
        let (dir, v) = vault_with("id: 01AAAAAAAAAAAAAAAAAAAAAAAA
tags: [甲, 乙]
");
        v.rename_prop("a.md", "tags", "标签").unwrap();
        let raw = std::fs::read_to_string(dir.join("a.md")).unwrap();
        assert!(raw.contains("甲") && raw.contains("乙"), "{raw}");
        assert!(!raw.contains("甲、乙"), "数组不能被压成一个字符串：
{raw}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_prop_refuses_to_overwrite() {
        // 覆盖等于悄悄删掉另一个属性
        let (dir, v) = vault_with("id: 01AAAAAAAAAAAAAAAAAAAAAAAA
甲: 1
乙: 2
");
        assert!(v.rename_prop("a.md", "甲", "乙").is_err());
        let raw = std::fs::read_to_string(dir.join("a.md")).unwrap();
        assert!(raw.contains("甲: 1") && raw.contains("乙: 2"), "失败时不能动文件");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_prop_refuses_internal_fields() {
        let (dir, v) = vault_with("id: 01AAAAAAAAAAAAAAAAAAAAAAAA
created: 2026-01-01T00:00:00+08:00
甲: 1
");
        // 改掉 id 等于换掉这篇笔记的身份，所有指向它的链接都会断
        assert!(v.rename_prop("a.md", "id", "标识").is_err());
        assert!(v.rename_prop("a.md", "created", "建于").is_err());
        // 也不能把别的属性改**成** id
        assert!(v.rename_prop("a.md", "甲", "id").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_prop_rejects_missing_or_empty() {
        let (dir, v) = vault_with("id: 01AAAAAAAAAAAAAAAAAAAAAAAA
甲: 1
");
        assert!(v.rename_prop("a.md", "不存在", "乙").is_err());
        assert!(v.rename_prop("a.md", "甲", "   ").is_err());
        // 改成自己是无操作，不该报错
        assert!(v.rename_prop("a.md", "甲", "甲").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_then_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        let meta = v.create_note(None, "测试笔记").unwrap();
        assert_eq!(meta.path, "测试笔记.md");
        // §2.3：新建的笔记是一个空文件，不替用户写任何 frontmatter
        assert!(meta.id.is_none());
        assert_eq!(std::fs::read_to_string(dir.join("测试笔记.md")).unwrap(), "");

        v.write_note(&meta.path, "$$E = mc^2$$\n").unwrap();
        let read = v.read_note(&meta.path).unwrap();
        assert_eq!(read.body, "$$E = mc^2$$\n");
        // 没有 title 就回落到文件名
        assert_eq!(read.title, "测试笔记");

        // 保存一百次也不该冒出 frontmatter
        let raw = std::fs::read_to_string(dir.join("测试笔记.md")).unwrap();
        assert_eq!(raw, "$$E = mc^2$$\n", "保存不能凭空加 frontmatter");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 源码模式（§4.2）要显示的是 frontmatter 在文件里的**原文**：
    /// 解析成映射再拼回去的话，键序、缩进、注释全没了 —— 那就不叫源码了。
    #[test]
    fn read_note_keeps_the_raw_frontmatter_text() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        let raw = "---\n# 这行注释解析完就没了\nstatus: 整理中\ntags:\n  - 索引页\n---\n正文\n";
        std::fs::write(dir.join("带属性.md"), raw).unwrap();

        let read = v.read_note("带属性.md").unwrap();
        assert_eq!(
            read.frontmatter_text.as_deref(),
            Some("# 这行注释解析完就没了\nstatus: 整理中\ntags:\n  - 索引页\n"),
        );
        assert_eq!(read.body, "正文\n");

        // 没有 frontmatter 的笔记必须是 None，不能是空字符串 ——
        // 前端靠它决定「要不要显示这一块」
        std::fs::write(dir.join("没属性.md"), "光秃秃的正文\n").unwrap();
        assert!(v.read_note("没属性.md").unwrap().frontmatter_text.is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// schema 说了算：多选列第一次填值就该写成数组；文本列填了 `3`
    /// 不该悄悄变成数字（那会让 `where 编号 = "3"` 莫名其妙不匹配）
    #[test]
    fn declared_type_decides_how_the_value_is_written() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);
        let meta = v.create_note(None, "笔记").unwrap();

        v.set_prop_def("标签", Some(schema::PropDef { r#type: Some(schema::PropType::Multi), options: vec![] })).unwrap();
        v.set_prop_def("编号", Some(schema::PropDef { r#type: Some(schema::PropType::Text), options: vec![] })).unwrap();
        v.set_prop_def("读完", Some(schema::PropDef { r#type: Some(schema::PropType::Checkbox), options: vec![] })).unwrap();

        v.set_prop(&meta.path, "标签", Some("甲、乙")).unwrap();
        v.set_prop(&meta.path, "编号", Some("3")).unwrap();
        v.set_prop(&meta.path, "读完", Some("true")).unwrap();

        let raw = std::fs::read_to_string(dir.join(&meta.path)).unwrap();
        let (fm, _) = note::parse_frontmatter(&raw);
        assert!(matches!(fm.get("标签"), Some(serde_yaml::Value::Sequence(s)) if s.len() == 2));
        assert!(matches!(fm.get("编号"), Some(serde_yaml::Value::String(s)) if s == "3"));
        assert_eq!(fm.get("读完"), Some(&serde_yaml::Value::Bool(true)));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 源码模式下手改 frontmatter：正文不能动，改坏了不能吃掉东西。
    #[test]
    fn write_frontmatter_replaces_only_the_front_matter() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        let meta = v.create_note(None, "笔记").unwrap();
        v.write_note(&meta.path, "正文第一行\n\n正文第二行\n").unwrap();

        v.write_frontmatter(&meta.path, "status: 在读\ntags:\n  - 甲\n  - 乙\n")
            .unwrap();

        let read = v.read_note(&meta.path).unwrap();
        // 正文一个字节都没动
        assert_eq!(read.body, "正文第一行\n\n正文第二行\n");
        assert_eq!(read.frontmatter["status"], "在读");
        assert_eq!(read.frontmatter["tags"][1], "乙");
        // 交回什么就是什么，不会多出用户没写的键
        assert!(read.frontmatter.get("id").is_none());

        // 源码模式下把整块选中删掉 = 交回一段空 YAML。文件里连 `---` 都不该剩
        v.write_frontmatter(&meta.path, "").unwrap();
        let bare = v.read_note(&meta.path).unwrap();
        assert!(bare.frontmatter_text.is_none(), "整块删干净就该是干净的");
        assert_eq!(
            std::fs::read_to_string(dir.join(&meta.path)).unwrap(),
            "正文第一行\n\n正文第二行\n"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// YAML 写错是常事。那一刻文件里的旧内容还是好的 —— 报错，别写。
    #[test]
    fn broken_yaml_leaves_the_file_alone() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        let meta = v.create_note(None, "笔记").unwrap();
        v.write_note(&meta.path, "别弄丢我\n").unwrap();
        v.write_frontmatter(&meta.path, "status: 在读\n").unwrap();
        let before = std::fs::read_to_string(dir.join(&meta.path)).unwrap();

        // 冒号后面缺空格、缩进也乱
        assert!(v.write_frontmatter(&meta.path, "status: [在读\n  tags: 甲\n").is_err());
        // 不是键值映射
        assert!(v.write_frontmatter(&meta.path, "- 只是一个列表\n").is_err());

        assert_eq!(std::fs::read_to_string(dir.join(&meta.path)).unwrap(), before);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 从 Obsidian vault / git clone / AI 生成来的 .md 通常没有 frontmatter。
    /// **保存之后它仍然没有** —— §2.3：Verso 不往用户的文件里塞他没要求的东西。
    /// 这条以前是反的（首次保存补 id），v0.5.12 起改成现在这样。
    #[test]
    fn foreign_note_stays_frontmatter_free() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        // 模拟外来文件：纯正文，没有 frontmatter
        std::fs::write(dir.join("外来.md"), "别处拿来的笔记\n").unwrap();
        assert!(v.read_note("外来.md").unwrap().id.is_none());

        v.write_note("外来.md", "别处拿来的笔记，改了一下\n").unwrap();

        let after = v.read_note("外来.md").unwrap();
        assert!(after.id.is_none(), "保存不该给它塞一个 id");
        assert!(after.frontmatter_text.is_none(), "文件里不该冒出 frontmatter");
        assert_eq!(after.body, "别处拿来的笔记，改了一下\n");

        // 再存一次也一样 —— 文件里始终只有那一行正文
        v.write_note("外来.md", "再改一次\n").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("外来.md")).unwrap(), "再改一次\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 时间戳不该带 9 位小数 —— 每次保存都会在 git diff 里制造一行噪音
    #[test]
    fn timestamps_are_second_precision() {
        let (mut fm, _) = note::parse_frontmatter("---\nupdated: 旧\n---\n");
        note::touch_updated(&mut fm);
        let updated = note::get_str(&fm, "updated").unwrap();
        assert!(!updated.contains('.'), "不该有小数秒: {updated}");
    }

    #[test]
    fn create_child_note_makes_same_named_folder() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        let parent = v.create_note(None, "线性代数").unwrap();
        let child = v.create_note(Some(&parent.path), "奇异值分解").unwrap();

        assert_eq!(child.path, "线性代数/奇异值分解.md");
        assert!(dir.join("线性代数.md").is_file(), "父文档本体仍是一个 .md");
        assert!(dir.join("线性代数").is_dir(), "同名文件夹应被建出来");

        std::fs::remove_dir_all(&dir).ok();
    }

    // 新建时名字只是个占位符，撞了就该自己让开 —— 和显式给标题时相反，
    // 那种情况撞名必须报错（改名时静悄悄换个名字等于没听懂）
    #[test]
    fn untitled_notes_number_themselves() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        assert_eq!(v.create_untitled(None).unwrap().path, "未命名.md");
        assert_eq!(v.create_untitled(None).unwrap().path, "未命名 2.md");
        assert_eq!(v.create_untitled(None).unwrap().path, "未命名 3.md");

        // 编号是**按目录**算的，子文档那边重新从头开始
        let parent = v.create_note(None, "数学").unwrap();
        assert_eq!(
            v.create_untitled(Some(&parent.path)).unwrap().path,
            "数学/未命名.md"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    // 只有「已存在」才该让循环继续。路径越界这类错误原样抛出，
    // 否则真正的原因会被一千次重试埋掉
    #[test]
    fn untitled_propagates_real_errors() {
        let v = vault_at(Path::new("/vault"));
        assert!(matches!(
            v.create_untitled(Some("../外面.md")),
            Err(Error::PathEscape(_))
        ));
    }

    #[test]
    fn create_template_makes_the_configured_directory_and_numbers_itself() {
        let dir = std::env::temp_dir().join(format!("verso-template-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        assert_eq!(
            v.create_template("资料/模板").unwrap().path,
            "资料/模板/未命名模板.md"
        );
        assert_eq!(
            v.create_template("资料\\模板/").unwrap().path,
            "资料/模板/未命名模板 2.md"
        );
        assert!(dir.join("资料/模板").is_dir());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_template_rejects_empty_and_escaping_directories() {
        let dir = std::env::temp_dir().join(format!("verso-template-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        assert!(v.create_template("  ").is_err());
        assert!(matches!(
            v.create_template("../../外面"),
            Err(Error::PathEscape(_))
        ));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_duplicate_and_invalid_titles() {
        let dir = std::env::temp_dir().join(format!("verso-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = vault_at(&dir);

        v.create_note(None, "甲").unwrap();
        assert!(v.create_note(None, "甲").is_err(), "重名应当报错而不是覆盖");
        assert!(v.create_note(None, "a/b").is_err(), "标题里的路径分隔符应被拒绝");
        assert!(v.create_note(None, "  ").is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
