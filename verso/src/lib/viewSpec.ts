/**
 * 改 `verso-view` 代码块里的那几行 YAML。DESIGN.md §2.6
 *
 * ## 为什么按行改，不解析成对象再序列化回去
 *
 * 那个代码块是**用户写的**：键的顺序、注释、缩进都是他排的。解析→序列化会
 * 把这些全抹平，点一次表头排序就在 git 里炸出一整块 diff。这里只动要动的
 * 那一行，别的一个字节都不碰 —— 和源码模式显示 frontmatter 原文是同一条
 * 原则（§0 第 1 条：文件是用户的）。
 */

export type SortDir = "asc" | "desc";

/** 读 `sort: 难度 desc`。没有这一行、或者写法不认识就返回 null */
export function readSort(yaml: string): { key: string; dir: SortDir } | null {
  for (const line of yaml.split("\n")) {
    const m = /^\s*sort\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const raw = m[1].replace(/^["']|["']$/g, "").trim();
    const parts = raw.split(/\s+/);
    if (!parts[0]) return null;
    const dir = parts[1]?.toLowerCase() === "desc" ? "desc" : "asc";
    return { key: parts[0], dir };
  }
  return null;
}

/**
 * 写回 `sort:`。`null` = 去掉这一行（回到默认顺序）。
 *
 * 已经有那一行就原地替换 —— 保住它在块里的位置，diff 才只有一行。
 */
export function writeSort(yaml: string, sort: { key: string; dir: SortDir } | null): string {
  const lines = yaml.split("\n");
  const at = lines.findIndex((l) => /^\s*sort\s*:/.test(l));
  const value = sort ? `sort: ${sort.key}${sort.dir === "desc" ? " desc" : ""}` : null;

  if (at >= 0) {
    if (value === null) {
      lines.splice(at, 1);
    } else {
      // 缩进跟着原来那一行 —— 块里可能整体缩进过
      const indent = /^\s*/.exec(lines[at])![0];
      lines[at] = indent + value;
    }
    return lines.join("\n");
  }
  if (value === null) return yaml;

  // 没有就加在末尾（去掉可能存在的尾随空行，免得越加越空）
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push(value);
  return lines.join("\n");
}

/** 点一次表头：无序 → 升 → 降 → 无序 */
export function nextSort(
  current: { key: string; dir: SortDir } | null,
  key: string,
): { key: string; dir: SortDir } | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

/**
 * 「新建一行」应当把笔记建在哪 —— 返回父文档的 `.md` 路径，null = vault 根。
 *
 * `from: "论文/**"` 说的是这个视图收哪些笔记；新建的那篇当然要落进同一片
 * 范围里，否则它建完就不在表里，等于什么都没发生。按 §2.1，`论文/` 下的
 * 子文档，父文档就是 `论文.md`。
 */
export function newNoteParent(yaml: string): string | null {
  for (const line of yaml.split("\n")) {
    const m = /^\s*from\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const raw = m[1].replace(/^["']|["']$/g, "").trim();
    // 取通配符之前的那一段目录
    const dir = raw
      .split("/")
      .filter((seg) => seg && !seg.includes("*") && !seg.includes("?"))
      .join("/");
    return dir ? `${dir}.md` : null;
  }
  return null;
}
