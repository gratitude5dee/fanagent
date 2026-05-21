import { useMemo, useState } from "react";
import { Megaphone, RefreshCcw } from "lucide-react";
import { useCampaigns } from "@/lib/campaigns/useCampaigns";
import type { CampaignBatch } from "@/lib/campaigns/api";
import CampaignFilters, { type CampaignStatusFilter } from "./components/CampaignFilters";
import CampaignsTable from "./components/CampaignsTable";

function statusMatches(batch: CampaignBatch, status: CampaignStatusFilter): boolean {
  if (status === "all") return true;
  if (status === "active") {
    return !batch.paused_at && !["complete", "failed", "canceled", "paused"].includes(batch.status);
  }
  if (status === "paused") return !!batch.paused_at || batch.status === "paused";
  if (status === "complete") return batch.status === "complete";
  return batch.status === "failed" || batch.status === "canceled";
}

function searchMatches(batch: CampaignBatch, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [batch.id, batch.source_mode, batch.prompt ?? "", batch.status]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export default function CampaignsPage() {
  const campaigns = useCampaigns();
  const [status, setStatus] = useState<CampaignStatusFilter>("all");
  const [account, setAccount] = useState("");
  const [search, setSearch] = useState("");
  const accounts = useMemo(() => {
    if (!campaigns.data?.account) return [];
    const label =
      campaigns.data.account.handle ??
      campaigns.data.account.tiktok_display_name ??
      campaigns.data.account.id.slice(0, 8);
    return [{ id: campaigns.data.account.id, label }];
  }, [campaigns.data?.account]);
  const accountLabel = (accountId?: string | null) =>
    accounts.find((option) => option.id === accountId)?.label ??
    campaigns.data?.account?.handle ??
    campaigns.data?.account?.tiktok_display_name ??
    "Primary";
  const filtered = useMemo(
    () =>
      campaigns.batches
        .filter((batch) => statusMatches(batch, status))
        .filter((batch) => !account || batch.account_id === account)
        .filter((batch) => searchMatches(batch, search))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [account, campaigns.batches, search, status],
  );

  return (
    <main className="app-shell campaigns-shell">
      <header className="topbar">
        <div>
          <h1>Campaigns</h1>
          <p>Manage active, paused, completed, and failed generation batches.</p>
        </div>
        <div className="topbar-actions">
          <button className="button ghost" type="button" onClick={() => void campaigns.mutate()}>
            <RefreshCcw className={campaigns.loading ? "spin" : undefined} size={14} /> Refresh
          </button>
        </div>
      </header>
      {campaigns.error ? <div className="banner bad">{campaigns.error}</div> : null}
      <section className="panel-title campaigns-title">
        <Megaphone size={18} />
        <h2>Campaign pipeline</h2>
      </section>
      <CampaignFilters
        status={status}
        search={search}
        account={account}
        accounts={accounts}
        onStatus={setStatus}
        onSearch={setSearch}
        onAccount={setAccount}
      />
      <CampaignsTable
        batches={filtered}
        items={campaigns.items}
        posts={campaigns.posts}
        accountLabel={accountLabel}
        busy={campaigns.loading}
        onPause={campaigns.actions.pause}
        onResume={campaigns.actions.resume}
        onCancel={campaigns.actions.cancel}
      />
    </main>
  );
}
