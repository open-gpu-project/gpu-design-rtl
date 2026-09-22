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

/**
 * A directed rectilinear link between two block perimeters.
 *
 * The route is stored, not re-derived on read: `points` is the truth the renderer, the hit test
 * and the file all use. While `routing` is `'auto'` it is re-derived on every commit that moves
 * an endpoint; while it is `'manual'` the user owns it and only the ends are patched.
 */
export interface ConnectionShape extends ShapeBase {
  readonly kind: 'conn';
  /** Name of the source block. Empty only on an uncommitted ghost. */
  readonly from: ShapeName;
  /** Anchor id on `from`, resolved by that kind's `resolveAnchor`. */
  readonly fromAnchor: string;
  readonly to: ShapeName;
  readonly toAnchor: string;
  /**
   * The full route in world units. `points[0]` is the source anchor and the last point is the
   * target anchor; every consecutive pair shares exactly one coordinate.
   */
  readonly points: readonly Vec2[];
  /** Flips to `'manual'` the moment the user drags a segment or types a route. */
  readonly routing: 'auto' | 'manual';
  /** Free-text note on what this link carries. Never rendered on the canvas. */
  readonly description: string;
}

/** Widen as kinds are added: `| PortShape | LabelShape`. */
export type Shape = RectShape | ConnectionShape;

/** The eight box handles, plus kind-specific ids like a connection's `seg:0` or `end:from`. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | (string & {});

/**
 * What dragging a handle means.
 *
 * - `reshape` moves this shape's own geometry. The tool calls `resize`.
 * - `rebind` attaches an end of this shape to some *other* shape's perimeter, so the tool has
 *   to resolve what is under the cursor first and calls `rebind` with the answer.
 *
 * Declared on the handle rather than inferred from its id, so the select tool can route a drag
 * without knowing that `end:to` means something different from `se`.
 */
export type HandleRole = 'reshape' | 'rebind';

interface HandleCommon {
  readonly id: HandleId;
  /** World coordinates. The hit radius is applied by the caller, in screen pixels. */
  readonly pos: Vec2;
  /** CSS cursor while hovering or dragging this handle. */
  readonly cursor: string;
  /** Whether to draw a visible knob. False means an invisible grab affordance. */
  readonly visible: boolean;
  /** Omitted means `'reshape'`, which is what all eight box handles are. */
  readonly role?: HandleRole;
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

/**
 * Rectilinear runs a router may bundle onto, exposed as queries rather than as an array.
 *
 * Deliberately narrow: the implementation behind it is mutated by the reroute fold *after* each
 * `reroute` call returns, so a shape that retained the instance would observe geometry that did
 * not exist when it was built. Query-only makes that impossible to do by accident.
 */
export interface CorridorQuery {
  /** Ascending vertical-run x coordinates within `[lo, hi]`. */
  rangeX(lo: number, hi: number): readonly number[];
  /** Ascending horizontal-run y coordinates within `[lo, hi]`. */
  rangeY(lo: number, hi: number): readonly number[];
  hasX(v: number): boolean;
  hasY(v: number): boolean;
}

/** Everything a `reroute` needs beyond its own dependencies. A record, so it can grow. */
export interface RouteContext {
  readonly corridors: CorridorQuery;
}

/**
 * A point on some other shape's perimeter: what a `rebind` handle was dragged onto.
 *
 * Carries the name rather than the shape, because it is stored into the dragged shape and a
 * retained `Shape` reference would be a second, stale copy of a thing the scene already owns.
 */
export interface AnchorTarget {
  readonly shape: ShapeName;
  readonly anchor: Anchor;
}

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

  /**
   * Edit handles in world space, in hit-priority order -- the caller takes the first match.
   * A block puts corners before edges; a connection puts its two ends before its segments.
   */
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

  /* ---------------- optional seams: a kind implements only what it has ---------------- */

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

  /**
   * Re-derive geometry after a dependency moved. Called for every dependent on commit.
   *
   * MUST return `s` itself by reference when nothing changed. `SceneStore.commit` decides
   * whether to push an undo entry by comparing `shapes` identity, so a `reroute` that always
   * allocates turns every commit -- including ones that touched nothing -- into a history entry.
   */
  reroute?(s: S, deps: ReadonlyMap<ShapeName, Shape>, rc: RouteContext): S;

  /** Points a connection may terminate on. A block exposes its edge midpoints. */
  anchors?(s: S): readonly Anchor[];

  /**
   * Project a world point onto this shape's perimeter, or null when it is farther away than a
   * threshold derived from `hc.worldPerPx`. Returning null is how the caller walks the z-order.
   */
  anchorAt?(s: S, p: Vec2, hc: HitContext): Anchor | null;

  /** The inverse of `anchorAt`: an anchor id back to a live position. Null if unparseable. */
  resolveAnchor?(s: S, id: string): Anchor | null;

  /**
   * Re-attach the end named by a `rebind` handle, or refuse.
   *
   * `target` is null when the cursor is over no perimeter at all. Only the binding changes
   * here -- the geometry follows from `reroute`, which both the commit path and the select
   * tool's preview already run.
   *
   * MUST return `s` by reference when it refuses, which is how "there is nothing valid under
   * the cursor" renders as the end simply staying where it was.
   */
  rebind?(s: S, handle: HandleId, target: AnchorTarget | null): S;

  /**
   * The rectilinear run other connections may bundle onto, or null for a kind that owns none.
   * Pairs with `anchors`: that is where a route may END, this is where it may RUN. A block's
   * outline is deliberately not a corridor -- lines bundle with lines, not with boxes.
   */
  corridors?(s: S): readonly Vec2[] | null;
}
