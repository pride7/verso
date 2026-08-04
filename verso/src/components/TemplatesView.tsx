import { Icon } from "./Icon";
import type { Template } from "../lib/template";
import { RenameInput } from "./Tree";

interface Props {
  templates: Template[];
  /** 模板目录，空态要说清「往哪儿放」 */
  dir: string;
  /** 有没有打开笔记 —— 没有的话「插入」无处可插 */
  hasNote: boolean;
  /** 插进当前笔记 */
  onInsert: (t: Template) => void;
  /** 用它新建一篇 */
  onCreate: (t: Template) => void;
  /** 打开模板文件本身来改它 */
  onOpen: (path: string) => void;
  /** 在模板目录里直接新建一篇，并打开就地改名 */
  onNew: () => void;
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
 * ## 一行三个动作，主次分明
 *
 * 整行点下去是**插入**（最高频，写到一半想套个格式）；右边两个小按钮分别是
 * 「用它新建一篇」和「改这个模板本身」。改模板走的是打开那个 `.md`，没有
 * 另一套编辑器 —— 模板就是普通笔记（§0 第 1 条）。
 */
export function TemplatesView({
  templates,
  dir,
  hasNote,
  onInsert,
  onCreate,
  onOpen,
  onNew,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
}: Props) {
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
          {templates.map((t) => (
            <li key={t.path}>
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
                  onClick={() => (hasNote ? onInsert(t) : onCreate(t))}
                  title={
                    hasNote
                      ? `插入到当前笔记（${t.path}）`
                      : `没有打开的笔记，点它会用这个模板新建一篇（${t.path}）`
                  }
                >
                  <Icon name="template" size={13} />
                  <span>{t.name}</span>
                </button>
              )}
              {renamingPath !== t.path && (
                <span className="tpl-acts">
                  <button
                    onClick={() => onCreate(t)}
                    title="用它新建一篇"
                    aria-label={`用「${t.name}」新建`}
                  >
                    <Icon name="plus" size={12} />
                  </button>
                  <button
                    onClick={() => onOpen(t.path)}
                    title="编辑这个模板"
                    aria-label={`编辑「${t.name}」`}
                  >
                    <Icon name="doc" size={12} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
