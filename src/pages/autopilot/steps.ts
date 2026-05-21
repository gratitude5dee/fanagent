import type { AutopilotContextValue } from "./AutopilotContext";

export type AutopilotStepId = "connect" | "upload" | "lyrics" | "campaign" | "review";

export type AutopilotStep = {
  id: AutopilotStepId;
  path: string;
  label: string;
  context: string;
  isComplete: (ctx: AutopilotContextValue) => boolean;
};

function templateProvidesAudio(ctx: AutopilotContextValue): boolean {
  return (
    ctx.selectedTemplate?.status === "saved" &&
    !!ctx.selectedTemplate.audio_clip_id &&
    !!ctx.selectedTemplate.trimmed_audio_asset_id
  );
}

export const STEPS: AutopilotStep[] = [
  {
    id: "connect",
    path: "/autopilot/connect",
    label: "Connect",
    context: "Connect TikTok (optional)",
    isComplete: () => true,
  },
  {
    id: "upload",
    path: "/autopilot/upload",
    label: "Upload",
    context: "Prepare your audio clip",
    isComplete: (ctx) =>
      (!!ctx.trimmedAudio && !!ctx.registeredAudioClip && ctx.audioClipStatus === "ready") ||
      templateProvidesAudio(ctx),
  },
  {
    id: "lyrics",
    path: "/autopilot/lyrics",
    label: "Lyrics",
    context: "Review your lyric template",
    isComplete: (ctx) =>
      ctx.selectedTemplate?.status === "saved" && ctx.campaignHandoff.templateMatchesAudio,
  },
  {
    id: "campaign",
    path: "/autopilot/campaign",
    label: "Campaign",
    context: "Set campaign parameters",
    isComplete: (ctx) => ctx.isCampaignFormComplete,
  },
  {
    id: "review",
    path: "/autopilot/review",
    label: "Review",
    context: "Confirm and launch",
    isComplete: (ctx) => ctx.isCampaignFormComplete,
  },
];

export function stepFromPath(pathname: string): AutopilotStep {
  return (
    STEPS.find((step) => pathname === step.path || pathname.startsWith(`${step.path}/`)) ?? STEPS[0]
  );
}

export function stepIndex(stepId: AutopilotStepId): number {
  return Math.max(
    0,
    STEPS.findIndex((step) => step.id === stepId),
  );
}

export function firstIncompleteStep(ctx: AutopilotContextValue): AutopilotStep {
  return STEPS.find((step) => step.id !== "review" && !step.isComplete(ctx)) ?? STEPS[4];
}

export function canVisitStep(ctx: AutopilotContextValue, target: AutopilotStep): boolean {
  const targetIndex = stepIndex(target.id);
  if (targetIndex === 0) return true;
  return STEPS.slice(0, targetIndex).every((step) => step.isComplete(ctx));
}
