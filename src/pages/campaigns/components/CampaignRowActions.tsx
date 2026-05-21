import { PauseCircle, PlayCircle, Square, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { CampaignBatch } from "@/lib/campaigns/api";
import { appRoutes } from "@/lib/routes";

type CampaignRowActionsProps = {
  batch: CampaignBatch;
  busy?: boolean;
  onPause: (batchId: string) => Promise<unknown>;
  onResume: (batchId: string) => Promise<unknown>;
  onCancel: (batchId: string) => Promise<unknown>;
};

export default function CampaignRowActions({
  batch,
  busy = false,
  onPause,
  onResume,
  onCancel,
}: CampaignRowActionsProps) {
  const paused = !!batch.paused_at || batch.status === "paused";
  const canceled = batch.status === "canceled";
  const complete = batch.status === "complete";
  return (
    <div className="campaign-row-actions">
      <Link className="button ghost" to={appRoutes.campaignDetail(batch.id)}>
        <ExternalLink size={14} /> Open
      </Link>
      {paused ? (
        <button
          className="button"
          disabled={busy || canceled || complete}
          type="button"
          onClick={() => void onResume(batch.id)}
        >
          <PlayCircle size={14} /> Resume
        </button>
      ) : (
        <button
          className="button"
          disabled={busy || canceled || complete}
          type="button"
          onClick={() => void onPause(batch.id)}
        >
          <PauseCircle size={14} /> Pause
        </button>
      )}
      <button
        className="button ghost"
        disabled={busy || canceled || complete}
        type="button"
        onClick={() => void onCancel(batch.id)}
      >
        <Square size={14} /> Cancel
      </button>
    </div>
  );
}
