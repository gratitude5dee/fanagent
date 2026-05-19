import { refreshStoredAssetSignedUrl } from "./assets.ts";

type AssetRow = Record<string, unknown>;

export async function refreshRenderableAssetUrls(
  assets: Map<string, AssetRow>,
): Promise<Map<string, AssetRow>> {
  const refreshedAssets = new Map(assets);
  for (const [assetId, asset] of assets) {
    if (asset.storage_bucket !== "renders") continue;
    const refreshedUrl = await refreshStoredAssetSignedUrl(assetId);
    if (!refreshedUrl) continue;
    refreshedAssets.set(assetId, {
      ...asset,
      public_url: refreshedUrl,
    });
  }
  return refreshedAssets;
}
