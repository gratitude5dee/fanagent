export function findGmiVideoUrl(outcome: unknown): string | undefined {
  if (!outcome || typeof outcome !== "object") {
    return undefined;
  }

  if ("video_url" in outcome && typeof outcome.video_url === "string") {
    return outcome.video_url;
  }

  if (
    "url" in outcome &&
    typeof outcome.url === "string" &&
    /\.(mp4|mov)(\?|$)/i.test(outcome.url)
  ) {
    return outcome.url;
  }

  for (const value of Object.values(outcome)) {
    if (typeof value === "string" && /\.(mp4|mov)(\?|$)/i.test(value)) {
      return value;
    }

    const nested = findGmiVideoUrl(value);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}
