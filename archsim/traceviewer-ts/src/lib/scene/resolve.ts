import { opsFor } from './registry';
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

const NO_DEPS: readonly ShapeName[] = [];

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
 * Re-derive every dependent's geometry, walking the z-order from the bottom up, and repeat the
 * walk until no shape has read a dependency that later changed underneath it.
 *
 * A left fold, not a map, and that is still the whole design. Since iteration 6 the fold reads
 * back what the shapes it already folded ACTUALLY BECAME -- `byId` is now
 * updated in step with the corridor index, which has always worked that way. The dependency
 * graph is deeper than one level (`conn -> nif -> fabric`), and resolving one level per pass is
 * why a wire glued to a port used to lag the fabric the port sits on: live while dragging a
 * block, correct only at the next commit. Reading back resolves that whole chain in a single
 * sweep whenever the array is already in dependency order, which `expandChildren` guarantees
 * for parents and children by re-seating every child immediately above its parent.
 *
 * What ordering cannot guarantee is a connection the user pushed BELOW its own ports with
 * `sendToBack`. Under the line above that connection would read them stale permanently rather
 * than for one frame, so the sweep repeats, exactly as `pruneOrphans` above already does. This
 * supersedes iteration 4's "do not fix it by feeding the fold its own results", whose objection
 * was that a fixed point was asserted rather than argued. The argument:
 *
 *   - a `nif` depends only on a parent that has no `reroute`, so it is final after one sweep;
 *   - an `auto` connection is a function of `(a, b, corridors)` and never reads its own points;
 *   - a `manual` connection does read its points, but `patchStart`/`patchEnd` return by
 *     reference once the ends already match;
 *   - corridors flow strictly bottom-up within a sweep and the index is discarded between
 *     sweeps, so no run can outlive the connection that drew it;
 *   - and `reroute` is required to be idempotent (see `ShapeOps.reroute`), which is what makes
 *     a repeat sweep a confirmation rather than a fresh perturbation.
 *
 * Termination does not rest on that argument alone. The sweep count is capped by the measured
 * depth of the graph, so if the argument is ever wrong the worst case is the one-commit lag
 * this function already had, not a spin.
 *
 * **Two things this deliberately does not promise.** The result is a fixed point -- one more
 * sweep hands it back by reference -- but it is NOT necessarily what a single sweep against
 * fully resolved dependencies would have produced: for a manual rectilinear route,
 * `patchStart`/`patchEnd` composed with `collapseRoute` is path-dependent. That is not new; the
 * same two steps already run across a preview and its commit. And restacking a connection can
 * still change its route, because corridors still accumulate bottom-up.
 *
 * "No shape can observe its own output" survives, and is now load-bearing rather than
 * incidental: it rests on `conn.props.ts` refusing a connection as an endpoint, and on
 * `expand.ts` dropping a child whose parent cannot `expand`. A kind whose `bounds` depended on
 * its own children would break that argument and would have to arrive with a new one.
 */
export function rerouteAll(shapes: readonly Shape[]): readonly Shape[] {
  /*
    The lowest index that depends on each name, which is what makes the repeat sweep free in
    the common case: a second sweep is needed only when a shape CHANGED at an index above one
    of its own dependents. Dragging two connected blocks changes only the connections, and
    nothing depends on a connection -- one sweep, at exactly the cost this had before. A fabric
    drag with its ports seated above it is also one sweep, because of the read-back. Worth the
    care: this runs on every `pointermove`.
  */
  const firstDependent = new Map<ShapeName, number>();
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]!;
    for (const id of opsFor(s).dependsOn?.(s) ?? NO_DEPS) {
      const at = firstDependent.get(id);
      if (at === undefined || i < at) firstDependent.set(id, i);
    }
  }

  const cap = sweepCap(shapes);
  let current = shapes;
  for (let i = 0; i < cap; i++) {
    const pass = sweep(current, firstDependent);
    current = pass.shapes;
    if (pass.settled) break;
  }
  return current;
}

interface Pass {
  readonly shapes: readonly Shape[];
  /** False when a shape changed above one of its own dependents, which read the stale version. */
  readonly settled: boolean;
}

function sweep(shapes: readonly Shape[], firstDependent: ReadonlyMap<ShapeName, number>): Pass {
  const byId = new Map(shapes.map((s) => [s.name, s]));
  /*
    A FRESH index per sweep, never a reused one. Keeping the previous sweep's runs would offer
    corridors that no longer exist anywhere in the scene, and `BUNDLE_BONUS` is large enough to
    win against them.
  */
  const corridors = new CorridorIndex();
  let out: Shape[] | null = null;
  let settled = true;

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
    if (next !== s) {
      const dependent = firstDependent.get(s.name);
      if (dependent !== undefined && dependent < i) settled = false;
    }
    // Absorb what the shape actually became, never the version it had on entry.
    byId.set(next.name, next);
    corridors.absorb(next);
  }

  return { shapes: out ?? shapes, settled };
}

/**
 * How many sweeps can be needed, as the longest chain of `dependsOn` edges in THIS array.
 *
 * Derived rather than picked, on the precedent of `route.ts`'s `BUNDLE_REACH`: each sweep
 * finalises at least one more level of the graph even in the worst ordering, so a chain of `d`
 * edges settles within `d` sweeps. Today the deepest chain is `conn -> nif -> fabric`, so this
 * is 2, and it becomes 3 on the day some kind depends on a port's port.
 *
 * A cycle is a programming error -- a kind that declares its own dependent as a dependency --
 * rather than anything a document can express, so it fails loudly in development and degrades
 * to the old single-sweep behaviour in production.
 */
function sweepCap(shapes: readonly Shape[]): number {
  const byId = new Map(shapes.map((s) => [s.name, s]));
  const depth = new Map<ShapeName, number>();
  const open = new Set<ShapeName>();

  const walk = (s: Shape): number => {
    const seen = depth.get(s.name);
    if (seen !== undefined) return seen;
    if (open.has(s.name)) throw new Error(`dependency cycle through shape: ${s.name}`);
    open.add(s.name);
    let d = 0;
    for (const id of opsFor(s).dependsOn?.(s) ?? NO_DEPS) {
      const dep = byId.get(id);
      if (dep !== undefined) d = Math.max(d, walk(dep) + 1);
    }
    open.delete(s.name);
    depth.set(s.name, d);
    return d;
  };

  try {
    let max = 0;
    for (const s of shapes) max = Math.max(max, walk(s));
    return Math.max(1, max);
  } catch (err) {
    if (import.meta.env.DEV) throw err;
    return 1;
  }
}

/**
 * Which shapes a gesture should translate BODILY, given what the user selected.
 *
 * The select tool used to translate exactly the selection, and that is wrong at both ends.
 *
 * A shape that will be re-glued by `reroute` must not also be moved by hand, or it moves twice:
 * select a fabric together with one of its own ports and drag, and the port slides along the
 * border by the drag delta on top of arriving there with its parent. `Cmd+A` then a drag did it
 * to every port in the document.
 *
 * And a shape whose dependencies are ALL moving must be moved, not patched. A connection
 * between two ports of one fabric is the case: `reroute`'s manual branch splices the user's
 * interior points through verbatim and only slides the two ends, so a hand-drawn route between
 * two ends that both moved 200 units deforms instead of travelling. Translating it rigidly puts
 * its ends exactly where its ports arrive, so `patchStart`/`patchEnd` then find them already
 * correct and return by reference.
 *
 *   follows   = children, transitively, of anything in the selection  -- moved by reroute
 *   carried   = has dependencies, has no parent, and every dependency
 *               is in the selection or in `follows`                   -- moved bodily
 *   result    = (selection \ follows) ∪ carried
 *
 * **Why this is here and not inside `conn.reroute`.** The tempting version compares each end's
 * new anchor against the point it replaced and translates when the two deltas agree. It cannot
 * work: dragging a manual connection by its own BODY gives both ends a delta of exactly the
 * drag, so the rule reads the user's own gesture as a rigid move and undoes it. Geometry alone
 * cannot tell "my endpoints moved" from "I was moved" -- only the tool knows which it is.
 *
 * **Two things this deliberately does not cover.** Moving a fabric by typing into the property
 * panel is not a gesture, so a hand-drawn route between its ports still deforms there. And a
 * rigid translation can split a bundle that patching would have held together -- which is the
 * better trade, since patching a route whose ends both moved a thousand units is far worse.
 */
export function movesWith(
  shapes: readonly Shape[],
  selection: ReadonlySet<ShapeName>,
): ReadonlySet<ShapeName> {
  if (selection.size === 0) return selection;

  const moving = new Set(selection);
  const follows = new Set<ShapeName>();
  /*
    Children by parent, which is a walk rather than a lookup: a port's port would follow its
    grandparent too. In practice the depth is one, and building the index costs the same walk
    `expandChildren` already does on every commit.
  */
  const childrenOf = new Map<ShapeName, ShapeName[]>();
  for (const s of shapes) {
    const parent = opsFor(s).childOf?.(s) ?? null;
    if (parent === null || parent === '') continue;
    const list = childrenOf.get(parent);
    if (list === undefined) childrenOf.set(parent, [s.name]);
    else list.push(s.name);
  }

  const queue = [...selection];
  while (queue.length > 0) {
    for (const child of childrenOf.get(queue.pop()!) ?? []) {
      if (follows.has(child)) continue;
      follows.add(child);
      moving.add(child);
      queue.push(child);
    }
  }

  const out = new Set<ShapeName>();
  for (const name of selection) if (!follows.has(name)) out.add(name);
  for (const s of shapes) {
    const ops = opsFor(s);
    const parent = ops.childOf?.(s) ?? null;
    // A child is placed by its parent, never carried: that is what `follows` already covers.
    if (parent !== null && parent !== '') continue;
    const deps = ops.dependsOn?.(s);
    if (deps === undefined || deps.length === 0) continue;
    if (deps.every((id) => moving.has(id))) out.add(s.name);
  }
  return out;
}

export function resolveDependencies(shapes: readonly Shape[]): readonly Shape[] {
  return rerouteAll(pruneOrphans(shapes));
}
