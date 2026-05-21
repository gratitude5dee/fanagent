import { Link, useParams } from "react-router-dom";
import { ChevronLeft, RefreshCcw } from "lucide-react";
import { useCampaigns } from "@/lib/campaigns/useCampaigns";
import { appRoutes } from "@/lib/routes";
import CampaignSummaryCard from "./components/CampaignSummaryCard";
import QueueTable from "./components/QueueTable";

export default function CampaignDetailPage() {
  const { batchId } = useParams();
  const campaigns = useCampaigns();
  const batch = campaigns.batches.find((candidate) => candidate.id === batchId) ?? null;
  const items = campaigns.items
    .filter((item) => item.batch_id === batchId)
    .sort((a, b) => {
      const indexA = a.item_index ?? 0;
      const indexB = b.item_index ?? 0;
      if (indexA !== indexB) return indexA - indexB;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });
  const posts = campaigns.posts.filter((post) => post.batch_id === batchId);
  const templateTitle =
    campaigns.data?.lyricTemplates?.find((template) => template.id === batch?.lyric_template_id)
      ?.title ?? null;

  return (
    <main className="app-shell campaigns-shell">
      <header className="topbar">
        <div>
          <Link className="button ghost" to={appRoutes.campaigns}>
            <ChevronLeft size={14} /> Campaigns
          </Link>
          <h1>Campaign detail</h1>
          <p>{batchId}</p>
        </div>
        <div className="topbar-actions">
          <button className="button ghost" type="button" onClick={() => void campaigns.mutate()}>
            <RefreshCcw className={campaigns.loading ? "spin" : undefined} size={14} /> Refresh
          </button>
        </div>
      </header>
      {campaigns.error ? <div className="banner bad">{campaigns.error}</div> : null}
      {!batch ? (
        <section className="panel">
          <div className="empty-state">
            {campaigns.loading ? "Loading campaign..." : "Campaign not found."}
          </div>
        </section>
      ) : (
        <>
          <CampaignSummaryCard
            batch={batch}
            items={items}
            posts={posts}
            lyricTemplateTitle={templateTitle}
          />
          <QueueTable
            items={items}
            posts={posts}
            lyricTemplates={campaigns.data?.lyricTemplates ?? []}
            onRegenerate={campaigns.actions.regenerate}
            onSkip={campaigns.actions.skip}
            onSetLyricTemplate={campaigns.actions.setLyricTemplate}
          />
        </>
      )}
    </main>
  );
}
