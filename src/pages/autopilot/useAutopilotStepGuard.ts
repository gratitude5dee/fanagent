import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAutopilot } from "./useAutopilot";
import { canVisitStep, firstIncompleteStep, stepFromPath } from "./steps";

export function useAutopilotStepGuard() {
  const ctx = useAutopilot();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ctx.hasLoadedInitialData) return;
    const current = stepFromPath(location.pathname);
    if (canVisitStep(ctx, current)) return;
    const fallback = firstIncompleteStep(ctx);
    navigate(`${fallback.path}${location.search}`, { replace: true });
  }, [ctx, location.pathname, location.search, navigate]);
}
