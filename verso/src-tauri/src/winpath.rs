//! 交给外部程序的路径要先"说人话"。
//!
//! vault 根是 `canonicalize()` 出来的（§2.1 的越界检查依赖它），而在 Windows 上
//! 那会得到**扩展长度写法**：`\\?\D:\Notes`。这个写法对 Win32 API 完全合法，
//! 我们自己读写文件一点问题没有 —— 但把它交给 shell 当工作目录，PowerShell
//! 会用 provider 限定名来表示当前位置：
//!
//! ```text
//! PS Microsoft.PowerShell.Core\FileSystem::\\?\D:\Notes> cd ..
//! Set-Location: Cannot process argument because the value of argument "path" is not valid.
//! ```
//!
//! 也就是**整个 `cd` 都废了**（`cd ..`、`cd 子目录`、`cd ~` 全部报错），提示符
//! 还长得吓人、一行占掉大半屏。作者报的「怎么 cd 都不支持，而且很难看」就是
//! 这一件事的两个症状。
//!
//! 所以：内部照旧用 verbatim 路径，**跨出进程边界之前**（起 shell、调系统终端）
//! 把前缀摘掉。

use std::path::{Path, PathBuf};

/// 摘掉 `\\?\` 前缀，让路径变回人和 shell 都认得的样子。
///
/// 只摘两种确定安全的：`\\?\C:\…`（盘符）和 `\\?\UNC\server\share`（网络路径，
/// 还原成 `\\server\share`）。**其余一律原样返回** —— `\\?\Volume{GUID}\…`
/// 这种设备路径摘掉前缀就不再指向同一个东西了，宁可难看也不能指错地方。
///
/// 非 Windows 上永远走不到那两个分支（`\\?\` 只是个普通文件名前缀），
/// 所以不加 `cfg`：少一份按平台分叉的代码，测试也能在任何平台上跑。
pub fn for_external(path: &Path) -> PathBuf {
    let s = path.as_os_str().to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        let b = rest.as_bytes();
        // 「盘符 + 冒号」才是普通路径，别的（Volume{…}、PIPE 之类）不碰
        if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_paths_lose_the_prefix() {
        assert_eq!(for_external(Path::new(r"\\?\D:\Notes")), Path::new(r"D:\Notes"));
        assert_eq!(for_external(Path::new(r"\\?\C:\")), Path::new(r"C:\"));
    }

    #[test]
    fn unc_paths_go_back_to_the_double_backslash_form() {
        assert_eq!(
            for_external(Path::new(r"\\?\UNC\nas\share\Notes")),
            Path::new(r"\\nas\share\Notes")
        );
    }

    #[test]
    fn device_paths_are_left_alone() {
        // 摘了前缀它就不指向同一个东西了 —— 难看也得留着
        let dev = r"\\?\Volume{9f3c1b2a-0000-0000-0000-100000000000}\Notes";
        assert_eq!(for_external(Path::new(dev)), Path::new(dev));
    }

    #[test]
    fn ordinary_paths_pass_through() {
        for p in [r"D:\Notes", "/home/me/notes", "notes"] {
            assert_eq!(for_external(Path::new(p)), Path::new(p));
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_canonicalized_path_still_points_at_the_same_place() {
        // 这条才是这个模块存在的理由：canonicalize 在 Windows 上产出的正是
        // verbatim 路径，而 shell 拿它当 cwd 就废了
        let here = std::fs::canonicalize(".").unwrap();
        assert!(here.to_string_lossy().starts_with(r"\\?\"));
        let plain = for_external(&here);
        assert!(!plain.to_string_lossy().starts_with(r"\\?\"));
        assert!(plain.is_dir());
    }
}
