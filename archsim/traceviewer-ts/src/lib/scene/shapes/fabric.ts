import { pointInRect, normalizeRect, rectFromPoints, rectsIntersect } from '../../geom/math';
import type { Rect, Side, Vec2 } from '../../geom/types';
import { GRID } from '../../grid';
import { registerShape } from '../registry';
import type { FabricShape, ShapeName, ShapeOps, ShapeTooltip } from '../shape';
import { boxAnchorAt, boxHandles, drawBoxBody, resizeBox, resolveBoxAnchor } from './box';
import { fabricProps } from './fabric.props';
import { headingHit, headingTooltip } from './heading';
import { expandInterfaces } from './interfaces';

/**
 * The two borders a fabric offers its interfaces.
 *
 * Top and bottom only, because a fabric is drawn BETWEEN the things it connects: a port on its
 * left or right edge sits where the neighbour's own ports are and reads as belonging to them.
 * The restriction is on interface placement, not on wires -- `anchorAt` below still takes a
 * connection anywhere on the perimeter.
 */
const FABRIC_SIDES: readonly Side[] = ['n', 's'];

function box(s: FabricShape): Rect {
  return normalizeRect({ x: s.x, y: s.y, w: s.w, h: s.h });
}

export function makeFabric(a: Vec2, b: Vec2, name: ShapeName): FabricShape {
  const r = rectFromPoints(a, b);
  return {
    kind: 'fabric',
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

export const fabricOps: ShapeOps<FabricShape> = {
  kind: 'fabric',
  props: fabricProps,

  blank(name) {
    return {
      kind: 'fabric',
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

  intersects: (s, r) => rectsIntersect(box(s), r),

  hitTest: (s, p, hc) => pointInRect(p, box(s)) || headingHit(s, box(s), p, hc),

  tooltip: (s): ShapeTooltip => headingTooltip(s),

  handles: (s) => boxHandles(box(s)),

  resize: (s, handle, p, mods) => ({ ...s, ...resizeBox(s, handle, p, mods) }),

  translate: (s, d) => ({ ...s, x: s.x + d.x, y: s.y + d.y }),

  normalize(s) {
    const r = box(s);
    if (r.w < GRID || r.h < GRID) return null;
    return { ...s, ...r };
  },

  draw: (s, dc, flags) => drawBoxBody(s, box(s), dc, flags),

  anchorAt: (s, p, hc) => boxAnchorAt(box(s), p, hc),

  resolveAnchor: (s, id) => resolveBoxAnchor(box(s), id),

  interfaceSides: () => FABRIC_SIDES,

  /**
   * A fabric's ports take links on their inward edge too.
   *
   * It is the one place an inward link means something: a crossbar's internal routing is a real
   * set of wires between its own ports, and drawing them is the whole reason the seam exists.
   * A plain block does not implement this -- a wire between two ports across the inside of a
   * block would be describing something the block has not said it has.
   */
  interfaceInward: () => true,

  expand: (s, existing, mint) =>
    expandInterfaces(s.name, box(s), FABRIC_SIDES[0]!, s.interfaces, existing, mint),
};

registerShape(fabricOps);
