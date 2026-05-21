import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { AudioClipStatus, Duration } from "@/components/autopilot/UploadStep";
import { clipSelectionMatchesDuration } from "@/lib/audio/selection";
import {
  registerAudioClip,
  transcribeAudioClip,
  type RegisteredAudioClipSummary,
} from "@/lib/fanagent/audioClip";
import {
  categoryToSourceMode,
  fetchClipCategories,
  fetchPoolCounts,
  type CategoryNode,
  type PoolCountIndex,
} from "@/lib/fanagent/categories";
import { isFanAgentSchemaReady, type FanAgentSchemaDiagnostics } from "@/lib/fanagent/diagnostics";
import { invokeEdgeFunction } from "@/lib/fanagent/invokeFunction";
import { coerceSelectableSourceMode, type SourceMode } from "@/lib/fanagent/sourceMode";
import { lyricsApi } from "@/lib/lyrics/api";
import type { LyricTemplate, LyricTemplateSummary } from "@/lib/lyrics/types";
import { buildCampaignHandoff } from "./handoff";
import { AutopilotContext } from "./useAutopilot";

export type Account = {
  id: string;
  handle: string | null;
  status: string | null;
  is_primary?: boolean;
  tiktok_connected_at: string | null;
  tiktok_display_name: string | null;
};

export type Batch = {
  id: string;
  account_id?: string | null;
  source_mode: string;
  status: string;
  post_count: number;
  cadence_minutes: number;
  paused_at: string | null;
  completed_at?: string | null;
  created_at: string;
  prompt?: string | null;
  lyric_template_id?: string | null;
};

export type Segment = {
  source?: string | null;
  url?: string | null;
  provider?: string | null;
  externalId?: string | null;
  query?: string | null;
  durationSec?: number | null;
  reused?: boolean | null;
};

export type Item = {
  id: string;
  account_id?: string | null;
  batch_id: string;
  item_index?: number | null;
  library_item_id?: string | null;
  status: string;
  scheduled_at: string;
  provider?: string | null;
  prompt?: string | null;
  segments?: Segment[] | null;
  stock_clip_url: string | null;
  render_provider: string | null;
  error_message: string | null;
  lyric_template_id?: string | null;
  stage_events?: Array<{ stage?: string; at?: string; [key: string]: unknown }> | null;
};

export type Post = {
  id: string;
  batch_id?: string | null;
  generation_item_id: string | null;
  library_item_id?: string | null;
  caption: string;
  status: string;
  publish_status: string | null;
  scheduled_at: string;
  video_url: string | null;
};

export type CampaignList = {
  account: Account | null;
  batches: Batch[];
  items: Item[];
  posts: Post[];
  lyricTemplates?: LyricTemplateSummary[];
};

export type Diagnostics = {
  env: Record<string, boolean>;
  buckets: Array<{ name: string; ok: boolean }>;
  account: {
    id: string;
    platform: string;
    handle: string | null;
    tiktokConnected: boolean;
    tiktokCreatorInfo: Record<string, unknown> | null;
  } | null;
  queueCounts: Record<string, number>;
  lastWorkerError: unknown;
  cron: {
    configured: boolean;
    schedule: string;
    detectable: boolean;
  };
  schema: FanAgentSchemaDiagnostics;
  recentWorkerRuns: Array<{
    function_name: string;
    started_at: string;
    ended_at: string | null;
    items_processed: number;
    errors_count: number;
    detail?: unknown;
  }>;
  recentFailedItems: Array<{
    id: string;
    status: string;
    provider: string | null;
    error_message: string | null;
    updated_at: string;
  }>;
};

export type TrimmedAudio = {
  blob: Blob;
  durationSec: number;
  name: string;
  startSec: number;
  endSec: number;
  originalFileName: string;
};

export type CampaignHandoff = {
  audioClipId: string | null;
  lyricTemplateId: string | null;
  templateStatus: LyricTemplateSummary["status"] | null;
  durationSec: number | null;
  clipSelection: {
    startSec: number;
    endSec: number;
    durationSec: number;
    originalFileName: string;
  } | null;
  trimmedAudioAssetId: string | null;
  templateAudioClipId: string | null;
  templateSaved: boolean;
  templateMatchesAudio: boolean;
  ready: boolean;
};

type StockProviders = {
  library: boolean;
  pexels: boolean;
  pixabay: boolean;
};

type CampaignCreateResponse = {
  batch?: { id?: string | null } | null;
  audio_clip?: { id?: string | null } | null;
  audio_asset?: { id?: string | null } | null;
  items?: Array<{ id?: string | null }>;
  video_library_items?: Array<{ id?: string | null }>;
  posts?: Array<{ id?: string | null }>;
  items_total?: number;
};

export type AutopilotContextValue = {
  data: CampaignList | null;
  diagnostics: Diagnostics | null;
  categories: CategoryNode[];
  categoriesLoading: boolean;
  poolCounts: PoolCountIndex | null;
  lyricTemplates: LyricTemplateSummary[];
  audioFile: File | null;
  trimmedAudio: TrimmedAudio | null;
  duration: Duration;
  sourceMode: SourceMode;
  postCount: number;
  startAt: string;
  cadenceMinutes: number;
  prompt: string;
  stockProviders: StockProviders;
  stockKeywords: string;
  stockNegativeKeywords: string;
  stockCategory: string;
  stockMood: string;
  stockPortraitOnly: boolean;
  stockAvoidReuse: boolean;
  stockAllowReuse: boolean;
  sportsLeague: string;
  sportsTeam: string;
  sportsAllowedChannels: string;
  sportsOwnerAssetUrls: string;
  streamerName: string;
  streamerAllowedChannels: string;
  seedanceResolution: "480p" | "720p" | "1080p";
  publishPrivacy: string;
  busy: boolean;
  message: string | null;
  lyricTemplateId: string;
  lyricsDrawerOpen: boolean;
  registeredAudioClip: RegisteredAudioClipSummary | null;
  audioClipStatus: AudioClipStatus;
  audioClipError: string | null;
  autoOpenTemplateRequest: number;
  categoryId: string;
  subcategorySlug: string;
  randomize: boolean;
  autoRender: boolean;
  lastLaunchedAudioClipId: string | null;
  account: Account | null;
  accountId: string;
  isConnected: boolean;
  schemaReady: boolean;
  campaignHandoff: CampaignHandoff;
  derivedSourceMode: SourceMode;
  selectedTemplate: LyricTemplateSummary | null;
  templateById: Map<string, LyricTemplateSummary>;
  hasLoadedInitialData: boolean;
  isCampaignFormComplete: boolean;
  setAudioFile: Dispatch<SetStateAction<File | null>>;
  setTrimmedAudio: Dispatch<SetStateAction<TrimmedAudio | null>>;
  setDuration: Dispatch<SetStateAction<Duration>>;
  setSourceMode: Dispatch<SetStateAction<SourceMode>>;
  setPostCount: Dispatch<SetStateAction<number>>;
  setStartAt: Dispatch<SetStateAction<string>>;
  setCadenceMinutes: Dispatch<SetStateAction<number>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setStockProviders: Dispatch<SetStateAction<StockProviders>>;
  setStockKeywords: Dispatch<SetStateAction<string>>;
  setStockNegativeKeywords: Dispatch<SetStateAction<string>>;
  setStockCategory: Dispatch<SetStateAction<string>>;
  setStockMood: Dispatch<SetStateAction<string>>;
  setStockPortraitOnly: Dispatch<SetStateAction<boolean>>;
  setStockAvoidReuse: Dispatch<SetStateAction<boolean>>;
  setStockAllowReuse: Dispatch<SetStateAction<boolean>>;
  setSportsLeague: Dispatch<SetStateAction<string>>;
  setSportsTeam: Dispatch<SetStateAction<string>>;
  setSportsAllowedChannels: Dispatch<SetStateAction<string>>;
  setSportsOwnerAssetUrls: Dispatch<SetStateAction<string>>;
  setStreamerName: Dispatch<SetStateAction<string>>;
  setStreamerAllowedChannels: Dispatch<SetStateAction<string>>;
  setSeedanceResolution: Dispatch<SetStateAction<"480p" | "720p" | "1080p">>;
  setPublishPrivacy: Dispatch<SetStateAction<string>>;
  setLyricTemplateId: Dispatch<SetStateAction<string>>;
  setLyricsDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setCategoryId: Dispatch<SetStateAction<string>>;
  setSubcategorySlug: Dispatch<SetStateAction<string>>;
  setRandomize: Dispatch<SetStateAction<boolean>>;
  setAutoRender: Dispatch<SetStateAction<boolean>>;
  refresh: () => Promise<void>;
  refreshLyricTemplates: () => Promise<void>;
  refreshDiagnostics: () => Promise<void>;
  startCampaign: () => Promise<CampaignCreateResponse>;
  run: <T>(label: string, fn: () => Promise<T>) => Promise<void>;
  recoverRecentFailures: () => Promise<void>;
};

type AutopilotProviderProps = {
  children: ReactNode;
  initialLyricTemplateId?: string | null;
  focusLyricsStepSignal?: number;
};

async function callCampaign<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  return invokeEdgeFunction<T>("fanpage-campaign", { action, ...(body ?? {}) });
}

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function splitCsv(value: string): string[] {
  return value
    .split(/[,;\n]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseKeyValueLines(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/[\n,;]/g)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.includes("=") ? "=" : ":";
        const [key, ...rest] = entry.split(separator);
        return [key?.trim(), rest.join(separator).trim()];
      })
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" &&
          entry[0].length > 0 &&
          typeof entry[1] === "string" &&
          /^https?:\/\//i.test(entry[1]),
      ),
  );
}

function dedupeStrategyForStockOptions(input: {
  avoidReuse: boolean;
  allowReuseWhenExhausted: boolean;
}): "strict" | "allow_reuse_after_exhaustion" | "allow_reuse_freely" {
  if (!input.avoidReuse) return "allow_reuse_freely";
  return input.allowReuseWhenExhausted ? "allow_reuse_after_exhaustion" : "strict";
}

function summarizeTemplate(template: LyricTemplate | LyricTemplateSummary): LyricTemplateSummary {
  if ("word_count" in template && "cut_marker_count" in template) return template;
  const full = template as LyricTemplate;
  return {
    id: template.id,
    title: template.title,
    status: template.status,
    audio_clip_id: template.audio_clip_id ?? null,
    trimmed_audio_asset_id: template.trimmed_audio_asset_id ?? null,
    total_duration_ms: template.total_duration_ms,
    selection_duration_ms: template.selection_duration_ms,
    word_count: Array.isArray(full.lyric_blocks)
      ? full.lyric_blocks.reduce((sum, block) => sum + (block.words?.length ?? 0), 0)
      : 0,
    cut_marker_count: Array.isArray(full.cut_markers) ? full.cut_markers.length : 0,
    updated_at: template.updated_at,
  };
}

export function AutopilotProvider({
  children,
  initialLyricTemplateId,
  focusLyricsStepSignal,
}: AutopilotProviderProps) {
  const [data, setData] = useState<CampaignList | null>(null);
  const [lastLaunchedAudioClipId, setLastLaunchedAudioClipId] = useState<string | null>(null);
  const [lyricTemplates, setLyricTemplates] = useState<LyricTemplateSummary[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [trimmedAudio, setTrimmedAudio] = useState<TrimmedAudio | null>(null);
  const [duration, setDuration] = useState<Duration>(15);
  const [sourceMode, setSourceMode] = useState<SourceMode>("stock");
  const [postCount, setPostCount] = useState(14);
  const [startAt, setStartAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 15 * 60_000)),
  );
  const [cadenceMinutes, setCadenceMinutes] = useState(1440);
  const [prompt, setPrompt] = useState("aesthetic vertical cinematic visuals");
  const [stockProviders, setStockProviders] = useState<StockProviders>({
    library: true,
    pexels: true,
    pixabay: true,
  });
  const [stockKeywords, setStockKeywords] = useState("");
  const [stockNegativeKeywords, setStockNegativeKeywords] = useState("logo, watermark, text");
  const [stockCategory, setStockCategory] = useState("");
  const [stockMood, setStockMood] = useState("");
  const [stockPortraitOnly, setStockPortraitOnly] = useState(true);
  const [stockAvoidReuse, setStockAvoidReuse] = useState(true);
  const [stockAllowReuse, setStockAllowReuse] = useState(true);
  const [sportsLeague, setSportsLeague] = useState("");
  const [sportsTeam, setSportsTeam] = useState("");
  const [sportsAllowedChannels, setSportsAllowedChannels] = useState("");
  const [sportsOwnerAssetUrls, setSportsOwnerAssetUrls] = useState("");
  const [streamerName, setStreamerName] = useState("");
  const [streamerAllowedChannels, setStreamerAllowedChannels] = useState("");
  const [seedanceResolution, setSeedanceResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [publishPrivacy, setPublishPrivacy] = useState("SELF_ONLY");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lyricTemplateId, setLyricTemplateId] = useState("");
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false);
  const [registeredAudioClip, setRegisteredAudioClip] = useState<RegisteredAudioClipSummary | null>(
    null,
  );
  const [audioClipStatus, setAudioClipStatus] = useState<AudioClipStatus>("idle");
  const [audioClipError, setAudioClipError] = useState<string | null>(null);
  const [autoOpenTemplateRequest, setAutoOpenTemplateRequest] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [poolCounts, setPoolCounts] = useState<PoolCountIndex | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [subcategorySlug, setSubcategorySlug] = useState("");
  const [randomize, setRandomize] = useState(false);
  const [autoRender, setAutoRender] = useState(true);

  const templateById = useMemo(
    () => new Map(lyricTemplates.map((template) => [template.id, template])),
    [lyricTemplates],
  );
  const selectedTemplate = lyricTemplateId ? (templateById.get(lyricTemplateId) ?? null) : null;
  const lyricTemplateIdRef = useRef(lyricTemplateId);
  const appliedInitialTemplateRef = useRef<string | null>(null);

  const account = data?.account ?? null;
  const accountId = account?.id ?? "";
  const isConnected = !!account?.tiktok_connected_at;
  const schemaReady = isFanAgentSchemaReady(diagnostics?.schema);
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === categoryId) ?? null,
    [categories, categoryId],
  );
  const derivedSourceMode: SourceMode = useMemo(() => {
    if (randomize) return "stock";
    if (!selectedCategory) return sourceMode;
    return coerceSelectableSourceMode(categoryToSourceMode(selectedCategory), diagnostics?.env);
  }, [randomize, selectedCategory, sourceMode, diagnostics?.env]);
  const trimmedAudioKey = useMemo(
    () =>
      trimmedAudio
        ? [
            trimmedAudio.name,
            trimmedAudio.startSec,
            trimmedAudio.endSec,
            trimmedAudio.durationSec,
            trimmedAudio.blob.size,
          ].join(":")
        : "",
    [trimmedAudio],
  );
  const campaignHandoff = useMemo(
    () =>
      buildCampaignHandoff({
        lyricTemplateId,
        registeredAudioClip,
        selectedTemplate,
        trimmedAudio,
      }),
    [lyricTemplateId, registeredAudioClip, selectedTemplate, trimmedAudio],
  );
  const isCampaignFormComplete = useMemo(() => {
    if (!campaignHandoff.ready) return false;
    if (!Number.isFinite(postCount) || postCount < 1 || postCount > 250) return false;
    if (!Number.isFinite(cadenceMinutes) || cadenceMinutes < 5) return false;
    const scheduledStart = new Date(startAt);
    return Number.isFinite(scheduledStart.getTime()) && prompt.trim().length > 0;
  }, [cadenceMinutes, campaignHandoff.ready, postCount, prompt, startAt]);

  const refresh = useCallback(async () => {
    try {
      const next = await callCampaign<CampaignList>("list");
      setData(next);
      setLyricTemplates((next.lyricTemplates ?? []).map(summarizeTemplate));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const refreshLyricTemplates = useCallback(async () => {
    try {
      const next = await lyricsApi.list();
      setLyricTemplates(next.templates.map(summarizeTemplate));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const next = await callCampaign<Diagnostics>("diagnostics");
      setDiagnostics(next);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      if (/aborted|AbortError|signal is aborted/i.test(nextMessage)) return;
      setMessage(nextMessage);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshDiagnostics();
    const interval = setInterval(() => {
      void refresh();
      void refreshDiagnostics();
    }, 15_000);
    return () => clearInterval(interval);
  }, [refresh, refreshDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    fetchClipCategories()
      .then((rows) => {
        if (cancelled) return;
        setCategories(rows);
        setCategoryId((current) => current || rows[0]?.id || "");
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchPoolCounts(accountId || null);
        if (!cancelled) setPoolCounts(next);
      } catch {
        // Pool counts are advisory and should not block the wizard.
      }
    }
    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [accountId]);

  useEffect(() => {
    if (!initialLyricTemplateId) return;
    if (appliedInitialTemplateRef.current === initialLyricTemplateId) return;
    appliedInitialTemplateRef.current = initialLyricTemplateId;
    setLyricTemplateId(initialLyricTemplateId);
    setRandomize(true);
  }, [initialLyricTemplateId]);

  useEffect(() => {
    if (!focusLyricsStepSignal) return;
    setLyricsDrawerOpen(true);
  }, [focusLyricsStepSignal]);

  useEffect(() => {
    if (trimmedAudio && !lyricTemplateId) setLyricsDrawerOpen(true);
  }, [trimmedAudio, lyricTemplateId]);

  useEffect(() => {
    lyricTemplateIdRef.current = lyricTemplateId;
  }, [lyricTemplateId]);

  useEffect(() => {
    let cancelled = false;
    setRegisteredAudioClip(null);
    setAudioClipError(null);

    if (!trimmedAudio) {
      setAudioClipStatus("idle");
      return () => {
        cancelled = true;
      };
    }
    if (!accountId) {
      setAudioClipStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    const clipToRegister = trimmedAudio;

    async function registerAndTranscribeClip() {
      try {
        setAudioClipStatus("registering");
        const registered = await registerAudioClip({
          accountId,
          trimmedAudio: clipToRegister,
        });
        if (cancelled) return;
        setRegisteredAudioClip(registered.audio_clip);
        setAudioClipStatus("transcribing");
        setLyricsDrawerOpen(true);

        try {
          const transcribed = await transcribeAudioClip(registered.audio_clip.id);
          if (cancelled) return;
          const registeredClip = transcribed.audio_clip;
          setRegisteredAudioClip(registeredClip);
          if (!lyricTemplateIdRef.current) {
            try {
              const template = await lyricsApi.createFromAudioClip({
                audioClipId: registeredClip.id,
                title: `${clipToRegister.originalFileName} lyrics`,
              });
              if (cancelled) return;
              setLyricTemplateId(template.template.id);
              setLyricsDrawerOpen(true);
              await refresh();
              if (cancelled) return;
              setAutoOpenTemplateRequest((request) => request + 1);
            } catch (templateError) {
              if (cancelled) return;
              setAudioClipError(
                `Template creation failed: ${
                  templateError instanceof Error ? templateError.message : String(templateError)
                }`,
              );
            }
          }
          setAudioClipStatus("ready");
        } catch (error) {
          if (cancelled) return;
          setRegisteredAudioClip(registered.audio_clip);
          setAudioClipStatus("failed");
          setAudioClipError(error instanceof Error ? error.message : String(error));
        }
      } catch (error) {
        if (cancelled) return;
        setRegisteredAudioClip(null);
        setAudioClipStatus("failed");
        setAudioClipError(error instanceof Error ? error.message : String(error));
      }
    }

    void registerAndTranscribeClip();
    return () => {
      cancelled = true;
    };
  }, [accountId, refresh, trimmedAudio, trimmedAudioKey]);

  useEffect(() => {
    setSourceMode((current) => coerceSelectableSourceMode(current, diagnostics?.env));
  }, [diagnostics?.env]);

  useEffect(() => {
    if (derivedSourceMode !== sourceMode) setSourceMode(derivedSourceMode);
  }, [derivedSourceMode, sourceMode]);

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>) => {
      setBusy(true);
      setMessage(null);
      try {
        await fn();
        await refresh();
        setMessage(`${label} complete.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const startCampaign = useCallback(async (): Promise<CampaignCreateResponse> => {
    if (!account) throw new Error("No account.");
    if (!lyricTemplateId) {
      throw new Error("Review and save a lyric template before launching.");
    }
    if (!selectedTemplate) {
      throw new Error("Refresh the lyric templates list before launching.");
    }
    if (selectedTemplate.status !== "saved") {
      throw new Error("Save the lyric template before generating the library.");
    }
    if (!selectedTemplate.trimmed_audio_asset_id) {
      throw new Error("The selected lyric template is missing its persisted trimmed audio.");
    }
    if (!trimmedAudio && !selectedTemplate.audio_clip_id) {
      throw new Error("Trim your audio clip first.");
    }
    if (!campaignHandoff.audioClipId) {
      throw new Error("Wait for the audio clip to finish registering before launching.");
    }
    if (!campaignHandoff.templateMatchesAudio) {
      throw new Error("The selected lyric template must be created from this trimmed audio clip.");
    }
    if (!campaignHandoff.ready) {
      throw new Error("The campaign audio/template handoff is not ready yet.");
    }
    if (
      trimmedAudio &&
      !clipSelectionMatchesDuration(
        { startSec: trimmedAudio.startSec, endSec: trimmedAudio.endSec },
        duration,
      )
    ) {
      throw new Error(`Trimmed audio must be exactly ${duration}s before launching.`);
    }
    const scheduledStart = new Date(startAt);
    if (!Number.isFinite(scheduledStart.getTime())) throw new Error("Choose a valid start time.");
    const commonSourceSettings = {
      providers: Object.entries(stockProviders)
        .filter(([, enabled]) => enabled)
        .map(([provider]) => provider),
      keywords: splitCsv(stockKeywords),
      negativeKeywords: splitCsv(stockNegativeKeywords),
      category: stockCategory || null,
      mood: stockMood || null,
      portraitOnly: stockPortraitOnly,
      minDurationSec: Math.min(15, duration),
      maxDurationSec: Math.max(15, duration * 3),
      avoidReuseWithinBatch: stockAvoidReuse,
      allowReuseWhenExhausted: stockAllowReuse,
    };
    const dedupeStrategy = dedupeStrategyForStockOptions({
      avoidReuse: stockAvoidReuse,
      allowReuseWhenExhausted: stockAllowReuse,
    });
    const created = await callCampaign<CampaignCreateResponse>("create", {
      accountId: account.id,
      audioClipId: campaignHandoff.audioClipId,
      clipSelection: trimmedAudio
        ? {
            startSec: trimmedAudio.startSec,
            endSec: trimmedAudio.endSec,
            durationSec: trimmedAudio.durationSec,
            originalFileName: trimmedAudio.originalFileName,
          }
        : undefined,
      sourceMode: derivedSourceMode,
      categoryId: randomize ? null : categoryId || null,
      subcategorySlug: randomize ? null : subcategorySlug || null,
      randomize,
      autoRender,
      autoDraftSchedule: true,
      durationSeconds: duration,
      dedupeStrategy,
      postCount,
      cadenceMinutes,
      prompt,
      sourceSettings: {
        stock: commonSourceSettings,
        seedance: {
          resolution: seedanceResolution,
        },
        gmi_seedance: {
          resolution: seedanceResolution,
        },
        sports_edit: {
          league: sportsLeague || null,
          team: sportsTeam || null,
          allowedChannels: splitCsv(sportsAllowedChannels),
          ownerAssetUrls: parseKeyValueLines(sportsOwnerAssetUrls),
        },
        streamer_clip: {
          streamer: streamerName || null,
          allowedChannels: splitCsv(streamerAllowedChannels),
        },
      },
      seedanceSettings: {
        resolution: seedanceResolution,
      },
      publishDefaults: {
        privacyLevel: publishPrivacy,
        disableDuet: true,
        disableStitch: true,
        disableComment: false,
      },
      startAt: scheduledStart.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lyricTemplateId: lyricTemplateId || null,
    });
    setLastLaunchedAudioClipId(campaignHandoff.audioClipId);
    await refresh();
    setMessage("Campaign launch complete.");
    return created;
  }, [
    account,
    autoRender,
    cadenceMinutes,
    campaignHandoff,
    categoryId,
    derivedSourceMode,
    duration,
    lyricTemplateId,
    postCount,
    prompt,
    publishPrivacy,
    randomize,
    refresh,
    seedanceResolution,
    selectedTemplate,
    sportsAllowedChannels,
    sportsLeague,
    sportsOwnerAssetUrls,
    sportsTeam,
    startAt,
    stockAllowReuse,
    stockAvoidReuse,
    stockCategory,
    stockKeywords,
    stockMood,
    stockNegativeKeywords,
    stockPortraitOnly,
    stockProviders,
    streamerAllowedChannels,
    streamerName,
    subcategorySlug,
    trimmedAudio,
  ]);

  const recoverRecentFailures = useCallback(async () => {
    await callCampaign("recoverRecentFailures", {
      limit: 50,
      includeFailed: true,
      includeStaleActive: true,
    });
    await refreshDiagnostics();
  }, [refreshDiagnostics]);

  const value: AutopilotContextValue = {
    data,
    diagnostics,
    categories,
    categoriesLoading,
    poolCounts,
    lyricTemplates,
    audioFile,
    trimmedAudio,
    duration,
    sourceMode,
    postCount,
    startAt,
    cadenceMinutes,
    prompt,
    stockProviders,
    stockKeywords,
    stockNegativeKeywords,
    stockCategory,
    stockMood,
    stockPortraitOnly,
    stockAvoidReuse,
    stockAllowReuse,
    sportsLeague,
    sportsTeam,
    sportsAllowedChannels,
    sportsOwnerAssetUrls,
    streamerName,
    streamerAllowedChannels,
    seedanceResolution,
    publishPrivacy,
    busy,
    message,
    lyricTemplateId,
    lyricsDrawerOpen,
    registeredAudioClip,
    audioClipStatus,
    audioClipError,
    autoOpenTemplateRequest,
    categoryId,
    subcategorySlug,
    randomize,
    autoRender,
    lastLaunchedAudioClipId,
    account,
    accountId,
    isConnected,
    schemaReady,
    campaignHandoff,
    derivedSourceMode,
    selectedTemplate,
    templateById,
    hasLoadedInitialData: data !== null,
    isCampaignFormComplete,
    setAudioFile,
    setTrimmedAudio,
    setDuration,
    setSourceMode,
    setPostCount,
    setStartAt,
    setCadenceMinutes,
    setPrompt,
    setStockProviders,
    setStockKeywords,
    setStockNegativeKeywords,
    setStockCategory,
    setStockMood,
    setStockPortraitOnly,
    setStockAvoidReuse,
    setStockAllowReuse,
    setSportsLeague,
    setSportsTeam,
    setSportsAllowedChannels,
    setSportsOwnerAssetUrls,
    setStreamerName,
    setStreamerAllowedChannels,
    setSeedanceResolution,
    setPublishPrivacy,
    setLyricTemplateId,
    setLyricsDrawerOpen,
    setCategoryId,
    setSubcategorySlug,
    setRandomize,
    setAutoRender,
    refresh,
    refreshLyricTemplates,
    refreshDiagnostics,
    startCampaign,
    run,
    recoverRecentFailures,
  };

  return <AutopilotContext.Provider value={value}>{children}</AutopilotContext.Provider>;
}
