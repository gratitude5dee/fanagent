import { RefreshCcw } from "lucide-react";
import { ConnectStep } from "@/components/autopilot/ConnectStep";
import { SUPABASE_URL } from "@/integrations/supabase/client";
import { schemaDiagnosticsSummary } from "@/lib/fanagent/diagnostics";
import { useAutopilot } from "../useAutopilot";

function tiktokConnectUrl(accountId: string): string {
  return `${SUPABASE_URL}/functions/v1/tiktok-oauth-callback?action=connect&accountId=${encodeURIComponent(accountId)}`;
}

export default function ConnectPage() {
  const ctx = useAutopilot();
  return (
    <div className="autopilot-focused-step">
      <ConnectStep
        account={ctx.account}
        isConnected={ctx.isConnected}
        connectUrl={ctx.account ? tiktokConnectUrl(ctx.account.id) : null}
      />
      <p className="text-sm text-muted-foreground -mt-2">
        Optional — you can connect TikTok later, before publishing.
      </p>
      {ctx.diagnostics ? (
        <section className="panel subtle-panel">
          <div className="panel-title">
            <RefreshCcw size={14} />
            <h4>Preflight</h4>
          </div>
          <div className="batch-list">
            <div className="batch-row">
              <span className={`dot ${ctx.schemaReady ? "good" : "bad"}`} />
              <div>
                <strong>Database queue schema</strong>
                <span>{schemaDiagnosticsSummary(ctx.diagnostics.schema)}</span>
              </div>
            </div>
            <div className="batch-row">
              <span
                className={`dot ${
                  ctx.diagnostics.buckets.every((bucket) => bucket.ok) ? "good" : "warn"
                }`}
              />
              <div>
                <strong>Storage buckets</strong>
                <span>
                  {ctx.diagnostics.buckets
                    .map((bucket) => `${bucket.name}:${bucket.ok ? "ok" : "missing"}`)
                    .join(" · ")}
                </span>
              </div>
            </div>
            {ctx.diagnostics.recentFailedItems.length > 0 ? (
              <div className="batch-row">
                <span className="dot bad" />
                <div style={{ flex: 1 }}>
                  <strong>Recent failed generation items</strong>
                  <span>
                    {ctx.diagnostics.recentFailedItems.length} failed item
                    {ctx.diagnostics.recentFailedItems.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  className="button"
                  disabled={ctx.busy}
                  type="button"
                  onClick={() => void ctx.run("Recovery", ctx.recoverRecentFailures)}
                >
                  <RefreshCcw size={14} /> Recover
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
