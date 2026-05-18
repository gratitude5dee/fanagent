import { CheckCircle2, PlugZap } from "lucide-react";

type Account = {
  id: string;
  handle: string | null;
  tiktok_connected_at: string | null;
  tiktok_display_name: string | null;
};

type ConnectStepProps = {
  account: Account | null;
  isConnected: boolean;
  connectUrl: string | null;
};

export function ConnectStep({ account, isConnected, connectUrl }: ConnectStepProps) {
  return (
    <section className="panel">
      <div className="panel-title">
        <PlugZap size={16} />
        <h3>1. Connect TikTok</h3>
      </div>
      {account ? (
        <div className="stack">
          <div>
            Account:{" "}
            <strong>
              {account.handle ?? account.tiktok_display_name ?? account.id.slice(0, 8)}
            </strong>{" "}
            {isConnected ? (
              <span className="status-pill good">
                <CheckCircle2 size={14} /> connected
              </span>
            ) : (
              <span className="status-pill warn">not connected</span>
            )}
          </div>
          {connectUrl ? (
            <a className="button ghost" href={connectUrl}>
              <PlugZap size={16} /> {isConnected ? "Reconnect" : "Connect TikTok"}
            </a>
          ) : null}
        </div>
      ) : (
        <div className="empty-state">Loading account...</div>
      )}
    </section>
  );
}
