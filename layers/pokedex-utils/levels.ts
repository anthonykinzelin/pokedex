export const POINTS_PER_PURCHASE = 50;
export const POINTS_PER_LEVEL = 100;

// The level is derived from the points, never stored: two sources of truth for
// one fact only raise the question of when they start to disagree. A purchase is
// worth less than a level on purpose, so "which levels did this purchase take
// the user through" is a real question rather than always exactly one.
export function levelFor(points: unknown): number {
  if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) {
    return 0;
  }

  return Math.floor(points / POINTS_PER_LEVEL);
}

// The levels a purchase took the user through, in order. `published` is the
// watermark stored on the LEVEL item, so both bounds come from committed state:
// a purchase crossing two thresholds returns two levels, and a redelivered
// message whose points were already counted returns none.
export function levelsCrossed(published: unknown, reached: number): number[] {
  const watermark = typeof published === 'number' && Number.isFinite(published)
    ? Math.max(Math.floor(published), 0)
    : 0;
  const levels: number[] = [];

  for (let level = watermark + 1; level <= reached; level += 1) {
    levels.push(level);
  }

  return levels;
}
