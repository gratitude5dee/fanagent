// Resolves and refreshes the signed URL for a template's trimmed audio asset.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { LyricTemplate } from "./types";

const SIGNED_URL_TTL_SEC = 3600;
const REFRESH_BEFORE_SEC = 600; // refresh 10 min before expiry

export function useTrimmedAudioUrl(template: LyricTemplate | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const assetId = template?.trimmed_audio_asset_id ?? null;

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!assetId) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const { data: asset, error: assetErr } = await supabase
          .from("project_assets")
          .select("storage_bucket,storage_path")
          .eq("id", assetId)
          .maybeSingle();
        if (assetErr) throw assetErr;
        if (!asset?.storage_path) throw new Error("Trimmed audio asset is missing a storage path.");
        const { data: signed, error: signErr } = await supabase.storage
          .from(asset.storage_bucket)
          .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SEC);
        if (signErr) throw signErr;
        if (cancelled) return;
        const signedUrl = signed?.signedUrl ?? null;
        if (!signedUrl) throw new Error("Failed to sign trimmed audio URL.");
        setUrl(signedUrl);
        setError(null);
        if (import.meta.env.DEV) console.info("[lyrics] trimmed audio URL ready", signedUrl);
        refreshTimer = setTimeout(
          () => {
            if (!cancelled) setNonce((n) => n + 1);
          },
          (SIGNED_URL_TTL_SEC - REFRESH_BEFORE_SEC) * 1000,
        );
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setUrl(null);
        setError(msg);
        console.error("[lyrics] failed to load trimmed audio", e);
        toast.error(`Couldn't load trimmed audio: ${msg}`);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [assetId, nonce]);

  return { url, error, retry };
}
