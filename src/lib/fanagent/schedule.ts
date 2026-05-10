export function buildSchedule(startAt: Date, count: number, cadenceMinutes: number): Date[] {
  const safeCount = Math.max(1, Math.min(Math.floor(count), 50));
  const safeCadence = Math.max(5, Math.min(Math.floor(cadenceMinutes), 7 * 24 * 60));

  return Array.from(
    { length: safeCount },
    (_, index) => new Date(startAt.getTime() + index * safeCadence * 60_000),
  );
}
