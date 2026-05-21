import { LyricsStep } from "@/components/autopilot/LyricsStep";
import { useAutopilot } from "../useAutopilot";

export default function LyricsPage() {
  const ctx = useAutopilot();
  return (
    <div className="autopilot-focused-step">
      <LyricsStep
        lyricTemplateId={ctx.lyricTemplateId}
        lyricTemplates={ctx.lyricTemplates}
        drawerOpen={ctx.lyricsDrawerOpen}
        onDrawerOpen={ctx.setLyricsDrawerOpen}
        onTemplate={ctx.setLyricTemplateId}
        onTemplatesChanged={ctx.refreshLyricTemplates}
        autoOpenTemplateRequest={ctx.autoOpenTemplateRequest}
      />
    </div>
  );
}
