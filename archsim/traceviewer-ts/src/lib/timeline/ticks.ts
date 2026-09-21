import { clampNum } from '../geom/math';
import { MIN_MAJOR_PX, MIN_TICK_PX } from './theme';

/**
 * The three tick spacings to draw at a given zoom, in ticks.
 *
 * This is the timeline's version of the dot grid's level of detail (`canvas/grid-renderer.ts`),
 * and it keeps that module's two load-bearing properties:
 *
 * - the ladder climbs so the hierarchy survives a zoom -- minors fade out as the old mediums
 *   become the new minors, rather than every tier changing at once;
 * - `minorAlpha` is anchored to the same `MIN_TICK_PX` the ladder test uses, so the fade
 *   reaches zero exactly at the moment the tier is replaced. A fade that bottomed out above
 *   zero would leave the tier visible at the instant it was swapped, which is the discontinuity
 *   iter-1 bug 9 was about.
 *
 * It differs from the grid in two ways, both forced by the data rather than chosen. The ladder
 * is decimal (1-2-5) because tick counts are read as numbers, not as cells; and **every tier is
 * a whole number of ticks, floored at 1**, because a simulation tick is indivisible and a
 * gridline at 2.5 ticks would be pointing at nothing.
 */
export interface TickTiers {
  readonly minor: number;
  readonly medium: number;
  readonly major: number;
  /** 0..1. The minor tier is skipped entirely at 0. */
  readonly minorAlpha: number;
}

/** The smallest 1-2-5 decade value >= `v`. */
export function ladderAtLeast(v: number): number {
  if (!Number.isFinite(v) || v <= 1) return 1;
  const k = Math.floor(Math.log10(v));
  const base = Math.pow(10, k);
  for (const m of [1, 2, 5]) {
    const cand = m * base;
    if (cand >= v - 1e-9) return cand;
  }
  return 10 * base;
}

/**
 * Pick `medium` and `minor` so both **divide** `major`.
 *
 * Rounding `major / 2` would give 3 for a major of 5, and mediums every 3 ticks under majors
 * every 5 is a ruler that never lines up with itself.
 */
function subdivide(major: number): { medium: number; minor: number } {
  const divides = (d: number): boolean => major % d === 0;
  const medium = divides(2) && major / 2 >= 1 ? major / 2 : divides(5) ? major / 5 : major;
  const minor = divides(10) && major / 10 >= 1 ? major / 10 : 1;
  return { medium, minor: Math.min(minor, medium) };
}

export function tickTiers(pxPerTick: number): TickTiers {
  if (!Number.isFinite(pxPerTick) || pxPerTick <= 0) {
    return { minor: 1, medium: 1, major: 1, minorAlpha: 0 };
  }
  const major = Math.max(1, Math.round(ladderAtLeast(MIN_MAJOR_PX / pxPerTick)));
  const { medium, minor } = subdivide(major);

  // Ramp width of 6 screen px, as in the dot grid: wide enough not to pop, narrow enough that
  // the tier is genuinely gone by the time the ladder moves on.
  const minorAlpha = minor === major ? 0 : clampNum((minor * pxPerTick - MIN_TICK_PX) / 6, 0, 1);

  return { minor, medium, major, minorAlpha };
}

/**
 * The first multiple of `step` at or after `from`.
 *
 * Callers walk ticks by incrementing an **index** and multiplying, never by adding `step` to a
 * running coordinate: repeated addition drifts, and the "is this a major?" test has to stay
 * exact or the ruler grows and loses lines as it is panned.
 */
export function firstIndexAtOrAfter(from: number, step: number): number {
  return Math.ceil(from / step);
}

/** A tick number as it appears under a major gridline. */
export function formatTick(tick: number): string {
  return String(Math.round(tick));
}
