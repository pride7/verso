export interface UpdaterAsset {
  name: string;
  url: string;
}

export interface UpdaterPlatform {
  signature: string;
  url: string;
}

export function buildUpdaterPlatforms(
  version: string,
  assets: UpdaterAsset[],
  signatures: Record<string, string>,
): Record<string, UpdaterPlatform>;
