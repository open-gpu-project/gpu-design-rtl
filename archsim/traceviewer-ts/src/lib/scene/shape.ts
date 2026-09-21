import type { PropSchema } from '../props/spec';
import type { Theme } from '../canvas/theme';
import type { Anchor, Modifiers, Rect, Vec2 } from '../geom/types';

/**
 * A shape's identity **is** its name. There is no separate opaque id.
 *
 * That is a deliberate product decision: the diagram is of named hardware entities and is meant
 * to be queried by those names later, so a UUID would just be a second identifier nobody wants
 * to type. The cost is that renaming is a structural operation -- see `SceneStore.renameShape`
 * and the `renameRef` seam below.
 */
export type ShapeName = string;

export interface ShapeBase {
  readonly kind: string;
  /** The identity. Unique scene-wide, never empty. */
  readonly name: ShapeName;
  /** Text drawn on the shape. Cosmetic and may be empty, in which case `name` is drawn. */
  readonly label: string;
}

/** A block in the architecture diagram. The only entity kind so far. */
export interface RectShape extends ShapeBase {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Free-text note on what this hardware block is. Never rendered on the canvas. */
  readonly description: string;
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

  /* ------------------------------------------------------------------- properties ---- */

  /**
   * The property declaration for this kind. One source for four consumers: the property
   * panel's document, the generated JSON Schema ajv validates against, the footer
   * documentation, and the on-disk record. `serialize` is derived from it, not written.
   */
  readonly props: PropSchema<S>;

  /**
   * A default instance under the given name, for an import to be applied onto. Keeping this
   * per-kind is what lets `deserializeShape` stay generic.
   */
  blank(name: ShapeName): S;

  /* -------- seams for connections: designed now, unimplemented this revision -------- */

  /**
   * Rewrite references to a shape that was just renamed. A connection updates its endpoints.
   *
   * Required because identity is the name: without this, renaming a block would silently
   * orphan everything pointing at it, and adding connections would become a breaking change
   * to every mutation path instead of an additive one.
   */
  renameRef?(s: S, from: ShapeName, to: ShapeName): S;

  /** Ids whose geometry this shape depends on. A connection returns its two endpoints. */
  dependsOn?(s: S): readonly ShapeName[];

  /** Re-derive geometry after a dependency moved. Called for every dependent on commit. */
  reroute?(s: S, deps: ReadonlyMap<ShapeName, Shape>): S;

  /** Points a connection may terminate on. A block exposes its edge midpoints. */
  anchors?(s: S): readonly Anchor[];
}
