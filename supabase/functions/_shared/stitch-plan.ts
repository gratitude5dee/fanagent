export function normalizeCutMarkersMs(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((marker) => Number(marker))
        .filter((marker) => Number.isFinite(marker) && marker > 0)
        .map((marker) => Math.round(marker)),
    ),
  ).sort((left, right) => left - right);
}

function nearestUnusedMarker(
  markers: number[],
  targetMs: number,
  usedIndexes: Set<number>,
): { index: number; marker: number } | null {
  let best: { index: number; marker: number; distance: number } | null = null;
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (usedIndexes.has(index)) continue;
    const distance = Math.abs(marker - targetMs);
    if (!best || distance < best.distance) best = { index, marker, distance };
  }
  return best ? { index: best.index, marker: best.marker } : null;
}

export function segmentDurationsFromCutMarkers(input: {
  cutMarkersMs: unknown;
  segmentCount: number;
  totalSeconds: number;
}): number[] | null {
  const segmentCount = Math.max(1, Math.floor(input.segmentCount));
  const totalMs = Math.round(Number(input.totalSeconds) * 1000);
  if (segmentCount <= 1 || !Number.isFinite(totalMs) || totalMs <= 0) return null;

  const markers = normalizeCutMarkersMs(input.cutMarkersMs).filter(
    (marker) => marker > 0 && marker < totalMs,
  );
  if (markers.length < segmentCount - 1) return null;

  const used = new Set<number>();
  const boundaries = [0];
  for (let boundaryIndex = 1; boundaryIndex < segmentCount; boundaryIndex += 1) {
    const targetMs = (totalMs * boundaryIndex) / segmentCount;
    const selected = nearestUnusedMarker(markers, targetMs, used);
    if (!selected) return null;
    used.add(selected.index);
    boundaries.push(selected.marker);
  }
  boundaries.push(totalMs);
  boundaries.sort((left, right) => left - right);

  const durations = boundaries
    .slice(1)
    .map((boundary, index) => (boundary - boundaries[index]) / 1000);
  if (durations.length !== segmentCount || durations.some((duration) => duration <= 0)) {
    return null;
  }
  return durations;
}
