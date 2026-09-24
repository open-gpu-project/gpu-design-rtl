import { alignStroke } from '../../canvas/pixel';
import { normalizeRect, pointInRect, rectFromPoints, rectsIntersect } from '../../geom/math';
import type { Rect, Vec2 } from '../../geom/types';
import { GRID } from '../../grid';
import { registerShape } from '../registry';
import type { DrawContext, FifoShape, ShapeName, ShapeOps, ShapeTooltip } from '../shape';
import {
  boxAnchorAt,
  boxAnchors,
  boxHandles,
  drawBoxBody,
  resizeBox,
  resolveBoxAnchor,
} from './box';
import { dividers, fifoBox, flowIsFree, minFlow } from './fifo-geom';
import { fifoProps } from './fifo.props';
import { headingHit, headingTooltip, type DeviceBox } from './heading';

export function makeFifo(a: Vec2, b: Vec2, name: ShapeName): FifoShape {
  const r = rectFromPoints(a, b);
  return {
    kind: 'fifo',
    name,
    label: '',
    subtitle: '',
    labelMode: 'inset',
    description: '',
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    orientation: r.w >= r.h ? 'horizontal' : 'vertical',
    cells: 4,
    spacing: GRID * 2,
  };
}

/** Paint the dividers, in device space, between the outline and the heading. */
function drawDividers(s: FifoShape, body: Rect, dc: DrawContext, d: DeviceBox): void {
  const { ctx, dpr, theme } = dc;
  const horizontal = s.orientation === 'horizontal';
  const wDev = Math.max(1, Math.round(dpr));

  ctx.lineWidth = wDev;
  ctx.strokeStyle = theme.fifoDivider;

  // Two passes so the dashed borders and the solid interior each cost one path, and so the dash
  // pattern is set twice per FIFO rather than once per divider.
  for (const dashed of [false, true]) {
    const set = dividers(s).filter((v) => v.gap === dashed);
    if (set.length === 0) continue;
    ctx.setLineDash(dashed ? [3 * dpr, 3 * dpr] : []);
    ctx.beginPath();
    for (const v of set) {
      const p = dc.project(
        horizontal ? { x: body.x + v.at, y: body.y } : { x: body.x, y: body.y + v.at },
      );
      if (horizontal) {
        const x = alignStroke(p.x * dpr, wDev);
        ctx.moveTo(x, d.y0);
        ctx.lineTo(x, d.y1);
      } else {
        const y = alignStroke(p.y * dpr, wDev);
        ctx.moveTo(d.x0, y);
        ctx.lineTo(d.x1, y);
      }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

export const fifoOps: ShapeOps<FifoShape> = {
  kind: 'fifo',
  props: fifoProps,

  blank(name) {
    return {
      kind: 'fifo',
      name,
      label: '',
      subtitle: '',
      labelMode: 'inset',
      description: '',
      x: 0,
      y: 0,
      w: GRID,
      h: GRID,
      orientation: 'horizontal',
      cells: 4,
      spacing: GRID * 2,
    };
  },

  bounds: fifoBox,

  intersects: (s, r) => rectsIntersect(fifoBox(s), r),

  hitTest: (s, p, hc) => pointInRect(p, fifoBox(s)) || headingHit(s, fifoBox(s), p, hc),

  tooltip: (s): ShapeTooltip => headingTooltip(s),

  /**
   * Handles on the free axis only.
   *
   * A bounded queue's length is `cells * spacing`, so a knob on the flow axis would be an
   * affordance that refuses to do anything -- worse than no knob, because the user has to drag
   * it to find out. An unbounded queue gets the full set, and dragging its flow axis resizes the
   * gap, since that is the only part of it that is not fixed by `spacing`.
   */
  handles: (s) =>
    flowIsFree(s)
      ? boxHandles(fifoBox(s))
      : boxHandles(fifoBox(s), s.orientation === 'horizontal' ? 'y' : 'x'),

  /**
   * Resize, with the unbounded queue's minimum length enforced about the edge the drag PINNED.
   *
   * The floor cannot live in `fifoBox`, which sees only an origin and an extent and so can only
   * grow the box in one direction. Dragging the west handle of a 200-long queue rightward past
   * the floor then moved the east edge out with it -- the gesture was shrinking the box and the
   * pinned edge grew away from the cursor. Only `resize` knows which handle moved, so only
   * `resize` can hold the other edge still.
   */
  resize(s, handle, p, mods) {
    const raw = resizeBox(fifoBox(s), handle, p, mods);
    if (!flowIsFree(s)) return { ...s, ...raw };

    const horizontal = s.orientation === 'horizontal';
    const r = normalizeRect(raw);
    const min = minFlow(s);
    const len = horizontal ? r.w : r.h;
    if (len >= min) return { ...s, ...r };

    /*
      Which edge is pinned. The handle names the edge that MOVED -- but a drag that flipped past
      the far edge swaps the two round, because `normalizeRect` has already re-labelled the
      cursor's side as the low edge. Hence the XOR against the flip.
    */
    const h = String(handle);
    const flipped = horizontal ? raw.w < 0 : raw.h < 0;
    const movedLow = (horizontal ? h.includes('w') : h.includes('n')) !== flipped;

    if (horizontal) {
      const x = movedLow ? r.x + r.w - min : r.x;
      return { ...s, x, y: r.y, w: min, h: r.h };
    }
    const y = movedLow ? r.y + r.h - min : r.y;
    return { ...s, x: r.x, y, w: r.w, h: min };
  },

  translate: (s, d) => ({ ...s, x: s.x + d.x, y: s.y + d.y }),

  /**
   * Fold the derived flow extent back into the stored fields, and drop a queue too thin to see.
   *
   * Only the CROSS axis is checked against the grid: the flow axis is `cells * spacing` and both
   * of those have their own floors, so a queue cannot be short along its length without already
   * having been refused by one of those writers.
   */
  normalize(s) {
    const r = fifoBox(s);
    const cross = s.orientation === 'horizontal' ? r.h : r.w;
    if (cross < GRID) return null;
    return { ...s, x: r.x, y: r.y, w: r.w, h: r.h };
  },

  draw(s, dc, flags) {
    const body = fifoBox(s);
    drawBoxBody(s, body, dc, flags, (d) => drawDividers(s, body, dc, d), true);
  },

  anchorAt: (s, p, hc) => boxAnchorAt(fifoBox(s), p, hc),

  resolveAnchor: (s, id) => resolveBoxAnchor(fifoBox(s), id),

  anchors: (s) => boxAnchors(fifoBox(s)),
};

registerShape(fifoOps);
