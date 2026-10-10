import type { ReactNode } from "react";

import type { SidebarZones, ZoneSpace } from "../core/spaces";
import { Icon } from "./Icon";

/** 收起状态的键：两个区各一个，每个共享空间用它的根路径。 */
export const ZONE_SHARED = "zone:shared";
export const ZONE_PRIVATE = "zone:private";

interface Props {
  zones: SidebarZones;
  /**
   * 每个空间的那棵树由上层画 —— 活动仓库的那棵能改，其余是只读预览，
   * 这个区别只有 App 知道。还没读回来时返回 null
   */
  renderTree: (space: ZoneSpace) => ReactNode;
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  onManage: (root: string) => void;
  /** 正在切过去的那个空间。切换要落盘、重建索引，不是一瞬间的事 */
  opening: string | null;
}

/**
 * 文档侧栏的「共享 / 私人」两区（DESIGN.md §2.8）。
 *
 * 共享内容住在各自独立的仓库里，而后端同一时刻只开着一个 —— 以前这件事原样
 * 漏到了界面上：想看一篇共享笔记，得先去底部菜单「切换空间」。这里把两边
 * 同时摆出来，点哪篇开哪篇，切换在后台发生。
 *
 * **共享在上、私人在下**：共享内容通常只有几行，私人那棵树可以很长；反过来
 * 排的话共享区会一直沉在第一屏以下，「常驻」就成了一句空话。
 */
export function SpaceZones({ zones, renderTree, collapsed, onToggle, onManage, opening }: Props) {
  const sharedOpen = !collapsed[ZONE_SHARED];
  const privateOpen = !collapsed[ZONE_PRIVATE];
  return (
    <div className="space-zones">
      <section className="space-zone" aria-label="共享">
        <ZoneHead label="共享" open={sharedOpen} onToggle={() => onToggle(ZONE_SHARED)} />
        {sharedOpen &&
          zones.shared.map((space) => {
            const open = !collapsed[space.root];
            return (
              <div
                className={`space${opening === space.root ? " is-opening" : ""}`}
                key={space.root}
              >
                <div className="space-row">
                  <button
                    className={`tree-twisty${open ? " is-open" : ""}`}
                    onClick={() => onToggle(space.root)}
                    aria-label={open ? "折叠" : "展开"}
                  >
                    <Icon name="chevron" size={12} />
                  </button>
                  {/* 名字就是「这些内容给了谁」的那个答案，所以每个空间都留一行，
                      哪怕只有一个 —— 把共享内容直接并排铺开，就看不出哪几篇是
                      同一组人能看到的了 */}
                  <button
                    className="space-label"
                    onClick={() => onToggle(space.root)}
                    aria-expanded={open}
                    title={space.root}
                  >
                    <Icon name="people" size={14} />
                    <span className="tree-name">{space.name}</span>
                  </button>
                  <button
                    className="space-manage"
                    onClick={() => onManage(space.root)}
                    title="成员与共享内容"
                    aria-label={`管理 ${space.name}`}
                  >
                    <Icon name="settings" size={13} />
                  </button>
                </div>
                {open && <div className="space-tree">{renderTree(space)}</div>}
              </div>
            );
          })}
      </section>

      {zones.private && (
        <section
          className={`space-zone${opening === zones.private.root ? " is-opening" : ""}`}
          aria-label="私人"
        >
          <ZoneHead
            label="私人"
            open={privateOpen}
            onToggle={() => onToggle(ZONE_PRIVATE)}
            title={zones.private.root}
          />
          {privateOpen && renderTree(zones.private)}
        </section>
      )}
    </div>
  );
}

function ZoneHead({
  label,
  open,
  onToggle,
  title,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button className="zone-head" onClick={onToggle} aria-expanded={open} title={title}>
      <span>{label}</span>
      <Icon name="chevron" size={11} className={`zone-chevron${open ? " is-open" : ""}`} />
    </button>
  );
}
