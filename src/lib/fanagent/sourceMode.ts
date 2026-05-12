export const sourceModes = ["stock", "mixed", "seedance", "gmi_seedance"] as const;

export type SourceMode = (typeof sourceModes)[number];

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
