import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { displayError } from "@/lib/errors";
import type { Account, GenerationBatch } from "@/lib/fanagent/types";
import { listReadyLibraryItems } from "@/lib/library/api";
import type { LibraryItem } from "@/lib/library/types";
import type { CalendarAccount, CalendarLibraryPreview, CalendarPost } from "@/lib/calendar/posts";

export type StudioAccount = CalendarAccount &
  Pick<Account, "platform" | "status" | "tiktok_connected_at" | "tiktok_display_name">;

export type StudioData = {
  accounts: StudioAccount[];
  posts: CalendarPost[];
  libraryItems: LibraryItem[];
  libraryPreviews: CalendarLibraryPreview[];
  batches: GenerationBatch[];
};

type UseStudioDataResult = {
  data: StudioData;
  refresh: () => Promise<void>;
  busy: boolean;
  error: string | null;
};

const emptyStudioData: StudioData = {
  accounts: [],
  posts: [],
  libraryItems: [],
  libraryPreviews: [],
  batches: [],
};

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function coerceCalendarAccount(row: Record<string, unknown>): StudioAccount {
  return {
    id: String(row.id),
    platform: String(row.platform ?? "tiktok"),
    handle: nullableString(row.handle),
    status: nullableString(row.status),
    tiktok_connected_at: nullableString(row.tiktok_connected_at),
    tiktok_display_name: nullableString(row.tiktok_display_name),
    tiktok_creator_info: objectValue(row.tiktok_creator_info),
  };
}

function coerceLibraryPreview(row: Record<string, unknown>): CalendarLibraryPreview {
  return {
    id: String(row.id),
    audio_clip_id: String(row.audio_clip_id),
    library_index: Number(row.library_index ?? 0),
    duration_sec: Number(row.duration_sec ?? 0),
    status: String(row.status ?? "not_ready"),
    segments: arrayValue(row.segments),
    provenance: arrayValue(row.provenance),
  };
}

export function useStudioData(): UseStudioDataResult {
  const [data, setData] = useState<StudioData>(emptyStudioData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [accountRows, postRows, readyItems, batchRows] = await Promise.all([
        supabase
          .from("accounts")
          .select(
            "id,platform,handle,status,tiktok_connected_at,tiktok_display_name,tiktok_creator_info",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("posts")
          .select(
            "id,account_id,caption,hashtags,scheduled_at,status,publish_status,video_url,library_item_id,tiktok_privacy_level,tiktok_disable_duet,tiktok_disable_stitch,tiktok_disable_comment,tiktok_is_aigc,tiktok_brand_content,tiktok_brand_organic,tiktok_post_id,posted_at",
          )
          .order("scheduled_at", { ascending: true })
          .limit(250),
        listReadyLibraryItems(80),
        supabase
          .from("generation_batches")
          .select("id,account_id,source_mode,status,post_count,prompt,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (accountRows.error) throw accountRows.error;
      if (postRows.error) throw postRows.error;
      if (batchRows.error) throw batchRows.error;

      const nextPosts = (postRows.data ?? []) as CalendarPost[];
      const libraryIds = Array.from(
        new Set(
          nextPosts
            .map((post) => post.library_item_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      let nextPreviews: CalendarLibraryPreview[] = [];
      if (libraryIds.length > 0) {
        const previews = await supabase
          .from("video_library_items")
          .select("id,audio_clip_id,library_index,duration_sec,status,segments,provenance")
          .in("id", libraryIds);
        if (previews.error) throw previews.error;
        nextPreviews = ((previews.data ?? []) as Record<string, unknown>[]).map(
          coerceLibraryPreview,
        );
      }

      setData({
        accounts: ((accountRows.data ?? []) as Record<string, unknown>[]).map(
          coerceCalendarAccount,
        ),
        posts: nextPosts,
        libraryItems: readyItems,
        libraryPreviews: nextPreviews,
        batches: (batchRows.data ?? []) as GenerationBatch[],
      });
    } catch (refreshError) {
      setError(displayError(refreshError));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, refresh, busy, error };
}
