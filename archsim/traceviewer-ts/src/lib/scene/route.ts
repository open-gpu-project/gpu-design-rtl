import { clampNum, distToSegment } from '../geom/math';
import type { Anchor, Rect, Vec2 } from '../geom/types';
import { GRID, snap } from '../grid';
import { opsFor } from './registry';
import type { CorridorQuery, Shape } from './shape';

/**
 * The rectilinear router, and the polyline algebra everything else reads through.
 *
 * Pure: no canvas, no store, no tools. That is deliberate -- routing is the part of connections
 * most likely to be wrong in a way a screenshot will not show, so it is the part a browser check
 * can drive as a function (see `window.__route` and `verify/connections.mjs`).
 *
 * Every function here returns its INPUT reference when nothing changed. `SceneStore.commit`
 * decides whether to push an undo entry by comparing array identity, so an allocation that
 * represents no change is not a wasted object -- it is a spurious history entry.
 */

/** How far a route may be nudged off its natural elbow to leave along a face normal. */
const STUB = GRID;

/** Hard cap on segments out of the router. See the iteration 4 document, decision A. */
export const ROUTE_MAX_SEGMENTS = 3;

/** A run shorter than this is a stub, not a corridor: bundling onto it would buy nothing. */
const MIN_CORRIDOR_LEN = 2 * GRID;

/* ------------------------------------------------------------------- cost weights ----
 * Lengths are normalised by GRID so every weight is scale-free, and the weights are chosen so
 * the resulting behaviour is provable rather than tuned. For two fixed endpoints every L and
 * every in-span Z has identical Manhattan length, so within the span the contest is exactly
 * W_SEGMENT vs BUNDLE_BONUS vs W_MIDPREF * distance. That yields, without any special-casing:
 *
 *   - no corridor nearby         -> the L wins by 2, so a route is 1 or 2 segments by default
 *   - a corridor near the middle -> the Z wins by up to 4, so lines bundle
 *   - a corridor far / out of span -> loses on length, so there are no absurd detours
 *   - a normal violation costs 25 or 10 000, always more than bundling can pay, so bundling
 *     can never buy an arrowhead that arrives through the back of its target
 */

/** The route would dive into the block it just left, or arrive through the one it enters. */
const W_THROUGH = 10_000;
/** The route leaves or arrives along the face rather than across it. Ugly, but legal. */
const W_OFFAXIS = 25;
const W_SEGMENT = 2;
const W_LENGTH = 1;
/** Pull towards the natural midpoint, so an unbundled Z does not wander. */
const W_MIDPREF = 0.25;
const BUNDLE_BONUS = 6;
/** Strictly increasing tiebreak, so the argmin is a deterministic function of the input. */
const W_INDEX = 0.001;

/**
 * How far from the span a corridor may sit and still be a candidate. Derived rather than picked:
 * past this distance W_MIDPREF already exceeds BUNDLE_BONUS, so the candidate could not win.
 */
const BUNDLE_REACH = (BUNDLE_BONUS / W_MIDPREF) * GRID;

/** Cap on elbow candidates per axis, nearest the midpoint first. Bounds cost in a dense scene. */
const MAX_ELBOW_CANDIDATES = 12;

/* --------------------------------------------------------------- polyline algebra ---- */

export function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Value equality. Identity first, so the common "nothing changed" case is one comparison. */
export function samePoints(a: readonly Vec2[], b: readonly Vec2[] | undefined): boolean {
  if (b === undefined) return false;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!samePoint(a[i]!, b[i]!)) return false;
  }
  return true;
}

/** Every consecutive pair shares exactly one coordinate. A repeated point counts as shared. */
export function isRectilinear(points: readonly Vec2[]): boolean {
  if (points.length < 2) return false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
}

/**
 * Drop zero-length segments and collinear interior points. Never drops the first or last point,
 * so the anchors survive. Idempotent, and returns the input reference when it changed nothing.
 */
export function collapseRoute(points: readonly Vec2[]): readonly Vec2[] {
  if (points.length <= 2) return points;
  const out: Vec2[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    if (samePoint(prev, cur)) continue;
    // Collinear: the point is in the middle of a straight run, so it says nothing.
    if ((prev.x === cur.x && cur.x === next.x) || (prev.y === cur.y && cur.y === next.y)) continue;
    out.push(cur);
  }
  const last = points[points.length - 1]!;
  if (!samePoint(out[out.length - 1]!, last) || out.length === 1) out.push(last);
  return out.length === points.length ? points : out;
}

export function routeBounds(points: readonly Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function distToRoute(p: Vec2, points: readonly Vec2[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = distToSegment(p, points[i - 1]!, points[i]!);
    if (d < best) best = d;
  }
  return best;
}

/** Unit direction of the last non-degenerate segment, or null. Orients the arrowhead. */
export function endDirection(points: readonly Vec2[]): Vec2 | null {
  for (let i = points.length - 1; i >= 1; i--) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (samePoint(a, b)) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }
  return null;
}

/** Unit direction of the first non-degenerate segment, or null. */
export function startDirection(points: readonly Vec2[]): Vec2 | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (samePoint(a, b)) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }
  return null;
}

function manhattan(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i]!.x - points[i - 1]!.x) + Math.abs(points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

/* ------------------------------------------------------------------ corridor index ---- */

function insertSorted(xs: number[], v: number): void {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  if (xs[lo] === v) return;
  xs.splice(lo, 0, v);
}

function rangeOf(xs: readonly number[], lo: number, hi: number): readonly number[] {
  const out: number[] = [];
  for (const v of xs) {
    if (v > hi) break;
    if (v >= lo) out.push(v);
  }
  return out;
}

/**
 * The corridors a route may bundle onto: the x of every long vertical run and the y of every
 * long horizontal run already in the scene.
 *
 * Sorted arrays with an O(n) splice per insert. At the scale this editor targets (a few hundred
 * connections, three runs each) that is nothing, and the `CorridorQuery` interface is narrow
 * enough that bucketing is a drop-in if it ever stops being nothing.
 */
export class CorridorIndex implements CorridorQuery {
  #xs: number[] = [];
  #ys: number[] = [];

  /** Whatever `s`'s kind declares as a corridor. A kind without the seam contributes nothing. */
  absorb(s: Shape): void {
    const pts = opsFor(s).corridors?.(s);
    if (pts === undefined || pts === null) return;
    this.absorbPoints(pts);
  }

  absorbPoints(points: readonly Vec2[]): void {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (a.x === b.x) {
        if (Math.abs(b.y - a.y) >= MIN_CORRIDOR_LEN) insertSorted(this.#xs, a.x);
      } else if (a.y === b.y) {
        if (Math.abs(b.x - a.x) >= MIN_CORRIDOR_LEN) insertSorted(this.#ys, a.y);
      }
    }
  }

  rangeX(lo: number, hi: number): readonly number[] {
    return rangeOf(this.#xs, lo, hi);
  }

  rangeY(lo: number, hi: number): readonly number[] {
    return rangeOf(this.#ys, lo, hi);
  }

  hasX(v: number): boolean {
    return this.#xs.includes(v);
  }

  hasY(v: number): boolean {
    return this.#ys.includes(v);
  }

  /** Everything owned by `shapes[0 .. upTo)`. The connect tool routes its ghost against this. */
  static from(shapes: readonly Shape[], upTo: number = shapes.length): CorridorIndex {
    const index = new CorridorIndex();
    for (let i = 0; i < upTo && i < shapes.length; i++) index.absorb(shapes[i]!);
    return index;
  }
}

const EMPTY_RANGE: readonly number[] = [];

/** Shared no-op, for the first shape in a fold and for routing with no scene at all. */
export const NO_CORRIDORS: CorridorQuery = {
  rangeX: () => EMPTY_RANGE,
  rangeY: () => EMPTY_RANGE,
  hasX: () => false,
  hasY: () => false,
};

/* ------------------------------------------------------------------------ routing ---- */

interface Candidate {
  readonly pts: readonly Vec2[];
  /** The axis the free elbow coordinate lives on, or null for a straight run or an L. */
  readonly axis: 'x' | 'y' | null;
  readonly m: number;
  readonly mid: number;
}

function isAnchor(t: Anchor | Vec2): t is Anchor {
  return 'normal' in t;
}

/**
 * Elbow coordinates worth trying on one axis: the natural midpoint, each end's stub position,
 * and every existing corridor within reach. Nearest the midpoint first, then sorted ascending
 * so the index tiebreak is stable.
 */
function elbowCandidates(
  mid: number,
  a: number,
  b: number,
  naAxis: number,
  nbAxis: number | null,
  corridors: readonly number[],
): readonly number[] {
  const set = new Set<number>([mid]);
  if (naAxis !== 0) set.add(a + STUB * Math.sign(naAxis));
  if (nbAxis !== null && nbAxis !== 0) set.add(b - STUB * Math.sign(nbAxis));
  for (const c of corridors) set.add(c);
  const all = [...set];
  if (all.length > MAX_ELBOW_CANDIDATES) {
    all.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
    all.length = MAX_ELBOW_CANDIDATES;
  }
  all.sort((p, q) => p - q);
  return all;
}

function cost(
  c: Candidate,
  i: number,
  na: Vec2,
  nb: Vec2 | null,
  corridors: CorridorQuery,
): number {
  const d0 = startDirection(c.pts);
  const dz = endDirection(c.pts);

  // Two tiers, not one boolean. "Through" is the line diving into the block it just left or
  // arriving through the far side of its target -- visibly broken. "Off-axis" is leaving along
  // the face, which is merely ugly, and is what makes the head-to-head case routable at all.
  let through = 0;
  let offaxis = 0;
  if (d0 !== null) {
    const dot = d0.x * na.x + d0.y * na.y;
    if (dot < 0) through += 1;
    else if (dot === 0) offaxis += 1;
  }
  if (nb !== null && dz !== null) {
    const dot = dz.x * nb.x + dz.y * nb.y;
    if (dot > 0) through += 1;
    else if (dot === 0) offaxis += 1;
  }

  const onCorridor =
    c.axis === 'x' ? corridors.hasX(c.m) : c.axis === 'y' ? corridors.hasY(c.m) : false;

  return (
    W_THROUGH * through +
    W_OFFAXIS * offaxis +
    W_SEGMENT * (c.pts.length - 2) +
    W_LENGTH * (manhattan(c.pts) / GRID) +
    (c.axis === null ? 0 : W_MIDPREF * (Math.abs(c.m - c.mid) / GRID)) -
    (onCorridor ? BUNDLE_BONUS : 0) +
    W_INDEX * i
  );
}

/**
 * Route from an anchor to an anchor, or to a bare point for the ghost's free end.
 *
 * Generates every straight / L / Z candidate, scores them, and takes the argmin. That is a lot
 * of words for "pick the nicest elbow", but the scoring is what lets one function satisfy four
 * requirements at once -- short, few segments, leaving along the face normal, and bundled onto
 * its neighbours -- without any of them being special-cased against the others.
 */
export function routeConnection(
  from: Anchor,
  to: Anchor | Vec2,
  corridors: CorridorQuery = NO_CORRIDORS,
): readonly Vec2[] {
  const a = from.pos;
  const na = from.normal;
  const bAnchor = isAnchor(to);
  const b = bAnchor ? to.pos : to;
  const nb = bAnchor ? to.normal : null;

  if (samePoint(a, b)) return [a, b];

  const candidates: Candidate[] = [];
  const push = (pts: readonly Vec2[], axis: 'x' | 'y' | null, m: number, mid: number): void => {
    candidates.push({ pts: collapseRoute(pts), axis, m, mid });
  };

  if (a.x === b.x || a.y === b.y) {
    push([a, b], null, 0, 0);
  } else {
    push([a, { x: b.x, y: a.y }, b], null, 0, 0);
    push([a, { x: a.x, y: b.y }, b], null, 0, 0);
  }

  if (ROUTE_MAX_SEGMENTS >= 3) {
    const midX = snap((a.x + b.x) / 2);
    const loX = Math.min(a.x, b.x) - BUNDLE_REACH;
    const hiX = Math.max(a.x, b.x) + BUNDLE_REACH;
    for (const m of elbowCandidates(
      midX,
      a.x,
      b.x,
      na.x,
      nb?.x ?? null,
      corridors.rangeX(loX, hiX),
    )) {
      push([a, { x: m, y: a.y }, { x: m, y: b.y }, b], 'x', m, midX);
    }
    const midY = snap((a.y + b.y) / 2);
    const loY = Math.min(a.y, b.y) - BUNDLE_REACH;
    const hiY = Math.max(a.y, b.y) + BUNDLE_REACH;
    for (const m of elbowCandidates(
      midY,
      a.y,
      b.y,
      na.y,
      nb?.y ?? null,
      corridors.rangeY(loY, hiY),
    )) {
      push([a, { x: a.x, y: m }, { x: b.x, y: m }, b], 'y', m, midY);
    }
  }

  let best = candidates[0]!;
  let bestCost = cost(best, 0, na, nb, corridors);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.pts.length - 1 > ROUTE_MAX_SEGMENTS) continue;
    const score = cost(c, i, na, nb, corridors);
    if (score < bestCost) {
      best = c;
      bestCost = score;
    }
  }
  return best.pts;
}

/* ------------------------------------------------------------------ segment edits ---- */

/**
 * Move segment `i` perpendicular to itself so it passes through `target`, patching both
 * neighbours so the route stays rectilinear.
 *
 * The two bound endpoints never move. Dragging an end segment therefore INSERTS a joining
 * segment rather than detaching the anchor from its block -- an anchor that slid off its
 * perimeter because the user grabbed the wrong line would be a very confusing way to lose a
 * connection.
 */
export function moveSegment(points: readonly Vec2[], i: number, target: Vec2): readonly Vec2[] {
  if (i < 0 || i + 1 >= points.length) return points;
  const a = points[i]!;
  const b = points[i + 1]!;
  const vertical = a.x === b.x;
  if (!vertical && a.y !== b.y) return points;

  const coord = vertical ? snap(target.x) : snap(target.y);
  if (vertical ? coord === a.x : coord === a.y) return points;
  const moved = (q: Vec2): Vec2 => (vertical ? { x: coord, y: q.y } : { x: q.x, y: coord });

  const out = points.slice();
  out[i] = moved(a);
  out[i + 1] = moved(b);
  if (i === 0) out.splice(0, 0, a);
  if (i + 1 === points.length - 1) out.push(b);
  return collapseRoute(out);
}

/**
 * Slide the first point onto `a`, re-hanging exactly one interior point so the adjacent run
 * keeps its orientation. Used to keep a hand-edited route attached when its block moves.
 */
export function patchStart(points: readonly Vec2[], a: Vec2): readonly Vec2[] {
  if (points.length < 2) return [a, a];
  const p0 = points[0]!;
  if (samePoint(p0, a)) return points;
  if (points.length === 2) return collapseRoute([a, points[1]!]);
  const p1 = points[1]!;
  const p1b = p0.x === p1.x ? { x: a.x, y: p1.y } : { x: p1.x, y: a.y };
  return collapseRoute([a, p1b, ...points.slice(2)]);
}

export function patchEnd(points: readonly Vec2[], b: Vec2): readonly Vec2[] {
  if (points.length < 2) return [b, b];
  const pn = points[points.length - 1]!;
  if (samePoint(pn, b)) return points;
  if (points.length === 2) return collapseRoute([points[0]!, b]);
  const pm = points[points.length - 2]!;
  const pmb = pn.x === pm.x ? { x: b.x, y: pm.y } : { x: pm.x, y: b.y };
  return collapseRoute([...points.slice(0, -2), pmb, b]);
}

/** Clamp a corner radius to half the shorter adjacent segment, so short runs stay sane. */
export function cornerRadius(prev: Vec2, cur: Vec2, next: Vec2, wanted: number): number {
  const inLen = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
  const outLen = Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y);
  return clampNum(Math.min(wanted, inLen / 2, outLen / 2), 0, wanted);
}
