import type { DedupeStrategy, SourceCandidate } from "./types.ts";

export function candidateDedupeKeys(candidate: SourceCandidate): string[] {
  const keys: string[] = [];
  const externalId = candidate.external_id?.trim();
  if (externalId) {
    keys.push(`provider:${candidate.source_type}:${candidate.provider}:${externalId}`);
  }
  if (candidate.origin_url?.trim()) keys.push(`url:${candidate.origin_url.trim()}`);
  if (candidate.perceptual_hash?.trim()) keys.push(`phash:${candidate.perceptual_hash.trim()}`);
  return keys;
}

export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = Number.parseInt(left[index], 16);
    const r = Number.parseInt(right[index], 16);
    if (!Number.isFinite(l) || !Number.isFinite(r)) return Number.POSITIVE_INFINITY;
    let xor = l ^ r;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

function isUsed(candidate: SourceCandidate, usedKeys: Set<string>, phashThreshold = 6): boolean {
  const keys = candidateDedupeKeys(candidate);
  if (keys.some((key) => usedKeys.has(key))) return true;
  if (!candidate.perceptual_hash) return false;

  for (const key of usedKeys) {
    if (!key.startsWith("phash:")) continue;
    const usedHash = key.slice("phash:".length);
    if (hammingDistance(candidate.perceptual_hash, usedHash) <= phashThreshold) return true;
  }
  return false;
}

export function selectUnique(
  candidates: SourceCandidate[],
  usedKeys: Set<string>,
  strategy: DedupeStrategy = "strict",
): { candidate: SourceCandidate; reused: boolean } | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  if (strategy === "allow_reuse_freely") {
    return { candidate: ranked[0], reused: isUsed(ranked[0], usedKeys) };
  }

  const unused = ranked.find((candidate) => !isUsed(candidate, usedKeys));
  if (unused) return { candidate: unused, reused: false };

  if (strategy === "allow_reuse_after_exhaustion") {
    return { candidate: ranked[0], reused: true };
  }

  return null;
}
