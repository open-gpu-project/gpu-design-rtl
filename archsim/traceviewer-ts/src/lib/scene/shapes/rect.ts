import { normalizeRect, pointInRect, rectFromPoints, rectsIntersect } from '../../geom/math';
import type { Rect, Side, Vec2 } from '../../geom/types';
import { GRID } from '../../grid';
import { registerShape } from '../registry';
import type { RectShape, ShapeName, ShapeOps, ShapeTooltip } from '../shape';
import {
  boxAnchorAt,
  boxAnchors,
  boxHandles,
  drawBoxBody,
  resizeBox,
  resolveBoxAnchor,
} from './box';
import { headingHit, headingTooltip } from './heading';
import { expandInterfaces } from './interfaces';
import { rectProps } from './rect.props';

/**
 * A block offers all four borders to its interfaces, unlike a fabric.
 *
 * `'n'` first is what `expand` lays new ones out along -- see `spreadOffsets` for why every new
 * interface starts on one face rather than being distributed around the box.
 */
const RECT_SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/** Mid-drag a rect may carry negative w/h (the user flipped it). Everything reads through this. */
function box(s: RectShape): Rect {
  return normalizeRect({ x: s.x, y: s.y, w: s.w, h: s.h });
}

export function makeRect(a: Vec2, b: Vec2, name: ShapeName): RectShape {
  const r = rectFromPoints(a, b);
  return {
    kind: 'rect',
    name,
    label: '',
    subtitle: '',
    labelMode: 'inset',
    description: '',
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    interfaces: 0,
  };
}

export const rectOps: ShapeOps<RectShape> = {
  kind: 'rect',
  props: rectProps,

  /** One grid cell at the origin. An import overwrites whatever it carries onto this. */
  blank(name) {
    return {
      kind: 'rect',
      name,
      label: '',
      subtitle: '',
      labelMode: 'inset',
      description: '',
      x: 0,
      y: 0,
      w: GRID,
      h: GRID,
      interfaces: 0,
    };
  },

  bounds: box,

  /**
   * The body only, deliberately -- the tab is excluded for the same reason `bounds` excludes
   * it. The tab is screen-sized and this signature has no `worldPerPx` to size it with, so a
   * band's answer would otherwise depend on the zoom it was drawn at.
   */
  intersects: (s, r) => rectsIntersect(box(s), r),

  /** The body, or the tab above it. */
  hitTest: (s, p, hc) => pointInRect(p, box(s)) || headingHit(s, box(s), p, hc),

  tooltip: (s): ShapeTooltip => headingTooltip(s),

  handles: (s) => boxHandles(box(s)),

  resize: (s, handle, p, mods) => ({ ...s, ...resizeBox(s, handle, p, mods) }),

  translate(s, d) {
    return { ...s, x: s.x + d.x, y: s.y + d.y };
  },

  /** A sub-cell block would be invisible, unhittable and unresizable, so it is dropped. */
  normalize(s) {
    const r = box(s);
    if (r.w < GRID || r.h < GRID) return null;
    return { ...s, ...r };
  },

  draw: (s, dc, flags) => drawBoxBody(s, box(s), dc, flags),

  anchorAt: (s, p, hc) => boxAnchorAt(box(s), p, hc),

  resolveAnchor: (s, id) => resolveBoxAnchor(box(s), id),

  anchors: (s) => boxAnchors(box(s)),

  interfaceSides: () => RECT_SIDES,

  expand: (s, existing, mint) =>
    expandInterfaces(s.name, box(s), RECT_SIDES[0]!, s.interfaces, existing, mint),
};

registerShape(rectOps);
