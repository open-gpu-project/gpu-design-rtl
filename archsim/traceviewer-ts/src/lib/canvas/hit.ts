import { dist2, distToSegment } from '../geom/math';
import type { Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import type { Handle, HitContext, Shape, ShapeId } from '../scene/shape';
import { HANDLE_HIT_R_PX } from './theme';

export type HitResult =
  | { readonly type: 'handle'; readonly shape: Shape; readonly handle: Handle }
  | { readonly type: 'body'; readonly shape: Shape }
  | { readonly type: 'empty' };

export interface HitScene {
  readonly shapes: readonly Shape[];
  readonly selection: ReadonlySet<ShapeId>;
}

/**
 * Priority: handles of selected shapes, then the topmost body, then nothing.
 *
 * Handles only exist on selected shapes, so an unselected block lying on top can never steal a
 * resize gesture from the selected one underneath it.
 */
export function hitTest(scene: HitScene, world: Vec2, hc: HitContext): HitResult {
  // A screen-pixel tolerance converted to world units, so the grab zone feels the same at
  // every zoom level.
  const tol = HANDLE_HIT_R_PX * hc.worldPerPx;

  for (let i = scene.shapes.length - 1; i >= 0; i--) {
    const s = scene.shapes[i]!;
    if (!scene.selection.has(s.id)) continue;
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
