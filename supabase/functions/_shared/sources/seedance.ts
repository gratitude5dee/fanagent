import type { SourceAdapter, SourceCandidate } from "./types.ts";

function virtualCandidate(provider: "seedance" | "gmi_seedance", prompt: string): SourceCandidate {
  return {
    source_type: provider,
    provider,
    external_id: null,
    origin_url: `virtual://${provider}/${crypto.randomUUID()}`,
    width: 1080,
    height: 1920,
    duration_seconds: 15,
    is_portrait: true,
    license: provider === "seedance" ? "generated_seedance" : "generated_gmi_seedance",
    metadata: { prompt },
    score: 1,
  };
}

export const seedanceAdapter: SourceAdapter = {
  type: "seedance",
  async search(input) {
    return [virtualCandidate("seedance", input.query)];
  },
  async cache(candidate) {
    return { url: candidate.origin_url };
  },
  describeLicense(candidate) {
    return { license: candidate.license };
  },
};

export const gmiSeedanceAdapter: SourceAdapter = {
  type: "gmi_seedance",
  async search(input) {
    return [virtualCandidate("gmi_seedance", input.query)];
  },
  async cache(candidate) {
    return { url: candidate.origin_url };
  },
  describeLicense(candidate) {
    return { license: candidate.license };
  },
};
