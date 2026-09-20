import type { Theme } from '../canvas/theme';
import type { Anchor, Modifiers, Rect, Vec2 } from '../geom/types';

export type ShapeId = string;

export interface ShapeBase {
  readonly id: ShapeId;
  readonly kind: string;
  /** The diagram is of named hardware entities; a future layers panel and inspector show this. */
  readonly name: string;
}

/** A block in the architecture diagram. The only entity kind so far. */
export interface RectShape extends ShapeBase {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Widen as kinds are added: `| ConnectionShape | PortShape | LabelShape`. */
export type Shape = RectShape;

/** The eight box handles, plus room for kind-specific ids like a connection's `p0`/`p1`. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | (string & {});

interface HandleCommon {
  readonly id: HandleId;
  /** World coordinates. The hit radius is applied by the caller, in screen pixels. */
  readonly pos: Vec2;
  /** CSS cursor while hovering or dragging this handle. */
  readonly cursor: string;
  /** Whether to draw a visible knob. False means an invisible grab affordance. */
  readonly visible: boolean;
}

/** Hit-tested as a disc around `pos`. */
export interface PointHandle extends HandleCommon {
  readonly geom: 'point';
}

/** Hit-tested as the segment `pos` -> `end`. */
export interface SegmentHandle extends HandleCommon {
  readonly geom: 'segment';
  readonly end: Vec2;
}

export type Handle = PointHandle | SegmentHandle;

export interface HitContext {
  /** World units per screen CSS pixel (= 1 / zoom). Multiply screen-px tolerances by this. */
  readonly worldPerPx: number;
}

export interface DrawContext {
  /** Already in world space when handed to `ShapeOps.draw`. */
  readonly ctx: CanvasRenderingContext2D;
  readonly worldPerPx: number;
  readonly dpr: number;
  /** Visible world rectangle, for culling. */
  readonly viewport: Rect;
  readonly theme: Theme;
  /** Switch `ctx` to CSS-pixel space. Call the returned function to restore world space. */
  toScreenSpace(): () => void;
  /** Switch `ctx` to raw device-pixel space, for crisp hairlines. Returns a restore function. */
  toDeviceSpace(): () => void;
  /** Project a world point to CSS pixels. */
  project(p: Vec2): Vec2;
}

export interface RenderFlags {
  readonly selected: boolean;
  /** An uncommitted preview: draw it dashed and faint. */
  readonly ghost: boolean;
}

export interface SerializedShape {
  readonly id: ShapeId;
  readonly kind: string;
  readonly [key: string]: unknown;
}

/**
 * Per-kind operations. Every method is pure: it must not mutate `s`, leave canvas state behind,
 * or read anything global. That is what makes undo a matter of swapping array references.
 */
export interface ShapeOps<S extends ShapeBase = Shape> {
  readonly kind: S['kind'];

  /** Geometric bounds in world units, excluding stroke width. */
  bounds(s: S): Rect;

  draw(s: S, dc: DrawContext, flags: RenderFlags): void;

  /** Body hit test. Derive tolerances from `hc.worldPerPx` so they stay screen-constant. */
  hitTest(s: S, p: Vec2, hc: HitContext): boolean;

  /** Edit handles in world space, in hit-priority order: corners before edges. */
  handles(s: S): readonly Handle[];

  /** Geometry this shape would have if `handle` were dragged to world point `p`. */
  resize(s: S, handle: HandleId, p: Vec2, mods: Modifiers): S;

  translate(s: S, d: Vec2): S;

  /** Canonicalise. Return null when the result is degenerate and should be dropped. */
  normalize(s: S): S | null;

  serialize(s: S): SerializedShape;
  deserialize(data: SerializedShape): S;

  /* -------- seams for connections: designed now, unimplemented this revision -------- */

  /** Ids whose geometry this shape depends on. A connection returns its two endpoints. */
  dependsOn?(s: S): readonly ShapeId[];

  /** Re-derive geometry after a dependency moved. Called for every dependent on commit. */
  reroute?(s: S, deps: ReadonlyMap<ShapeId, Shape>): S;

  /** Points a connection may terminate on. A block exposes its edge midpoints. */
  anchors?(s: S): readonly Anchor[];
}
