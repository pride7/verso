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
  /**
   * **前 `pinnedCount` 个是固定的。**
   *
   * 不用「一个存路径的集合」来表示固定，是因为那样要在关闭、重命名、删除
   * 子树、拖动重排每一处都记得同步维护它，漏一处就会留下一条指着不存在
   * 文件的"幽灵固定项"。用下标区间的话，「固定的排在最前」这条不变量是
   * **结构上成立**的，剩下的只是把这个数字跟着增减。
   */
  pinnedCount: number;
}

export const EMPTY_TABS: TabState = { tabs: [], active: 0, pinnedCount: 0 };

/** 当前页的路径。没有标签时是 null */
export function activePath(s: TabState): string | null {
  return s.tabs[s.active] ?? null;
}

/** 第 `i` 个是不是固定的 */
export function isPinned(s: TabState, i: number): boolean {
  return i >= 0 && i < s.pinnedCount;
}

function clamp(s: TabState): TabState {
  if (s.tabs.length === 0) return EMPTY_TABS;
  return {
    tabs: s.tabs,
    active: Math.min(Math.max(s.active, 0), s.tabs.length - 1),
    pinnedCount: Math.min(Math.max(s.pinnedCount, 0), s.tabs.length),
  };
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
export function openTab(
  s: TabState,
  path: string,
  mode: "new" | "replace",
  /**
   * 项目总览传入它自己的路径。复用模式因此只会替换这个项目目录里的普通
   * 内容页；另一个项目已经打开的内容页不是它的槽，必须并排留下。
   */
  replaceWithin?: string,
): TabState {
  const existing = s.tabs.indexOf(path);
  if (existing >= 0) return { ...s, active: existing };

  if (s.tabs.length === 0) return { tabs: [path], active: 0, pinnedCount: 0 };

  // 固定的那个**不会被替换掉**。若当前正停在固定标签，就复用固定区后面的
  // 第一个普通标签作为内容槽；没有普通标签才新建一个。这样既保住固定页，
  // 也不会让「复用标签」在固定页上变成每点一次都新增标签。
  if (mode === "replace") {
    const tabs = [...s.tabs];
    let at: number;
    if (replaceWithin) {
      const prefix = `${replaceWithin.replace(/\.md$/i, "")}/`;
      const inProject = (candidate: string) => candidate.startsWith(prefix);
      // 当前就在这个项目的内容页时，手感仍是普通的“替换当前”。从项目总览
      // 或另一个项目过来时，则找到本项目原有的内容槽；第一次打开才新增。
      at = !isPinned(s, s.active) && inProject(s.tabs[s.active] ?? "")
        ? s.active
        : tabs.findIndex((candidate, index) => index >= s.pinnedCount && inProject(candidate));
      if (at < 0) {
        // 这是这个项目的第一个内容槽。它应当接在已有内容标签之后；若仍按
        // “当前页右边”插入，从固定项目总览打开时会落到普通区最前面，反而
        // 把先打开的项目内容推到后面，阅读顺序每开一个项目就倒转一次。
        at = tabs.length;
        tabs.push(path);
        return { ...s, tabs, active: at };
      }
    } else {
      at = isPinned(s, s.active) ? s.pinnedCount : s.active;
    }
    if (at < tabs.length) tabs[at] = path;
    else tabs.push(path);
    return { ...s, tabs, active: at };
  }

  // 插在当前页右边；当前页是固定的就落到固定区之后 —— 固定区中间不能插进
  // 一个没固定的，否则「前 N 个是固定的」这条不变量就破了
  const at = Math.max(s.active + 1, s.pinnedCount);
  const tabs = [...s.tabs];
  tabs.splice(at, 0, path);
  return { ...s, tabs, active: at };
}

/**
 * 固定一个标签：挪到固定区末尾。
 *
 * 「固定」在这里意味着三件事：排在最前、批量关闭时留着、不会被复用模式
 * 换走。复用模式从固定页打开别处时，复用它后面的普通标签。**不**意味着关不掉
 * —— × 照样在，需要一个不打开菜单也能关掉它的办法。
 */
export function pinTab(s: TabState, index: number): TabState {
  if (index < 0 || index >= s.tabs.length || isPinned(s, index)) return s;
  const current = s.tabs[s.active];
  const tabs = [...s.tabs];
  const [moved] = tabs.splice(index, 1);
  tabs.splice(s.pinnedCount, 0, moved);
  return { tabs, active: Math.max(0, tabs.indexOf(current)), pinnedCount: s.pinnedCount + 1 };
}

/** 取消固定：落到未固定区的最前面，而不是弹回队尾 —— 位置突变会让人找不着 */
export function unpinTab(s: TabState, index: number): TabState {
  if (!isPinned(s, index)) return s;
  const current = s.tabs[s.active];
  const tabs = [...s.tabs];
  const [moved] = tabs.splice(index, 1);
  tabs.splice(s.pinnedCount - 1, 0, moved);
  return { tabs, active: Math.max(0, tabs.indexOf(current)), pinnedCount: s.pinnedCount - 1 };
}

export function togglePin(s: TabState, index: number): TabState {
  return isPinned(s, index) ? unpinTab(s, index) : pinTab(s, index);
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
  const pinnedCount = isPinned(s, index) ? s.pinnedCount - 1 : s.pinnedCount;
  return clamp({ tabs, active, pinnedCount });
}

/** 关掉某个路径。它没开着就什么都不做 */
export function closePath(s: TabState, path: string): TabState {
  const i = s.tabs.indexOf(path);
  return i < 0 ? s : closeTab(s, i);
}

/**
 * 只留下这一个 —— **以及所有固定的**。
 *
 * 「关闭其他」是个批量动作，而固定正是用来标记「批量操作时别动它」的：
 * 一份天天要看的索引被一次右键清掉，比多留几个标签难受得多。
 */
export function closeOthers(s: TabState, index: number): TabState {
  const keep = s.tabs[index];
  if (!keep) return s;
  const tabs = s.tabs.filter((p, i) => i < s.pinnedCount || p === keep);
  return clamp({
    tabs,
    active: tabs.indexOf(keep),
    pinnedCount: Math.min(s.pinnedCount, tabs.length),
  });
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
  const at = Math.min(Math.max(to, 0), tabs.length);
  tabs.splice(at, 0, moved);

  // **拖进固定区就是固定它，拖出去就是取消固定。**
  //
  // 把固定表示成「前 N 个」之后，这是唯一自洽的解释 —— 否则固定区中间会
  // 插进一个没固定的。边界要用**拿走之后**的下标算，从固定区里拖走的那一个
  // 已经不占位置了。
  const boundary = isPinned(s, from) ? s.pinnedCount - 1 : s.pinnedCount;
  let pinnedCount = s.pinnedCount;
  if (isPinned(s, from) && at >= boundary) pinnedCount -= 1;
  else if (!isPinned(s, from) && at < boundary) pinnedCount += 1;

  // 当前页跟着它的**路径**走，不是跟着下标 —— 拖动不该顺手换页
  return { tabs, active: Math.max(0, tabs.indexOf(current)), pinnedCount };
}

/** 相对切换，循环。`Ctrl+Tab` / `Ctrl+Shift+Tab` 用 */
export function stepTab(s: TabState, delta: number): TabState {
  const n = s.tabs.length;
  if (n === 0) return s;
  return { ...s, active: (((s.active + delta) % n) + n) % n };
}

/** 跳到第 n 个（0 起）。超出范围时跳到最后一个 —— `Ctrl+9` 的常见约定 */
export function gotoTab(s: TabState, index: number): TabState {
  if (s.tabs.length === 0) return s;
  return { ...s, active: Math.min(Math.max(index, 0), s.tabs.length - 1) };
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
  // 顺序一个没动，固定的还是那几个 —— 这正是「固定 = 前 N 个」省下的活
  return { ...s, tabs };
}

/** 删除之后把它和它子树的标签都去掉 */
export function dropSubtree(s: TabState, path: string): TabState {
  const dir = path.replace(/\.md$/, "");
  const gone = (p: string) => p === path || p.startsWith(`${dir}/`);
  const current = s.tabs[s.active];
  const tabs = s.tabs.filter((p) => !gone(p));
  if (tabs.length === 0) return EMPTY_TABS;
  // 固定区里删掉几个，这个数就减几个
  const pinnedCount = s.tabs.slice(0, s.pinnedCount).filter((p) => !gone(p)).length;
  const stillThere = tabs.indexOf(current);
  // 当前页被删掉了就退到最接近的位置，而不是跳回第一个
  return clamp({ tabs, active: stillThere >= 0 ? stillThere : s.active, pinnedCount });
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
