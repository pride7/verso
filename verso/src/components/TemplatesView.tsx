import { Icon } from "./Icon";
import type { Template } from "../lib/template";

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
export function TemplatesView({ templates, dir, hasNote, onInsert, onCreate, onOpen }: Props) {
  if (templates.length === 0) {
    return (
      <p className="side-empty">
        {dir ? (
          <>
            还没有模板。往 <code>{dir}/</code> 里放一篇 <code>.md</code> 就是一个模板，
            里面可以写 <code>{"{{title}}"}</code>、<code>{"{{date}}"}</code>、
            <code>{"{{cursor}}"}</code> 这些变量。
          </>
        ) : (
          <>还没设模板目录。去设置 → 编辑器里填一个。</>
        )}
      </p>
    );
  }

  return (
    <ul className="tpl-list">
      {templates.map((t) => (
        <li key={t.path}>
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
          <span className="tpl-acts">
            <button onClick={() => onCreate(t)} title="用它新建一篇" aria-label={`用「${t.name}」新建`}>
              <Icon name="plus" size={12} />
            </button>
            <button onClick={() => onOpen(t.path)} title="编辑这个模板" aria-label={`编辑「${t.name}」`}>
              <Icon name="doc" size={12} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
