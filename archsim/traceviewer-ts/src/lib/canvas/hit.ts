import { dist2, distToSegment } from '../geom/math';
import type { Anchor, Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import type { Handle, HitContext, Shape, ShapeName } from '../scene/shape';
import { HANDLE_HIT_R_PX } from './theme';

export type HitResult =
  | { readonly type: 'handle'; readonly shape: Shape; readonly handle: Handle }
  | { readonly type: 'body'; readonly shape: Shape }
  | { readonly type: 'empty' };

export interface HitScene {
  readonly shapes: readonly Shape[];
  readonly selection: ReadonlySet<ShapeName>;
}

/**
 * Priority: handles of selected shapes, then the topmost body, then nothing.
 *
 * Handles only exist on selected shapes, so an unselected block lying on top can never steal a
 * resize gesture from the selected one underneath it.
 *
 * **With one exception, and it is the same reasoning rather than a hole in it.** That rule is
 * about an *unrelated* shape lying on top. A shape's own CHILD is not unrelated: a network
 * interface is glued to its parent's border, which is exactly where the parent's invisible edge
 * grab zone runs. Without the exception, selecting a fabric covers every one of its interfaces
 * with a resize zone, and a press meant for a port silently resizes the fabric instead -- the
 * port becomes ungrabbable until you deselect its parent. So a selected shape's handles yield at
 * points its own children occupy, and the body pass below picks the child, which sits above it.
 *
 * **Owned children only, never the blocks a parent encloses.** A block inside a selected group
 * does not cover the group's handles. A child can have exactly its parent's bounds, and yielding
 * to it would disable every handle the parent has. The exception is about a port sitting in a
 * border's grab zone, and nothing but a port does that. Pressing the body of a child inside a
 * selected parent still selects the child, because the child sits above it.
 */
export function hitTest(scene: HitScene, world: Vec2, hc: HitContext): HitResult {
  // A screen-pixel tolerance converted to world units, so the grab zone feels the same at
  // every zoom level.
  const tol = HANDLE_HIT_R_PX * hc.worldPerPx;

  for (let i = scene.shapes.length - 1; i >= 0; i--) {
    const s = scene.shapes[i]!;
    if (!scene.selection.has(s.name)) continue;
    if (childCovers(scene.shapes, s.name, world, hc)) continue;
    for (const h of opsFor(s).handles(s)) {
      const hit =
        h.geom === 'point'
          ? dist2(world, h.pos) <= tol * tol
          : distToSegment(world, h.pos, h.end) <= tol;
      if (hit) return { type: 'handle', shape: s, handle: h };
    }
  }

  for (let i = scene.shapes.length - 1; i >= 0; i--) {
    const s = scene.shapes[i]!;
    if (opsFor(s).hitTest(s, world, hc)) return { type: 'body', shape: s };
  }

  return { type: 'empty' };
}

/** Is `world` on a child of `parent`? Drives the handle exception documented above. */
function childCovers(
  shapes: readonly Shape[],
  parent: ShapeName,
  world: Vec2,
  hc: HitContext,
): boolean {
  for (const t of shapes) {
    const ops = opsFor(t);
    if (ops.childOf?.(t) !== parent) continue;
    if (ops.hitTest(t, world, hc)) return true;
  }
  return false;
}

export interface AnchorHit {
  readonly shape: Shape;
  readonly anchor: Anchor;
}

/**
 * The topmost shape whose perimeter is within reach of `world`, or null.
 *
 * Separate from `hitTest` rather than a fourth `HitResult` variant, because it answers a
 * different question: `hitTest` asks "what did I click", this asks "what could a connection
 * attach to here", and the two want different z-order rules the moment a connection crosses a
 * block. A kind with no `anchorAt` is skipped, which is how connections avoid being anchored
 * onto each other.
 *
 * Deliberately takes no shape to exclude. Skipping the pending connection's own source would
 * make a click on it read as a click on empty space, which a click-click tool has to treat as
 * "never mind" -- so the gesture would silently cancel instead of explaining itself. Refusing a
 * self-connection belongs in the caller, at the point where it can say why.
 *
 * Takes the shape list rather than a `HitScene`, because unlike `hitTest` it has no use for the
 * selection -- and its callers hand it a pre-drag snapshot, which would have to be paired with
 * a live selection set to satisfy the wider type.
 */
export function anchorHitTest(
  shapes: readonly Shape[],
  world: Vec2,
  hc: HitContext,
): AnchorHit | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    const anchor = opsFor(s).anchorAt?.(s, world, hc);
    if (anchor !== undefined && anchor !== null) return { shape: s, anchor };
  }
  return null;
}
