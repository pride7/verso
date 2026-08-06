import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "../types";
import {
  collaborationSeenKey,
  isOwnEntry,
  readSeenCommits,
  unreadCollaborationEntries,
  writeSeenCommits,
} from "./collaboration";

const entry = (id: string, authorName: string, authorEmail: string | null): HistoryEntry => ({
  id,
  message: `更新 ${id}`,
  detail: "",
  authorName,
  authorEmail,
  at: 1,
  files: [],
  additions: 0,
  deletions: 0,
});

const history = [
  entry("remote", "林", "lin@example.com"),
  entry("mine", "冯", "feng@example.com"),
  entry("old", "林", "lin@example.com"),
];

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

beforeEach(() => storage.clear());

describe("协作动态的已读状态", () => {
  it("首次启用不把旧历史全标成未读", () => {
    expect(unreadCollaborationEntries(history, null, { name: "冯", email: "feng@example.com" })).toEqual([]);
  });

  it("只把没看过的其他人提交算作未读", () => {
    const unread = unreadCollaborationEntries(
      history,
      new Set(["old"]),
      { name: "冯", email: "feng@example.com" },
    );
    expect(unread.map((item) => item.id)).toEqual(["remote"]);
  });

  it("优先按邮箱认自己，避免同名协作者被吞掉", () => {
    expect(isOwnEntry(entry("x", "冯", "other@example.com"), { name: "冯", email: "feng@example.com" })).toBe(false);
    expect(isOwnEntry(entry("x", "别名", "FENG@example.com"), { name: "冯", email: "feng@example.com" })).toBe(true);
  });

  it("按 vault 保存最近的提交集合，坏数据安全退回首次状态", () => {
    writeSeenCommits("D:/a", history, 2);
    expect([...readSeenCommits("D:/a")!]).toEqual(["remote", "mine"]);
    expect(readSeenCommits("D:/b")).toBeNull();

    localStorage.setItem(collaborationSeenKey("D:/a"), "not json");
    expect(readSeenCommits("D:/a")).toBeNull();
  });
});
