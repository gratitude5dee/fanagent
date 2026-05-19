import { getSupabaseAdmin } from "./supabase.ts";
import { renderedVideoSignedUrlSeconds } from "./render-storage.ts";
import { contentFingerprint64 } from "./hash.ts";
export { renderedVideoSignedUrlSeconds, renderedVideoStoragePath } from "./render-storage.ts";

export type MediaKind =
  | "audio"
  | "source_video"
  | "generated_video"
  | "rendered_video"
  | "thumbnail"
  | "other";

const defaultBucket = "post-assets";
const hashRequiredKinds = new Set<MediaKind>(["generated_video", "rendered_video"]);

function extensionFromMime(mimeType: string, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && ext !== fileName.toLowerCase()) return ext;
  return mimeType.split("/")[1]?.replace(/[^\w-]/g, "") || "bin";
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function metadataWithVideoHash(input: {
  kind: MediaKind;
  bytes: Uint8Array;
  metadata?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const metadata = { ...(input.metadata ?? {}) };
  if (
    hashRequiredKinds.has(input.kind) &&
    typeof metadata.perceptual_hash !== "string"
  ) {
    metadata.perceptual_hash = await contentFingerprint64(input.bytes);
    metadata.perceptual_hash_kind = "sha256_64_content_fingerprint";
  }
  return metadata;
}

export async function createMediaAssetFromBytes(input: {
  accountId: string;
  kind: MediaKind;
  source: string;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  storageBucket?: string;
  storagePath?: string;
  publicUrlMode?: "public" | "signed";
  signedUrlExpiresIn?: number;
  upsert?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const ext = extensionFromMime(input.mimeType, input.fileName);
  const bucket = input.storageBucket ?? defaultBucket;
  const storagePath = input.storagePath ?? `${input.kind}/${crypto.randomUUID()}.${ext}`;
  const metadata = await metadataWithVideoHash({
    kind: input.kind,
    bytes: input.bytes,
    metadata: input.metadata,
  });
  const upload = await supabase.storage.from(bucket).upload(storagePath, input.bytes, {
    contentType: input.mimeType,
    cacheControl: "3600",
    upsert: input.upsert ?? false,
  });

  if (upload.error) throw upload.error;

  const publicUrl =
    input.publicUrlMode === "signed"
      ? await supabase.storage
          .from(bucket)
          .createSignedUrl(storagePath, input.signedUrlExpiresIn ?? renderedVideoSignedUrlSeconds)
          .then((result) => {
            if (result.error || !result.data?.signedUrl) {
              throw result.error ?? new Error("Signed URL creation failed.");
            }
            return result.data.signedUrl;
          })
      : supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
  const inserted = await supabase
    .from("media_assets")
    .insert({
      account_id: input.accountId,
      kind: input.kind,
      source: input.source,
      storage_bucket: bucket,
      storage_path: storagePath,
      public_url: publicUrl,
      mime_type: input.mimeType,
      file_name: input.fileName,
      byte_size: input.bytes.byteLength,
      metadata,
    })
    .select("*")
    .single();

  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export async function registerMediaAsset(input: {
  accountId: string;
  kind: MediaKind;
  source: string;
  publicUrl: string;
  mimeType?: string;
  fileName?: string;
  byteSize?: number;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const inserted = await supabase
    .from("media_assets")
    .insert({
      account_id: input.accountId,
      kind: input.kind,
      source: input.source,
      storage_bucket: defaultBucket,
      public_url: input.publicUrl,
      mime_type: input.mimeType ?? "video/mp4",
      file_name: input.fileName ?? null,
      byte_size: input.byteSize ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export async function refreshStoredAssetSignedUrl(
  assetId: string,
  expiresIn = renderedVideoSignedUrlSeconds,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const asset = await supabase
    .from("media_assets")
    .select("id,storage_bucket,storage_path,public_url")
    .eq("id", assetId)
    .maybeSingle();
  if (asset.error) throw asset.error;
  if (!asset.data) return null;
  if (asset.data.storage_bucket !== "renders" || !asset.data.storage_path) {
    return asset.data.public_url ?? null;
  }

  const signed = await supabase.storage
    .from("renders")
    .createSignedUrl(asset.data.storage_path, expiresIn);
  if (signed.error || !signed.data?.signedUrl) {
    throw signed.error ?? new Error("Signed URL refresh failed.");
  }

  const updated = await supabase
    .from("media_assets")
    .update({ public_url: signed.data.signedUrl })
    .eq("id", assetId);
  if (updated.error) throw updated.error;

  return signed.data.signedUrl;
}

export async function resolveMediaAssetUrl(
  asset: {
    storage_bucket?: string | null;
    storage_path?: string | null;
    public_url?: string | null;
  },
  expiresIn = renderedVideoSignedUrlSeconds,
): Promise<string | null> {
  if (!asset.storage_bucket || !asset.storage_path) return asset.public_url ?? null;

  const supabase = getSupabaseAdmin();
  const signed = await supabase.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, expiresIn);
  if (!signed.error && signed.data?.signedUrl) return signed.data.signedUrl;
  if (asset.public_url) return asset.public_url;
  throw signed.error ?? new Error("Signed media asset URL creation failed.");
}

export async function downloadBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
  };
}
