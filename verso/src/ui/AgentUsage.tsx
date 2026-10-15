/**
 * AI 的额度和上下文用量，摆在状态栏右下角、字数旁边。DESIGN.md §7.8
 *
 * 原来挤在 AI 面板的输入框里，和权限、模型、思考强度、发送排成一行 —— 面板
 * 一窄就要折行，而它不是「这一句怎么发」的设置，是「还剩多少」的状态。状态
 * 本来就该在状态栏。单独一个文件：AI 面板是按需加载的，状态栏不该为了这几个
 * 字把整个面板拉进启动包。
 */
import type { Conversation, QuotaWindow } from "../core/agentChat";
import { shortCount } from "../core/agentChat";

export interface AgentUsageData {
  /** 当前对话的上下文用量；还没发过话就是 null */
  usage: NonNullable<Conversation["usage"]> | null;
  /** 账号额度，各个窗口 */
  quota: QuotaWindow[];
}

/** 重置时间说成人话：今天的说钟点，别的天说日期 */
export function resetText(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/**
 * 「额度 70%」加一个上下文小圆环。额度取几个窗口（5 小时、每周…）里用得最多
 * 的那个，快到头变提醒色、用完变红；圆环快满时变色 —— 那时 agent 要开始压缩
 * 前面的对话了。悬停看每一项的数字和重置时间，点一下打开 AI 面板
 */
export function AgentUsage({ usage, quota, onClick }: AgentUsageData & { onClick?: () => void }) {
  const ratio = usage ? Math.min(1, Math.max(0, usage.used / usage.size)) : 0;
  const r = 5;
  const len = 2 * Math.PI * r;
  const pct = Math.round(ratio * 100);
  const cost = usage?.cost
    ? ` · 这个对话花了 ${usage.cost.currency === "USD" ? "$" : `${usage.cost.currency} `}${usage.cost.amount.toFixed(2)}`
    : "";
  const ctxLine = usage
    ? `上下文：${shortCount(usage.used)} / ${shortCount(usage.size)}（${pct}%）${cost}`
    : "上下文：发出第一句之后才有数字";

  const windows = [...quota].sort((a, b) => (b.used ?? -1) - (a.used ?? -1));
  const top = windows[0];
  const out = quota.some((q) => q.status === "out" || q.used === 100);
  const warning = quota.some((q) => q.status === "warning" || (q.used ?? 0) >= 80);
  const quotaLines = windows.map((q) => {
    const used = q.status === "out" ? "已用完" : q.used === null ? "可用" : `已用 ${q.used}%`;
    return `${q.name}额度：${used}${q.resets ? `，${q.resets} 重置` : ""}`;
  });

  return (
    <button
      className={`status-agent${out ? " is-out" : warning ? " is-warn" : ""}`}
      title={[ctxLine, ...quotaLines].join("\n")}
      onClick={onClick}
    >
      {top && <span className="agent-quota">{out ? "额度用完" : top.used === null ? "额度正常" : `额度 ${top.used}%`}</span>}
      <span
        className={`agent-ctx${ratio > 0.8 ? " is-full" : ""}${usage ? "" : " is-empty"}`}
        aria-label={usage ? `上下文已用 ${pct}%` : "上下文还没有用量"}
        role="img"
      >
        <svg width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r={r} className="agent-ctx-track" />
          {usage && (
            <circle
              cx="7"
              cy="7"
              r={r}
              className="agent-ctx-fill"
              strokeDasharray={`${len * ratio} ${len}`}
              transform="rotate(-90 7 7)"
            />
          )}
        </svg>
      </span>
    </button>
  );
}
