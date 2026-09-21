import {
  summarize,
  lowerBound,
  upperBound,
  type SignalTrack,
  type Tick,
  type TraceSignal,
} from '../trace/model';
import { FLAG_FONT, FLAG_MAX_W, FLAG_MIN_PX, FLAG_PAD_X, MAX_SCAN_PER_ROW } from './theme';
import type { TimelineView } from './view.svelte';

/** Measures flag labels. Falls back to an estimate when there is no context to measure with. */
export function flagMeasurer(ctx: CanvasRenderingContext2D | null): (s: string) => number {
  if (ctx === null) return (s) => s.length * 6.2;
  ctx.font = FLAG_FONT;
  return (s) => ctx.measureText(s).width;
}

/**
 * One drawable flag: a stem at an exact tick, and the body hanging off it.
 *
 * Several records at the same tick collapse into a single box with `count > 1` -- the merged
 * flag. Selecting it puts every one of them in the property panel.
 */
export interface FlagBox {
  readonly tick: Tick;
  /** Stem position, CSS px. The stem sits exactly here; the body starts here and runs right. */
  readonly x: number;
  /** Body width in CSS px. **Zero means stem-only**: there was no room for a body. */
  readonly w: number;
  readonly count: number;
  /** Index of the first record at this tick, into `track.values`. */
  readonly start: number;
  /** What the body reads. `count > 1` collapses to a bare count. */
  readonly label: string;
}

/**
 * The flags of one row that fall inside the visible time window.
 *
 * Shared by the renderer and the hit test **on purpose**. Flag width depends on how much empty
 * time follows the flag, so it is not derivable from the tick alone; computing it in two places
 * would let the clickable box drift away from the drawn one, which is the kind of defect that
 * only shows up as "sometimes clicking a flag does nothing".
 *
 * A flag is sized to **its own text**, then clipped by the gap to the next stem. Sizing it to
 * the gap instead -- which the first cut did -- makes a flag standing in front of a long idle
 * stretch balloon to the maximum width, so it reads as a value span covering that time rather
 * than as an instant. The one record before a 600-tick hole looked exactly like a 600-tick
 * state.
 */
export function visibleFlags(
  view: TimelineView,
  track: SignalTrack,
  signal: TraceSignal,
  measure: (s: string) => number,
): FlagBox[] {
  const out: FlagBox[] = [];
  const ticks = track.ticks;
  if (ticks.length === 0 || view.zT <= 0) return out;

  // A margin of one maximum body width on the left, so a flag whose stem is just off-screen
  // still contributes the body that overlaps the viewport.
  const fromTick = view.camT - FLAG_MAX_W / view.zT;
  const toTick = view.camT + view.visibleTicks;

  const lo = lowerBound(ticks, fromTick);
  const hi = upperBound(ticks, toTick);
  const n = hi - lo;
  if (n <= 0) return out;

  const stride = n > MAX_SCAN_PER_ROW ? Math.ceil(n / MAX_SCAN_PER_ROW) : 1;

  let i = lo;
  while (i < hi) {
    const tick = ticks[i]!;

    // Collapse the run of records sharing this tick. With a stride in play the run is not
    // walked exactly, so the count is derived from the real bounds rather than from the walk.
    let end = i + 1;
    while (end < hi && ticks[end] === tick) end++;
    const count = end - i;

    const x = view.toX(tick);

    const label = count > 1 ? `${count} events` : summarize(signal, track.values[i]!);
    const wanted = Math.min(FLAG_MAX_W, measure(label) + FLAG_PAD_X);

    // How far to the next stem: the body may not run into it.
    const nextTick = end < hi ? ticks[end]! : Number.POSITIVE_INFINITY;
    const gapPx = Number.isFinite(nextTick)
      ? (nextTick - tick) * view.zT
      : Number.POSITIVE_INFINITY;
    const avail = Math.min(wanted, gapPx - 2);
    const w = avail >= FLAG_MIN_PX ? avail : 0;

    out.push({ tick, x, w, count, start: i, label });

    i = stride === 1 ? end : Math.max(end, i + stride);
  }

  return out;
}

/** The flag box containing or nearest to `x`, within `tol` CSS px of its stem or body. */
export function flagAt(
  boxes: readonly FlagBox[],
  x: number,
  y: number,
  rowTop: number,
  flagH: number,
  tol: number,
): FlagBox | null {
  let best: FlagBox | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const inBody = y >= rowTop && y <= rowTop + flagH;

  for (const b of boxes) {
    // The body is only clickable where it is drawn: the upper half of the row.
    if (inBody && b.w > 0 && x >= b.x && x <= b.x + b.w) return b;
    const d = Math.abs(x - b.x);
    if (d <= tol && d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}
