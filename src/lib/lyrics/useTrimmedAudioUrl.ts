// Resolves and refreshes the signed URL for a template's trimmed audio asset.
// Goes through the kanvas-lyrics-template edge function (service role) instead
// of querying project_assets from the browser, because templates owned by the
// anon sentinel user are not readable via RLS from an unauthenticated session.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { invokeEdgeFunction } from "@/lib/fanagent/invokeFunction";
import type { LyricTemplate } from "./types";

const SIGNED_URL_TTL_SEC = 3600;
const REFRESH_BEFORE_SEC = 600;

type SignResponse = {
  signedUrl: string;
  expiresInSec: number;
  assetId: string | null;
};

export function useTrimmedAudioUrl(template: LyricTemplate | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const templateId = template?.id ?? null;
  const assetMarker =
    template?.trimmed_audio_asset_id ?? template?.source_audio_asset_id ?? null;

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!templateId || !assetMarker) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const res = await invokeEdgeFunction<SignResponse>("kanvas-lyrics-template", {
          action: "signTrimmedAudio",
          templateId,
          ttlSec: SIGNED_URL_TTL_SEC,
        });
        if (cancelled) return;
        if (!res?.signedUrl) throw new Error("Empty signed URL response");
        setUrl(res.signedUrl);
        setError(null);
        if (import.meta.env.DEV) console.info("[lyrics] trimmed audio URL ready", res.signedUrl);
        const ttl = res.expiresInSec || SIGNED_URL_TTL_SEC;
        refreshTimer = setTimeout(
          () => {
            if (!cancelled) setNonce((n) => n + 1);
          },
          Math.max(60, ttl - REFRESH_BEFORE_SEC) * 1000,
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
  }, [templateId, assetMarker, nonce]);

  return { url, error, retry };
}
