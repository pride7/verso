import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  /** 两道 `---` 之间的原文。null = 这篇笔记没有 frontmatter */
  text: string | null;
  /** 当前笔记路径。换笔记时要把没提交的编辑丢掉，靠它判断 */
  path: string;
  /** 把改好的 YAML 交出去落盘。抛错说明 YAML 没通过解析，文件没被动 */
  onSave: (yaml: string) => Promise<void>;
}

/**
 * 源码模式下的 frontmatter，可编辑。
 *
 * 属性条（§2.3）是 frontmatter 的**渲染结果** —— 和正文里的表格、公式是一回事。
 * 源码模式下正文全都退回了源码，属性条却还渲染着的话，它就是页面上唯一一块
 * 自相矛盾的东西。
 *
 * 显示的是文件里的**原文**而不是把解析后的映射再拼回去：后者会丢掉键序、
 * 缩进和注释，那就不叫源码了。
 *
 * ## 为什么是 textarea 而不是并进 CodeMirror 的文档
 *
 * 把 frontmatter 塞进编辑器文档看起来更"整体"，代价却是把正文的口径全搅乱：
 * 保存要换一条写入路径、大纲的行号要整体偏移、字数统计会把 YAML 算进正文，
 * 而且撤销一步就可能把 `---` 那一行撤掉、再一保存 frontmatter 就没了。
 * 这里是**两半各写各的**：正文走 `writeNote`，这一段走 `writeFrontmatter`，
 * 两条路都从磁盘读另一半，谁也盖不掉谁。
 *
 * ## 什么时候落盘
 *
 * 失焦、`Ctrl/⌘+S`、以及停手 800ms（和正文的自动保存同一个节奏）。
 * 存不进去（YAML 写错了）就把错误挂在下面，**文本原样留着** —— 这时候把
 * 用户刚敲的东西回滚掉是最糟的处理。
 */
export function FrontmatterSource({ text, path, onSave }: Props) {
  const [draft, setDraft] = useState(text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** 有没有还没落盘的改动。避免失焦时把没改过的内容也写一遍 */
  const dirty = useRef(false);
  /** 正在写盘。防抖计时器和失焦可能前后脚触发，别写两遍 */
  const saving = useRef(false);

  // 外面换了笔记、或者文件被别处改了：把草稿换成新的。
  //
  // **正在打字、或者有没存进去的改动时不换** —— 那会把人写到一半的东西抽走。
  // `focused` 也是依赖之一：存完之后 Rust 会补上 `updated:`、把键序规整一遍，
  // 那份"文件里真实的样子"要等手离开这个框才换上来，否则这一段就名不副实了。
  useEffect(() => {
    if (focused || dirty.current) return;
    setDraft(text ?? "");
    setError(null);
  }, [text, path, focused]);

  const flush = useCallback(async () => {
    if (!dirty.current || saving.current) return;
    saving.current = true;
    try {
      await onSave(draft);
      // **存进去了才算干净。** 提前清掉的话，写盘这段时间里 dirty 是假的，
      // 上面那个 effect 会以为没人在改，把用户刚敲的东西换成文件里的旧内容
      dirty.current = false;
      setError(null);
    } catch (e) {
      setError((e as Error).message); // 仍然是脏的，下次失焦还会再试
    } finally {
      saving.current = false;
    }
  }, [draft, onSave]);

  // 停手 800ms 自动存，和正文的 AUTOSAVE_MS 一个节奏
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void flush(), 800);
    return () => clearTimeout(t);
  }, [draft, flush]);

  if (text == null && !dirty.current && draft === "") return null;

  const rows = Math.max(1, draft.split("\n").length - (draft.endsWith("\n") ? 1 : 0));

  return (
    <div className="fm-source">
      {/* 两道 `---` 不进输入框：它们是 frontmatter 的边界不是内容，
          让人能删掉边界只会换来一个"我的属性怎么全没了" */}
      <span className="fm-fence">---</span>
      <textarea
        ref={ref}
        className="fm-yaml"
        value={draft}
        rows={rows}
        spellCheck={false}
        aria-label="frontmatter 源码"
        onChange={(e) => {
          dirty.current = true;
          setDraft(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void flush();
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            e.stopPropagation();
            void flush();
          }
        }}
      />
      <span className="fm-fence">---</span>
      {error && <p className="fm-error">{error}</p>}
    </div>
  );
}
