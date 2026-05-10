export type Account = {
  id: string;
  platform: string;
  handle: string | null;
  status: string | null;
  tiktok_connected_at: string | null;
  tiktok_display_name: string | null;
  tiktok_creator_info: Record<string, unknown> | null;
};

export type DashboardPost = {
  id: string;
  account_id: string;
  generation_item_id: string | null;
  caption: string;
  hashtags: string[];
  scheduled_at: string;
  status: string;
  publish_status: string | null;
  video_url: string | null;
  tiktok_privacy_level: string | null;
  tiktok_disable_duet: boolean | null;
  tiktok_disable_stitch: boolean | null;
  tiktok_disable_comment: boolean | null;
};

export type GenerationBatch = {
  id: string;
  account_id: string;
  source_mode: string;
  status: string;
  post_count: number;
  prompt: string | null;
  created_at: string;
};

export type SourceMode = "gmi_seedance" | "remote_render";
