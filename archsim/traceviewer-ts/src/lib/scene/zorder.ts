import type { Shape, ShapeId } from './shape';

/**
 * Z-order lives in the `shapes` array: index 0 is the bottom of the stack. These are pure array
 * transforms; `reorder` is the primitive a layers panel will drag against, and the four commands
 * below are conveniences on top of the same idea.
 */
export function reorder(shapes: readonly Shape[], id: ShapeId, toIndex: number): readonly Shape[] {
  const from = shapes.findIndex((s) => s.id === id);
  if (from < 0) return shapes;
  const to = Math.max(0, Math.min(shapes.length - 1, toIndex));
  if (from === to) return shapes;
  const out = shapes.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved!);
  return out;
}

/** Stable partition: everything else keeps its order, the moved set keeps its order too. */
export function bringToFront(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeId>,
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  return [...shapes.filter((s) => !ids.has(s.id)), ...shapes.filter((s) => ids.has(s.id))];
}

export function sendToBack(shapes: readonly Shape[], ids: ReadonlySet<ShapeId>): readonly Shape[] {
  if (ids.size === 0) return shapes;
  return [...shapes.filter((s) => ids.has(s.id)), ...shapes.filter((s) => !ids.has(s.id))];
}

/**
 * Step each selected shape past exactly one unselected neighbour, so repeated presses walk it up
 * the stack one *visible* position at a time. Iterating from the top down stops a shape being
 * carried more than one place per call.
 */
export function bringForward(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeId>,
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  const out = shapes.slice();
  for (let i = out.length - 2; i >= 0; i--) {
    if (ids.has(out[i]!.id) && !ids.has(out[i + 1]!.id)) {
      [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
    }
  }
  return out;
}

export function sendBackward(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeId>,
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  const out = shapes.slice();
  for (let i = 1; i < out.length; i++) {
    if (ids.has(out[i]!.id) && !ids.has(out[i - 1]!.id)) {
      [out[i], out[i - 1]] = [out[i - 1]!, out[i]!];
    }
  }
  return out;
}
