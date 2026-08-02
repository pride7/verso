/**
 * 文档图标的候选表（§2.3 的 frontmatter `icon`）。
 *
 * ## 为什么是 emoji，不是一套自己的图标
 *
 * 图标存在笔记的 frontmatter 里，也就是**用户的文件**里。存一个自定义图标名
 * （`icon: book-open`）等于让这份笔记只有 Verso 认得 —— 拖进 Obsidian、用
 * 记事本打开，看到的是一个查不到含义的字符串。emoji 是 Unicode，哪儿都认识，
 * 记事本里也照样显示（§0 第 1 条）。
 *
 * 代价是渲染归系统字体管，同一个 emoji 在 Windows 和 macOS 上长得不一样。
 * 这是可以接受的：图标的用处是**一眼分辨**，不是精确的视觉设计。
 *
 * ## 为什么是一张手挑的表，不是全量 emoji
 *
 * 全量有三千多个，其中绝大多数（食物、国旗、肤色变体）对笔记毫无意义，
 * 而它们会把真正有用的那几十个淹掉。这张表按「记笔记的人会想标什么」挑，
 * 搜不到的还可以直接粘贴任意字符进去（见 `normalizeIcon`）。
 */

export interface EmojiItem {
  /** 字符本身 */
  ch: string;
  /** 搜索关键词。中文在前 —— 这个软件的主语言是中文 */
  keywords: string[];
}

export interface EmojiGroup {
  name: string;
  items: EmojiItem[];
}

/** `["📘", "书", "book"]` 这样的紧凑写法，省掉一百多个对象字面量的噪音 */
function g(name: string, rows: string[][]): EmojiGroup {
  return { name, items: rows.map(([ch, ...keywords]) => ({ ch, keywords })) };
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  g("文档与写作", [
    ["📄", "文档", "纸", "doc", "page"],
    ["📝", "笔记", "写", "note", "memo"],
    ["📃", "草稿", "卷", "draft"],
    ["📑", "书签", "索引", "tabs"],
    ["📖", "阅读", "读书", "read", "book"],
    ["📚", "书堆", "藏书", "books", "library"],
    ["📓", "本子", "笔记本", "notebook"],
    ["📔", "手账", "日记本", "journal"],
    ["📕", "红书", "book", "red"],
    ["📗", "绿书", "book", "green"],
    ["📘", "蓝书", "book", "blue"],
    ["📙", "橙书", "book", "orange"],
    ["🗒️", "便签", "记事", "pad"],
    ["📰", "文章", "报纸", "news", "article"],
    ["✏️", "铅笔", "写", "pencil"],
    ["🖊️", "钢笔", "笔", "pen"],
    ["🖌️", "画笔", "brush"],
    ["🔖", "书签", "bookmark"],
    ["🏷️", "标签", "tag", "label"],
    ["📌", "图钉", "钉住", "pin"],
    ["📎", "回形针", "附件", "clip", "attach"],
    ["✂️", "剪", "裁剪", "cut"],
  ]),
  g("学习与科研", [
    ["🎓", "学习", "毕业", "课程", "study", "school"],
    ["🧠", "大脑", "思考", "想法", "brain", "think"],
    ["💡", "灵感", "点子", "想法", "idea", "bulb"],
    ["🔍", "查找", "搜索", "研究", "search", "find"],
    ["🔬", "显微镜", "实验", "科研", "lab", "science"],
    ["🧪", "试管", "实验", "化学", "test", "chemistry"],
    ["🧬", "生物", "基因", "dna", "bio"],
    ["🔭", "望远镜", "天文", "远景", "telescope"],
    ["📐", "几何", "尺", "设计", "geometry", "ruler"],
    ["📏", "尺子", "测量", "ruler", "measure"],
    ["🧮", "算盘", "计算", "数学", "abacus", "math"],
    ["♾️", "无穷", "数学", "infinity"],
    ["📊", "图表", "柱状图", "统计", "chart", "stats"],
    ["📈", "上升", "增长", "趋势", "up", "growth"],
    ["📉", "下降", "回落", "down"],
    ["🗺️", "地图", "全局", "map"],
    ["🧭", "指南针", "方向", "导航", "compass"],
    ["🌐", "网络", "国际", "web", "global"],
  ]),
  g("工作与项目", [
    ["💼", "工作", "公文包", "职业", "work", "business"],
    ["📅", "日历", "日程", "calendar", "date"],
    ["🗓️", "计划", "日程表", "schedule", "plan"],
    ["⏰", "闹钟", "提醒", "时间", "alarm", "time"],
    ["⏳", "沙漏", "等待", "进行中", "wait", "pending"],
    ["✅", "完成", "对勾", "done", "check"],
    ["☑️", "待办", "清单", "todo", "checkbox"],
    ["❌", "取消", "错", "废弃", "cancel", "no"],
    ["🎯", "目标", "靶", "goal", "target"],
    ["🚀", "启动", "发布", "上线", "launch", "ship"],
    ["🏁", "完结", "终点", "finish"],
    ["📦", "归档", "包", "archive", "box"],
    ["🗂️", "分类", "文件夹", "folder", "category"],
    ["🗄️", "档案", "资料库", "cabinet", "archive"],
    ["🧰", "工具箱", "toolbox"],
    ["🛠️", "工具", "维护", "tools", "fix"],
    ["⚙️", "设置", "配置", "机制", "settings", "config"],
    ["🔔", "提醒", "通知", "bell", "notify"],
    ["💰", "钱", "预算", "财务", "money", "budget"],
    ["🤝", "合作", "会议", "meeting", "team"],
  ]),
  g("代码与技术", [
    ["💻", "代码", "电脑", "开发", "code", "laptop"],
    ["🖥️", "主机", "桌面", "desktop"],
    ["⌨️", "键盘", "输入", "keyboard"],
    ["🐛", "缺陷", "bug", "问题"],
    ["🧩", "模块", "拼图", "插件", "module", "plugin"],
    ["🔌", "接口", "插件", "api", "plugin"],
    ["🗜️", "压缩", "优化", "compress"],
    ["📡", "网络", "信号", "signal", "network"],
    ["🔐", "安全", "加密", "security", "encrypt"],
    ["🔑", "密钥", "凭据", "key", "token"],
    ["🛡️", "防护", "安全", "shield", "guard"],
    ["⚡", "性能", "快", "闪电", "fast", "perf"],
    ["🔥", "热", "重要", "紧急", "hot", "fire"],
    ["♻️", "重构", "循环", "refactor", "recycle"],
    ["🧱", "地基", "架构", "brick", "infra"],
    ["🕹️", "游戏", "控制", "game"],
  ]),
  g("状态与强调", [
    ["⭐", "重要", "星", "收藏", "star", "fav"],
    ["✨", "新", "亮点", "sparkle", "new"],
    ["❗", "注意", "重要", "important"],
    ["❓", "疑问", "待解", "question"],
    ["⚠️", "警告", "小心", "warning"],
    ["🚧", "施工", "未完成", "wip", "construction"],
    ["🔒", "锁定", "私密", "lock", "private"],
    ["🔓", "解锁", "公开", "unlock"],
    ["❤️", "喜欢", "红心", "heart", "love"],
    ["🔴", "红", "高优先级", "red"],
    ["🟠", "橙", "orange"],
    ["🟡", "黄", "yellow"],
    ["🟢", "绿", "正常", "green", "ok"],
    ["🔵", "蓝", "blue"],
    ["🟣", "紫", "purple"],
    ["⚫", "黑", "black"],
    ["⚪", "白", "white"],
    ["🔺", "上", "三角", "up"],
    ["🔻", "下", "三角", "down"],
  ]),
  g("生活与自然", [
    ["🏠", "家", "生活", "home"],
    ["🌱", "萌芽", "开始", "成长", "seed", "grow"],
    ["🌳", "树", "自然", "tree"],
    ["🍀", "幸运", "四叶草", "luck"],
    ["🌸", "花", "春", "flower"],
    ["🌊", "海", "波", "wave", "sea"],
    ["🏔️", "山", "高", "mountain"],
    ["☀️", "太阳", "晴", "sun"],
    ["🌙", "月", "夜", "moon", "night"],
    ["❄️", "雪", "冬", "snow"],
    ["🌈", "彩虹", "rainbow"],
    ["☕", "咖啡", "休息", "coffee"],
    ["🍵", "茶", "tea"],
    ["🎵", "音乐", "music"],
    ["🎨", "设计", "美术", "art", "design"],
    ["🎬", "影视", "视频", "movie", "video"],
    ["📷", "照片", "拍摄", "photo", "camera"],
    ["🏃", "运动", "跑", "run", "sport"],
    ["🧘", "冥想", "静", "meditate"],
    ["✈️", "旅行", "出行", "travel", "flight"],
    ["🍎", "苹果", "食物", "apple", "food"],
    ["🐈", "猫", "cat"],
  ]),
];

const ALL: EmojiItem[] = EMOJI_GROUPS.flatMap((x) => x.items);

/**
 * 按关键词找图标。空查询返回空数组（调用方这时该显示分组浏览）。
 *
 * 中文按**子串**匹配（「笔记本」要能被「笔记」和「本」找到），英文同样按
 * 子串 —— 关键词都很短，这里没必要上模糊匹配。
 */
export function searchEmoji(query: string): EmojiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL.filter((e) => e.ch === q || e.keywords.some((k) => k.toLowerCase().includes(q)));
}

/**
 * 把用户输入收敛成**一个**图标字符。
 *
 * 这是「搜不到就自己粘一个」那条出路的守门人 —— 也是防止一整段文字跑到
 * 树上去的地方。frontmatter 是纯文本，用户完全可能手写 `icon: 一段说明`，
 * 那时树上每一行都会被撑开。
 *
 * 用 `Intl.Segmenter` 而不是 `[...s][0]`：emoji 常常由多个码点组成
 * （`❤️` 是心 + 变体选择符，旗帜是两个区域指示符），按码点取会得到半个
 * 字符，屏幕上是个方框。
 */
export function normalizeIcon(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // tsconfig 的 lib 停在 ES2020，`Intl.Segmenter` 的类型不在里面。
  // 只为一个函数去抬整个项目的 lib 不划算，就地声明用得到的那一点
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (Seg) {
    for (const part of new Seg(undefined, { granularity: "grapheme" }).segment(s)) {
      return part.segment;
    }
    return null;
  }
  return Array.from(s)[0] ?? null;
}

type SegmenterCtor = new (
  locales?: string,
  options?: { granularity: "grapheme" },
) => { segment(input: string): Iterable<{ segment: string }> };

/** 最近用过的图标。localStorage 而不是设置文件 —— 丢了没有任何损失 */
const RECENT_KEY = "verso.iconRecent";
const RECENT_MAX = 16;

export function recentIcons(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentIcon(ch: string): string[] {
  const next = [ch, ...recentIcons().filter((x) => x !== ch)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式下写不进去。最近使用是锦上添花，失败就当没有
  }
  return next;
}
