import { CalendarClock, FileMusic, Music2, UserRound } from "lucide-react";
import { useAutopilot } from "../useAutopilot";

export default function ReviewPage() {
  const ctx = useAutopilot();
  return (
    <div className="autopilot-focused-step">
      <section className="panel">
        <div className="panel-title">
          <CalendarClock size={16} />
          <h3>5. Review campaign</h3>
        </div>
        <div className="campaign-summary-grid">
          <div className="campaign-summary-metric">
            <UserRound size={16} />
            <span>Account</span>
            <strong>
              {ctx.account?.handle ??
                ctx.account?.tiktok_display_name ??
                ctx.account?.id.slice(0, 8)}
            </strong>
          </div>
          <div className="campaign-summary-metric">
            <Music2 size={16} />
            <span>Audio</span>
            <strong>
              {ctx.campaignHandoff.durationSec
                ? `${ctx.campaignHandoff.durationSec}s clip`
                : "Audio ready"}
            </strong>
          </div>
          <div className="campaign-summary-metric">
            <FileMusic size={16} />
            <span>Lyrics</span>
            <strong>{ctx.selectedTemplate?.title ?? "No template selected"}</strong>
          </div>
          <div className="campaign-summary-metric">
            <CalendarClock size={16} />
            <span>Schedule</span>
            <strong>
              {ctx.postCount} videos · draft every {ctx.cadenceMinutes}m
            </strong>
          </div>
        </div>
        <div className="batch-list">
          <div className="batch-row">
            <span className={`dot ${ctx.campaignHandoff.ready ? "good" : "warn"}`} />
            <div>
              <strong>Audio/template handoff</strong>
              <span>
                {ctx.campaignHandoff.ready
                  ? "Ready for render"
                  : "Finish the lyric template and audio handoff first"}
              </span>
            </div>
          </div>
          <div className="batch-row">
            <span className={`dot ${ctx.isCampaignFormComplete ? "good" : "warn"}`} />
            <div>
              <strong>Campaign settings</strong>
              <span>
                {ctx.isCampaignFormComplete ? ctx.prompt : "Complete draft schedule and prompt"}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
