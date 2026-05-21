import { invokeEdgeFunction } from "@/lib/fanagent/invokeFunction";
import type { LyricTemplateSummary } from "@/lib/lyrics/types";

export type CampaignAccount = {
  id: string;
  handle: string | null;
  tiktok_display_name: string | null;
};

export type CampaignBatch = {
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

export type CampaignItemSegment = {
  source?: string | null;
  url?: string | null;
  provider?: string | null;
  externalId?: string | null;
  query?: string | null;
  durationSec?: number | null;
  reused?: boolean | null;
};

export type CampaignItem = {
  id: string;
  account_id?: string | null;
  batch_id: string;
  item_index?: number | null;
  library_item_id?: string | null;
  status: string;
  scheduled_at: string;
  provider?: string | null;
  prompt?: string | null;
  segments?: CampaignItemSegment[] | null;
  stock_clip_url: string | null;
  render_provider: string | null;
  error_message: string | null;
  lyric_template_id?: string | null;
  stage_events?: Array<{ stage?: string; at?: string; [key: string]: unknown }> | null;
};

export type CampaignPost = {
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

export type CampaignListResponse = {
  account: CampaignAccount | null;
  batches: CampaignBatch[];
  items: CampaignItem[];
  posts: CampaignPost[];
  lyricTemplates?: LyricTemplateSummary[];
};

export type CampaignActionResponse = { ok: true };

function callCampaign<T>(body: Record<string, unknown>): Promise<T> {
  return invokeEdgeFunction<T>("fanpage-campaign", body);
}

export const campaignsApi = {
  list(accountId?: string | null) {
    return callCampaign<CampaignListResponse>({
      action: "list",
      ...(accountId ? { accountId } : {}),
    });
  },
  pause(batchId: string) {
    return callCampaign<CampaignActionResponse>({ action: "pause", batchId });
  },
  resume(batchId: string) {
    return callCampaign<CampaignActionResponse>({ action: "resume", batchId });
  },
  cancel(batchId: string) {
    return callCampaign<CampaignActionResponse>({ action: "cancel", batchId });
  },
  regenerate(itemId: string) {
    return callCampaign<CampaignActionResponse>({ action: "regenerate", itemId });
  },
  skip(itemId: string) {
    return callCampaign<CampaignActionResponse>({ action: "skip", itemId });
  },
  setLyricTemplate(itemId: string, lyricTemplateId: string | null) {
    return callCampaign<CampaignActionResponse>({
      action: "setLyricTemplate",
      itemId,
      lyricTemplateId,
    });
  },
};
