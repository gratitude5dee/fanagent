import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

type DbRow = Record<string, unknown>;

function localEnv(): Record<string, string> {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, ...parts] = line.split("=");
        return [key, parts.join("=").replace(/^"|"$/g, "")];
      }),
  );
}

const envFile = localEnv();

export const e2eEnv = {
  supabaseUrl:
    process.env.E2E_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    envFile.SUPABASE_URL ??
    envFile.VITE_SUPABASE_URL,
  serviceRoleKey:
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  runProviderFlow: process.env.E2E_RUN_PROVIDER_FLOW === "1",
};

export const hasDatabaseCredentials = Boolean(e2eEnv.supabaseUrl && e2eEnv.serviceRoleKey);
export const hasProviderFlowCredentials = hasDatabaseCredentials && e2eEnv.runProviderFlow;

export function adminClient(): SupabaseClient {
  if (!e2eEnv.supabaseUrl || !e2eEnv.serviceRoleKey) {
    throw new Error("Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run e2e tests.");
  }
  return createClient(e2eEnv.supabaseUrl, e2eEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSineWavBuffer(durationSec = 31, sampleRate = 8000): Buffer {
  const samples = Math.floor(durationSec * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples; index += 1) {
    const amplitude = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2;
    buffer.writeInt16LE(Math.floor(amplitude * 32767), 44 + index * 2);
  }

  return buffer;
}

export async function seedPrimaryAccount(client = adminClient()): Promise<string> {
  const handle = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await client
    .from("accounts")
    .insert({
      platform: "tiktok",
      handle,
      status: "active",
      is_primary: true,
      tiktok_connected_at: null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return String((data as DbRow).id);
}

export async function cleanupAccount(accountId: string, client = adminClient()): Promise<void> {
  await client.from("accounts").delete().eq("id", accountId);
}

export async function seedAudioClip(accountId: string, client = adminClient()): Promise<string> {
  const asset = await client
    .from("media_assets")
    .insert({
      account_id: accountId,
      kind: "audio",
      source: "e2e_fixture",
      storage_bucket: "audio-uploads",
      storage_path: `e2e/${randomUUID()}.wav`,
      public_url: "https://example.com/e2e-audio.wav",
      mime_type: "audio/wav",
      file_name: "e2e-audio.wav",
      byte_size: 44,
      duration_seconds: 30,
    })
    .select("id")
    .single();
  if (asset.error) throw asset.error;

  const clip = await client
    .from("audio_clips")
    .insert({
      account_id: accountId,
      source_asset_id: (asset.data as DbRow).id,
      trimmed_asset_id: (asset.data as DbRow).id,
      selection_start_sec: 0,
      selection_end_sec: 30,
      duration_sec: 30,
      file_name: "e2e-audio.wav",
      transcription_status: "ready",
    })
    .select("id")
    .single();
  if (clip.error) throw clip.error;
  return String((clip.data as DbRow).id);
}

export async function seedReadyLibraryItem(
  accountId: string,
  audioClipId: string,
  client = adminClient(),
): Promise<string> {
  const item = await client
    .from("video_library_items")
    .insert({
      account_id: accountId,
      audio_clip_id: audioClipId,
      library_index: 0,
      status: "ready",
      duration_sec: 30,
      thumbnail_url: "https://example.com/thumb.jpg",
      segments: [
        {
          source: "stock",
          provider: "pexels",
          externalId: "e2e-clip",
          url: "https://example.com/source.mp4",
        },
      ],
      provenance: [
        {
          source_type: "stock",
          provider: "pexels",
          external_id: "e2e-clip",
          origin_url: "https://example.com/source.mp4",
          reused: false,
        },
      ],
      default_caption: "e2e caption",
      default_hashtags: ["#e2e"],
    })
    .select("id")
    .single();
  if (item.error) throw item.error;
  return String((item.data as DbRow).id);
}

export async function waitForAudioClip(
  accountId: string,
  sinceIso: string,
  client = adminClient(),
): Promise<DbRow> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { data, error } = await client
      .from("audio_clips")
      .select("*")
      .eq("account_id", accountId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    if (data?.[0]) return data[0] as DbRow;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for an audio_clips row.");
}

export async function waitForLibraryItems(
  audioClipId: string,
  expectedCount: number,
  client = adminClient(),
): Promise<DbRow[]> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { data, error } = await client
      .from("video_library_items")
      .select("*")
      .eq("audio_clip_id", audioClipId)
      .eq("status", "ready")
      .order("library_index", { ascending: true });
    if (error) throw error;
    if ((data ?? []).length >= expectedCount) return data as DbRow[];
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for ${expectedCount} ready video_library_items rows.`);
}

export async function openAutopilot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fanpage Autopilot" })).toBeVisible();
  await expect(page.getByText("Database queue schema")).toBeVisible();
}
