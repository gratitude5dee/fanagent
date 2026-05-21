import { Navigate } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { AutopilotProvider } from "@/pages/autopilot/AutopilotContext";
import ConnectPage from "@/pages/autopilot/steps/ConnectPage";
import UploadPage from "@/pages/autopilot/steps/UploadPage";
import LyricsPage from "@/pages/autopilot/steps/LyricsPage";
import CampaignPage from "@/pages/autopilot/steps/CampaignPage";
import ReviewPage from "@/pages/autopilot/steps/ReviewPage";

type AutopilotPanelProps = {
  initialTab?: "campaign" | "lyrics";
  focusLyricsStepSignal?: number;
  initialLyricTemplateId?: string | null;
};

function legacyTarget(props: AutopilotPanelProps): string {
  const params = new URLSearchParams();
  if (props.initialLyricTemplateId) params.set("lyricTemplateId", props.initialLyricTemplateId);
  if (props.initialTab === "lyrics" || props.focusLyricsStepSignal) {
    const query = params.toString();
    return `/autopilot/lyrics${query ? `?${query}` : ""}`;
  }
  if (props.initialTab === "campaign") {
    const query = params.toString();
    return `/autopilot/campaign${query ? `?${query}` : ""}`;
  }
  const query = params.toString();
  return `/autopilot/connect${query ? `?${query}` : ""}`;
}

function LegacyAutopilotStack(props: AutopilotPanelProps) {
  return (
    <AutopilotProvider
      initialLyricTemplateId={props.initialLyricTemplateId}
      focusLyricsStepSignal={props.focusLyricsStepSignal}
    >
      <div className="autopilot-panel stack">
        <header className="panel-title">
          <CalendarClock size={18} />
          <h2>Fanpage Autopilot</h2>
        </header>
        <ConnectPage />
        <UploadPage />
        <LyricsPage />
        <CampaignPage />
        <ReviewPage />
      </div>
    </AutopilotProvider>
  );
}

export default function AutopilotPanel(props: AutopilotPanelProps = {}) {
  const stepperEnabled = import.meta.env.VITE_AUTOPILOT_STEPPER !== "0";
  if (stepperEnabled) return <Navigate to={legacyTarget(props)} replace />;
  return <LegacyAutopilotStack {...props} />;
}
