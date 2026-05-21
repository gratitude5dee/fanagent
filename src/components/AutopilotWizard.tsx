// AutopilotWizard — premium chrome around the existing AutopilotPanel.
// The panel already renders Connect → Upload → Lyrics → Category → Campaign
// in vertical order inside a single form (tab row was removed in v2).
// We wrap it in `.wizard-shell` so the design tokens (dark cards, accent
// borders, etc.) apply. A full per-step collapse/expand state machine is
// deferred to keep the existing controller untouched.

import { Sparkles } from "lucide-react";
import AutopilotPanel from "@/components/AutopilotPanel";

type Props = {
  initialTab?: "campaign" | "lyrics";
  focusLyricsStepSignal?: number;
  initialLyricTemplateId?: string | null;
};

export default function AutopilotWizard(props: Props) {
  return (
    <div className="wizard-shell">
      <header
        style={{
          alignItems: "center",
          display: "flex",
          gap: 12,
          padding: "4px 4px 8px",
        }}
      >
        <span
          aria-hidden
          style={{
            alignItems: "center",
            background: "linear-gradient(135deg, var(--accent), var(--accent-glow))",
            borderRadius: 12,
            color: "#fff",
            display: "inline-flex",
            height: 36,
            justifyContent: "center",
            width: 36,
          }}
        >
          <Sparkles size={18} />
        </span>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>Launch a campaign</h2>
          <p style={{ color: "var(--fanagent-muted)", fontSize: 13, margin: "2px 0 0" }}>
            Connect · Upload audio · Lyrics · Category · Schedule
          </p>
        </div>
      </header>
      <AutopilotPanel {...props} />
    </div>
  );
}
