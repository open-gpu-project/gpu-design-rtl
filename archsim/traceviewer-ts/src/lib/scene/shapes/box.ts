import { alignStroke } from '../../canvas/pixel';
import { ANCHOR_BAND_PX, ANCHOR_HIT_PX } from '../../canvas/theme';
import { clampNum, expandRect, pointInRect } from '../../geom/math';
import type { Anchor, Modifiers, Rect, Vec2 } from '../../geom/types';
import { snap } from '../../grid';
import type { DrawContext, Handle, HandleId, HitContext, RenderFlags } from '../shape';
import type { Headed } from '../shape';
import { drawHeading, type DeviceBox } from './heading';

/**
 * Everything an axis-aligned box kind shares: its handles, its resize arithmetic, its perimeter
 * anchors and the fill-plus-outline half of its `draw`.
 *
 * Extracted from `rect` in iteration 6 for `fifo` and `fabric`. Every function takes a `Rect`
 * rather than a shape, because the three kinds disagree about where that rectangle comes from --
 * a block stores it, a FIFO derives its flow axis from its cell count -- and the moment one of
 * them read `s.w` directly the shared code would be wrong for the others.
 */

export type Side = 'n' | 'e' | 's' | 'w';

export const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

export const NORMALS: Readonly<Record<Side, Vec2>> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/** Length of a face, and the corner its offset is measured from (left for n/s, top for e/w). */
export function faceLength(r: Rect, side: Side): number {
  return side === 'n' || side === 's' ? r.w : r.h;
}

/**
 * An anchor at `off` world units along `side`.
 *
 * `id` carries the offset as authored, not as clamped, so shrinking a box below an anchor and
 * growing it back puts the connection where the user left it rather than where the small
 * version of the box happened to end.
 */
export function makeBoxAnchor(r: Rect, side: Side, off: number, authored = off): Anchor {
  const len = faceLength(r, side);
  const t = clampNum(off, 0, len);
  const pos =
    side === 'n'
      ? { x: r.x + t, y: r.y }
      : side === 's'
        ? { x: r.x + t, y: r.y + r.h }
        : side === 'e'
          ? { x: r.x + r.w, y: r.y + t }
          : { x: r.x, y: r.y + t };
  return { id: `${side}:${authored}`, pos, normal: NORMALS[side] };
}

export const ANCHOR_ID = /^([nesw])(?::(-?\d+))?$/;

/**
 * Nearest perimeter point, grid-snapped along the face.
 *
 * Within `ANCHOR_BAND_PX` of the outline the offset tracks the cursor, which is what puts the
 * anchor exactly where the user pointed. Deeper inside the box the nearest face is both
 * ambiguous and jumpy -- a pixel of drift flips the dot to another side -- so the offset
 * collapses to the face midpoint and "click the middle of the target" becomes a stable
 * gesture instead of a lottery.
 *
 * `allowed` narrows which faces may be returned, for a kind whose perimeter is not all equal.
 */
export function boxAnchorAt(
  r: Rect,
  p: Vec2,
  hc: HitContext,
  allowed: readonly Side[] = SIDES,
): Anchor | null {
  const tol = ANCHOR_HIT_PX * hc.worldPerPx;
  if (!pointInRect(p, expandRect(r, tol))) return null;

  // Ties resolve in n, e, s, w order, so the id is a deterministic function of the point.
  const dist: Readonly<Record<Side, number>> = {
    n: Math.abs(p.y - r.y),
    e: Math.abs(p.x - (r.x + r.w)),
    s: Math.abs(p.y - (r.y + r.h)),
    w: Math.abs(p.x - r.x),
  };
  let side: Side | null = null;
  for (const c of SIDES) {
    if (!allowed.includes(c)) continue;
    if (side === null || dist[c] < dist[side]) side = c;
  }
  if (side === null) return null;

  const band = ANCHOR_BAND_PX * hc.worldPerPx;
  const inner = { x: r.x + band, y: r.y + band, w: r.w - 2 * band, h: r.h - 2 * band };
  const deep = inner.w > 0 && inner.h > 0 && pointInRect(p, inner);

  const len = faceLength(r, side);
  if (deep) return makeBoxAnchor(r, side, Math.round(len / 2));
  const along = side === 'n' || side === 's' ? p.x - r.x : p.y - r.y;
  const off = clampNum(snap(along), 0, len);
  return makeBoxAnchor(r, side, off);
}

/** `'e'` (the face midpoint) or `'e:48'` (offset from the face's start corner). */
export function resolveBoxAnchor(r: Rect, id: string): Anchor | null {
  const m = ANCHOR_ID.exec(id);
  if (m === null) return null;
  const side = m[1] as Side;
  if (m[2] === undefined) {
    const mid = Math.round(faceLength(r, side) / 2);
    return { ...makeBoxAnchor(r, side, mid), id: side };
  }
  return makeBoxAnchor(r, side, Number(m[2]));
}

/** Edge midpoints. The discrete siblings of `boxAnchorAt`. */
export function boxAnchors(r: Rect): readonly Anchor[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return [
    { id: 'n', pos: { x: cx, y: r.y }, normal: NORMALS.n },
    { id: 'e', pos: { x: r.x + r.w, y: cy }, normal: NORMALS.e },
    { id: 's', pos: { x: cx, y: r.y + r.h }, normal: NORMALS.s },
    { id: 'w', pos: { x: r.x, y: cy }, normal: NORMALS.w },
  ];
}

/**
 * Four visible corner knobs, then four invisible edge grab zones.
 *
 * Corners first so they win wherever they overlap an edge. `hitTest` returns on first match,
 * so this ordering is the whole mechanism -- do not sort the result.
 *
 * `axes` drops the handles for an axis that cannot move. A kind whose width is derived rather
 * than authored passes `'y'`, and gets two knobs on the faces it can actually resize: offering
 * a handle that refuses to do anything is worse than offering none.
 */
export function boxHandles(r: Rect, axes: 'both' | 'x' | 'y' = 'both'): readonly Handle[] {
  const x2 = r.x + r.w;
  const y2 = r.y + r.h;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;

  if (axes === 'y') {
    return [
      { id: 'n', geom: 'point', pos: { x: cx, y: r.y }, cursor: 'ns-resize', visible: true },
      { id: 's', geom: 'point', pos: { x: cx, y: y2 }, cursor: 'ns-resize', visible: true },
    ];
  }
  if (axes === 'x') {
    return [
      { id: 'w', geom: 'point', pos: { x: r.x, y: cy }, cursor: 'ew-resize', visible: true },
      { id: 'e', geom: 'point', pos: { x: x2, y: cy }, cursor: 'ew-resize', visible: true },
    ];
  }

  return [
    { id: 'nw', geom: 'point', pos: { x: r.x, y: r.y }, cursor: 'nwse-resize', visible: true },
    { id: 'ne', geom: 'point', pos: { x: x2, y: r.y }, cursor: 'nesw-resize', visible: true },
    { id: 'se', geom: 'point', pos: { x: x2, y: y2 }, cursor: 'nwse-resize', visible: true },
    { id: 'sw', geom: 'point', pos: { x: r.x, y: y2 }, cursor: 'nesw-resize', visible: true },
    // Edges are invisible grab zones running the length of each side.
    {
      id: 'n',
      geom: 'segment',
      pos: { x: r.x, y: r.y },
      end: { x: x2, y: r.y },
      cursor: 'ns-resize',
      visible: false,
    },
    {
      id: 'e',
      geom: 'segment',
      pos: { x: x2, y: r.y },
      end: { x: x2, y: y2 },
      cursor: 'ew-resize',
      visible: false,
    },
    {
      id: 's',
      geom: 'segment',
      pos: { x: r.x, y: y2 },
      end: { x: x2, y: y2 },
      cursor: 'ns-resize',
      visible: false,
    },
    {
      id: 'w',
      geom: 'segment',
      pos: { x: r.x, y: r.y },
      end: { x: r.x, y: y2 },
      cursor: 'ew-resize',
      visible: false,
    },
  ];
}

/**
 * Only the dragged edges move; the opposite ones stay pinned. Flipping past the far edge is
 * allowed and produces negative w/h, which the kind's `normalize` folds back on commit --
 * clamping here instead would make the box stick to the cursor.
 */
export function resizeBox(r: Rect, handle: HandleId, p: Vec2, mods: Modifiers): Rect {
  const h = String(handle);
  const movesN = h.includes('n');
  const movesS = h.includes('s');
  const movesW = h.includes('w');
  const movesE = h.includes('e');

  const ox1 = r.x;
  const oy1 = r.y;
  const ox2 = r.x + r.w;
  const oy2 = r.y + r.h;

  let px = p.x;
  let py = p.y;

  if (mods.shift && (movesN || movesS) && (movesE || movesW)) {
    // Square aspect about the pinned corner. Both deltas are grid multiples already, so the
    // larger of the two is too, and the result stays on the grid.
    const ax = movesW ? ox2 : ox1;
    const ay = movesN ? oy2 : oy1;
    const dx = px - ax;
    const dy = py - ay;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    px = ax + (dx < 0 ? -m : m);
    py = ay + (dy < 0 ? -m : m);
  }

  const x1 = movesW ? px : ox1;
  const y1 = movesN ? py : oy1;
  const x2 = movesE ? px : ox2;
  const y2 = movesS ? py : oy2;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Fill, outline and heading -- the whole of a plain box kind's `draw`.
 *
 * `inner` is called in DEVICE space, after the outline and before the heading, for a kind that
 * paints something inside the body: a FIFO's cell dividers. Running it in that order is what
 * lets the heading's plate occlude those dividers rather than the other way round.
 *
 * The outline goes in device space because a world-space hairline lands on fractional pixels at
 * most zooms and reads as a grey smudge next to the crisp grid.
 */
export function drawBoxBody(
  s: Headed,
  body: Rect,
  dc: DrawContext,
  flags: RenderFlags,
  inner?: (d: DeviceBox) => void,
  plate = false,
): void {
  const { ctx, theme } = dc;

  ctx.fillStyle = flags.ghost ? theme.ghostFill : theme.shapeFill;
  ctx.fillRect(body.x, body.y, body.w, body.h);

  const restore = dc.toDeviceSpace();
  const a = dc.project({ x: body.x, y: body.y });
  const b = dc.project({ x: body.x + body.w, y: body.y + body.h });
  const wDev = Math.max(1, Math.round((flags.selected ? 2 : 1) * dc.dpr));
  const d: DeviceBox = {
    x0: alignStroke(a.x * dc.dpr, wDev),
    y0: alignStroke(a.y * dc.dpr, wDev),
    x1: alignStroke(b.x * dc.dpr, wDev),
    y1: alignStroke(b.y * dc.dpr, wDev),
    boxW: (b.x - a.x) * dc.dpr,
    boxH: (b.y - a.y) * dc.dpr,
  };

  ctx.lineWidth = wDev;
  ctx.strokeStyle = flags.ghost
    ? theme.ghostStroke
    : flags.selected
      ? theme.shapeStrokeSelected
      : theme.shapeStroke;
  if (flags.ghost) ctx.setLineDash([4 * dc.dpr, 4 * dc.dpr]);
  ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
  ctx.setLineDash([]);

  if (!flags.ghost) {
    inner?.(d);
    drawHeading(s, body, dc, d, flags.selected, plate);
  }
  restore();
}
