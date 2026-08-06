import type { GitIdentity, HistoryEntry } from "../types";

const PREFIX = "verso.collaborationSeen:";

/** 每个 vault 各记一份；路径只做 localStorage 的键，不离开本机。 */
export const collaborationSeenKey = (root: string) => `${PREFIX}${root}`;

export function readSeenCommits(root: string): Set<string> | null {
  const raw = localStorage.getItem(collaborationSeenKey(root));
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) && ids.every((id) => typeof id === "string")
      ? new Set(ids)
      : null;
  } catch {
    return null;
  }
}

/**
 * 只保留最近一段历史，避免一个用了几年的 vault 把 localStorage 越写越大。
 * Git 本身才是历史真源；这份表丢了最多只是未读点归零。
 */
export function writeSeenCommits(root: string, entries: HistoryEntry[], limit = 300): void {
  localStorage.setItem(
    collaborationSeenKey(root),
    JSON.stringify(entries.slice(0, limit).map((entry) => entry.id)),
  );
}

export function isOwnEntry(entry: HistoryEntry, identity: GitIdentity | null): boolean {
  const ownName = identity?.name?.trim() || "Verso";
  const ownEmail = identity?.email?.trim().toLocaleLowerCase() || "verso@localhost";
  const authorEmail = entry.authorEmail?.trim().toLocaleLowerCase();

  // 邮箱比显示名稳定；有邮箱时不要把同名协作者错认成自己。
  if (authorEmail) return authorEmail === ownEmail;
  return entry.authorName.trim() === ownName;
}

/** 没有已读基线表示第一次启用：旧历史不应突然全部变成未读。 */
export function unreadCollaborationEntries(
  entries: HistoryEntry[],
  seen: Set<string> | null,
  identity: GitIdentity | null,
): HistoryEntry[] {
  if (seen === null) return [];
  return entries.filter((entry) => !seen.has(entry.id) && !isOwnEntry(entry, identity));
}

