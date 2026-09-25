import type { Shape, ShapeName } from './shape';

/*
 * Z-order lives in the `shapes` array: index 0 is the bottom of the stack. These are pure array
 * transforms.
 */

/** Stable partition: everything else keeps its order, the moved set keeps its order too. */
export function bringToFront(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  return [...shapes.filter((s) => !ids.has(s.name)), ...shapes.filter((s) => ids.has(s.name))];
}

export function sendToBack(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  return [...shapes.filter((s) => ids.has(s.name)), ...shapes.filter((s) => !ids.has(s.name))];
}

/**
 * Step each selected shape past exactly one unselected neighbour, so repeated presses walk it up
 * the stack one *visible* position at a time. Iterating from the top down stops a shape being
 * carried more than one place per call.
 */
export function bringForward(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  const out = shapes.slice();
  for (let i = out.length - 2; i >= 0; i--) {
    if (ids.has(out[i]!.name) && !ids.has(out[i + 1]!.name)) {
      [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
    }
  }
  return out;
}

export function sendBackward(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  const out = shapes.slice();
  for (let i = 1; i < out.length; i++) {
    if (ids.has(out[i]!.name) && !ids.has(out[i - 1]!.name)) {
      [out[i], out[i - 1]] = [out[i - 1]!, out[i]!];
    }
  }
  return out;
}
