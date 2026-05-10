import { getSupabaseAdmin } from "./supabase.ts";

export type MediaKind =
  | "audio"
  | "source_video"
  | "generated_video"
  | "rendered_video"
  | "thumbnail"
  | "other";

const bucket = "post-assets";

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

export async function createMediaAssetFromBytes(input: {
  accountId: string;
  kind: MediaKind;
  source: string;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const ext = extensionFromMime(input.mimeType, input.fileName);
  const storagePath = `${input.kind}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from(bucket).upload(
    storagePath,
    input.bytes,
    {
      contentType: input.mimeType,
      cacheControl: "3600",
      upsert: false,
    },
  );

  if (upload.error) throw upload.error;

  const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(
    storagePath,
  );
  const inserted = await supabase
    .from("media_assets")
    .insert({
      account_id: input.accountId,
      kind: input.kind,
      source: input.source,
      storage_bucket: bucket,
      storage_path: storagePath,
      public_url: publicUrl.publicUrl,
      mime_type: input.mimeType,
      file_name: input.fileName,
      byte_size: input.bytes.byteLength,
      metadata: input.metadata ?? {},
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
      storage_bucket: bucket,
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

export async function downloadBytes(
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type")?.split(";")[0] ??
      "application/octet-stream",
  };
}
