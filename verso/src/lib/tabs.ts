/**
 * 标签页的状态迁移。DESIGN.md §2.1
 *
 * 全是纯函数：`{tabs, active}` 进，新的 `{tabs, active}` 出。标签页的规则
 * （开哪、关了之后跳到谁、重命名怎么跟）本身就是一堆边界情况，把它们从
 * React 状态里拆出来，才验得动。
 *
 * 状态存在 vault 的 `.verso/workspace.json`，见 `src-tauri/src/workspace.rs`。
 */

export interface TabState {
  /** vault 相对路径，顺序就是标签栏上的顺序 */
  tabs: string[];
  /** 当前页下标。`tabs` 为空时是 0 */
  active: number;
}

export const EMPTY_TABS: TabState = { tabs: [], active: 0 };

/** 当前页的路径。没有标签时是 null */
export function activePath(s: TabState): string | null {
  return s.tabs[s.active] ?? null;
}

function clamp(s: TabState): TabState {
  if (s.tabs.length === 0) return EMPTY_TABS;
  return { tabs: s.tabs, active: Math.min(Math.max(s.active, 0), s.tabs.length - 1) };
}

/**
 * 打开一篇笔记。
 *
 * **已经开着就切过去，不再开第二个。** 同一个文件出现两次没有意义 ——
 * 这一版没有分屏，两个标签指着同一份内容只会让人分不清改的是哪个。
 *
 * 新标签插在**当前页右边**而不是队尾：从一篇笔记点进它的链接时，新页紧挨着
 * 来源，读完关掉就回到原处。浏览器和 VS Code 都是这个行为。
 */
export function openTab(s: TabState, path: string, mode: "new" | "replace"): TabState {
  const existing = s.tabs.indexOf(path);
  if (existing >= 0) return { tabs: s.tabs, active: existing };

  if (s.tabs.length === 0) return { tabs: [path], active: 0 };

  if (mode === "replace") {
    const tabs = [...s.tabs];
    tabs[s.active] = path;
    return { tabs, active: s.active };
  }

  const tabs = [...s.tabs];
  tabs.splice(s.active + 1, 0, path);
  return { tabs, active: s.active + 1 };
}

/**
 * 关掉一个。
 *
 * 关的是当前页时，接班的是**右边那个**；右边没有了才往左找。反过来（总是往左）
 * 会让「从左往右挨个关」变成每关一次就跳回开头。
 */
export function closeTab(s: TabState, index: number): TabState {
  if (index < 0 || index >= s.tabs.length) return s;
  const tabs = s.tabs.filter((_, i) => i !== index);
  if (tabs.length === 0) return EMPTY_TABS;

  let active = s.active;
  if (index < s.active) active = s.active - 1;
  else if (index === s.active) active = Math.min(s.active, tabs.length - 1);
  return clamp({ tabs, active });
}

/** 关掉某个路径。它没开着就什么都不做 */
export function closePath(s: TabState, path: string): TabState {
  const i = s.tabs.indexOf(path);
  return i < 0 ? s : closeTab(s, i);
}

/** 只留下这一个 */
export function closeOthers(s: TabState, index: number): TabState {
  const keep = s.tabs[index];
  return keep ? { tabs: [keep], active: 0 } : s;
}

/**
 * 拖动重排。`to` 是**移走之后**的目标下标 —— 和 `treeSort.reorderSiblings`
 * 一个口径，往前挪和往后挪才不会差一格。
 */
export function moveTab(s: TabState, from: number, to: number): TabState {
  if (from === to || from < 0 || from >= s.tabs.length) return s;
  const current = s.tabs[s.active];
  const tabs = [...s.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(Math.min(Math.max(to, 0), tabs.length), 0, moved);
  // 当前页跟着它的**路径**走，不是跟着下标 —— 拖动不该顺手换页
  return { tabs, active: Math.max(0, tabs.indexOf(current)) };
}

/** 相对切换，循环。`Ctrl+Tab` / `Ctrl+Shift+Tab` 用 */
export function stepTab(s: TabState, delta: number): TabState {
  const n = s.tabs.length;
  if (n === 0) return s;
  return { tabs: s.tabs, active: (((s.active + delta) % n) + n) % n };
}

/** 跳到第 n 个（0 起）。超出范围时跳到最后一个 —— `Ctrl+9` 的常见约定 */
export function gotoTab(s: TabState, index: number): TabState {
  if (s.tabs.length === 0) return s;
  return { tabs: s.tabs, active: Math.min(Math.max(index, 0), s.tabs.length - 1) };
}

/**
 * 重命名 / 移动之后修好路径。
 *
 * 不只换那一条：重命名一个有子文档的节点时，`X/` 下面所有孙节点的路径都变了，
 * 开着的那些标签也得跟着改，否则它们会全部指向不存在的文件。和
 * `vault/order.rs` 的 `rename_path` 是同一个道理。
 */
export function renameTab(s: TabState, from: string, to: string): TabState {
  const fromDir = from.replace(/\.md$/, "");
  const toDir = to.replace(/\.md$/, "");
  const tabs = s.tabs.map((p) => {
    if (p === from) return to;
    return p.startsWith(`${fromDir}/`) ? `${toDir}${p.slice(fromDir.length)}` : p;
  });
  return { tabs, active: s.active };
}

/** 删除之后把它和它子树的标签都去掉 */
export function dropSubtree(s: TabState, path: string): TabState {
  const dir = path.replace(/\.md$/, "");
  const current = s.tabs[s.active];
  const tabs = s.tabs.filter((p) => p !== path && !p.startsWith(`${dir}/`));
  if (tabs.length === 0) return EMPTY_TABS;
  const stillThere = tabs.indexOf(current);
  // 当前页被删掉了就退到最接近的位置，而不是跳回第一个
  return clamp({ tabs, active: stillThere >= 0 ? stillThere : s.active });
}

/** 标签上显示的名字：去掉目录和 `.md` */
export function tabLabel(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/**
 * 重名时补一段父目录来区分。
 *
 * 一堆同名的「索引」「README」排在一起，标签栏就等于没有。只给**真的重名**
 * 的那几个加，其余保持干净。
 */
export function tabLabels(tabs: string[]): string[] {
  const base = tabs.map(tabLabel);
  const dupes = new Set(base.filter((n, i) => base.indexOf(n) !== i));
  return tabs.map((path, i) => {
    if (!dupes.has(base[i])) return base[i];
    const parent = path.slice(0, path.lastIndexOf("/"));
    const seg = parent.slice(parent.lastIndexOf("/") + 1);
    return seg ? `${seg}/${base[i]}` : base[i];
  });
}
