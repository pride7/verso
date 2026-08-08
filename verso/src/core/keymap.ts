/**
 * 快捷键。DESIGN.md §7.3
 *
 * 全局快捷键原来是 `App.tsx` 里一条 `if / else if` 链，键位写死在判断里。
 * 这有两个问题：**键位改不了**，而且新加一条命令很容易忘了同步命令面板里
 * 那行提示文字 —— 两处各写一遍，迟早对不上。
 *
 * 现在只有一份真相：命令表。每条命令带一个默认键位（`Mod+Shift+P` 这种
 * 平台无关的写法），用户在设置里改过的记在 `settings.keybindings` 里覆盖它，
 * 派发、提示文字、设置界面全从这一份算出来。
 *
 * 键位识别走 `KeyboardEvent.code` 而不是 `.key`：
 *
 * - `.key` 在按下 Shift 时会变成上档字符（`Shift+[` 报的是 `{`），录出来的
 *   键位和用户看到的键帽对不上；
 * - `.code` 是**物理按键位置**，不受 Shift、也不受输入法状态影响。中文输入法
 *   开着的时候 `.key` 可能是 `Process`，那会让所有快捷键失灵。
 */

/** 修饰键的规范次序。存储和比较都按这个顺序，`Shift+Mod+P` 和 `Mod+Shift+P` 才是同一个键位 */
const MOD_ORDER = ["Mod", "Alt", "Shift"] as const;

/**
 * 物理键位 → 键名。
 *
 * 只列符号键和功能键；字母、数字、F 键在下面用正则认，不必一个个写。
 */
const CODE_KEYS: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/** 认得的键名，用来把手写的大小写规整回来 */
const KEY_NAMES = new Set(Object.values(CODE_KEYS));

/** 光按着修饰键不算一次按键 —— 等它后面那个真正的键 */
const MODIFIER_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "OS",
  "CapsLock",
  "Dead",
  "Unidentified",
  "Process",
]);

function normalizeKey(raw: string): string {
  const k = raw.trim();
  if (k.length === 1) return k.toUpperCase();
  const fn = /^f(\d{1,2})$/i.exec(k);
  if (fn) return `F${Number(fn[1])}`;
  for (const name of KEY_NAMES) {
    if (name.toLowerCase() === k.toLowerCase()) return name;
  }
  // 常见的另一种写法：Up / ArrowUp 都收
  const arrow = /^arrow(up|down|left|right)$/i.exec(k);
  if (arrow) return arrow[1][0].toUpperCase() + arrow[1].slice(1).toLowerCase();
  return k;
}

/**
 * 把手写的、或者存下来的键位写法规整成规范形式。
 *
 * `Ctrl` / `Cmd` / `Meta` 一律折成 `Mod` —— 派发时判的就是
 * `ctrlKey || metaKey`（见 `platform.ts`），两边分开存没有意义，
 * 只会让「Mac 上存的配置到 Windows 上失灵」。
 */
export function normalizeSpec(spec: string): string {
  const parts = spec.split("+").map((p) => p.trim());
  // 键本身就是 `+` 的情况：`Mod++` 会切出一个空的末段
  const tail = parts.pop() ?? "";
  const key = normalizeKey(tail === "" && spec.endsWith("+") ? "+" : tail);
  if (!key) return "";

  const mods = new Set<string>();
  for (const m of parts) {
    const lower = m.toLowerCase();
    if (["mod", "ctrl", "control", "cmd", "command", "meta", "super"].includes(lower)) {
      mods.add("Mod");
    } else if (lower === "alt" || lower === "option" || lower === "opt") {
      mods.add("Alt");
    } else if (lower === "shift") {
      mods.add("Shift");
    }
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/**
 * 这一发按键对应哪个键位。只按着修饰键、或者认不出来时返回 `null`。
 */
export function eventSpec(e: KeyboardEvent): string | null {
  const key = eventKey(e);
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("Mod");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, key].join("+");
}

function eventKey(e: KeyboardEvent): string | null {
  const code = e.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code in CODE_KEYS) return CODE_KEYS[code];

  // 没有 code 的场景：测试里手造的事件、少数虚拟键盘。退回 e.key
  const k = e.key;
  if (!k || MODIFIER_KEYS.has(k)) return null;
  return normalizeKey(k);
}

/** 带修饰键没有。不带的键位绑在全局会把打字吃掉，只有 F 键例外 */
export function hasModifier(spec: string): boolean {
  const mods = spec.split("+").slice(0, -1).map((m) => m.toLowerCase());
  return mods.includes("mod") || mods.includes("alt");
}

/**
 * 这个键位能不能拿来当全局快捷键。
 *
 * 门槛是「不会把正常打字吃掉」：要么带 Ctrl/Alt，要么是 F 键。
 * 光按 Shift 不算 —— `Shift+A` 就是大写的 A。
 */
export function isUsableSpec(spec: string): boolean {
  if (!spec) return false;
  const key = spec.split("+").pop() ?? "";
  return hasModifier(spec) || /^F\d{1,2}$/.test(key);
}

/**
 * 按钮 tooltip：「新建文档 (Ctrl+N)」。没绑键位时只剩名字，不留一个空括号。
 */
export function hint(label: string, keys?: string): string {
  return keys ? `${label} (${keys})` : label;
}

/** 能被绑快捷键的东西：一个 id，和一个默认键位 */
export interface Bindable {
  id: string;
  /** 默认键位，`Mod+Shift+P` 这种写法。留空 = 默认不绑 */
  defaultKeys?: string;
}

/** 用户改过的键位。命令 id → 键位；空串表示**显式解绑**，与「没改过」不是一回事 */
export type KeyOverrides = Record<string, string>;

/** 这条命令当前实际生效的键位。空串 = 没绑 */
export function bindingOf(cmd: Bindable, overrides: KeyOverrides | undefined): string {
  const custom = overrides?.[cmd.id];
  if (typeof custom === "string") return custom ? normalizeSpec(custom) : "";
  return cmd.defaultKeys ? normalizeSpec(cmd.defaultKeys) : "";
}

/**
 * 键位 → 抢到它的命令 id。
 *
 * 撞键时**先定义的赢**，和 `Array.find` 的顺序一致；设置界面会把撞了的
 * 都标出来，所以这里不需要更聪明的裁决。
 */
export function bindingMap(cmds: Bindable[], overrides: KeyOverrides | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of cmds) {
    const spec = bindingOf(c, overrides);
    if (spec && !out.has(spec)) out.set(spec, c.id);
  }
  return out;
}

/**
 * 撞在一起的命令 id。
 *
 * 不阻止用户撞 —— 改键位是个来回试的过程，中途必然出现「先占上、等下把
 * 原来那个挪走」。拦下来只会让人没法完成这个过程，标出来就够了。
 */
export function conflictIds(cmds: Bindable[], overrides: KeyOverrides | undefined): Set<string> {
  const bySpec = new Map<string, string[]>();
  for (const c of cmds) {
    const spec = bindingOf(c, overrides);
    if (!spec) continue;
    bySpec.set(spec, [...(bySpec.get(spec) ?? []), c.id]);
  }
  const out = new Set<string>();
  for (const ids of bySpec.values()) {
    if (ids.length > 1) ids.forEach((id) => out.add(id));
  }
  return out;
}

/**
 * 只留下真正改过的那几条。
 *
 * 存下来的覆盖表要和默认值保持可区分：改回默认的那条必须**删掉**而不是
 * 存一份一样的值，否则以后调整默认键位时，这些人的配置会把新默认钉死在旧值上。
 */
export function pruneOverrides(cmds: Bindable[], overrides: KeyOverrides): KeyOverrides {
  const out: KeyOverrides = {};
  const byId = new Map(cmds.map((c) => [c.id, c]));
  for (const [id, spec] of Object.entries(overrides)) {
    const cmd = byId.get(id);
    // 认不出的 id 原样留着：可能是旧版本或者以后的命令，删掉等于替用户丢配置
    if (!cmd) {
      out[id] = spec;
      continue;
    }
    const fallback = cmd.defaultKeys ? normalizeSpec(cmd.defaultKeys) : "";
    const wanted = spec ? normalizeSpec(spec) : "";
    if (wanted !== fallback) out[id] = wanted;
  }
  return out;
}
