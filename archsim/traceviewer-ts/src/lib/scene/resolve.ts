import { opsFor, registryHasDependencies } from './registry';
import { CorridorIndex } from './route';
import type { Shape, ShapeName } from './shape';

/**
 * Dependency resolution, lifted out of `SceneStore` so it is a pure function of the shape array.
 *
 * That matters for one caller in particular: `SelectTool` needs to re-route connections against
 * a mid-drag *preview*, where there is no commit to hang the work off. Keeping it pure also
 * means the fold below can be reasoned about -- and tested -- without a store.
 *
 * Every function here returns its input array when nothing changed. See the identity guard in
 * `SceneStore.#resolveDependencies` for why that is a correctness property, not a micro-tuning.
 */

/** Drop shapes whose dependencies are gone, settling to a fixed point. */
export function pruneOrphans(shapes: readonly Shape[]): readonly Shape[] {
  let current = shapes;
  for (;;) {
    const byId = new Map(current.map((s) => [s.name, s]));
    const kept = current.filter((s) => {
      const deps = opsFor(s).dependsOn?.(s);
      return deps === undefined || deps.every((id) => byId.has(id));
    });
    // A dropped shape may orphan another, so settle rather than sweeping once.
    if (kept.length === current.length) return current === shapes ? shapes : current;
    current = kept;
  }
}

/**
 * Re-derive every dependent's geometry, walking the z-order from the bottom up.
 *
 * A left fold, not a map, and that is the whole design. Corridors accumulate as the walk
 * proceeds, so a connection may bundle onto runs owned by connections *below* it and only
 * those. No shape can ever observe its own output: the pass is well-founded, settles in one
 * sweep, and has no order in which two connections can chase each other forever.
 *
 * The price is that restacking a connection can change its route. That is visible, explainable,
 * and much cheaper than the alternative -- do not "fix" it by feeding the fold its own results.
 */
export function rerouteAll(shapes: readonly Shape[]): readonly Shape[] {
  if (!registryHasDependencies()) return shapes;

  const byId = new Map(shapes.map((s) => [s.name, s]));
  const corridors = new CorridorIndex();
  let out: Shape[] | null = null;

  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]!;
    const ops = opsFor(s);
    const deps = ops.dependsOn?.(s);
    let next = s;

    if (deps !== undefined && ops.reroute !== undefined) {
      const resolved = new Map<ShapeName, Shape>();
      for (const id of deps) {
        const dep = byId.get(id);
        if (dep !== undefined) resolved.set(id, dep);
      }
      next = ops.reroute(s, resolved, { corridors });
    }

    // Copy on first write, so a pass that changes nothing hands back the same array.
    if (next !== s && out === null) out = shapes.slice(0, i);
    out?.push(next);
    // Absorb what the shape actually became, never the version it had on entry.
    corridors.absorb(next);
  }

  return out ?? shapes;
}

export function resolveDependencies(shapes: readonly Shape[]): readonly Shape[] {
  return rerouteAll(pruneOrphans(shapes));
}
