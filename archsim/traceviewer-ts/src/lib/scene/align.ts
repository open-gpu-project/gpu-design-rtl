import type { Rect, Vec2 } from '../geom/types';
import { GRID, snap, snapPoint } from '../grid';
import { hierarchyOf } from './hierarchy';
import { opsFor } from './registry';
import type { Shape, ShapeName } from './shape';

/**
 * Alignment snapping: a placed shape being moved, resized or drawn -- the source -- lines up with
 * the placed shapes that share its parent. Edges go to edges and medians to medians, on each axis.
 *
 * **The grid wins.** Every position alignment can choose is one the grid-only gesture could
 * have produced: a grid multiple for a move's delta, a grid point for a resize's or a create's
 * pointer. Alignment decides which of those wins near a target, and says so with a guide. It
 * never makes geometry the grid could not, so nothing fractional reaches the file.
 *
 * Every candidate is a grid point, and any grid point other than `snap(q)` lies at least half a
 * step from the raw coordinate `q`. So alignment moves a landing only while the tolerance, in
 * world units, is more than `GRID / 2`; nearer in than that, the guides are all it adds.
 *
 * Pure, and built per gesture rather than memoised: the index leaves out what the gesture moves,
 * so no two gestures would share one.
 */

export type Axis = 'x' | 'y';

/** What a feature aligns with: an edge with edges, a median with medians. */
export type Role = 'edge' | 'mid';

/** How far across the axis the targets on one coordinate reach. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * One axis's alignment targets, keyed by coordinate: an x-edge is its x, a y-median its y.
 *
 * One entry per distinct value, which is the de-duplication. Targets that share a coordinate
 * share its entry, and its span is the union of theirs, so one guide reaches every one of them.
 */
export interface AxisStops {
  readonly edge: ReadonlyMap<number, Span>;
  readonly mid: ReadonlyMap<number, Span>;
}

export interface AlignTargets {
  /** Vertical lines: left and right edges, and vertical medians. */
  readonly x: AxisStops;
  /** Horizontal lines: top and bottom edges, and horizontal medians. */
  readonly y: AxisStops;
}

export interface AlignIndex {
  /** The targets among the placed children of `parent`, or of the top level for null. */
  targetsOf(parent: ShapeName | null): AlignTargets;
  /** The parent a placed source with bounds `b`, at z-index `index`, would get. */
  parentFor(b: Rect, index: number): ShapeName | null;
}

const NO_TARGETS: AlignTargets = {
  x: { edge: new Map(), mid: new Map() },
  y: { edge: new Map(), mid: new Map() },
};

interface MutableTargets {
  readonly x: { readonly edge: Map<number, Span>; readonly mid: Map<number, Span> };
  readonly y: { readonly edge: Map<number, Span>; readonly mid: Map<number, Span> };
}

function addStop(stops: Map<number, Span>, at: number, from: number, to: number): void {
  const s = stops.get(at);
  stops.set(
    at,
    s === undefined ? { from, to } : { from: Math.min(s.from, from), to: Math.max(s.to, to) },
  );
}

/**
 * Every parent's targets, built eagerly from `hierarchyOf(shapes)`.
 *
 * Only placed shapes are targets, never a wire or an interface, and only finite bounds. `skip`
 * is what the gesture moves: it is neither a target nor a candidate parent. Parents are read off
 * the whole array, which is sound because nothing outside `skip` has a parent inside it -- a
 * shape whose parent moves is a descendant, and moves too.
 */
export function alignIndex(shapes: readonly Shape[], skip: ReadonlySet<ShapeName>): AlignIndex {
  const h = hierarchyOf(shapes);
  const byParent = new Map<ShapeName | null, MutableTargets>();

  for (const s of shapes) {
    if (!h.isPlaced(s.name) || skip.has(s.name)) continue;
    const b = opsFor(s).bounds(s);
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) continue;

    const key = h.parentOf(s.name);
    let t = byParent.get(key);
    if (t === undefined) {
      t = { x: { edge: new Map(), mid: new Map() }, y: { edge: new Map(), mid: new Map() } };
      byParent.set(key, t);
    }
    const x2 = b.x + b.w;
    const y2 = b.y + b.h;
    addStop(t.x.edge, b.x, b.y, y2);
    addStop(t.x.edge, x2, b.y, y2);
    addStop(t.x.mid, b.x + b.w / 2, b.y, y2);
    addStop(t.y.edge, b.y, b.x, x2);
    addStop(t.y.edge, y2, b.x, x2);
    addStop(t.y.mid, b.y + b.h / 2, b.x, x2);
  }

  return {
    targetsOf: (parent) => byParent.get(parent) ?? NO_TARGETS,
    parentFor: (b, index) => h.parentFor(b, index, skip),
  };
}

export interface Feature {
  readonly at: number;
  readonly role: Role;
}

/**
 * The features of `b` on one axis that a gesture moves.
 *
 * With no pin, as in a move, that is both edges and the median. With a pin, as in a resize or
 * a create's drag, it is the edge that is not the pin, and the median. Asking which edge is not
 * the pin, rather than which one the handle names, stays right after the drag flips past the far
 * edge. With no extent on the axis there is only the edge, so a point has no median to show.
 */
export function featuresOf(b: Rect, axis: Axis, pin: number | null): readonly Feature[] {
  const lo = axis === 'x' ? b.x : b.y;
  const len = axis === 'x' ? b.w : b.h;
  const hi = lo + len;
  if (len === 0) return [{ at: lo, role: 'edge' }];
  const mid: Feature = { at: lo + len / 2, role: 'mid' };
  if (pin === null) {
    return [{ at: lo, role: 'edge' }, mid, { at: hi, role: 'edge' }];
  }
  return [{ at: lo === pin ? hi : lo, role: 'edge' }, mid];
}

/**
 * The first grid point within `tol` of `q` that `ok` accepts, nearest first, or null.
 *
 * `snap(q)` goes first among equals, so the grid's own answer wins a tie.
 */
export function magnet(q: number, tol: number, ok: (g: number) => boolean): number | null {
  if (!Number.isFinite(q) || !Number.isFinite(tol) || tol < 0) return null;
  const g0 = snap(q);
  const out: number[] = [];
  for (let i = Math.ceil((q - tol) / GRID); i * GRID <= q + tol; i++) out.push(i * GRID);
  out.sort((a, b) => Math.abs(a - q) - Math.abs(b - q) || (a === g0 ? -1 : b === g0 ? 1 : a - b));
  for (const g of out) if (ok(g)) return g;
  return null;
}

function onStop(stops: AxisStops, b: Rect, axis: Axis, pin: number | null): boolean {
  return featuresOf(b, axis, pin).some((f) => stops[f.role].has(f.at));
}

/** A line to draw: vertical at x = `at` for axis `x`, spanning `from`..`to` across it. */
export interface Guide {
  readonly axis: Axis;
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/**
 * A guide for every feature of `b`, on the axes named, that lies exactly on a target of its
 * role. One per coordinate, spanning the targets on it and `b` itself.
 *
 * Read off real geometry, never off a candidate, so a guide is shown for exactly what lines up:
 * that includes plain grid snapping that happens to align, and excludes a snap the shape's own
 * rules then overrode.
 */
export function guidesFor(
  t: AlignTargets,
  b: Rect,
  axes: { readonly x: boolean; readonly y: boolean },
): Guide[] {
  const out: Guide[] = [];
  for (const axis of ['x', 'y'] as const) {
    if (!axes[axis]) continue;
    const from = axis === 'x' ? b.y : b.x;
    const to = from + (axis === 'x' ? b.h : b.w);
    const seen = new Set<number>();
    for (const f of featuresOf(b, axis, null)) {
      const s = t[axis][f.role].get(f.at);
      if (s === undefined || seen.has(f.at)) continue;
      seen.add(f.at);
      out.push({ axis, at: f.at, from: Math.min(s.from, from), to: Math.max(s.to, to) });
    }
  }
  return out;
}

export interface AlignRequest {
  readonly index: AlignIndex;
  /** The source's z-index, for `parentFor`'s ties: its own, or `shapes.length` if it is new. */
  readonly sourceIndex: number;
  /** The raw gesture coordinate: a move's delta, or a resize's or a create's pointer. */
  readonly q: Vec2;
  /** World units. */
  readonly tol: number;
  /** Which axes the gesture moves. */
  readonly axes: { readonly x: boolean; readonly y: boolean };
  /** The edge each axis holds still, or null when the whole shape moves on it. */
  readonly pins: { readonly x: number | null; readonly y: number | null };
  /** The source's real bounds for gesture coordinate `g`. */
  readonly geometryAt: (g: Vec2) => Rect;
}

export interface Aligned {
  /** The gesture coordinate to use: a grid point, aligned or not. */
  readonly at: Vec2;
  readonly guides: readonly Guide[];
}

/**
 * Where the gesture lands, and the guides that say what it lines up with.
 *
 * The parent is the one the source has at the grid-only position, and its children are the
 * targets. On each axis, the nearest grid point within `tol` whose real geometry puts a moving
 * feature on a target wins, as long as it keeps that parent; a snap that would carry the source
 * over a group border is refused, since its target would no longer be a sibling. Each axis is
 * found with the other held on the grid, so the pair is checked once more together, and if it
 * fails the nearer single-axis snap is kept. Otherwise the grid's answer stands.
 */
export function alignSnap(r: AlignRequest): Aligned {
  const grid = snapPoint(r.q);
  const parent = r.index.parentFor(r.geometryAt(grid), r.sourceIndex);
  const t = r.index.targetsOf(parent);
  if (t === NO_TARGETS) return { at: grid, guides: [] };

  const fits = (g: Vec2, axes: readonly Axis[]): boolean => {
    const b = r.geometryAt(g);
    return (
      axes.every((a) => onStop(t[a], b, a, r.pins[a])) &&
      r.index.parentFor(b, r.sourceIndex) === parent
    );
  };
  const gx = r.axes.x ? magnet(r.q.x, r.tol, (x) => fits({ x, y: grid.y }, ['x'])) : null;
  const gy = r.axes.y ? magnet(r.q.y, r.tol, (y) => fits({ x: grid.x, y }, ['y'])) : null;

  let at = grid;
  if (gx !== null && gy !== null && fits({ x: gx, y: gy }, ['x', 'y'])) {
    at = { x: gx, y: gy };
  } else if (gx !== null && (gy === null || Math.abs(gx - r.q.x) <= Math.abs(gy - r.q.y))) {
    at = { x: gx, y: grid.y };
  } else if (gy !== null) {
    at = { x: grid.x, y: gy };
  }
  return { at, guides: guidesFor(t, r.geometryAt(at), r.axes) };
}
