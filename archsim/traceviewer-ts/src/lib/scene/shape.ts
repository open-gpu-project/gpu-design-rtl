import type { PropSchema } from '../props/spec';
import type { Theme } from '../canvas/theme';
import type { Anchor, Modifiers, Rect, Side, Vec2 } from '../geom/types';

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

/**
 * What every box kind presents in common: a heading, an optional second line, and a note.
 *
 * Named separately from `RectShape` since iteration 6, when `fifo` and `fabric` arrived wanting
 * the identical three label modes. `shapes/heading.ts` renders anything that satisfies this, and
 * takes the body rectangle as a parameter rather than reading it off the shape -- a FIFO's drawn
 * box is derived from its cell count, so there is no `w` on it that would give the right answer.
 */
export interface Headed extends ShapeBase {
  /** Second line under an inset label. Moves into the tooltip in the tabbed modes. */
  readonly subtitle: string;
  readonly labelMode: LabelMode;
  /** Free-text note on what this entity is. Shown as a tooltip on hover. */
  readonly description: string;
}

/** The kinds that are nothing but a box with interfaces on it. See `shapes/plain-box.ts`. */
export type PlainBoxKind = 'rect' | 'fabric';

/** A box with a heading, carrying network interfaces on the borders its kind offers. */
export interface PlainBoxShape<K extends PlainBoxKind = PlainBoxKind> extends Headed {
  readonly kind: K;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** How many network interfaces sit on its border. Reconciled into `nif` children. */
  readonly interfaces: number;
}

/** A block in the architecture diagram. */
export type RectShape = PlainBoxShape<'rect'>;

/**
 * A switch fabric: a box that carries a row of network interfaces.
 *
 * The same shape as a block, minus the freedom -- its interfaces may only sit on the top and
 * bottom borders, because a fabric is drawn between the things it connects, and a port on its
 * left or right edge would read as belonging to the neighbour rather than to the fabric.
 */
export type FabricShape = PlainBoxShape<'fabric'>;

/** Which end of a bus this interface is. SystemVerilog modport convention. */
export type Modport = 'master' | 'slave';

/**
 * A network interface: a flat plain box glued to a parent's border.
 *
 * A first-class shape rather than data nested in its parent, which is what buys it the whole
 * editor for free -- selection, the property panel, a name a connection can bind to,
 * cascade-deletion through `dependsOn`, undo, and the clipboard. `PropValue` has no object case,
 * so nesting would have meant a list of tuples and a sub-object selection model built from
 * scratch.
 *
 * Its own creation and destruction are NOT its business: the parent's `interfaces` count is
 * authoritative and `expandChildren` reconciles against it. `deletable` returns false to say so.
 */
export interface NifShape extends ShapeBase {
  readonly kind: 'nif';
  /** The box this interface is glued to. Empty only on a blank awaiting an import. */
  readonly parent: ShapeName;
  readonly side: Side;
  /**
   * Distance along `side` from its start corner, AS AUTHORED.
   *
   * Clamped where the box is computed rather than stored clamped, so shrinking a parent past an
   * interface and growing it back puts the interface where the user left it -- the same reason
   * `makeBoxAnchor` carries the unclamped offset in its id.
   */
  readonly offset: number;
  /** Extent along the border, and across it. */
  readonly length: number;
  readonly depth: number;
  /** The bus standard. Means something beyond this editor later; today it is a label. */
  readonly protocol: 'axi3';
  readonly modport: Modport;
  readonly description: string;
  /**
   * An uncommitted drag, in world units, waiting to be turned into a `side` and an `offset`.
   *
   * This field exists because of a gap in the seams, and it is worth being explicit about.
   * Deciding which border a dragged interface landed on needs the PARENT's box, and neither
   * `translate` nor `resize` is given it -- only `reroute` is. So `translate` records the
   * gesture here and `reroute` consumes it, resolves the face, and zeroes it again.
   *
   * It has no `PropDef` at all -- not a `computed` one -- so it is absent from the schema and
   * from the file both. There is nothing to show a user about a gesture that has already been
   * resolved by the time anything can read it.
   */
  readonly pending: readonly [number, number];
  /**
   * Whether this interface's parent offers it an INWARD edge, cached from `interfaceInward`.
   *
   * Cached on the child because it has to be: `anchorAt`, `resolveAnchor` and `anchors` are pure
   * functions of one shape and never see the parent. `reroute` does see it, and writes this the
   * same way it writes the box. `computed` -- re-derived on load, never saved.
   */
  readonly inward: boolean;
  /** Derived from the parent's box by `reroute`. `computed` -- never authored, never saved. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A queue, drawn as a run of cells: one outline with dividers across it.
 *
 * The extent along the flow axis is DERIVED, not stored -- `cells * spacing` -- so `w` (or `h`
 * when vertical) is ignored while the queue is bounded, and everything reads the box through
 * one function rather than off these fields. `cells: -1` means unbounded, which is drawn as one
 * cell, a resizable gap, and three more; that is the only case where the flow axis is authored.
 */
export interface FifoShape extends Headed {
  readonly kind: 'fifo';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Which way the queue runs. The cross axis is the one the user may resize. */
  readonly orientation: 'horizontal' | 'vertical';
  /** Number of cells, or -1 for unbounded. Never 0. */
  readonly cells: number;
  /** Divider pitch along the flow axis, in world units. */
  readonly spacing: number;
}

/**
 * Which family of geometry a connection's `points` describe.
 *
 * Kept SEPARATE from `routing`, which is a different question. `routing` says who maintains the
 * geometry -- the router, or the user who dragged it. This says what the geometry IS. Folding
 * them into one four-valued enum would encode a 2x2 product as a flat list, and `conn.props.ts`
 * already argues that distinction the other way round for `routing` itself.
 */
export type PathStyle = 'ortho' | 'curve';

/**
 * A directed link between two shape perimeters.
 *
 * The route is stored, not re-derived on read: `points` is the truth the renderer, the hit test
 * and the file all use. While `routing` is `'auto'` it is re-derived on every commit that moves
 * an endpoint; while it is `'manual'` the user owns it and only the ends are patched -- unless
 * the gesture moved BOTH of them, in which case `movesWith` translates the whole route and the
 * patch has nothing left to do.
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
   * `'ortho'` for the rectilinear router, `'curve'` for a Catmull-Rom spline.
   *
   * The connect tool picks it from what the two ends prefer (see `preferredPath`), so a link
   * between two network interfaces curves and everything else stays square.
   */
  readonly path: PathStyle;
  /**
   * The route in world units. `points[0]` is the source anchor and the last is the target.
   *
   * What lies between depends on `path`. For `'ortho'` it is the polyline itself, and every
   * consecutive pair shares exactly one coordinate. For `'curve'` it is the CONTROL POLYGON of a
   * centripetal Catmull-Rom spline -- the user's waypoints -- so two points is a straight line.
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

/** Widen as kinds are added: `| LabelShape`. */
export type Shape = RectShape | FifoShape | FabricShape | NifShape | ConnectionShape;

/** The eight box handles, plus kind-specific ids like a connection's `way:1` or `end:from`. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | (string & {});

/**
 * What dragging a handle means.
 *
 * - `reshape` moves this shape's own geometry. The tool calls `resize`.
 * - `rebind` attaches an end of this shape to some *other* shape's perimeter, so the tool has
 *   to resolve what is under the cursor first and calls `rebind` with the answer.
 * - `action` does something once on press instead of starting a drag: the tool calls `resize`
 *   with the press point and commits, and a drag continuing from it carries on normally. The
 *   insert-waypoint badge on a curve is one. It is a handle rather than a bespoke affordance
 *   because it wants hit priority over the line it sits on, a screen-constant grab radius and a
 *   drawn knob -- all of which a handle already has, and none of which `hit.ts` offers anything
 *   else.
 *
 * Declared on the handle rather than inferred from its id, so the select tool can route a drag
 * without knowing that `end:to` means something different from `se`.
 */
export type HandleRole = 'reshape' | 'rebind' | 'action';

interface HandleCommon {
  readonly id: HandleId;
  /** World coordinates. The hit radius is applied by the caller, in screen pixels. */
  readonly pos: Vec2;
  /** CSS cursor while hovering or dragging this handle. */
  readonly cursor: string;
  /** Whether to draw a visible knob. False means an invisible grab affordance. */
  readonly visible: boolean;
  /**
   * What the knob should look like. Omitted is the plain square every resize handle uses.
   *
   * `'plus'` is drawn smaller and quieter with a cross through it, because an `action` handle
   * does something different from a `reshape` one and two affordances that look identical are
   * worse than one: a curve's waypoints and its insert badges sat side by side as the same
   * square, so nothing said which one you could drag.
   */
  readonly glyph?: 'plus';
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
 *
 * Narrower still since iteration 6.2: the index is built and thrown away within a single sweep
 * of `rerouteAll`, which may sweep more than once. A retained instance would therefore also
 * offer runs drawn by a version of the scene that no longer exists.
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
   * per-kind is what lets `deserializeScene`'s first pass stay generic: it can create every
   * shape under its final name before it knows how to fill any of them in.
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
   *
   * MUST also be idempotent: `reroute(reroute(s)) === reroute(s)`, by reference. `rerouteAll`
   * settles by sweeping until nothing moves, so an implementation that keeps producing a new
   * value from its own output would not merely cost a history entry -- it would not terminate,
   * and the sweep cap would turn that into a silent one-commit lag instead. Both current
   * implementations satisfy it for the same reason: `nif.reroute` consumes its `pending` nudge
   * and the second call finds nothing pending, and a connection re-derives from its endpoints.
   */
  reroute?(s: S, deps: ReadonlyMap<ShapeName, Shape>, rc: RouteContext): S;

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

  /* ------------------------------------------------------ parents and children ---- */

  /**
   * The shape that OWNS this one, for that parent's `expand` to reconcile against, or null.
   *
   * Narrower than `dependsOn`, which is about geometry and returns two names for a connection.
   * This one answers "whose count decides whether you exist", and only a child kind implements
   * it.
   */
  childOf?(s: S): ShapeName | null;

  /**
   * The children this shape must be accompanied by, reconciled on every commit.
   *
   * `existing` is its current children in document order; `mint` yields a free name. MUST return
   * `existing` BY REFERENCE when the set is already correct -- `expandChildren` decides whether
   * anything changed by identity, and an unconditional allocation would make every commit an
   * undoable step.
   *
   * Runs in `SceneStore.commit`, not in `resolve.ts`: minting a name is not pure, and `resolve.ts`
   * is documented as a pure function of the shape array -- the select tool calls its `rerouteAll`
   * directly, mid-drag, where nothing should be created.
   */
  expand?(s: S, existing: readonly Shape[], mint: (prefix: string) => ShapeName): readonly Shape[];

  /**
   * Which of its faces this shape lets an interface attach to. Omitted means it carries none.
   *
   * Asked of the PARENT by the child, so a `nif` never switches on its parent's kind. Note this
   * is a different question from `anchorAt`, which is where a WIRE may land: a fabric restricts
   * its interfaces to two borders but takes a wire anywhere on its perimeter.
   */
  interfaceSides?(s: S): readonly Side[];

  /**
   * Whether an interface on this shape also takes connections on its INWARD edge -- the one
   * facing into the body. Omitted means outward only.
   *
   * Asked of the PARENT, like `interfaceSides`, so a `nif` never switches on its parent's kind.
   * A fabric is the one place an inward link means something: the wires INSIDE a crossbar are as
   * real as the ones outside it, and they are how its internal routing is drawn.
   */
  interfaceInward?(s: S): boolean;

  /* ----------------------------------------------------------------- sub-parts ---- */

  /**
   * Which editable sub-part of this shape a handle names, or null.
   *
   * A sub-part is something inside one shape that the user can select and delete on its own --
   * a curve's waypoint is the only one today. Named generically, and returned as a plain index,
   * so `SelectTool` can hold a cursor on one without knowing what a waypoint is. The alternative
   * was the tool parsing `way:3` out of a handle id, which would put the id grammar in two
   * files and make the tool kind-aware in all but name.
   */
  subPartOf?(s: S, handle: HandleId): number | null;

  /** What the status bar should say about one, or null when the index is stale. */
  subPart?(
    s: S,
    index: number,
  ): {
    readonly count: number;
    readonly ordinal: number;
    readonly pos: Vec2;
    readonly noun: string;
  } | null;

  /** Remove one. MUST return `s` by reference when it refuses, as `rebind` does. */
  removeSubPart?(s: S, index: number): S;

  /**
   * Which path family a connection landing on this shape should take. Omitted means `'ortho'`.
   *
   * Asked of BOTH ends by the connect tool, which takes `'curve'` only when they agree -- which
   * is what makes "a plain arrow may still be drawn to an interface" true by construction rather
   * than by a rule written down somewhere.
   */
  preferredPath?(s: S): PathStyle;

  /**
   * False to refuse direct deletion. Omitted means deletable.
   *
   * What keeps a parent's `interfaces` count authoritative: you change the number of interfaces
   * on the parent, you do not delete interfaces off it. Without this the reconcile would simply
   * mint the deleted one again on the next commit, which is a worse answer than refusing.
   */
  deletable?(s: S): boolean;
}
