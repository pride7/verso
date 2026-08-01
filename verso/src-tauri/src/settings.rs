//! 用户设置。DESIGN.md §6
//!
//! 和 [`crate::recent`] 一样存在**应用配置目录**，不在 `.verso/` 里：
//! 设置是跟着人走的（字号、主题、自己写的 snippet），换一个 vault 不该重来一遍。
//! 而且 `.verso/` 按第 6 条铁律必须能整个删掉重建，放设置进去就违规了。
//!
//! 每个字段都带 `#[serde(default)]`：设置文件是可以被用户手改的，少一个键、
//! 写坏一个值，都不该让应用起不来 —— 那时候用户连改回去的界面都打不开。

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// `"system"` | `"light"` | `"dark"`。
///
/// 用字符串而不是 enum：万一以后加主题（比如护眼色），旧版本读到不认识的值
/// 会回退到默认，而不是整个设置文件解析失败。
fn default_theme() -> String {
    "system".into()
}

fn default_tree_sort() -> String {
    "name".into()
}

fn default_tab_open() -> String {
    "new".into()
}

/// 主题色的色相与鲜艳度。默认是应用图标上那点青绿。
///
/// **明度不开放**：深浅两套主题各自需要不同的明度才看得清，让用户调它
/// 等于给了一个把界面调成看不见的机会。
fn default_accent_hue() -> f64 {
    195.0
}
fn default_accent_chroma() -> f64 {
    0.085
}

// §6.1 的排版尺度就是这几个默认值的出处
fn default_body_font_size() -> f64 {
    16.5
}
fn default_line_height() -> f64 {
    1.75
}
fn default_content_width() -> f64 {
    42.0
}
fn default_ui_font_size() -> f64 {
    14.0
}
fn default_terminal_font_size() -> f64 {
    // 12.5 太小了 —— 终端里读的是等宽小字，而且常常是 AI 刷出来的一屏日志
    13.5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,

    /// 正文字号（px）。中文比西文需要更大字号，默认 16.5
    pub body_font_size: f64,
    pub line_height: f64,
    /// 正文栏宽（rem）。超过约 40 汉字，眼睛回扫会丢行
    pub content_width: f64,
    /// 界面（侧栏、状态栏、面板）字号，与正文分开调
    pub ui_font_size: f64,

    /// 用户指定的字体名，空串表示用内置回退栈。
    /// 存**字体名**而不是整个 font-family 串 —— 前端会把它接在默认栈前面，
    /// 这样用户填一个装了的字体就行，不必自己写回退。
    pub body_font: String,
    pub mono_font: String,

    pub terminal_font_size: f64,
    /// 终端字体。留空跟随 `mono_font`
    pub terminal_font: String,

    /// 文档树排序方式。`"manual"` 时按每篇笔记 frontmatter 里的 `order` 排。
    ///
    /// 用字符串而不是 enum：以后加排序方式时，旧版本读到不认识的值会回退
    /// 到默认，而不是整个设置文件解析失败。
    pub tree_sort: String,

    /// 点侧栏里的文件时开新标签（`"new"`，默认）还是替换当前标签
    /// （`"replace"`）。两种模式下 Ctrl/⌘+点 和中键都强制开新标签。
    ///
    /// `#[serde(default)]`：老的设置文件里没这个键，缺了要回落到默认而不是
    /// 让整份设置解析失败
    #[serde(default = "default_tab_open")]
    pub tab_open: String,

    /// 主题色色相（oklch 的 h，0–360）。界面底色是中性灰，这个色相只用在
    /// 链接、焦点环、选中标记这些「重音」上
    #[serde(default = "default_accent_hue")]
    pub accent_hue: f64,
    /// 主题色鲜艳度（oklch 的 c）。0 = 完全无彩的石墨风
    #[serde(default = "default_accent_chroma")]
    pub accent_chroma: f64,

    /// 自定义 snippet，Latex Suite 那种 JSON 文本，原样存、由前端解析。
    ///
    /// 有意不在 Rust 侧建模：snippet 的编译规则（触发词、正则、标志位）全在
    /// 前端 `editor/snippets/types.ts` 里，在这边再写一份 schema 只会造出
    /// 两份会各自漂移的定义。Rust 这里只负责把这段文本原封不动地存下来。
    pub custom_snippets: String,

    /// 改过的快捷键：命令 id → 键位（`"Mod+Shift+P"`）。空串表示显式解绑。
    ///
    /// 和 snippet 一样**不在 Rust 侧建模**：命令表和键位写法全在前端
    /// `lib/keymap.ts` 里，这边再写一份只会造出两份各自漂移的定义。
    /// 只存**与默认不同**的那几条，所以将来调整默认键位时，没动过它的人
    /// 会跟着一起变。
    ///
    /// 用 `BTreeMap` 而不是 `HashMap`：设置文件是给人看、也可以手改的，
    /// 每次写盘键的顺序都变会让它没法进版本控制。
    pub keybindings: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            body_font_size: default_body_font_size(),
            line_height: default_line_height(),
            content_width: default_content_width(),
            ui_font_size: default_ui_font_size(),
            body_font: String::new(),
            mono_font: String::new(),
            terminal_font_size: default_terminal_font_size(),
            terminal_font: String::new(),
            tree_sort: default_tree_sort(),
            tab_open: default_tab_open(),
            accent_hue: default_accent_hue(),
            accent_chroma: default_accent_chroma(),
            custom_snippets: String::new(),
            keybindings: BTreeMap::new(),
        }
    }
}

impl Settings {
    /// 把明显不合理的值拉回可用范围。
    ///
    /// 存在的理由很实际：设置文件能手改，字号填成 0 或者 999 都会让界面
    /// **没法用**，而唯一能改回来的地方正是那个已经没法用的界面。宁可
    /// 悄悄夹紧，也不要把人锁在外面。
    pub fn sanitized(mut self) -> Self {
        if !matches!(self.theme.as_str(), "system" | "light" | "dark") {
            self.theme = default_theme();
        }
        if !matches!(
            self.tree_sort.as_str(),
            "manual" | "name" | "name-desc" | "created" | "updated"
        ) {
            self.tree_sort = default_tree_sort();
        }
        if !matches!(self.tab_open.as_str(), "new" | "replace") {
            self.tab_open = default_tab_open();
        }
        // 色相是环形的，超出范围绕回来而不是夹到端点 —— 夹的话 370 会
        // 变成 360（红），而它本该是 10（也是红），差别在别的角度上会很明显
        self.accent_hue = if self.accent_hue.is_finite() {
            self.accent_hue.rem_euclid(360.0)
        } else {
            default_accent_hue()
        };
        // 上限 0.16：再高在浅色主题下会刺眼，而这套界面的彩色本来就只做重音
        self.accent_chroma = clamp(self.accent_chroma, 0.0, 0.16, default_accent_chroma());
        self.body_font_size = clamp(self.body_font_size, 12.0, 28.0, default_body_font_size());
        self.line_height = clamp(self.line_height, 1.2, 2.4, default_line_height());
        self.content_width = clamp(self.content_width, 24.0, 80.0, default_content_width());
        self.ui_font_size = clamp(self.ui_font_size, 11.0, 20.0, default_ui_font_size());
        self.terminal_font_size = clamp(self.terminal_font_size, 9.0, 24.0, default_terminal_font_size());
        // 键位写法由前端管，这边只挡住明显是垃圾的：手改的文件里塞进来一段
        // 长文本，会让设置界面里那一行铺满整个面板
        self.keybindings
            .retain(|id, spec| id.len() <= 64 && spec.len() <= 64);
        self
    }
}

/// NaN 也要挡掉 —— JSON 里进不来，但手改的文件和前端的浮点运算都可能产出它，
/// 而 NaN 参与的比较全是 false，会悄悄穿过普通的范围检查。
fn clamp(v: f64, lo: f64, hi: f64, fallback: f64) -> f64 {
    if !v.is_finite() {
        return fallback;
    }
    v.clamp(lo, hi)
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn store(app: &AppHandle, data: &Settings) -> Result<()> {
    let path = settings_path(app).ok_or_else(|| Error::Vault("找不到应用配置目录".into()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| Error::Vault(format!("设置序列化失败: {e}")))?;
    // 这里和 recent.rs 不同，出错要报上去而不是忽略：用户在设置界面按下的
    // 每一次改动都该有反馈，静默失败会变成「改了没用」这种最难查的问题
    std::fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_design_doc() {
        let s = Settings::default();
        assert_eq!(s.theme, "system");
        assert_eq!(s.body_font_size, 16.5);
        assert_eq!(s.line_height, 1.75);
        assert_eq!(s.content_width, 42.0);
    }

    #[test]
    fn missing_keys_fall_back_to_defaults() {
        // 用户手改设置文件、或者新版本加了字段，旧文件都长这样
        let s: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.body_font_size, 16.5);
        assert_eq!(s.custom_snippets, "");
    }

    #[test]
    fn unknown_theme_falls_back_instead_of_breaking() {
        let s = Settings {
            theme: "霓虹".into(),
            ..Default::default()
        }
        .sanitized();
        assert_eq!(s.theme, "system");
    }

    #[test]
    fn absurd_sizes_are_clamped_not_rejected() {
        // 关键点：夹紧而不是报错。字号填成 0 的话，唯一能改回来的界面
        // 恰恰就是那个已经看不见的设置界面
        let s = Settings {
            body_font_size: 0.0,
            ui_font_size: 999.0,
            content_width: -5.0,
            ..Default::default()
        }
        .sanitized();
        assert_eq!(s.body_font_size, 12.0);
        assert_eq!(s.ui_font_size, 20.0);
        assert_eq!(s.content_width, 24.0);
    }

    #[test]
    fn nan_does_not_slip_through() {
        // NaN 的所有比较都是 false，普通的范围检查拦不住它，
        // 漏到 CSS 里会让整个界面塌掉
        let s = Settings {
            body_font_size: f64::NAN,
            line_height: f64::INFINITY,
            ..Default::default()
        }
        .sanitized();
        assert_eq!(s.body_font_size, 16.5);
        assert_eq!(s.line_height, 1.75);
    }

    #[test]
    fn custom_snippets_survive_a_round_trip() {
        // 前端才懂 snippet 的格式，Rust 只保证原样存取
        let text = r#"[{"trigger":"@a","replacement":"\\alpha","options":"mA"}]"#;
        let s = Settings {
            custom_snippets: text.into(),
            ..Default::default()
        };
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.custom_snippets, text);
    }

    #[test]
    fn keybindings_survive_a_round_trip() {
        // 同理：命令表和键位写法都在前端，Rust 只保证原样存取。
        // 空串是「显式解绑」，不能在存取途中被当成空值丢掉
        let s: Settings =
            serde_json::from_str(r#"{"keybindings":{"note.new":"Mod+Alt+N","note.save":""}}"#)
                .unwrap();
        assert_eq!(s.keybindings.get("note.new").unwrap(), "Mod+Alt+N");
        assert_eq!(s.keybindings.get("note.save").unwrap(), "");

        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.keybindings, s.keybindings);
    }

    #[test]
    fn absurd_keybindings_are_dropped() {
        let mut binds = BTreeMap::new();
        binds.insert("note.new".to_string(), "Mod+N".to_string());
        binds.insert("x".to_string(), "A".repeat(500));
        let s = Settings {
            keybindings: binds,
            ..Default::default()
        }
        .sanitized();
        assert_eq!(s.keybindings.len(), 1);
        assert!(s.keybindings.contains_key("note.new"));
    }
}
