import { useNavigate } from "react-router-dom";
import type { CampaignBatch, CampaignItem, CampaignPost } from "@/lib/campaigns/api";
import { appRoutes } from "@/lib/routes";
import CampaignRowActions from "./CampaignRowActions";

type CampaignsTableProps = {
  batches: CampaignBatch[];
  items: CampaignItem[];
  posts: CampaignPost[];
  accountLabel: (accountId?: string | null) => string;
  busy?: boolean;
  onPause: (batchId: string) => Promise<unknown>;
  onResume: (batchId: string) => Promise<unknown>;
  onCancel: (batchId: string) => Promise<unknown>;
};

function statusTone(batch: CampaignBatch): string {
  if (batch.status === "complete") return "good";
  if (batch.status === "failed" || batch.status === "canceled") return "bad";
  if (batch.paused_at || batch.status === "paused") return "warn";
  return "idle";
}

export default function CampaignsTable({
  batches,
  items,
  posts,
  accountLabel,
  busy = false,
  onPause,
  onResume,
  onCancel,
}: CampaignsTableProps) {
  const navigate = useNavigate();

  function openBatch(batchId: string) {
    navigate(appRoutes.campaignDetail(batchId));
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element
      ? Boolean(target.closest("a,button,input,select,textarea,[role='button']"))
      : false;
  }

  return (
    <section className="panel campaigns-table-panel">
      <div className="campaigns-table">
        <div className="campaigns-table__head">
          <span>Campaign</span>
          <span>Schedule</span>
          <span>Status</span>
          <span>Account</span>
          <span>Created</span>
          <span>Actions</span>
        </div>
        {batches.length === 0 ? (
          <div className="empty-state">No campaigns match these filters.</div>
        ) : (
          batches.map((batch) => {
            const batchPosts = posts.filter((post) => post.batch_id === batch.id);
            const batchItems = items.filter((item) => item.batch_id === batch.id);
            const readyCount = batchItems.filter((item) =>
              ["complete", "ready"].includes(item.status),
            ).length;
            return (
              <div
                className="campaigns-table__row"
                key={batch.id}
                role="link"
                tabIndex={0}
                onClick={(event) => {
                  if (!isInteractiveTarget(event.target)) openBatch(batch.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openBatch(batch.id);
                  }
                }}
              >
                <div>
                  <strong>{batch.source_mode}</strong>
                  <span>{batch.prompt || batch.id.slice(0, 8)}</span>
                </div>
                <div>
                  <strong>{batch.post_count} videos</strong>
                  <span>draft every {batch.cadence_minutes}m</span>
                </div>
                <div>
                  <span className={`status-pill ${statusTone(batch)}`}>
                    {batch.paused_at ? "paused" : batch.status}
                  </span>
                  <span>
                    {readyCount}/{batch.post_count} ready · {batchPosts.length} draft slots
                  </span>
                </div>
                <div>{accountLabel(batch.account_id)}</div>
                <div>{new Date(batch.created_at).toLocaleString()}</div>
                <CampaignRowActions
                  batch={batch}
                  busy={busy}
                  onPause={onPause}
                  onResume={onResume}
                  onCancel={onCancel}
                />
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
