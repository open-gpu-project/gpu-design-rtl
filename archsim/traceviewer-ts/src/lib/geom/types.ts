/** A point or offset. All coordinates in this app are plain numbers; units are per-call. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle. After `normalizeRect` the invariant `w >= 0 && h >= 0` holds. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Modifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
}

/**
 * A face of an axis-aligned box, named by compass point.
 *
 * Here rather than in `shapes/box.ts` because `ShapeOps` has a seam that returns a set of them
 * (`interfaceSides`), and a type in the shape contract should not have to reach into one kind's
 * implementation file to be named.
 */
export type Side = 'n' | 'e' | 's' | 'w';

/**
 * An attachment point a connection can terminate on. Unused this revision; the type exists so
 * `ShapeOps.anchors` has something to return when connections land.
 */
export interface Anchor {
  readonly id: string;
  /** World coordinates. */
  readonly pos: Vec2;
  /** Unit vector pointing away from the shape, for connection stub direction. */
  readonly normal: Vec2;
}
