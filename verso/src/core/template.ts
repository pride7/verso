/**
 * 模板变量展开。DESIGN.md §4.6
 *
 * ## 只做替换，不做执行
 *
 * Obsidian 的 Templater 能在模板里跑 JS（`<%* ... %>`）。**这里不做。**
 * 模板是文件，文件会被分享、会由 AI 生成、会从别人的仓库里抄来 —— 一个能
 * 执行模板里代码的软件，等于把「插入模板」变成「运行一个陌生程序」，这和
 * §7.5 否决「代码块运行按钮」是同一条理由。
 *
 * 于是能力边界很清楚：**变量替换 + 一个光标位置**。这覆盖了日记、会议纪要、
 * 读书笔记这些真正天天用的场景，而它们恰恰不需要图灵完备。
 *
 * ## 认不出来的变量原样留着
 *
 * 从别处抄来的模板里可能有 `{{tp.file.title}}` 这种别的软件的写法。
 * **不能把它替换成空** —— 那样用户看到的是一篇少了几块的笔记，还不知道
 * 少在哪；留着原文至少能一眼看出「这个变量没生效」。
 */

export interface TemplateContext {
  /** 目标笔记的标题 */
  title: string;
  /** 目标笔记的 vault 相对路径 */
  path: string;
  /** 插入时选中的文字。没选就是空串 */
  selection: string;
  /** 注入而不是现取：测试要能钉住输出，日记模板也可能要按「昨天」渲染 */
  now: Date;
}

export interface Expanded {
  text: string;
  /** `{{cursor}}` 在结果里的偏移。模板没写就是 null（光标落在末尾） */
  cursor: number | null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * 日期格式。取 moment/dayjs 里最常用的那一小撮 token。
 *
 * **按长到短匹配**，否则 `YYYY` 会被 `YY` 先啃掉两位。非 token 的字符
 * （`年`、`-`、`/`、空格）原样留着，所以 `YYYY年M月D日` 直接能用。
 */
const TOKENS = /YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g;

export function formatWith(date: Date, fmt: string): string {
  return fmt.replace(TOKENS, (t) => {
    switch (t) {
      case "YYYY":
        return String(date.getFullYear());
      case "YY":
        return pad(date.getFullYear() % 100);
      case "MM":
        return pad(date.getMonth() + 1);
      case "M":
        return String(date.getMonth() + 1);
      case "DD":
        return pad(date.getDate());
      case "D":
        return String(date.getDate());
      case "HH":
        return pad(date.getHours());
      case "H":
        return String(date.getHours());
      case "mm":
        return pad(date.getMinutes());
      case "m":
        return String(date.getMinutes());
      case "ss":
        return pad(date.getSeconds());
      default:
        return String(date.getSeconds());
    }
  });
}

/** 变量名 + 可选的 `:参数`。名字里不允许有 `}`，免得吃掉收尾的括号 */
const VAR = /\{\{\s*([a-zA-Z_]+)\s*(?::([^}]*))?\}\}/g;

const DEFAULT_DATE = "YYYY-MM-DD";
const DEFAULT_TIME = "HH:mm";

/**
 * 支持的变量：
 *
 * | 写法 | 展开成 |
 * |---|---|
 * | `{{title}}` | 笔记标题 |
 * | `{{path}}` | vault 相对路径 |
 * | `{{date}}` / `{{date:YYYY年M月D日}}` | 日期 |
 * | `{{time}}` / `{{time:HH:mm:ss}}` | 时刻 |
 * | `{{selection}}` | 插入时选中的文字 |
 * | `{{cursor}}` | 插入后光标停在这里（自身不留下任何字符） |
 */
export function expandTemplate(src: string, ctx: TemplateContext): Expanded {
  let out = "";
  let cursor: number | null = null;
  let last = 0;

  for (const m of src.matchAll(VAR)) {
    const [whole, name, arg] = m;
    const at = m.index;
    out += src.slice(last, at);
    last = at + whole.length;

    switch (name) {
      case "title":
        out += ctx.title;
        break;
      case "path":
        out += ctx.path;
        break;
      case "date":
        out += formatWith(ctx.now, arg?.trim() || DEFAULT_DATE);
        break;
      case "time":
        out += formatWith(ctx.now, arg?.trim() || DEFAULT_TIME);
        break;
      case "selection":
        out += ctx.selection;
        break;
      case "cursor":
        // 只记位置，不产出字符。**只认第一个** —— 光标只有一个，
        // 后面的原样留着，用户才看得出自己写了两个
        if (cursor === null) cursor = out.length;
        else out += whole;
        break;
      default:
        // 认不出来的原样留着（见文件头）
        out += whole;
    }
  }
  out += src.slice(last);

  return { text: out, cursor };
}

/** 一个模板文件 */
export interface Template {
  /** vault 相对路径 */
  path: string;
  /** 显示名：去掉模板目录前缀和 `.md` */
  name: string;
}

/**
 * 从全量笔记清单里挑出模板。
 *
 * 用笔记清单而不是另开一条「列目录」的 IPC：模板就是普通的 `.md`
 * （§0 第 1 条 —— 它们也该能被搜索、被链接、被别的编辑器打开），
 * 索引里本来就有它们。
 *
 * 目录名按前缀比对，两头都规整掉斜杠 —— 用户在设置里填 `模板/` 或
 * `/模板` 都该认，填错一个斜杠就「一个模板都没有」太难自查了。
 */
export function pickTemplates(
  notes: { path: string; name: string }[],
  dir: string,
): Template[] {
  const clean = dir.trim().replace(/^[/\\]+|[/\\]+$/g, "");
  if (!clean) return [];
  const prefix = `${clean}/`;
  return notes
    .filter((n) => n.path.startsWith(prefix))
    .map((n) => ({
      path: n.path,
      // 子目录留在名字里（`日记/每日.md` → `日记/每日`）：模板多了之后
      // 分类是靠目录做的，只显示文件名会出现好几个「每日」
      name: n.path.slice(prefix.length).replace(/\.md$/, ""),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}
