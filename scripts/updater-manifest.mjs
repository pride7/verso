#!/usr/bin/env node
/**
 * 在所有桌面构建完成后，按 Release 里的真实资产重建 latest.json。
 *
 * tauri-action 的 matrix 任务会并行更新同一个清单。不同操作系统通常能合并，
 * 但两个 macOS 架构仍可能后写覆盖先写，导致 Apple Silicon 客户端找不到
 * `darwin-aarch64-app`。最终任务必须成为清单的唯一真源。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const platformSpecs = (version) => [
  {
    keys: ["darwin-aarch64", "darwin-aarch64-app"],
    asset: `Verso_${version}_aarch64.app.tar.gz`,
  },
  {
    keys: ["darwin-x86_64", "darwin-x86_64-app"],
    asset: `Verso_${version}_x64.app.tar.gz`,
  },
  {
    keys: ["linux-x86_64", "linux-x86_64-appimage"],
    asset: `Verso_${version}_amd64.AppImage`,
  },
  {
    keys: ["linux-x86_64-deb"],
    asset: `Verso_${version}_amd64.deb`,
  },
  {
    keys: ["linux-x86_64-rpm"],
    asset: `Verso-${version}-1.x86_64.rpm`,
  },
  {
    keys: ["windows-x86_64", "windows-x86_64-nsis"],
    asset: `Verso_${version}_x64-setup.exe`,
  },
  {
    keys: ["windows-x86_64-msi"],
    asset: `Verso_${version}_x64_en-US.msi`,
  },
];

/**
 * @param {string} version
 * @param {Array<{name: string, url: string}>} assets
 * @param {Record<string, string>} signatures 以安装包名为 key，值是 `.sig` 原文
 */
export function buildUpdaterPlatforms(version, assets, signatures) {
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const platforms = {};

  for (const spec of platformSpecs(version)) {
    const asset = byName.get(spec.asset);
    if (!asset) throw new Error(`Release 缺少自动更新包：${spec.asset}`);
    const signature = signatures[spec.asset]?.trim();
    if (!signature) throw new Error(`Release 缺少自动更新签名：${spec.asset}.sig`);
    for (const key of spec.keys) platforms[key] = { signature, url: asset.url };
  }

  return platforms;
}

function headers(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": "verso-release-manifest",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function checkedFetch(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

async function generate(tag, repository, token) {
  const releases = await checkedFetch(
    `https://api.github.com/repos/${repository}/releases?per_page=100`,
    { headers: headers(token) },
  ).then((response) => response.json());
  const release = releases.find((item) => item.tag_name === tag);
  if (!release) throw new Error(`GitHub Release 不存在：${tag}`);

  const assets = release.assets;
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const manifestAsset = byName.get("latest.json");
  if (!manifestAsset) throw new Error("Release 缺少 latest.json");

  const manifest = await checkedFetch(manifestAsset.url, {
    headers: headers(token, "application/octet-stream"),
  }).then((response) => response.json());
  const version = tag.replace(/^v/, "");
  if (manifest.version !== version) {
    throw new Error(`latest.json 版本是 ${manifest.version}，预期 ${version}`);
  }

  const signatures = {};
  for (const spec of platformSpecs(version)) {
    const signatureName = `${spec.asset}.sig`;
    const signatureAsset = byName.get(signatureName);
    if (!signatureAsset) throw new Error(`Release 缺少自动更新签名：${signatureName}`);
    signatures[spec.asset] = await checkedFetch(signatureAsset.url, {
      headers: headers(token, "application/octet-stream"),
    }).then((response) => response.text());
  }

  manifest.platforms = buildUpdaterPlatforms(
    version,
    assets.map((asset) => ({ name: asset.name, url: asset.url })),
    signatures,
  );
  return manifest;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const tag = process.argv[2] ?? process.env.TAG;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!tag || !repository || !token) {
    console.error("用法：GH_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/updater-manifest.mjs v0.8.5");
    process.exit(2);
  }

  try {
    const manifest = await generate(tag, repository, token);
    writeFileSync("latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`已生成 ${tag} 的完整 latest.json（${Object.keys(manifest.platforms).length} 个平台键）`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
