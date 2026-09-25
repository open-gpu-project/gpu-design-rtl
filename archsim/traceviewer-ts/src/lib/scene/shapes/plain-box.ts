import { normalizeRect, pointInRect, rectFromPoints, rectsIntersect } from '../../geom/math';
import type { Rect, Side, Vec2 } from '../../geom/types';
import { GRID } from '../../grid';
import type { PropSchema } from '../../props/spec';
import type { PlainBoxKind, PlainBoxShape, ShapeName, ShapeOps, ShapeTooltip } from '../shape';
import { boxAnchorAt, boxHandles, drawBoxBody, resizeBox, resolveBoxAnchor } from './box';
import { headingHit, headingTooltip } from './heading';
import { expandInterfaces } from './interfaces';

/**
 * The operations of a kind that is nothing but a headed box carrying interfaces: `rect` and
 * `fabric`, which differ only in which borders they offer and whether a port there takes links
 * on its inward edge.
 *
 * Not in `box.ts`, which would be the obvious home: this needs `expandInterfaces`, and
 * `interfaces.ts` reaches `box.ts` through `nif.ts` and `nif-geom.ts`, so the import would be a
 * cycle.
 */

/** Mid-drag a box may carry negative w/h (the user flipped it). Everything reads through this. */
function box(s: PlainBoxShape): Rect {
  return normalizeRect({ x: s.x, y: s.y, w: s.w, h: s.h });
}

/** A box from two corners, as the creation drag builds it. */
export function makePlainBox<K extends PlainBoxKind>(
  kind: K,
  a: Vec2,
  b: Vec2,
  name: ShapeName,
): PlainBoxShape<K> {
  const r = rectFromPoints(a, b);
  return {
    kind,
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

export interface PlainBoxKindSpec<K extends PlainBoxKind> {
  readonly kind: K;
  readonly props: PropSchema<PlainBoxShape<K>>;
  /** The borders interfaces may sit on. New ones are laid out along the first. */
  readonly sides: readonly Side[];
  /** Whether this kind's ports take links on their inward edge; see `interfaceInward`. */
  readonly inward: boolean;
}

export function plainBoxOps<K extends PlainBoxKind>(
  spec: PlainBoxKindSpec<K>,
): ShapeOps<PlainBoxShape<K>> {
  const { kind, sides } = spec;
  return {
    kind,
    props: spec.props,

    /** One grid cell at the origin. An import overwrites whatever it carries onto this. */
    blank: (name) => makePlainBox(kind, { x: 0, y: 0 }, { x: GRID, y: GRID }, name),

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

    translate: (s, d) => ({ ...s, x: s.x + d.x, y: s.y + d.y }),

    /** A sub-cell box would be invisible, unhittable and unresizable, so it is dropped. */
    normalize(s) {
      const r = box(s);
      if (r.w < GRID || r.h < GRID) return null;
      return { ...s, ...r };
    },

    draw: (s, dc, flags) => drawBoxBody(s, box(s), dc, flags),

    /** The whole perimeter: which borders carry interfaces does not restrict where wires land. */
    anchorAt: (s, p, hc) => boxAnchorAt(box(s), p, hc),

    resolveAnchor: (s, id) => resolveBoxAnchor(box(s), id),

    interfaceSides: () => sides,

    ...(spec.inward ? { interfaceInward: () => true } : {}),

    expand: (s, existing, mint) =>
      expandInterfaces(s.name, box(s), sides[0]!, s.interfaces, existing, mint),
  };
}
