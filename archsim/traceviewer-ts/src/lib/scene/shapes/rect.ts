import { alignStroke } from '../../canvas/pixel';
import { ANCHOR_BAND_PX, ANCHOR_HIT_PX, LABEL_MIN_PX } from '../../canvas/theme';
import { clampNum, expandRect, normalizeRect, pointInRect, rectFromPoints } from '../../geom/math';
import type { Anchor, Rect, Vec2 } from '../../geom/types';
import { GRID, snap } from '../../grid';
import { registerShape } from '../registry';
import type { RectShape, ShapeName, ShapeOps } from '../shape';
import { rectProps } from './rect.props';

type Side = 'n' | 'e' | 's' | 'w';

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

const NORMALS: Readonly<Record<Side, Vec2>> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/** Length of a face, and the corner its offset is measured from (left for n/s, top for e/w). */
function faceLength(r: Rect, side: Side): number {
  return side === 'n' || side === 's' ? r.w : r.h;
}

/**
 * An anchor at `off` world units along `side`.
 *
 * `id` carries the offset as authored, not as clamped, so shrinking a block below an anchor and
 * growing it back puts the connection where the user left it rather than where the small
 * version of the block happened to end.
 */
function makeRectAnchor(r: Rect, side: Side, off: number, authored = off): Anchor {
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

const ANCHOR_ID = /^([nesw])(?::(-?\d+))?$/;

/** Mid-drag a rect may carry negative w/h (the user flipped it). Everything reads through this. */
function box(s: RectShape): Rect {
  return normalizeRect({ x: s.x, y: s.y, w: s.w, h: s.h });
}

export function makeRect(a: Vec2, b: Vec2, name: ShapeName): RectShape {
  const r = rectFromPoints(a, b);
  return { kind: 'rect', name, label: '', description: '', x: r.x, y: r.y, w: r.w, h: r.h };
}

export const rectOps: ShapeOps<RectShape> = {
  kind: 'rect',
  props: rectProps,

  /** One grid cell at the origin. An import overwrites whatever it carries onto this. */
  blank(name) {
    return { kind: 'rect', name, label: '', description: '', x: 0, y: 0, w: GRID, h: GRID };
  },

  bounds: box,

  hitTest(s, p, _hc) {
    return pointInRect(p, box(s));
  },

  // Corners first so they win wherever they overlap an edge. `hitTest` returns on first match,
  // so this ordering is the whole mechanism -- do not sort this array.
  handles(s) {
    const r = box(s);
    const x2 = r.x + r.w;
    const y2 = r.y + r.h;
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
  },

  /**
   * Only the dragged edges move; the opposite ones stay pinned. Flipping past the far edge is
   * allowed and produces negative w/h, which `normalize` folds back on commit -- clamping here
   * instead would make the rect stick to the cursor.
   */
  resize(s, handle, p, mods) {
    const h = String(handle);
    const movesN = h.includes('n');
    const movesS = h.includes('s');
    const movesW = h.includes('w');
    const movesE = h.includes('e');

    const ox1 = s.x;
    const oy1 = s.y;
    const ox2 = s.x + s.w;
    const oy2 = s.y + s.h;

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
    return { ...s, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  },

  translate(s, d) {
    return { ...s, x: s.x + d.x, y: s.y + d.y };
  },

  /** A sub-cell block would be invisible, unhittable and unresizable, so it is dropped. */
  normalize(s) {
    const r = box(s);
    if (r.w < GRID || r.h < GRID) return null;
    return { ...s, ...r };
  },

  draw(s, dc, flags) {
    const { ctx, theme } = dc;
    const r = box(s);

    ctx.fillStyle = flags.ghost ? theme.ghostFill : theme.shapeFill;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Outline in device space: a world-space hairline lands on fractional pixels at most zooms
    // and reads as a grey smudge next to the crisp grid.
    const restore = dc.toDeviceSpace();
    const a = dc.project({ x: r.x, y: r.y });
    const b = dc.project({ x: r.x + r.w, y: r.y + r.h });
    const wDev = Math.max(1, Math.round((flags.selected ? 2 : 1) * dc.dpr));
    const x0 = alignStroke(a.x * dc.dpr, wDev);
    const y0 = alignStroke(a.y * dc.dpr, wDev);
    const x1 = alignStroke(b.x * dc.dpr, wDev);
    const y1 = alignStroke(b.y * dc.dpr, wDev);

    ctx.lineWidth = wDev;
    ctx.strokeStyle = flags.ghost
      ? theme.ghostStroke
      : flags.selected
        ? theme.shapeStrokeSelected
        : theme.shapeStroke;
    if (flags.ghost) ctx.setLineDash([4 * dc.dpr, 4 * dc.dpr]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);

    if (!flags.ghost && x1 - x0 >= LABEL_MIN_PX * dc.dpr && y1 - y0 >= LABEL_MIN_PX * dc.dpr) {
      ctx.fillStyle = theme.shapeLabel;
      ctx.font = `${Math.round(12 * dc.dpr)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // The label is what the diagram is *about*; the name is the identifier behind it.
      const text = s.label !== '' ? s.label : s.name;
      ctx.fillText(text, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 - 8 * dc.dpr);
    }
    restore();
  },

  /**
   * Nearest perimeter point, grid-snapped along the face.
   *
   * Within `ANCHOR_BAND_PX` of the outline the offset tracks the cursor, which is what puts the
   * anchor exactly where the user pointed. Deeper inside the block the nearest face is both
   * ambiguous and jumpy -- a pixel of drift flips the dot to another side -- so the offset
   * collapses to the face midpoint and "click the middle of the target" becomes a stable
   * gesture instead of a lottery.
   */
  anchorAt(s, p, hc): Anchor | null {
    const r = box(s);
    const tol = ANCHOR_HIT_PX * hc.worldPerPx;
    if (!pointInRect(p, expandRect(r, tol))) return null;

    // Ties resolve in n, e, s, w order, so the id is a deterministic function of the point.
    const d: readonly number[] = [
      Math.abs(p.y - r.y),
      Math.abs(p.x - (r.x + r.w)),
      Math.abs(p.y - (r.y + r.h)),
      Math.abs(p.x - r.x),
    ];
    let best = 0;
    for (let i = 1; i < d.length; i++) {
      if (d[i]! < d[best]!) best = i;
    }
    const side = SIDES[best]!;

    const band = ANCHOR_BAND_PX * hc.worldPerPx;
    const inner = { x: r.x + band, y: r.y + band, w: r.w - 2 * band, h: r.h - 2 * band };
    const deep = inner.w > 0 && inner.h > 0 && pointInRect(p, inner);

    const len = faceLength(r, side);
    if (deep) return makeRectAnchor(r, side, Math.round(len / 2));
    const along = side === 'n' || side === 's' ? p.x - r.x : p.y - r.y;
    const off = clampNum(snap(along), 0, len);
    return makeRectAnchor(r, side, off);
  },

  /** `'e'` (the face midpoint) or `'e:48'` (offset from the face's start corner). */
  resolveAnchor(s, id): Anchor | null {
    const m = ANCHOR_ID.exec(id);
    if (m === null) return null;
    const r = box(s);
    const side = m[1] as Side;
    if (m[2] === undefined) {
      const mid = Math.round(faceLength(r, side) / 2);
      const a = makeRectAnchor(r, side, mid);
      return { ...a, id: side };
    }
    const off = Number(m[2]);
    return makeRectAnchor(r, side, off);
  },

  /** Edge midpoints. The discrete siblings of `anchorAt`; nothing consumes them yet. */
  anchors(s): readonly Anchor[] {
    const r = box(s);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return [
      { id: 'n', pos: { x: cx, y: r.y }, normal: { x: 0, y: -1 } },
      { id: 'e', pos: { x: r.x + r.w, y: cy }, normal: { x: 1, y: 0 } },
      { id: 's', pos: { x: cx, y: r.y + r.h }, normal: { x: 0, y: 1 } },
      { id: 'w', pos: { x: r.x, y: cy }, normal: { x: -1, y: 0 } },
    ];
  },
};

registerShape(rectOps);
