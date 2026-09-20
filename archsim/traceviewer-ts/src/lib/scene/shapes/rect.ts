import { alignStroke } from '../../canvas/pixel';
import { LABEL_MIN_PX } from '../../canvas/theme';
import { normalizeRect, pointInRect, rectFromPoints } from '../../geom/math';
import type { Anchor, Rect, Vec2 } from '../../geom/types';
import { GRID } from '../../grid';
import { registerShape } from '../registry';
import type { RectShape, SerializedShape, ShapeOps } from '../shape';

/** Mid-drag a rect may carry negative w/h (the user flipped it). Everything reads through this. */
function box(s: RectShape): Rect {
  return normalizeRect({ x: s.x, y: s.y, w: s.w, h: s.h });
}

export function makeRect(a: Vec2, b: Vec2, name: string): RectShape {
  const r = rectFromPoints(a, b);
  return { id: crypto.randomUUID(), kind: 'rect', name, x: r.x, y: r.y, w: r.w, h: r.h };
}

export const rectOps: ShapeOps<RectShape> = {
  kind: 'rect',

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
      ctx.fillText(s.name, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 - 8 * dc.dpr);
    }
    restore();
  },

  /** Edge midpoints. Unused until connections land, but cheap to keep honest. */
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

  serialize(s): SerializedShape {
    return { id: s.id, kind: 'rect', name: s.name, x: s.x, y: s.y, w: s.w, h: s.h };
  },

  deserialize(data): RectShape {
    return {
      id: typeof data['id'] === 'string' ? data['id'] : crypto.randomUUID(),
      kind: 'rect',
      name: typeof data['name'] === 'string' ? data['name'] : 'Block',
      x: Number(data['x']) || 0,
      y: Number(data['y']) || 0,
      w: Number(data['w']) || 0,
      h: Number(data['h']) || 0,
    };
  },
};

registerShape(rectOps);
