export type CampaignStatusFilter = "all" | "active" | "paused" | "complete" | "failed";

type CampaignFiltersProps = {
  status: CampaignStatusFilter;
  search: string;
  account: string;
  accounts: Array<{ id: string; label: string }>;
  onStatus: (status: CampaignStatusFilter) => void;
  onSearch: (search: string) => void;
  onAccount: (account: string) => void;
};

export default function CampaignFilters({
  status,
  search,
  account,
  accounts,
  onStatus,
  onSearch,
  onAccount,
}: CampaignFiltersProps) {
  return (
    <section className="panel campaign-filters">
      <label>
        Status
        <select
          value={status}
          onChange={(event) => onStatus(event.target.value as CampaignStatusFilter)}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="complete">Complete</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label>
        Account
        <select value={account} onChange={(event) => onAccount(event.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Search
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="id, source, prompt"
        />
      </label>
    </section>
  );
}
