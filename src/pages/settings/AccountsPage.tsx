import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  Home,
  Images,
  PlugZap,
  RefreshCcw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { displayError } from "@/lib/errors";
import {
  accountConnectionState,
  accountDisplayName,
  accountHandleLabel,
  buildTikTokConnectUrl,
  creatorRestrictionBadges,
  tiktokPrivacyOptions,
} from "@/lib/fanagent/accounts";
import type { Account } from "@/lib/fanagent/types";

type AccountRow = Account & {
  created_at: string | null;
  is_primary: boolean;
};

function formatDate(value: string | null, emptyLabel = "Not connected"): string {
  if (!value) return emptyLabel;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase
        .from("accounts")
        .select(
          "id,platform,handle,status,tiktok_connected_at,tiktok_display_name,tiktok_creator_info,created_at,is_primary",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAccounts((data ?? []) as AccountRow[]);
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const connectedCount = useMemo(
    () => accounts.filter((account) => accountConnectionState(account).connected).length,
    [accounts],
  );
  const needsConnectionCount = accounts.length - connectedCount;
  const primaryAccount = accounts.find((account) => account.is_primary) ?? accounts[0] ?? null;
  const hasDisconnectedTikTok = accounts.some(
    (account) => account.platform === "tiktok" && !account.tiktok_connected_at,
  );

  return (
    <main className="app-shell accounts-page">
      <header className="topbar">
        <div>
          <h1>Accounts</h1>
          <p>TikTok connection status and creator publishing limits.</p>
        </div>
        <div className="topbar-actions">
          <Link className="button ghost" to="/">
            <Home size={14} /> Home
          </Link>
          <Link className="button ghost" to="/library">
            <Images size={14} /> Library
          </Link>
          <Link className="button ghost" to="/calendar">
            <CalendarDays size={14} /> Calendar
          </Link>
          <button className="button ghost" type="button" disabled={busy} onClick={refresh}>
            <RefreshCcw className={busy ? "spin" : undefined} size={14} /> Refresh
          </button>
        </div>
      </header>

      {message ? <div className="banner bad">{message}</div> : null}
      {hasDisconnectedTikTok ? (
        <div className="banner warn">
          TikTok is not connected - videos will generate but auto-posting will pause until you
          reconnect.
        </div>
      ) : null}

      <section className="panel accounts-summary">
        <div className="account-metric">
          <CheckCircle2 size={18} />
          <div>
            <strong>{connectedCount}</strong>
            <span>Connected</span>
          </div>
        </div>
        <div className="account-metric">
          <Unplug size={18} />
          <div>
            <strong>{needsConnectionCount}</strong>
            <span>Needs connection</span>
          </div>
        </div>
        <div className="account-metric">
          <ShieldCheck size={18} />
          <div>
            <strong>{primaryAccount ? accountDisplayName(primaryAccount) : "None"}</strong>
            <span>Primary account</span>
          </div>
        </div>
      </section>

      <section className="accounts-grid" aria-label="Connected accounts">
        {accounts.length === 0 ? (
          <div className="panel empty-state">No account rows found.</div>
        ) : (
          accounts.map((account) => {
            const connection = accountConnectionState(account);
            const privacyOptions = tiktokPrivacyOptions(account.tiktok_creator_info);
            const badges = creatorRestrictionBadges(account.tiktok_creator_info);

            return (
              <article className="account-card" key={account.id}>
                <header>
                  <div>
                    <strong>{accountDisplayName(account)}</strong>
                    <span>{accountHandleLabel(account)}</span>
                  </div>
                  <span className={`status-pill ${connection.tone}`}>{connection.label}</span>
                </header>

                <dl className="account-details">
                  <div>
                    <dt>Platform</dt>
                    <dd>{account.platform}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{account.status || "unknown"}</dd>
                  </div>
                  <div>
                    <dt>Connected</dt>
                    <dd>{formatDate(account.tiktok_connected_at)}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDate(account.created_at, "Unknown")}</dd>
                  </div>
                </dl>

                {privacyOptions.length > 0 ? (
                  <div className="account-section">
                    <span className="account-section__label">Privacy</span>
                    <div className="account-chip-row">
                      {privacyOptions.map((option) => (
                        <span className="account-chip" key={option}>
                          {option}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {badges.length > 0 ? (
                  <div className="account-chip-row">
                    {badges.map((badge) => (
                      <span className="account-chip amber" key={badge}>
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="account-actions">
                  <a
                    className={`button ${connection.connected ? "ghost" : "primary"}`}
                    href={buildTikTokConnectUrl(SUPABASE_URL, account.id)}
                  >
                    <PlugZap size={14} /> {connection.connected ? "Reconnect" : "Connect TikTok"}
                  </a>
                </div>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
