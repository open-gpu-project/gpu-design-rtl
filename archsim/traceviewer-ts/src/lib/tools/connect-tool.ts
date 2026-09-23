import { anchorHitTest, type AnchorHit } from '../canvas/hit';
import { alignStroke } from '../canvas/pixel';
import { ANCHOR_DOT_R_PX } from '../canvas/theme';
import type { Anchor } from '../geom/types';
import { opsFor } from '../scene/registry';
import { CorridorIndex, routeConnection, samePoints } from '../scene/route';
import { connOps, makeConnection } from '../scene/shapes/conn';
import type { ConnectionShape, DrawContext, Shape, ShapeName } from '../scene/shape';
import { registerTool } from './registry';
import type { PointerInfo, Tool, ToolContext } from './tool';

const HINT_IDLE = 'Click a block edge to start a connection.';
const HINT_PENDING = 'Click another block to finish. Esc cancels.';
const HINT_SELF = 'A connection needs two different blocks.';

/**
 * Click once on a block's perimeter, click again on another block's: a directed arrow.
 *
 * Two things here deliberately diverge from `RectTool`, which is otherwise the template.
 *
 * First, the preview does NOT go through `scene.setDraft`. `draft` is `$state.raw` and the
 * canvas repaint effect reads it, so assigning it per pointermove is a reactive write at input
 * frequency -- exactly the cost iteration 3.2 measured and removed for `host.pointer`. Painting
 * from `drawOverlay` instead is visually identical (the overlay runs immediately before the
 * draft would) and touches no signal. It also cannot desync: `commit` nulls `draft` on its way
 * past, which would erase a ghost this tool still believed it owned.
 *
 * Second, the gesture spans two clicks rather than a drag, so the tool holds state while the
 * pointer is up. `isGesturing()` is true across that window, which correctly refuses undo,
 * delete and restack -- all of which would commit underneath a half-built connection.
 */
export class ConnectTool implements Tool {
  readonly id = 'connect';
  readonly label = 'Connection';
  readonly defaultCursor = 'crosshair';

  /** Set by the first click. Non-null means a connection is pending. */
  #from: { readonly shape: ShapeName; readonly anchor: Anchor } | null = null;
  /** The routed preview. A plain field, not a signal: see the class comment. */
  #ghost: ConnectionShape | null = null;
  /** The perimeter bead under the cursor. */
  #hover: AnchorHit | null = null;

  /** Identity-guarded: `scene.shapes` is `$state.raw`, so `!==` is a sound invalidation. */
  #corridorFor: readonly Shape[] | null = null;
  #corridors = new CorridorIndex();

  /* Read by `verify/connections.mjs`, which cannot see private fields. */
  get pendingFrom(): ShapeName | null {
    return this.#from?.shape ?? null;
  }
  get hoverAnchor(): Anchor | null {
    return this.#hover?.anchor ?? null;
  }
  get ghostPoints(): readonly { x: number; y: number }[] | null {
    return this.#ghost?.points ?? null;
  }

  isGesturing(): boolean {
    return this.#from !== null;
  }

  onActivate(c: ToolContext): void {
    // Instances are cached for the session, so a stale half-built connection would otherwise
    // resume the next time this tool is picked.
    this.#reset();
    c.setHint(HINT_IDLE);
  }

  onDeactivate(c: ToolContext): void {
    this.#reset();
    c.requestFrame();
  }

  onPointerCancel(c: ToolContext): void {
    this.#reset();
    c.setHint(HINT_IDLE);
    c.requestFrame();
  }

  onPointerLeave(c: ToolContext): void {
    // Only the hover bead goes. A pending connection survives the pointer wandering off to a
    // scrollbar; losing it there would be baffling.
    if (this.#hover === null) return;
    this.#hover = null;
    c.requestFrame();
  }

  onPointerDown(p: PointerInfo, c: ToolContext): void {
    if (p.button !== 0) return;
    const pending = this.#from;
    const hit = this.#pick(p, c);

    if (pending === null) {
      if (hit === null) return;
      this.#from = { shape: hit.shape.name, anchor: hit.anchor };
      this.#hover = hit;
      this.#retarget(p, c);
      c.setHint(HINT_PENDING);
      c.requestFrame();
      return;
    }

    if (hit === null) {
      // A click into open space is the natural "never mind" for a click-click gesture.
      this.#reset();
      c.setHint(HINT_IDLE);
      c.requestFrame();
      return;
    }

    this.#finish(pending, hit, c);
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    const before = this.#hover;
    const hit = this.#pick(p, c);
    this.#hover = hit;
    c.setCursor(hit === null ? this.defaultCursor : 'pointer');

    let dirty =
      (before === null) !== (hit === null) ||
      (before !== null &&
        hit !== null &&
        (before.shape.name !== hit.shape.name || before.anchor.id !== hit.anchor.id));

    if (this.#from !== null && this.#retarget(p, c)) dirty = true;
    // Repaint only on a real change. The free end is snapped, so in practice the ghost is
    // rebuilt about once per grid cell crossed rather than once per pointermove.
    if (dirty) c.requestFrame();
  }

  onKeyDown(e: KeyboardEvent, c: ToolContext): boolean {
    if (e.key === 'Escape') {
      if (this.#from !== null) {
        this.#reset();
        c.setHint(HINT_IDLE);
        c.requestFrame();
        return true;
      }
      c.setTool('pointer');
      return true;
    }
    // Undo is refused while `isGesturing()`, so without this the key would simply do nothing
    // and feel broken. Cancelling first, undoing on the second press, is what the user means.
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && this.#from !== null) {
      this.#reset();
      c.setHint(HINT_IDLE);
      c.requestFrame();
      return true;
    }
    return false;
  }

  drawOverlay(dc: DrawContext): void {
    const ghost = this.#ghost;
    if (ghost !== null) connOps.draw(ghost, dc, { selected: false, ghost: true });

    const hover = this.#hover;
    if (hover === null) return;

    const restore = dc.toDeviceSpace();
    const { ctx, dpr } = dc;
    const r = Math.max(2, Math.round(ANCHOR_DOT_R_PX * dpr));
    const lw = Math.max(1, Math.round(dpr));
    const q = dc.project(hover.anchor.pos);
    const x = alignStroke(q.x * dpr, lw);
    const y = alignStroke(q.y * dpr, lw);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = dc.theme.anchorDotFill;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = dc.theme.anchorDotStroke;
    ctx.stroke();
    restore();
  }

  /** The perimeter under the cursor, whichever block it belongs to. */
  #pick(p: PointerInfo, c: ToolContext): AnchorHit | null {
    return anchorHitTest(c.scene.shapes, p.world, { worldPerPx: c.view.worldPerPx });
  }

  /** Corridors owned by everything currently in the scene, rebuilt only when the scene changes. */
  #corridorIndex(c: ToolContext): CorridorIndex {
    if (this.#corridorFor !== c.scene.shapes) {
      this.#corridors = CorridorIndex.from(c.scene.shapes);
      this.#corridorFor = c.scene.shapes;
    }
    return this.#corridors;
  }

  /** Re-route the ghost to the cursor. Returns whether the route actually changed. */
  #retarget(p: PointerInfo, c: ToolContext): boolean {
    const from = this.#from;
    if (from === null) return false;
    // A hover on the source block is not a target: the second click there will be refused, so
    // previewing a route into it would advertise something that cannot happen.
    const hover =
      this.#hover !== null && this.#hover.shape.name !== from.shape ? this.#hover : null;
    const target = hover?.anchor ?? p.snapped;
    const points = routeConnection(from.anchor, target, this.#corridorIndex(c));
    if (this.#ghost !== null && samePoints(points, this.#ghost.points)) return false;

    this.#ghost = {
      kind: 'conn',
      name: 'preview',
      label: '',
      labelOffset: [0, 0],
      description: '',
      from: from.shape,
      fromAnchor: from.anchor.id,
      to: hover?.shape.name ?? '',
      toAnchor: hover?.anchor.id ?? '',
      routing: 'auto',
      points,
    };
    return true;
  }

  #finish(
    pending: { readonly shape: ShapeName; readonly anchor: Anchor },
    hit: AnchorHit,
    c: ToolContext,
  ): void {
    if (hit.shape.name === pending.shape) {
      c.setHint(HINT_SELF);
      return;
    }

    const scene = c.scene;
    // Re-resolve the source anchor: the block may have moved between the two clicks.
    const source = c.scene.shapes.find((s) => s.name === pending.shape);
    const a =
      source === undefined
        ? null
        : (opsFor(source).resolveAnchor?.(source, pending.anchor.id) ?? null);
    if (a === null) {
      this.#reset();
      c.setHint(HINT_IDLE);
      c.requestFrame();
      return;
    }

    const shape = makeConnection(
      scene.nextName('conn'),
      pending.shape,
      a,
      hit.shape.name,
      hit.anchor,
      this.#corridorIndex(c),
    );
    const normalized = connOps.normalize(shape);
    this.#from = null;
    this.#ghost = null;
    c.setHint(HINT_IDLE);

    if (normalized === null) {
      c.requestFrame();
      return;
    }
    scene.commit('connect', () => {
      scene.shapes = [...scene.shapes, normalized];
      scene.setSelection(new Set([normalized.name]));
    });
    c.requestFrame();
  }

  #reset(): void {
    this.#from = null;
    this.#ghost = null;
    this.#hover = null;
    this.#corridorFor = null;
  }
}

registerTool({
  id: 'connect',
  label: 'Connection',
  group: 'shape',
  order: 1,
  // Filled, not stroked: the toolbar renders `fill="currentColor"` with no stroke. An elbow
  // bar and an arrowhead, as two subpaths under the default nonzero fill rule.
  icon: 'M4 4h2v11h7v2H4V4z M12 12l7 4-7 4z',
  make: () => new ConnectTool(),
});
