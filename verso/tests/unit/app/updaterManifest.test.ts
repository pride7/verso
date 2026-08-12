import { describe, expect, it } from "vitest";

import { buildUpdaterPlatforms } from "../../../../scripts/updater-manifest.mjs";

const version = "0.8.5";
const packages = [
  `Verso_${version}_aarch64.app.tar.gz`,
  `Verso_${version}_x64.app.tar.gz`,
  `Verso_${version}_amd64.AppImage`,
  `Verso_${version}_amd64.deb`,
  `Verso-${version}-1.x86_64.rpm`,
  `Verso_${version}_x64-setup.exe`,
  `Verso_${version}_x64_en-US.msi`,
];

describe("发布清单的最终汇总", () => {
  it("同时保留 Apple Silicon、Intel 与其他桌面安装格式", () => {
    const platforms = buildUpdaterPlatforms(
      version,
      packages.map((name) => ({ name, url: `https://api.github.test/assets/${name}` })),
      Object.fromEntries(packages.map((name) => [name, `signature:${name}`])),
    );

    expect(Object.keys(platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
      "darwin-x86_64",
      "darwin-x86_64-app",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-x86_64",
      "windows-x86_64-msi",
      "windows-x86_64-nsis",
    ].sort());
    expect(platforms["darwin-aarch64-app"]).toEqual({
      signature: `signature:Verso_${version}_aarch64.app.tar.gz`,
      url: `https://api.github.test/assets/Verso_${version}_aarch64.app.tar.gz`,
    });
  });

  it("缺任一签名就停止发布，而不是生成残缺清单", () => {
    const signatures = Object.fromEntries(packages.map((name) => [name, `signature:${name}`]));
    delete signatures[`Verso_${version}_aarch64.app.tar.gz`];

    expect(() => buildUpdaterPlatforms(
      version,
      packages.map((name) => ({ name, url: name })),
      signatures,
    )).toThrow("Verso_0.8.5_aarch64.app.tar.gz.sig");
  });
});
