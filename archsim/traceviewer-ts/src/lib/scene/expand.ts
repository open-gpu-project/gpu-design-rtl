import { nextIndexedName } from './names';
import { opsFor } from './registry';
import type { Shape, ShapeName } from './shape';

const EMPTY: readonly Shape[] = [];

/**
 * Reconcile parent-owned children, and re-seat them above their parents.
 *
 * **Why this is not in `resolve.ts`.** That module declares itself a pure function of the shape
 * array, and the select tool calls its `rerouteAll` directly against a mid-drag preview. Minting
 * a name is not pure, and nothing should be created mid-gesture. So `SceneStore.commit` runs this
 * between the mutation and `#resolveDependencies` -- "skipped during a drag, applied on commit"
 * becomes a property of the commit path rather than something that merely happens to be true.
 *
 * The minter here is built from the live name set rather than from `SceneStore.nextName`, whose
 * high-water counters are mutable state: this way the function is still a pure function of its
 * input, just not of the registry.
 *
 * **Re-seating is the second job and it is load-bearing.** Both `hitTest` and `anchorHitTest`
 * walk the z-order top-down, so an interface has to sit above the parent it is glued to or a
 * click on the border picks the parent and connections start attaching to the fabric's body
 * instead of to its port. Appending a new child would put it there once -- but one
 * `bringToFront` on the parent (`zorder.ts`) buries every child it owns. Children are therefore
 * re-seated immediately after their parent on every commit, which makes their position a
 * consequence of ownership rather than of gesture history.
 *
 * The commit's next pass, `seatByHierarchy`, re-seats the whole hierarchy by the same rule --
 * owned children straight after their owner, then the subtrees of what the owner encloses -- so
 * the re-seat here is that pass's owned-children case. It stays because a freshly minted child
 * has to be emitted somewhere, and this is where it is minted.
 *
 * A child whose parent is gone is dropped here. `pruneOrphans` would drop it a moment later
 * anyway, through `dependsOn`; doing it in the same sweep just avoids emitting it and then
 * removing it.
 *
 * Returns its input BY REFERENCE when nothing changed, which is the contract `commit` uses to
 * decide whether to record an undo entry.
 */
export function expandChildren(shapes: readonly Shape[]): readonly Shape[] {
  const byParent = new Map<ShapeName, Shape[]>();
  const isChild = new Set<ShapeName>();
  for (const s of shapes) {
    const parent = opsFor(s).childOf?.(s) ?? null;
    if (parent === null || parent === '') continue;
    isChild.add(s.name);
    const list = byParent.get(parent);
    if (list === undefined) byParent.set(parent, [s]);
    else list.push(s);
  }

  const taken = new Set(shapes.map((s) => s.name));
  const mint = (prefix: string): ShapeName => {
    const name = nextIndexedName(prefix, taken);
    // Added eagerly, so two children minted in one pass cannot collide.
    taken.add(name);
    return name;
  };

  const out: Shape[] = [];
  for (const s of shapes) {
    // Emitted with its parent below, or dropped if that parent is gone.
    if (isChild.has(s.name)) continue;
    out.push(s);

    const ops = opsFor(s);
    if (ops.expand === undefined) continue;
    const existing = byParent.get(s.name) ?? EMPTY;
    for (const child of ops.expand(s, existing, mint)) out.push(child);
  }

  // Element-wise, because `expand` returning `existing` by reference is only half the story:
  // the re-seating can also be a no-op, and usually is.
  if (out.length === shapes.length && out.every((s, i) => s === shapes[i])) return shapes;
  return out;
}
