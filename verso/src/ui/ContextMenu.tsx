/**
 * 右键菜单（带二级菜单）。DESIGN.md §4.10
 *
 * 文档树那个菜单是一堆条件拼出来的 JSX，留在 App 里；这里这个由**数据**描述
 * —— 正文的菜单有三个二级菜单、四个分组、二十来条，写成 JSX 之后没人读得下去，
 * 而它们全是同一个形状：图标 + 名字 + 可选的右侧提示 + 一个动作。
 */
import { useLayoutEffect, useRef, useState } from "react";

import { fitFloatingMenu, fitSubmenu } from "./floatingMenu";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  label: string;
  /** 每一条都要有图标：一列纯文字要逐行读，图标让眼睛能直接跳过去（§4.10） */
  icon: IconName;
  /** 右侧的小字，一般是当前生效的快捷键 */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
  /** 有它就是二级菜单，`run` 不再使用 */
  items?: MenuItem[];
}

/** 一组。组与组之间画一条线 —— 「改格式」和「删东西」的代价差得远 */
export type MenuGroup = MenuItem[];

export function ContextMenu({
  at,
  groups,
  onClose,
}: {
  at: { x: number; y: number };
  groups: MenuGroup[];
  onClose: () => void;
}) {
  const root = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (root.current) fitFloatingMenu(root.current, at.x, at.y);
  }, [at.x, at.y]);

  // 点别处、改窗口大小就关。菜单自己 stopPropagation，点里面不会关
  useLayoutEffect(() => {
    window.addEventListener("mousedown", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <ul className="ctx" ref={root} onMouseDown={(e) => e.stopPropagation()}>
      {groups
        .filter((g) => g.length > 0)
        .map((group, gi) => (
          <li key={gi} className="ctx-group">
            {gi > 0 && <span className="ctx-sep" />}
            <ul>
              {group.map((item) =>
                item.items ? (
                  <Submenu key={item.label} item={item} onClose={onClose} />
                ) : (
                  <li key={item.label}>
                    <Row item={item} onClose={onClose} />
                  </li>
                ),
              )}
            </ul>
          </li>
        ))}
    </ul>
  );
}

function Row({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  return (
    <button
      className={item.danger ? "ctx-danger" : undefined}
      disabled={item.disabled}
      onClick={() => {
        onClose();
        item.run();
      }}
    >
      <Icon name={item.icon} size={14} />
      {item.label}
      {item.hint && <span className="ctx-key">{item.hint}</span>}
    </button>
  );
}

function Submenu({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLLIElement>(null);
  const panel = useRef<HTMLUListElement>(null);

  // 贴着这一条向右展开，右边放不下就翻到左边（`fitSubmenu`）
  useLayoutEffect(() => {
    if (open && panel.current && host.current) {
      fitSubmenu(panel.current, host.current.getBoundingClientRect());
    }
  }, [open]);

  return (
    <li
      ref={host}
      className={`ctx-parent${open ? " is-open" : ""}`}
      // 悬停就开，离开就关。点一下也能开 —— 触摸板上「悬停」这件事不可靠，
      // 而这个菜单本来就是给指针设备的
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={item.icon} size={14} />
        {item.label}
        <Icon name="chevron" size={12} className="ctx-arrow" />
      </button>
      {open && (
        <ul className="ctx ctx-sub" ref={panel} onMouseDown={(e) => e.stopPropagation()}>
          {item.items!.map((sub) => (
            <li key={sub.label}>
              <Row item={sub} onClose={onClose} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
