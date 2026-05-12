// Marker math: snap, dedupe, delete-nearest, and a tiny undo stack.
// Markers are stored in seconds in the UI layer.

const SNAP_SEC = 0.05;
const DEDUPE_SEC = 0.25;
const DELETE_RADIUS_SEC = 0.5;
export const MAX_UNDO = 30;

export function snap(t: number): number {
  return Math.round(t / SNAP_SEC) * SNAP_SEC;
}

export function addMarker(markers: number[], t: number): number[] {
  const snapped = snap(t);
  if (markers.some((m) => Math.abs(m - snapped) < DEDUPE_SEC)) return markers;
  return [...markers, snapped].sort((a, b) => a - b);
}

export function deleteAt(markers: number[], t: number): number[] {
  let bestIdx = -1;
  let bestDist = Infinity;
  markers.forEach((m, i) => {
    const d = Math.abs(m - t);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  });
  if (bestIdx === -1 || bestDist > DELETE_RADIUS_SEC) return markers;
  return markers.filter((_, i) => i !== bestIdx);
}

export function moveMarker(markers: number[], idx: number, t: number): number[] {
  const next = [...markers];
  next[idx] = snap(t);
  // Dedupe neighbors after move
  const seen = new Set<number>();
  return next
    .filter((m) => {
      const k = Math.round(m / DEDUPE_SEC);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a - b);
}

export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];

  push(state: T) {
    this.past.push(state);
    if (this.past.length > MAX_UNDO) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev == null) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next == null) return null;
    this.past.push(current);
    return next;
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
