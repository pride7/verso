import { useEffect, useState } from "react";

import { Icon } from "./Icon";
import type { Template } from "../lib/template";
import { RenameInput } from "./Tree";

interface Props {
  templates: Template[];
  /** 模板目录，空态要说清「往哪儿放」 */
  dir: string;
  /** 有没有打开笔记 —— 没有的话「插入」无处可插 */
  hasNote: boolean;
  /** 当前笔记。模板不能插进自己，否则会把自己的正文复制一遍。 */
  activePath: string | null;
  /** 插进当前笔记 */
  onInsert: (t: Template) => void;
  /** 用它新建一篇 */
  onCreate: (t: Template) => void;
  /** 打开模板文件本身来改它 */
  onOpen: (path: string) => void;
  /** 在模板目录里直接新建一篇，并打开就地改名 */
  onNew: () => void;
  /** 进入列表内的就地改名 */
  onRename: (path: string) => void;
  /** 删除模板文件 */
  onDelete: (t: Template) => void;
  renamingPath: string | null;
  onRenameSubmit: (path: string, title: string) => void;
  onRenameCancel: () => void;
}

/**
 * 侧栏里的模板列表。DESIGN.md §4.6
 *
 * ## 为什么值得在侧栏占一格
 *
 * 模板只藏在 `/` 菜单和命令面板里的话，**不知道它存在的人永远不会用到**，
 * 而且「我有哪些模板」这个问题没有任何地方能回答。摆在侧栏里，它同时是
 * 清单、入口和「这个功能存在」的提示。
 *
 * ## 模板先是文件，再是可插入的内容
 *
 * 整行点下去打开模板本身；插入和用它新建各有明确按钮。这样双击改名不会先把
 * 模板插两遍，列表也和文档树遵守同一套心智模型。右键和常显的「更多」按钮共用
 * 一份菜单，触摸屏没有右键也能完成重命名、删除（§0 第 1 条、§5.5）。
 */
export function TemplatesView({
  templates,
  dir,
  hasNote,
  activePath,
  onInsert,
  onCreate,
  onOpen,
  onNew,
  onRename,
  onDelete,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
}: Props) {
  const [menu, setMenu] = useState<{ template: Template; x: number; y: number } | null>(null);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  const openMenu = (template: Template, x: number, y: number) => {
    // 菜单不能伸出视口；侧栏靠左，但纵向仍可能在窗口底部溢出。
    setMenu({
      template,
      x: Math.max(8, Math.min(x, window.innerWidth - 190)),
      y: Math.max(8, Math.min(y, window.innerHeight - 214)),
    });
  };

  return (
    <div className="tpl-view">
      <div className="tpl-top">
        <button
          className="tpl-new"
          disabled={!dir.trim()}
          onClick={onNew}
          title={dir.trim() ? `在 ${dir}/ 中新建模板` : "请先在设置 → 编辑器中填写模板目录"}
        >
          <Icon name="plus" size={13} />
          新建模板
        </button>

        <details className="tpl-help">
          <summary>模板变量</summary>
          <div className="tpl-help-body">
            <dl>
              <dt>
                <code>{"{{title}}"}</code>
              </dt>
              <dd>目标笔记标题</dd>
              <dt>
                <code>{"{{path}}"}</code>
              </dt>
              <dd>目标笔记的相对路径</dd>
              <dt>
                <code>{"{{date}}"}</code>
              </dt>
              <dd>当前日期，默认 YYYY-MM-DD</dd>
              <dt>
                <code>{"{{time}}"}</code>
              </dt>
              <dd>当前时间，默认 HH:mm</dd>
              <dt>
                <code>{"{{selection}}"}</code>
              </dt>
              <dd>插入前选中的文字</dd>
              <dt>
                <code>{"{{cursor}}"}</code>
              </dt>
              <dd>插入后光标停在这里</dd>
            </dl>
            <p>
              日期和时间可自定义，例如 <code>{"{{date:YYYY年M月D日}}"}</code>、
              <code>{"{{time:HH:mm:ss}}"}</code>。
            </p>
            <p>可用格式：YYYY、YY、MM、M、DD、D、HH、H、mm、m、ss、s。</p>
            <p>变量只替换正文；属性区会原样复制。无法识别的变量也会原样保留。</p>
            <p>用模板新建时，标题和路径对应改名前的「未命名」文档。</p>
          </div>
        </details>
      </div>

      {templates.length === 0 ? (
        <p className="side-empty">
          {dir ? (
            <>
              还没有模板。点击上面的「新建模板」，或往 <code>{dir}/</code> 里放一篇{" "}
              <code>.md</code>。
            </>
          ) : (
            <>还没设模板目录。去设置 → 编辑器里填一个。</>
          )}
        </p>
      ) : (
        <ul className="tpl-list">
          {templates.map((t) => {
            const canInsert = hasNote && activePath !== t.path;
            return (
              <li
                key={t.path}
                className={activePath === t.path ? "is-active" : undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(t, e.clientX, e.clientY);
                }}
              >
                {renamingPath === t.path ? (
                  <div className="tpl-name is-renaming">
                    <Icon name="template" size={13} />
                    <RenameInput
                      name={t.name.slice(t.name.lastIndexOf("/") + 1)}
                      className="tpl-rename"
                      onSubmit={(title) => onRenameSubmit(t.path, title)}
                      onCancel={onRenameCancel}
                    />
                  </div>
                ) : (
                  <button
                    className="tpl-name"
                    onClick={() => onOpen(t.path)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      onRename(t.path);
                    }}
                    title={`编辑模板；双击可改名（${t.path}）`}
                  >
                    <Icon name="template" size={13} />
                    <span>{t.name}</span>
                  </button>
                )}
                {renamingPath !== t.path && (
                  <span className="tpl-acts">
                    <button
                      disabled={!canInsert}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onInsert(t)}
                      title={
                        canInsert
                          ? "插入到当前笔记"
                          : activePath === t.path
                            ? "不能插入模板自身"
                            : "请先打开一篇笔记"
                      }
                      aria-label={`插入「${t.name}」`}
                    >
                      <Icon name="insert" size={12} />
                    </button>
                    <button
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onCreate(t)}
                      title="用它新建一篇"
                      aria-label={`用「${t.name}」新建`}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                    <button
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        const box = e.currentTarget.getBoundingClientRect();
                        openMenu(t, box.right, box.bottom + 3);
                      }}
                      title="更多操作"
                      aria-label={`管理「${t.name}」`}
                    >
                      <Icon name="more" size={12} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {menu && (
        <ul
          className="ctx tpl-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <li>
            <button
              onClick={() => {
                onOpen(menu.template.path);
                setMenu(null);
              }}
            >
              编辑模板
            </button>
          </li>
          <li>
            <button
              disabled={!hasNote || activePath === menu.template.path}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                onInsert(menu.template);
                setMenu(null);
              }}
            >
              插入到当前笔记
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                onCreate(menu.template);
                setMenu(null);
              }}
            >
              用模板新建文档
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                onRename(menu.template.path);
                setMenu(null);
              }}
            >
              重命名
            </button>
          </li>
          <li>
            <button
              className="ctx-danger"
              onClick={() => {
                onDelete(menu.template);
                setMenu(null);
              }}
            >
              删除模板
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
