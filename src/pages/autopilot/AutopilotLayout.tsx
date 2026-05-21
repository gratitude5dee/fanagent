import { Check, ChevronLeft, ChevronRight, Loader2, Rocket } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { AutopilotProvider } from "./AutopilotContext";
import { useAutopilot } from "./useAutopilot";
import { canVisitStep, STEPS, stepFromPath, stepIndex } from "./steps";
import { useAutopilotStepGuard } from "./useAutopilotStepGuard";

function AutopilotFrame() {
  useAutopilotStepGuard();
  const ctx = useAutopilot();
  const location = useLocation();
  const navigate = useNavigate();
  const current = stepFromPath(location.pathname);
  const currentIndex = stepIndex(current.id);
  const previous = STEPS[currentIndex - 1] ?? null;
  const next = STEPS[currentIndex + 1] ?? null;
  const [lockedMessage, setLockedMessage] = useState("");
  const currentComplete = current.isComplete(ctx);

  async function handlePrimary() {
    if (current.id === "review") {
      const created = await ctx.startCampaign();
      const batchId = created.batch?.id;
      if (batchId) navigate(`/campaigns/${batchId}`);
      else navigate("/campaigns");
      return;
    }
    if (next) navigate(`${next.path}${location.search}`);
  }

  return (
    <main className="app-shell autopilot-stepper-shell">
      <header className="autopilot-stepper-header">
        <div className="autopilot-stepper-brand">
          <strong>FanAgent</strong>
          <span>Autopilot</span>
        </div>
        <nav className="autopilot-steps" aria-label="Autopilot steps">
          {STEPS.map((step, index) => {
            const available = canVisitStep(ctx, step);
            const complete = step.isComplete(ctx) && index < currentIndex;
            const active = step.id === current.id;
            const label = `${index + 1} ${step.label}`;
            return (
              <NavLink
                key={step.id}
                to={`${step.path}${location.search}`}
                aria-current={active ? "step" : undefined}
                aria-disabled={!available}
                className={[
                  "autopilot-step-pill",
                  active ? "active" : "",
                  complete ? "complete" : "",
                  !available ? "locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={(event) => {
                  if (available) return;
                  event.preventDefault();
                  setLockedMessage("Step locked - finish previous step first");
                }}
              >
                <span className="autopilot-step-number">
                  {complete ? <Check size={12} /> : index + 1}
                </span>
                <span>{step.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <select value={ctx.accountId} aria-label="Account" disabled>
          {ctx.account ? (
            <option value={ctx.account.id}>
              {ctx.account.handle ?? ctx.account.tiktok_display_name ?? ctx.account.id.slice(0, 8)}
            </option>
          ) : (
            <option value="">No account</option>
          )}
        </select>
      </header>

      <div className="autopilot-step-context">
        Step {currentIndex + 1} of {STEPS.length} · {current.context}
      </div>
      <div className="sr-only" aria-live="polite">
        {lockedMessage}
      </div>
      {ctx.message ? <div className="banner">{ctx.message}</div> : null}

      <section className="autopilot-step-surface">
        <Outlet />
      </section>

      <footer className="autopilot-step-footer">
        <button
          className="button ghost"
          type="button"
          disabled={!previous}
          onClick={() => previous && navigate(`${previous.path}${location.search}`)}
        >
          <ChevronLeft size={16} /> Back
        </button>
        <button
          className="button primary"
          type="button"
          disabled={!currentComplete || ctx.busy}
          onClick={() => void handlePrimary()}
        >
          {ctx.busy ? (
            <Loader2 className="spin" size={16} />
          ) : current.id === "review" ? (
            <Rocket size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
          {current.id === "review" ? "Launch campaign" : "Continue"}
        </button>
      </footer>
    </main>
  );
}

export default function AutopilotLayout() {
  const [params] = useSearchParams();
  const lyricTemplateId = params.get("lyricTemplateId");
  const focusLyricsStepSignal = params.get("step") === "lyrics" ? 1 : 0;
  return (
    <AutopilotProvider
      initialLyricTemplateId={lyricTemplateId}
      focusLyricsStepSignal={focusLyricsStepSignal}
    >
      <AutopilotFrame />
    </AutopilotProvider>
  );
}
