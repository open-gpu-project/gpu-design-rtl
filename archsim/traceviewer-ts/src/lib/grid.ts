import type { Vec2 } from './geom/types';

/** World units between minor grid dots. Also the snap step for every edit in this revision. */
export const GRID = 16;

/** Every Nth dot on both axes is a major dot. Also the level-of-detail ratio when zooming out. */
export const MAJOR_EVERY = 5;

/**
 * Quantum the world bounding box snaps to. A multiple of both GRID and GRID*MAJOR_EVERY, so the
 * world only ever grows in chunks large enough that a one-cell nudge usually changes nothing.
 */
export const Q = GRID * MAJOR_EVERY * 2;

/** Empty world kept around the content on every side. */
export const BUFFER = 1024;

/** Floor on the world size, so an empty scene still has somewhere to pan. */
export const MIN_WORLD_W = 2048;
export const MIN_WORLD_H = 1536;

/**
 * Snap to the nearest multiple of `step`.
 *
 * `step` is a parameter rather than a read of GRID because per-axis snapping is coming: a
 * connection may want to snap along its own routing grid, not a uniform square one.
 */
export function snap(v: number, step: number = GRID): number {
  return Math.round(v / step) * step;
}

export function snapPoint(p: Vec2, step: number = GRID): Vec2 {
  return { x: snap(p.x, step), y: snap(p.y, step) };
}
