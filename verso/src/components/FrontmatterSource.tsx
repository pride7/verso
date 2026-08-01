interface Props {
  /** 两道 `---` 之间的原文。null = 这篇笔记没有 frontmatter */
  text: string | null;
}

/**
 * 源码模式下的 frontmatter。
 *
 * 属性条（§2.3）是 frontmatter 的**渲染结果** —— 和正文里的表格、公式是一回事。
 * 源码模式下正文全都退回了源码，属性条却还渲染着的话，它就是页面上唯一一块
 * 自相矛盾的东西：明明开着源码模式，文件最上面那几行却看不到。
 *
 * 显示的是**文件里的原文**而不是把解析后的映射再拼回去 —— 后者会丢掉键序、
 * 缩进和注释，那就不叫源码了。
 *
 * **只读。** 写回 frontmatter 的路径在 Rust 侧是「解析成映射 → 重新序列化」
 * （`write_note`），前端交回一段手改过的 YAML 文本没有对应的入口。要改属性
 * 就切回预览模式，那边的属性条是可以点的。
 */
export function FrontmatterSource({ text }: Props) {
  if (text == null) return null;
  return (
    <pre className="fm-source" title="frontmatter 源码（只读）—— 切回预览模式可以直接改属性">
      {`---\n${text}---`}
    </pre>
  );
}
