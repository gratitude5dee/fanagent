// AutopilotWizard — opt-in vertical wrapper around the existing AutopilotPanel.
// Enabled via `?wizard=1`. The full step-by-step rewrite is deferred (high
// regression risk against the 1231-line monolith); this shim keeps existing
// behavior while presenting cleaner outer chrome so we can iterate safely.

import AutopilotPanel from "@/components/AutopilotPanel";

type Props = {
  initialTab?: "campaign" | "lyrics";
  focusLyricsStepSignal?: number;
  initialLyricTemplateId?: string | null;
};

export default function AutopilotWizard(props: Props) {
  return (
    <div className="autopilot-wizard" style={{ display: "grid", gap: 16 }}>
      <header
        style={{
          padding: "12px 16px",
          borderRadius: 12,
          background:
            "linear-gradient(135deg, rgba(120,140,255,0.12), rgba(120,140,255,0.02))",
          border: "1px solid rgba(127,127,127,0.18)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Autopilot wizard</h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.75 }}>
          Connect → Upload → Lyrics → Category → Campaign. Each step unlocks the next.
        </p>
      </header>
      <AutopilotPanel {...props} />
    </div>
  );
}
