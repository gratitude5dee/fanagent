import type { SourceCandidate } from "./types.ts";

export function filterPortrait(candidates: SourceCandidate[]): SourceCandidate[] {
  return candidates.filter((candidate) => {
    if (candidate.is_portrait) return true;
    const width = Number(candidate.width ?? 0);
    const height = Number(candidate.height ?? 0);
    return width > 0 && height > width;
  });
}

export function filterByDuration(
  candidates: SourceCandidate[],
  segmentDur: number,
  preferred = 5,
  fallback = 10,
): { candidates: SourceCandidate[]; toleranceUsed: number | null } {
  const ranked = [...candidates].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  const preferredMatches = ranked.filter(
    (candidate) => Math.abs(Number(candidate.duration_seconds) - segmentDur) <= preferred,
  );
  if (preferredMatches.length > 0) {
    return {
      candidates: preferredMatches.map((candidate) => ({
        ...candidate,
        tolerance_seconds_used: preferred,
      })),
      toleranceUsed: preferred,
    };
  }

  const fallbackMatches = ranked.filter(
    (candidate) => Math.abs(Number(candidate.duration_seconds) - segmentDur) <= fallback,
  );
  if (fallbackMatches.length > 0) {
    return {
      candidates: fallbackMatches.map((candidate) => ({
        ...candidate,
        tolerance_seconds_used: fallback,
      })),
      toleranceUsed: fallback,
    };
  }

  return { candidates: [], toleranceUsed: null };
}
