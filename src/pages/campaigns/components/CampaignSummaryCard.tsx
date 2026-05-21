import { CalendarClock, FileMusic, Layers, PauseCircle } from "lucide-react";
import type { CampaignBatch, CampaignItem, CampaignPost } from "@/lib/campaigns/api";

type CampaignSummaryCardProps = {
  batch: CampaignBatch;
  items: CampaignItem[];
  posts: CampaignPost[];
  lyricTemplateTitle?: string | null;
};

export default function CampaignSummaryCard({
  batch,
  items,
  posts,
  lyricTemplateTitle,
}: CampaignSummaryCardProps) {
  const failed = items.filter((item) => item.status === "failed").length;
  const ready = items.filter((item) => ["complete", "ready"].includes(item.status)).length;
  return (
    <section className="panel">
      <div className="panel-title">
        <Layers size={16} />
        <h3>Campaign summary</h3>
      </div>
      <div className="campaign-summary-grid">
        <div className="campaign-summary-metric">
          <Layers size={16} />
          <span>Source</span>
          <strong>{batch.source_mode}</strong>
        </div>
        <div className="campaign-summary-metric">
          <CalendarClock size={16} />
          <span>Library</span>
          <strong>
            {ready}/{items.length} ready · {posts.length} draft slots
          </strong>
        </div>
        <div className="campaign-summary-metric">
          <PauseCircle size={16} />
          <span>Status</span>
          <strong>{batch.paused_at ? "paused" : batch.status}</strong>
        </div>
        <div className="campaign-summary-metric">
          <FileMusic size={16} />
          <span>Lyrics</span>
          <strong>{lyricTemplateTitle ?? batch.lyric_template_id ?? "No template"}</strong>
        </div>
      </div>
      {failed > 0 ? (
        <div className="banner bad">{failed} item(s) need render attention.</div>
      ) : null}
    </section>
  );
}
