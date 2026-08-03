#!/usr/bin/env node
/**
 * 取出 CHANGELOG 里某一版那一节，原样打到 stdout。
 *
 *   node scripts/release-notes.mjs v0.6.14
 *
 * 用处：发布流水线拿它当 GitHub release 的正文，而 release 正文又会被
 * `latest.json` 抄进 `notes` 字段 —— 也就是**用户在「检查更新」里读到的
 * 那段话**（§2.11）。所以这里的输出不是给机器看的流水账，就是给人看的。
 *
 * 找不到那一节时**退出码为 1**：宁可让发布停下来，也不要发一个正文是空的
 * 版本出去 —— 那样用户点开更新只看到一个版本号。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tag = process.argv[2];
if (!tag) {
  console.error("用法: node scripts/release-notes.mjs v0.6.14");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");

/**
 * 一节的样子是：`## v0.6.13 — 标题` 一直到下一个 `## ` 或者文件末尾。
 *
 * 行尾是混的（CRLF 和 LF 都有，见 AGENTS.md），所以先统一成 LF 再切 ——
 * 按 `\n## ` 切在 CRLF 的行上会切不开。
 */
const lines = text.replace(/\r\n/g, "\n").split("\n");
const want = tag.startsWith("v") ? tag : `v${tag}`;
const start = lines.findIndex((l) => l.startsWith(`## ${want} `) || l.trim() === `## ${want}`);
if (start === -1) {
  console.error(`CHANGELOG.md 里没有 ${want} 这一节`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end === -1) end = lines.length;

// 标题那一行不要 —— release 自己已经有标题了，正文里再来一遍是重复。
// 末尾那些 `---` 和空行也去掉
const body = lines
  .slice(start + 1, end)
  .join("\n")
  .replace(/\n*(-{3,}\s*)?$/, "")
  .trim();

process.stdout.write(body + "\n");
