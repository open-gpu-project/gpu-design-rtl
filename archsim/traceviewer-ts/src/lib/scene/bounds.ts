import { rectContains, unionRect } from '../geom/math';
import type { Rect } from '../geom/types';
import { BUFFER, MIN_WORLD_H, MIN_WORLD_W, Q } from '../grid';
import { opsFor } from './registry';
import type { Shape } from './shape';

export function unionBounds(shapes: readonly Shape[]): Rect | null {
  let acc: Rect | null = null;
  for (const s of shapes) {
    const b = opsFor(s).bounds(s);
    acc = acc === null ? b : unionRect(acc, b);
  }
  return acc;
}

/**
 * Every shape the marquee's band catches, in z-order: the ones lying WHOLLY inside it.
 *
 * Containment, not overlap, so a band swept inside a group takes the children and never the
 * block around them, which it crosses on every side. A connection's `bounds` is taken from its
 * drawn route, so for a wire containment means all of its ink is inside; a band across one run of
 * an L-shaped wire does not take it. The tab above a tabbed block is outside `bounds`, and a band
 * need not cover it.
 */
export function shapesInRect(shapes: readonly Shape[], r: Rect): Shape[] {
  return shapes.filter((s) => rectContains(r, opsFor(s).bounds(s)));
}

/**
 * The pannable world: the content bounding box grown by BUFFER on every side, then quantized to
 * Q. Quantizing is what stops the world twitching every time a block moves one cell.
 *
 * Minimums are satisfied by growing the max side only, so the origin stays put -- and the world
 * is deliberately independent of zoom, so zooming never churns it.
 */
export function computeWorldBounds(content: Rect | null): Rect {
  if (content === null) return { x: 0, y: 0, w: MIN_WORLD_W, h: MIN_WORLD_H };

  const minX = Math.floor((content.x - BUFFER) / Q) * Q;
  const minY = Math.floor((content.y - BUFFER) / Q) * Q;
  const maxX = Math.max(Math.ceil((content.x + content.w + BUFFER) / Q) * Q, minX + MIN_WORLD_W);
  const maxY = Math.max(Math.ceil((content.y + content.h + BUFFER) / Q) * Q, minY + MIN_WORLD_H);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
