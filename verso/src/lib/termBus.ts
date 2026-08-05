/**
 * 往内嵌终端里塞文本的那条通道。DESIGN.md §7.6
 *
 * 为什么要一个模块级的小总线，而不是 App 拿一个 ref 指到 TerminalPanel：
 * 终端面板是**条件渲染**的，关着的时候那个组件根本不存在。而「把当前笔记发给
 * 终端」最自然的用法恰恰是终端还没开的时候按下去 —— App 先把面板打开，组件挂载、
 * PTY 起来还要几十毫秒，这段窗口里送出的文本必须有地方待着。
 *
 * 所以：没人接的时候先排队，终端就绪时一次补发。
 */

type Sender = (text: string) => void;

let sender: Sender | null = null;
let queue: string[] = [];

/**
 * 排队上限。正常情况下队里最多待一两条（就是等 PTY 起来那几十毫秒），
 * 给个上限只是防止「终端始终起不来」时无声地攒下去 —— 攒住的是用户笔记里的
 * 原文，不该让它无限占着内存。超了丢最早的：最后按的那次才是用户还记得的。
 */
const MAX_QUEUED = 32;

/**
 * 终端就绪 / 卸载时调。传 `null` 表示终端没了。
 *
 * 卸载时**连队列一起清掉**：面板一关进程就被杀（§7.3），为上一个 shell 排的
 * 队再补发到下一个 shell 里，用户会看到一段莫名其妙冒出来的路径。
 */
export function attachTerminal(fn: Sender | null): void {
  sender = fn;
  const pending = queue;
  queue = [];
  if (fn) for (const text of pending) fn(text);
}

/**
 * 送进终端之前把文本压成**一行、且不含任何控制字符**。
 *
 * 这是一条无条件的不变量，不是按情况调整的策略 —— 它换来的是：这个功能
 * 无论对面跑着什么，都**不可能替用户提交任何东西**（§7.5）。
 *
 * 中间试过一版「看对面开没开括号粘贴模式再决定留不留换行」，两次都被现实
 * 打脸：
 *
 * 1. PowerShell 提示符（没开）：`\n` 原样送过去就是回车，`@项目/Latent.md`
 *    那一行被 shell 直接执行，回了个 ParserError。
 * 2. Codex 的 TUI（开着）：xterm 的 `paste()` 里那道 `prepareTextForTerminal`
 *    **总是**把 `\n` 换成 `\r`，连括号粘贴里的也换 —— 而 `\r` 在它的输入框里
 *    就是「发送」。于是 `@项目/Latent.md` 被当成一整条消息提交了出去，
 *    剩下的选区留在输入框里。
 *
 * 两次的教训是同一个：**对面怎么理解换行，我们猜不准也不该猜**。所以干脆
 * 一个换行都不送。代价是多行选区（列表、代码）会被并成一行 —— 但引文前面
 * 那条 `@路径` 已经把出处给了对面，它自己能去读原文。
 *
 * 控制字符一并去掉（含 `ESC`）：笔记可以是分享来的、也可以是 AI 生成的
 * （§2.9），而一段 `ESC[201~` 就能提前关掉括号粘贴、把后面的内容变成按键。
 * 制表符也换成空格 —— 没开括号粘贴的 shell 里那是补全键。
 *
 * 有意**不 trim**：`@路径 ` 末尾那个空格是分隔符，用户接着打的字得跟它分开。
 */
export function sanitizeForPaste(text: string): string {
  return text.replace(/[\t\r\n]+/g, " ").replace(/[\x00-\x1f\x7f]/g, "");
}

/** 送一段文本给终端。终端还没就绪就先排队。 */
export function sendToTerminal(text: string): void {
  if (sender) {
    sender(text);
    return;
  }
  queue.push(text);
  if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
}
