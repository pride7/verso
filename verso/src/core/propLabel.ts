/**
 * 几个「不是用户起的名字」的属性键，界面上显示成中文。DESIGN.md §2.6
 *
 * ## 界线在哪
 *
 * **只给我们自己定义的、或跨软件约定俗成的键起中文名，而且只改显示。**
 *
 * - `created` / `updated` 是**内置列**，压根不在 frontmatter 里（§2.3 起
 *   Verso 不往笔记里写这两个字段），值来自索引和文件系统 —— 它们完全是
 *   我们的东西，叫什么都行
 * - `tags` / `title` 是 Obsidian 那一套约定里的特殊键，写在用户文件里，
 *   但含义是全行业统一的
 * - `status`、`作者`、`难度` 这些**是用户自己起的名，一个字都不能动**
 *
 * ## 写进文件的永远是原键名
 *
 * `columns: [created]`、frontmatter 里的 `tags:` 一律保持英文。这里返回的
 * 只是**显示名** —— 一旦让中文名进了文件，笔记就再也不能拖进 Obsidian 用了
 * （§0 第 1 条）。
 *
 * ## 属性条上不用它
 *
 * 那里点键名就是重命名，显示的必须是**真名** —— 显示「标签」却把 `tags`
 * 填进改名框，是最容易让人以为自己看错了的一种不一致。
 */
/**
 * 用 `Map` 而不是对象字面量。
 *
 * 键来自用户的 frontmatter，而对象上 `LABELS["__proto__"]` 会返回
 * `Object.prototype` —— 一个对象，不是 undefined。它随后会被当成显示名交给
 * React，直接崩在渲染上。`Map` 没有原型链这回事。
 */
const LABELS = new Map([
  ["title", "标题"],
  ["tags", "标签"],
  ["created", "创建时间"],
  ["updated", "更新时间"],
]);

/** 显示名。不认识的键原样返回 —— 那是用户自己起的名字 */
export function propLabel(key: string): string {
  return LABELS.get(key) ?? key;
}

/** 这个键有没有中文显示名。有的话界面上别再重复解释一遍 */
export function hasLabel(key: string): boolean {
  return LABELS.has(key);
}
