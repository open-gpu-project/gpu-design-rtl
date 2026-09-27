import type { Vec2 } from './geom/types';

/** World units between minor grid dots. Also the snap step for every edit in this revision. */
export const GRID = 16;

/**
 * Every Nth dot on both axes is a major dot. Also the level-of-detail ratio when zooming out.
 *
 * Counted in minor *steps*, so this is one more than the number of minor dots you see between
 * two majors: 6 steps puts 5 minor dots in the gap. Independent of `GRID`, which is the snap
 * step and does not move when this does.
 */
export const MAJOR_EVERY = 6;

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
 * How bright the grid dots are: the one dial for the grid's contrast.
 *
 * It scales how far each dot colour sits from the canvas background, channel by channel. At 1
 * the dots are the original faint slate, at 2 they stand twice as far from the background, and
 * at 0 the grid disappears. Both tiers scale together, so a major dot stays brighter than a
 * minor one. The major dots reach white in their blue channel first, at about 3.4, and anything
 * past that only flattens them towards grey. The colours are worked out in `canvas/theme.ts`.
 */
export const GRID_DOT_BRIGHTNESS = 2;

/** Snap to the nearest grid point. */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export function snapPoint(p: Vec2): Vec2 {
  return { x: snap(p.x), y: snap(p.y) };
}
