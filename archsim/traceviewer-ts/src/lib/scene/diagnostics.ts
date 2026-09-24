import { opsFor } from './registry';
import type { Shape, ShapeName } from './shape';

/**
 * Cross-shape validation: the things that are wrong about a diagram rather than about a shape.
 *
 * Separate from `props/validate.ts`, which is the property editor's live annotation and asks a
 * different question -- is this DOCUMENT well formed. This one asks whether two shapes that were
 * joined should have been, which no single record can answer.
 *
 * A pure function of the shape array, for the same reason `route.ts` is: it is the part of the
 * app most likely to be quietly wrong, and a pure call is the only way to pin it.
 */

/** The violations for every shape that has any. A shape with none is absent, not empty. */
export type Diagnostics = ReadonlyMap<ShapeName, readonly string[]>;

export const NO_DIAGNOSTICS: Diagnostics = new Map();

export function diagnose(shapes: readonly Shape[]): Diagnostics {
  let out: Map<ShapeName, readonly string[]> | null = null;
  const byName = new Map(shapes.map((s) => [s.name, s]));

  for (const s of shapes) {
    const ops = opsFor(s);
    if (ops.diagnose === undefined) continue;
    const deps = ops.dependsOn?.(s) ?? [];
    const resolved = new Map<ShapeName, Shape>();
    for (const id of deps) {
      const dep = byName.get(id);
      if (dep !== undefined) resolved.set(id, dep);
    }
    const found = ops.diagnose(s, resolved);
    if (found.length === 0) continue;
    out ??= new Map();
    out.set(s.name, found);
  }

  // The same empty map every time, so a scene with nothing wrong never invalidates a `$derived`
  // that depends on this.
  return out ?? NO_DIAGNOSTICS;
}
