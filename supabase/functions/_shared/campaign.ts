import { unwrapEnvelopeData } from "./envelope.ts";

type UnknownRecord = Record<string, unknown>;

const adapterKeys = new Set([
  "stock",
  "library",
  "seedance",
  "gmi_seedance",
  "sports_edit",
  "streamer_clip",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function hasAdapterBuckets(settings: UnknownRecord): boolean {
  return Object.keys(settings).some((key) => adapterKeys.has(key) && isRecord(settings[key]));
}

function numberValue(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizedQuantity(body: UnknownRecord): number {
  const raw = body.quantity ?? body.postCount ?? body.count ?? 14;
  return Math.max(1, Math.floor(numberValue(raw, 14)));
}

export function buildCampaignCreateBatchPayload(body: UnknownRecord): UnknownRecord {
  const schedule = record(body.schedule);
  const sourceSettings = record(body.sourceSettings);
  const sourceSettingsHasBuckets = hasAdapterBuckets(sourceSettings);
  const sourceMode = String(body.sourceMode ?? "stock");
  const quantity = normalizedQuantity(body);

  const baseStockSettings = isRecord(body.stockSettings)
    ? body.stockSettings
    : isRecord(sourceSettings.stock)
      ? sourceSettings.stock
      : sourceSettingsHasBuckets
        ? {}
        : sourceSettings;
  const activeAdapterSettings = isRecord(sourceSettings[sourceMode])
    ? sourceSettings[sourceMode]
    : {};
  const stockSettings =
    sourceMode === "sports_edit" || sourceMode === "streamer_clip"
      ? { ...baseStockSettings, ...activeAdapterSettings }
      : baseStockSettings;
  const seedanceSettings = isRecord(body.seedanceSettings)
    ? body.seedanceSettings
    : isRecord(sourceSettings.seedance)
      ? sourceSettings.seedance
      : isRecord(sourceSettings.gmi_seedance)
        ? sourceSettings.gmi_seedance
        : {};

  const cadenceMinutes = numberValue(body.cadenceMinutes ?? schedule.cadenceMinutes, 1440);
  const durationSeconds = numberValue(body.durationSeconds, 15);

  return {
    ...body,
    sourceMode,
    quantity,
    count: quantity,
    cadenceMinutes,
    durationSeconds,
    startAt: body.startAt ?? schedule.startAt,
    timezone: body.timezone ?? schedule.timezone ?? "America/Los_Angeles",
    stockSettings,
    seedanceSettings,
  };
}

export function normalizeCampaignCreateResponse(rawResponse: unknown): UnknownRecord {
  const data = record(unwrapEnvelopeData(rawResponse));
  const items = Array.isArray(data.items) ? data.items : [];
  const videoLibraryItems = Array.isArray(data.video_library_items)
    ? data.video_library_items
    : [];
  const itemsTotal = Number.isFinite(Number(data.items_total))
    ? Number(data.items_total)
    : items.length || videoLibraryItems.length;

  return {
    batch: data.batch ?? null,
    audio_clip: data.audio_clip ?? data.audioClip ?? null,
    audio_asset: data.audio_asset ?? data.audioAsset ?? null,
    video_library_items: videoLibraryItems,
    items,
    items_total: itemsTotal,
  };
}
