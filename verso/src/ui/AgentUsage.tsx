/**
 * AI 的额度和上下文用量，摆在状态栏右下角、字数旁边。DESIGN.md §7.8
 *
 * 平时只是一句「额度 70%」加一个上下文小圆环；点开是一张小卡片，每个额度窗口
 * （5 小时、每周、每周 Fable…）一行进度条，写着多久后重置，下面是这个对话的
 * 上下文和花费。不用悬停提示：一大段文字挤在系统 tooltip 里，既不好读，也
 * 看不出哪个快满了（作者原话：「UI 需要做好，而不是这样文字描述」）。
 *
 * 单独一个文件：AI 面板是按需加载的，状态栏不该为了这几个字把整个面板拉进
 * 启动包。
 */
import { useEffect, useRef, useState } from "react";

import type { Conversation, QuotaWindow } from "../core/agentChat";
import { resetPhrase, shortCount } from "../core/agentChat";

export interface AgentUsageData {
  /** 哪个 AI（卡片的标题用） */
  agent: string;
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

/** 用到多少算「快到头」：八成 */
const WARN_AT = 80;

function levelOf(used: number | null, status?: QuotaWindow["status"]): "" | " is-warn" | " is-out" {
  if (status === "out" || used === 100) return " is-out";
  if (status === "warning" || (used ?? 0) >= WARN_AT) return " is-warn";
  return "";
}

export function AgentUsage({
  agent,
  usage,
  quota,
  onOpenPanel,
}: AgentUsageData & { onOpenPanel?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const ratio = usage ? Math.min(1, Math.max(0, usage.used / usage.size)) : 0;
  const ctxPct = Math.round(ratio * 100);
  const r = 5;
  const len = 2 * Math.PI * r;

  // 按用量从高到低：最要紧的那个在最上面，也是状态栏上显示的那一个
  const windows = [...quota].sort((a, b) => (b.used ?? -1) - (a.used ?? -1));
  const top = windows[0];
  const level = top ? levelOf(top.used, top.status) : "";
  const now = new Date();

  return (
    <div className="status-agent-wrap" ref={wrapRef}>
      <button
        className={`status-agent${level}${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={top && top.used !== null ? `额度已用 ${top.used}%，点开看详情` : "AI 用量，点开看详情"}
      >
        {top && (
          <span className="agent-quota">
            {level === " is-out" ? "额度用完" : top.used === null ? "额度正常" : `额度 ${top.used}%`}
          </span>
        )}
        <span className={`agent-ctx${ratio > 0.8 ? " is-full" : ""}${usage ? "" : " is-empty"}`} aria-hidden="true">
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

      {open && (
        <div className="usage-card" role="dialog" aria-label="AI 用量">
          <div className="usage-head">
            <span>额度</span>
            {agent && <span className="usage-agent">{agent}</span>}
          </div>
          {windows.length === 0 ? (
            <p className="usage-empty">这个 AI 没有报额度。</p>
          ) : (
            <ul className="usage-list">
              {windows.map((w) => {
                const lv = levelOf(w.used, w.status);
                const pct = w.used ?? 0;
                return (
                  <li key={w.name} className={`usage-row${lv}`}>
                    <div className="usage-line">
                      <span className="usage-name">{w.name}</span>
                      <span className="usage-pct">{lv === " is-out" ? "已用完" : w.used === null ? "—" : `${w.used}%`}</span>
                    </div>
                    <div
                      className="usage-bar"
                      role="progressbar"
                      aria-label={`${w.name}额度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={w.used ?? undefined}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    {(w.resetsAt || w.resets) && (
                      <div className="usage-reset">
                        {w.resetsAt ? resetPhrase(w.resetsAt, now) : `${w.resets} 重置`}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="usage-head usage-sub">
            <span>这个对话</span>
          </div>
          <div className="usage-ctx">
            <div className="usage-line">
              <span className="usage-name">上下文</span>
              <span className="usage-pct">{usage ? `${shortCount(usage.used)} / ${shortCount(usage.size)}` : "—"}</span>
            </div>
            <div className={`usage-bar${ratio > 0.8 ? " is-warn" : ""}`} aria-hidden="true">
              <span style={{ width: `${ctxPct}%` }} />
            </div>
            <div className="usage-reset">
              {usage
                ? `已用 ${ctxPct}%${ratio > 0.8 ? "，快满了，再往后它会开始压缩前面的内容" : ""}`
                : "发出第一句之后才有数字"}
            </div>
            {usage?.cost && (
              <div className="usage-line usage-cost">
                {/* 订阅登录时不真的按这个扣钱，这是按 API 价格折算的 */}
                <span className="usage-name">按 API 价格折算</span>
                <span className="usage-pct">
                  {usage.cost.currency === "USD" ? "$" : `${usage.cost.currency} `}
                  {usage.cost.amount.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {onOpenPanel && (
            <button
              className="usage-open"
              onClick={() => {
                setOpen(false);
                onOpenPanel();
              }}
            >
              打开 AI 面板
            </button>
          )}
        </div>
      )}
    </div>
  );
}
