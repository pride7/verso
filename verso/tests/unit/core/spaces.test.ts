import { describe, expect, it } from "vitest";

import { peekRoots, sidebarZones } from "../../../src/core/spaces";
import type { RecentVault } from "../../../src/core/types";

const vault = (root: string, over: Partial<RecentVault> = {}): RecentVault => ({
  root,
  name: root.split("/").pop()!,
  available: true,
  shared: false,
  ...over,
});

const NOTES = vault("D:/Notes/笔记");
const LAB = vault("D:/Notes/lab");
const PAPER = vault("D:/Shared/paper", { name: "论文合作", shared: true });
const GROUP = vault("D:/Shared/group", { name: "组会记录", shared: true });

describe("sidebarZones", () => {
  it("一个共享空间都没有时不分区 —— 侧栏和以前一模一样", () => {
    expect(sidebarZones([NOTES, LAB], NOTES.root)).toBeNull();
  });

  it("在私人空间时：私人区是它自己，共享区列出全部共享空间", () => {
    const zones = sidebarZones([NOTES, PAPER, LAB, GROUP], NOTES.root)!;
    expect(zones.private).toEqual({ root: NOTES.root, name: "笔记", current: true });
    expect(zones.shared.map((item) => item.name)).toEqual(["论文合作", "组会记录"]);
    expect(zones.shared.every((item) => !item.current)).toBe(true);
  });

  it("在共享空间时：私人区是最近用过的那个私人空间，也就是刚才来的地方", () => {
    // 清单是最近打开的在前：刚从「笔记」点进「组会记录」
    const zones = sidebarZones([GROUP, NOTES, PAPER, LAB], GROUP.root)!;
    expect(zones.private).toEqual({ root: NOTES.root, name: "笔记", current: false });
    expect(zones.shared.find((item) => item.current)?.root).toBe(GROUP.root);
  });

  // 点进一个空间会把它顶到「最近使用」的最前面。共享区照那个顺序画的话，
  // 每点一次行就换一次位置
  it("共享区的顺序不随最近使用变化", () => {
    const before = sidebarZones([NOTES, PAPER, GROUP], NOTES.root)!;
    const after = sidebarZones([GROUP, NOTES, PAPER], GROUP.root)!;
    expect(after.shared.map((item) => item.root)).toEqual(before.shared.map((item) => item.root));
  });

  it("目录已经不在的空间不摆出来", () => {
    const gone = vault("D:/Shared/old", { name: "旧空间", shared: true, available: false });
    const zones = sidebarZones([NOTES, PAPER, gone], NOTES.root)!;
    expect(zones.shared.map((item) => item.name)).toEqual(["论文合作"]);
    // 唯一的共享空间不可用时，等于没有共享空间
    expect(sidebarZones([NOTES, gone], NOTES.root)).toBeNull();
  });

  it("手上只有别人邀请的空间时，没有私人区", () => {
    const zones = sidebarZones([GROUP], GROUP.root)!;
    expect(zones.private).toBeNull();
    expect(zones.shared).toHaveLength(1);
  });

  // 切换之后清单要过一会儿才读回来。这时猜它属于哪一区，新加入的共享空间
  // 会先在「私人」底下闪一下
  it("当前空间还不在清单里时先不分区", () => {
    expect(sidebarZones([NOTES, PAPER], "D:/Shared/just-joined")).toBeNull();
    expect(sidebarZones([NOTES, PAPER], null)).toBeNull();
  });
});

describe("peekRoots", () => {
  it("只有不是当前仓库的那些要另外去读", () => {
    const zones = sidebarZones([GROUP, NOTES, PAPER], GROUP.root);
    expect(peekRoots(zones).sort()).toEqual([NOTES.root, PAPER.root].sort());
    expect(peekRoots(null)).toEqual([]);
  });
});
