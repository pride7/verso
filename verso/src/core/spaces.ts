import { naturalCmp } from "./treeSort";
import type { RecentVault } from "./types";

/** 侧栏两区里的一个空间：一棵点得进去的树。 */
export interface ZoneSpace {
  root: string;
  name: string;
  /** 后端此刻的活动仓库。只有它那棵树能改，其余的是只读预览（§2.8） */
  current: boolean;
}

export interface SidebarZones {
  shared: ZoneSpace[];
  /** 没有可用的私人空间时为 null —— 第一次用 Verso 就被邀请进来的人 */
  private: ZoneSpace | null;
}

/**
 * 文档侧栏的「共享 / 私人」两区里各放谁（DESIGN.md §2.8）。
 *
 * 返回 null 表示**不分区**：一个共享空间都没有的人，侧栏应当和没有这个功能时
 * 一模一样，不该多出两行只有一边有内容的标题。
 *
 * 三条规则：
 *
 * - 共享区列出**全部**可用的共享空间，按名字排。**不按最近使用排** ——
 *   `vaults` 是最近打开的在前，而点进一个空间就会把它顶到最前面；照那个顺序
 *   画，每点一次侧栏里的行就换一次位置，手还没离开鼠标，刚才那一行已经不在
 *   原处了
 * - 私人区只放一个：当前就在私人空间时是它自己；当前在共享空间时是最近用过
 *   的那个私人空间（也就是刚才来的地方）。别的私人空间是真正不相干的库，
 *   留给底部的切换菜单
 * - 当前空间不在 `vaults` 里时不分区。那是切换后清单还没读回来的一瞬间：
 *   这时猜它属于哪一区，新加入的共享空间会先在「私人」底下闪一下
 */
export function sidebarZones(
  vaults: RecentVault[],
  currentRoot: string | null,
): SidebarZones | null {
  const current = vaults.find((item) => item.root === currentRoot);
  if (!current) return null;

  const space = (item: RecentVault): ZoneSpace => ({
    root: item.root,
    name: item.name,
    current: item.root === currentRoot,
  });

  const shared = vaults
    .filter((item) => item.shared && item.available)
    .sort((a, b) => naturalCmp(a.name, b.name) || a.root.localeCompare(b.root))
    .map(space);
  if (shared.length === 0) return null;

  const home = current.shared
    ? vaults.find((item) => !item.shared && item.available)
    : current;
  return { shared, private: home ? space(home) : null };
}

/** 两区里所有**不是**当前仓库的空间 —— 它们的树要另外去读。 */
export function peekRoots(zones: SidebarZones | null): string[] {
  if (!zones) return [];
  return [...zones.shared, ...(zones.private ? [zones.private] : [])]
    .filter((item) => !item.current)
    .map((item) => item.root);
}
