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

/**
 * How a block's label is presented.
 *
 * - `inset`        label centred in the block, subtitle centred under it.
 * - `tabbed_left`  label in a tab above the block's top-left corner; body left empty.
 * - `tabbed_right` the same, above the top-right corner.
 *
 * The tabbed modes have nowhere to put a second line, so the subtitle moves into the hover
 * tooltip rather than being dropped.
 */
export type LabelMode = 'inset' | 'tabbed_left' | 'tabbed_right';

/** A block in the architecture diagram. The only entity kind so far. */
export interface RectShape extends ShapeBase {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Second line under an inset label. Moves into the tooltip in the tabbed modes. */
  readonly subtitle: string;
  readonly labelMode: LabelMode;
  /** Free-text note on what this hardware block is. Shown as a tooltip on hover. */
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
  /**
   * Nudge for the drawn label, in CSS pixels, as `[par, perp]` relative to the run it rides.
   *
   * Screen pixels rather than world units because the label is drawn at a fixed size at every
   * zoom: a screen-constant nudge holds the same visual relationship to the wire, where a
   * world-unit one would drift away from it as you zoom in.
   */
  readonly labelOffset: readonly [number, number];
  /** Free-text note on what this link carries. Shown as a tooltip on hover. */
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
  /**
   * Width of a string in CSS pixels, at whatever font the caller's decoration uses.
   *
   * Optional, because only a kind whose hit box depends on rendered text needs it and only one
   * of the four call sites can supply one. A kind that asks for it must cope with its absence,
   * and `textMeasurer`'s estimate fallback is how.
   */
  readonly measure?: (text: string) => number;
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
  /**
   * World bounds of ANOTHER shape, by name, or null when the scene has no such shape.
   *
   * The one thing a `draw` can learn about the rest of the scene, and deliberately the least
   * that answers a real question: a connection's arrowhead is sized in screen pixels and has
   * to know whether, at this zoom, it would land inside a block it is attached to. Handing
   * over the shape itself instead would let one kind read another kind's fields and re-enter
   * `draw`, and the purity contract below would stop being enforceable.
   *
   * Null is normal, not exceptional: a ghost connection is bound to nothing at its loose end.
   */
  boundsOf(name: ShapeName): Rect | null;
}

/**
 * What a hover tooltip shows for one shape: a heading and zero or more lines under it.
 *
 * Lines rather than one blob, because the two kinds contribute different numbers of them and
 * the component renders each as its own paragraph. Producing it is a per-kind question -- a
 * block's answer depends on its `labelMode` -- so it is a seam on `ShapeOps`, not a switch.
 */
export interface ShapeTooltip {
  readonly title: string;
  readonly lines: readonly string[];
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
   * What hovering this shape should say, or null for nothing worth a tooltip.
   *
   * Optional: a kind with no prose to show simply omits it and never gets a tooltip.
   */
  tooltip?(s: S): ShapeTooltip | null;

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
   * Does this shape overlap the world-space rectangle `r`? Used by the marquee.
   *
   * Optional, and the fallback is `rectsIntersect(bounds(s), r)`. A kind implements it when its
   * bounding box is a poor stand-in for its ink: a connection's `bounds` is the box around its
   * whole route, so an L-shaped wire's box covers a large region it does not occupy, and a
   * band dropped in that empty corner would select a wire it never touched.
   */
  intersects?(s: S, r: Rect): boolean;

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
