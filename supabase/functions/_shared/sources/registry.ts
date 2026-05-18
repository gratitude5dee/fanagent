import type { AdapterSearchInput, SourceAdapter, SourceCandidate, SourceType } from "./types.ts";

export const sourceAdapterTypes: SourceType[] = [
  "stock",
  "library",
  "seedance",
  "gmi_seedance",
  "sports_edit",
  "streamer_clip",
];

async function loadAdapter(type: SourceType): Promise<SourceAdapter> {
  switch (type) {
    case "stock":
      return (await import("./stock.ts")).stockAdapter;
    case "library":
      return (await import("./library.ts")).libraryAdapter;
    case "seedance":
      return (await import("./seedance.ts")).seedanceAdapter;
    case "gmi_seedance":
      return (await import("./gmi.ts")).gmiSeedanceAdapter;
    case "sports_edit":
      return (await import("./sports_edit.ts")).sportsEditAdapter;
    case "streamer_clip":
      return (await import("./streamer_clip.ts")).streamerClipAdapter;
  }
}

export function normalizeSourceType(value: unknown): SourceType {
  return sourceAdapterTypes.includes(value as SourceType) ? (value as SourceType) : "stock";
}

export function getSourceAdapter(type: SourceType): SourceAdapter {
  return {
    type,
    async search(input: AdapterSearchInput): Promise<SourceCandidate[]> {
      return (await loadAdapter(type)).search(input);
    },
    async cache(candidate: SourceCandidate) {
      return (await loadAdapter(type)).cache(candidate);
    },
    describeLicense(candidate: SourceCandidate) {
      return {
        license: candidate.license,
        rights_holder: candidate.rights_holder,
        attribution: candidate.attribution,
      };
    },
  };
}

export async function searchSourceCandidates(
  type: SourceType,
  input: AdapterSearchInput,
): Promise<SourceCandidate[]> {
  return getSourceAdapter(type).search(input);
}
