// The progression rules of the Levels service, in one place because three
// callers have to agree on them: the consumer that adds the points, the read
// route behind GET /users/{userId}/level, and the tests.
//
// A purchase is deliberately worth less than a level. If a purchase were worth
// exactly one level, "has the level changed?" would always be yes, and the
// question the consumer actually has to answer - which levels did this purchase
// take the user through - would never arise.
export const POINTS_PER_PURCHASE = 50;
export const POINTS_PER_LEVEL = 100;

// The level is derived, never stored. Storing it next to the points would give
// two sources of truth for one fact, and the only interesting question about
// two sources of truth is when they will start to disagree.
export function levelFor(points: unknown): number {
  if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) {
    return 0;
  }

  return Math.floor(points / POINTS_PER_LEVEL);
}

// The levels a purchase took the user through, in order.
//
// `published` is the watermark stored on the LEVEL item: the highest level
// already announced on the bus. Both bounds therefore come from committed
// state, which is what makes this replayable - a purchase that crosses two
// thresholds at once returns two levels, and a redelivered message whose points
// were already counted returns none.
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
