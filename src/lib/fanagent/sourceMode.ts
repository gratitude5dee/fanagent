export const sourceModes = [
  "stock",
  "mixed",
  "seedance",
  "gmi_seedance",
  "sports_edit",
  "streamer_clip",
] as const;

export type SourceMode = (typeof sourceModes)[number];

export type SourceDiagnosticsEnv = Partial<{
  fal: boolean;
  gmi: boolean;
  youtubeApiKey: boolean;
  sportsAllowed: boolean;
  twitchClientId: boolean;
  twitchClientSecret: boolean;
  streamerAllowed: boolean;
}>;

export type SourceOption = {
  value: SourceMode;
  label: string;
  disabled?: boolean;
  reason?: string;
};

export function normalizeSourceMode(value: unknown): SourceMode {
  if (value === "hybrid") return "mixed";
  return sourceModes.includes(value as SourceMode) ? (value as SourceMode) : "stock";
}

export function sourceModeNeedsFal(value: SourceMode): boolean {
  return value === "mixed" || value === "seedance";
}

export function sourceModeNeedsGmi(value: SourceMode): boolean {
  return value === "gmi_seedance";
}

export function buildSourceOptions(env?: SourceDiagnosticsEnv): SourceOption[] {
  const options: SourceOption[] = [
    { value: "stock", label: "Stock footage" },
    {
      value: "mixed",
      label: "Mixed: stock + Seedance 2",
      disabled: env ? !env.fal : false,
      reason: "FAL key missing",
    },
    {
      value: "seedance",
      label: "Seedance 2 only",
      disabled: env ? !env.fal : false,
      reason: "FAL key missing",
    },
    {
      value: "gmi_seedance",
      label: "GMI Seedance 2",
      disabled: env ? !env.gmi : false,
      reason: "GMI key missing",
    },
    {
      value: "sports_edit",
      label: "Sports edit",
      disabled: env ? !env.youtubeApiKey : false,
      reason: "YouTube API key missing",
    },
    {
      value: "streamer_clip",
      label: "Streamer clips",
      disabled: env ? !env.twitchClientId || !env.twitchClientSecret : false,
      reason: "Twitch credentials missing",
    },
  ];

  return options;
}

export function isSourceModeSelectable(mode: SourceMode, env?: SourceDiagnosticsEnv): boolean {
  return buildSourceOptions(env).some((option) => option.value === mode && !option.disabled);
}

export function coerceSelectableSourceMode(
  mode: SourceMode,
  env?: SourceDiagnosticsEnv,
): SourceMode {
  return isSourceModeSelectable(mode, env) ? mode : "stock";
}
