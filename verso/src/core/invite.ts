/**
 * 共享空间的邀请文本。DESIGN.md §2.8
 *
 * **为什么要有这么一段文本。** 受邀者是信息最少的那个人：他没建过这个仓库，
 * 不知道它在 GitHub 上叫什么，更没理由为了读一篇笔记先学会「HTTPS 克隆地址」。
 * 而这串地址在邀请方手上本来就是现成的。把它整理成一段能直接发出去的话，
 * 加入流程就从「去 GitHub 翻仓库列表」变成「粘贴」。
 *
 * 格式**故意是给人看的纯文本**，不是 `verso://` 之类的自定义协议：协议链接要
 * 注册系统处理器，在聊天软件里既不可点也不可读，粘错一个字符还没法自查。这里
 * 反过来 —— 人能看懂，机器也认得出，而且**退化得体面**：对方只发来一个裸地址
 * 同样能用。
 */

/** 认得出邀请、也用来取回空间名的那一行前缀。 */
const HEADING = "【Verso 共享空间邀请】";

export interface Invite {
  url: string;
  /** 邀请里带的空间名；只有裸地址时为 null。 */
  name: string | null;
}

/** 一段可以直接发给对方的邀请。 */
export function buildInvite(input: { url: string; name?: string | null }): string {
  const url = input.url.trim();
  const name = input.name?.trim();
  return [
    name ? `${HEADING}${name}` : HEADING,
    "在 Verso 里点「加入共享空间」，把这段整个粘贴进去即可。",
    url,
  ].join("\n");
}

/**
 * 尾随的中英文标点不属于地址 —— 从聊天记录里复制常常会带上句号或右括号，
 * 而 `…notes.git。` 这种地址只会在克隆时报一句看不懂的错。
 *
 * **只削尾巴是不够的**，中文标点还必须从 `ADDRESS` 的字符类里排掉：
 * 中文写作里地址后面直接跟标点再跟字是常态（`…records.git，你加一下。`），
 * 那时候削掉结尾的句号之后，`，你加一下` 还留在地址里。
 */
const TRAILING = /[)）」』】>，,。.;；、!！?？'"]+$/;

/**
 * 地址不一定单独占一行。人常常写成「地址在这（https://…）。」，所以是在整段里
 * **找**一个地址，而不是把每个空格分段都拿去当候选 —— 后者会因为前面粘着一个
 * 全角括号就认不出来，而那正是从聊天记录里复制的常态。
 */
const ADDRESS =
  /(?:https?|ssh|git):\/\/[^\s()（）「」『』【】<>，。；：、！？《》〈〉…]+|[\w.+-]+@[\w.-]+:[^\s()（）「」『』【】<>，。；：、！？《》〈〉…]+/;

/**
 * GitHub 上 `owner/repo` 的简写。只在整段里找不到任何地址时才当成地址。
 *
 * 两段都必须**带字母**：不加这一条的话，「会议 09/03 讨论共享空间的事」里的
 * `09/03` 会被当成合法邀请，界面还一本正经地摆出确认卡片。GitHub 的用户名和
 * 仓库名可以带数字，但纯数字的日期写法远比纯数字的仓库常见。
 */
const SHORTHAND = /^[\w.-]*[A-Za-z][\w.-]*\/[\w.-]*[A-Za-z][\w.-]*$/;

/**
 * 从粘贴的内容里认出一个共享空间。
 *
 * 整段邀请、一个裸地址、`owner/repo` 简写都接受 —— 不认得时返回 null，让
 * 调用方说清楚看到了什么，而不是逼人把文本改成某种格式。
 */
export function parseInvite(text: string): Invite | null {
  const lines = text.split(/\r?\n/);
  const heading = lines.find((line) => line.includes(HEADING));
  const name = heading
    ? heading.slice(heading.indexOf(HEADING) + HEADING.length).trim() || null
    : null;

  const found = text.match(ADDRESS)?.[0].replace(TRAILING, "");
  if (found) return { url: found, name };

  const tokens = text.split(/\s+/).map((token) => token.replace(TRAILING, "")).filter(Boolean);
  const shorthand = tokens.find((token) => SHORTHAND.test(token));
  if (shorthand) return { url: `https://github.com/${shorthand}.git`, name };

  return null;
}

/**
 * 仓库地址对应的本地文件夹名。
 *
 * 和创建共享空间时用的是同一条规则（仓库名即目录名），这样同一个空间在
 * 建立方和加入方的机器上叫同一个名字，对着说话时不会出现两套称呼。
 */
export function folderNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/[/\\]+$/, "");
  const withoutScheme = cleaned.replace(/^[a-z][\w+.-]*:\/\//i, "");
  // 只有主机名、没有仓库路径时取不出名字。拿主机名当文件夹名会得到一个
  // 谁都认不出来是哪份内容的目录，不如老实用兜底名。
  const path = /[/\\:]/.test(withoutScheme) ? withoutScheme : "";
  const segment = path.split(/[/\\:]/).pop() ?? "";
  const name = segment.replace(/\.git$/i, "").trim();
  // 文件名里不能出现的字符一律换成连字符：远端地址可以很随意，本地目录不行
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-") || "shared-space";
}
