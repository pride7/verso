#!/usr/bin/env node
/**
 * 版本号在三个文件里各存了一份，Tauri 不会帮你同步。
 * 不一致的后果是做出版本号错乱的安装包，而且很难第一时间发现。
 *
 *   node scripts/version.mjs          查看当前版本 + 检查一致性
 *   node scripts/version.mjs 0.2.0    三处一起改
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 用正则而不是 JSON.parse+stringify —— 后者会重排键序、丢掉格式，
 *  让 diff 里除了版本号之外全是噪音。 */
const FILES = [
  {
    path: join(root, "folio/package.json"),
    re: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    path: join(root, "folio/src-tauri/tauri.conf.json"),
    re: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    // 只匹配 [package] 段那个 version，别碰依赖的版本号
    path: join(root, "folio/src-tauri/Cargo.toml"),
    re: /(^version\s*=\s*")([^"]+)(")/m,
  },
];

const read = (f) => {
  const text = readFileSync(f.path, "utf8");
  const m = text.match(f.re);
  if (!m) throw new Error(`在 ${f.path} 里找不到版本号`);
  return { text, current: m[2] };
};

const rel = (p) => p.slice(root.length + 1).replaceAll("\\", "/");
const target = process.argv[2];

if (!target) {
  const versions = FILES.map((f) => {
    const { current } = read(f);
    console.log(`${current.padEnd(10)} ${rel(f.path)}`);
    return current;
  });
  const consistent = versions.every((v) => v === versions[0]);
  console.log(consistent ? `\n✓ 三处一致：v${versions[0]}` : "\n✗ 版本号不一致，用 `node scripts/version.mjs <版本>` 修复");
  process.exit(consistent ? 0 : 1);
}

const version = target.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本号格式应为 v0.0.0，收到：${target}`);
  process.exit(1);
}

for (const f of FILES) {
  const { text, current } = read(f);
  writeFileSync(f.path, text.replace(f.re, `$1${version}$3`));
  console.log(`${current} → ${version}   ${rel(f.path)}`);
}

console.log(`\n下一步：`);
console.log(`  1. 在 CHANGELOG.md 顶部加 v${version} 一节`);
console.log(`  2. git commit`);
console.log(`  3. git tag v${version}`);
