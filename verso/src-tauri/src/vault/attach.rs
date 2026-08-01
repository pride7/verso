//! 附件落盘。DESIGN.md §2.1 / §2.3
//!
//! 附件统一放 vault 根的 `attachments/`（§0 的已定决策）。**不按笔记分目录**：
//! 笔记会改名、会移动、会变成别的笔记的子文档（§2.1 的同名文件夹），附件跟着
//! 走的话每一次都要改一堆 `![[]]`；放一处则永远不用动。
//!
//! 重名**不覆盖**，加时间戳后缀。粘贴来的图片十有八九叫 `image.png`，
//! 覆盖掉的是别人笔记里正在用的那一张 —— 这类数据损坏没有撤销。

use crate::error::{Error, Result};

use super::Vault;

/// 附件目录，相对 vault 根。§2.3 说过要可配置，暂时先按默认值来
pub const DIR: &str = "attachments";

/// 从文件名里挑出扩展名，顺便把它当成一道过滤。
///
/// 只认图片：这条路径是「粘贴板里的图片落盘」，不是通用的文件导入。
/// 不认识的扩展名一律拒绝，免得剪贴板里的任意字节被写进 vault。
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"];

/// 把 `name` 变成安全的文件名：只留最后一段、去掉路径分隔符和 Windows 保留字符。
///
/// 名字来自剪贴板/拖拽，属于外部输入。`Vault::resolve` 只拦 `..` 和绝对路径，
/// 这里再收一道，保证附件一定落在 `attachments/` 里面。
fn sanitize(name: &str) -> Result<(String, String)> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, ext) = base
        .rsplit_once('.')
        .ok_or_else(|| Error::Vault(format!("附件没有扩展名: {base}")))?;

    let ext = ext.to_ascii_lowercase();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err(Error::Vault(format!("暂时只支持图片附件，不认识 .{ext}")));
    }

    let stem: String = stem
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '-' } else { c })
        .collect();
    let stem = stem.trim().trim_matches('.').to_string();
    let stem = if stem.is_empty() { "image".to_string() } else { stem };
    Ok((stem, ext))
}

impl Vault {
    /// 写一个附件，返回它的 **vault 相对路径**（正斜杠），供前端拼 `![[]]`。
    pub fn write_attachment(&self, name: &str, bytes: &[u8]) -> Result<String> {
        if bytes.is_empty() {
            return Err(Error::Vault("附件是空的".into()));
        }
        let (stem, ext) = sanitize(name)?;

        let dir_abs = self.resolve(DIR)?;
        self.fs.create_dir_all(&dir_abs)?;

        let mut rel = format!("{DIR}/{stem}.{ext}");
        if self.fs.exists(&self.resolve(&rel)?) {
            // 重名不覆盖。时间戳到秒够用了，同一秒里连粘两张同名图的话
            // 后面还有一层计数
            let stamp = chrono::Local::now().format("%Y%m%d%H%M%S");
            rel = format!("{DIR}/{stem}-{stamp}.{ext}");
            let mut n = 2;
            while self.fs.exists(&self.resolve(&rel)?) {
                rel = format!("{DIR}/{stem}-{stamp}-{n}.{ext}");
                n += 1;
            }
        }

        self.fs.write_bytes(&self.resolve(&rel)?, bytes)?;
        Ok(rel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 重名不覆盖 —— 粘贴来的图十有八九叫同一个名字，
    /// 覆盖掉的是别的笔记正在用的那一张，这类损坏没有撤销
    #[test]
    fn writes_into_attachments_and_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("verso-att-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let (v, _) = Vault::open(dir.clone()).unwrap();

        let a = v.write_attachment("图.png", &[1, 2, 3]).unwrap();
        assert_eq!(a, "attachments/图.png");
        assert_eq!(std::fs::read(dir.join("attachments/图.png")).unwrap(), vec![1, 2, 3]);

        let b = v.write_attachment("图.png", &[4, 5, 6]).unwrap();
        assert_ne!(b, a, "重名要另起一个");
        assert_eq!(std::fs::read(dir.join("attachments/图.png")).unwrap(), vec![1, 2, 3]);

        assert!(v.write_attachment("空.png", &[]).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_takes_images() {
        assert!(sanitize("图.PNG").is_ok());
        assert!(sanitize("木马.exe").is_err());
        assert!(sanitize("没有扩展名").is_err());
    }

    /// 名字来自剪贴板，属于外部输入 —— 分隔符和 Windows 保留字符都得挡掉，
    /// 否则附件可能落到 `attachments/` 外面去
    #[test]
    fn sanitizes_hostile_names() {
        assert_eq!(sanitize("../../跑出去.png").unwrap(), ("跑出去".into(), "png".into()));
        assert_eq!(sanitize(r"C:\Windows\x.png").unwrap(), ("x".into(), "png".into()));
        assert_eq!(sanitize("a:b|c?.png").unwrap(), ("a-b-c-".into(), "png".into()));
        // 清干净之后什么都不剩，也得有个名字
        assert_eq!(sanitize("...png").unwrap().0, "image");
    }
}
