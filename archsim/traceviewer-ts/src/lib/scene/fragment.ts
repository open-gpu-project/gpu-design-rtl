import type { Vec2 } from '../geom/types';
import { GRID, snapPoint } from '../grid';
import { unionBounds } from './bounds';
import { nextFreeIndexedName } from './names';
import { opsFor } from './registry';
import { pruneOrphans } from './resolve';
import { deserializeScene, serializeScene, type SceneDoc } from './serialize';
import type { Shape, ShapeName } from './shape';

/**
 * A detached piece of a scene: what the clipboard holds, and how it comes back.
 *
 * Deliberately pure -- no store, no DOM, no clipboard API. `ToolHost` owns the slot the doc
 * sits in and the gestures around it; everything here is a function of its arguments, which is
 * what lets `verify/` drive the hard parts without a pointer.
 *
 * The payload is a real `SceneDoc`, the same record `serializeScene` writes. There is no
 * second format: the thing you copy is the thing the file format already describes.
 */

/**
 * Stable order in which every shape follows everything in the fragment it depends on.
 *
 * Needed because `deserializeScene` is single-pass: its `PropContext` holds only the records
 * already loaded, and a connection whose endpoint has not been built yet fails `checkEndpoint`,
 * loses its `source`/`target` write, and is then dropped as degenerate. Blocks normally sit
 * below their wires so the z-order already satisfies this -- but `bringToFront` on a block, or
 * `sendToBack` on a wire, inverts it, and nothing in `zorder.ts` maintains the invariant.
 *
 * Kahn's algorithm with the original index as the tie-break, so the fragment's z-order survives
 * wherever the dependencies permit. Returns the input by reference when nothing had to move,
 * the convention every function in `resolve.ts` follows.
 */
export function dependencyOrder(shapes: readonly Shape[]): readonly Shape[] {
  const present = new Set(shapes.map((s) => s.name));
  const pending = shapes.map((s) => ({
    shape: s,
    // Only dependencies inside the fragment can constrain the order within it.
    waiting: new Set(
      (opsFor(s).dependsOn?.(s) ?? []).filter((d) => present.has(d) && d !== s.name),
    ),
  }));

  const out: Shape[] = [];
  const placed = new Set<ShapeName>();
  while (out.length < shapes.length) {
    const next = pending.find((e) => !placed.has(e.shape.name) && e.waiting.size === 0);
    // A dependency cycle cannot be ordered. It should be impossible -- `conn` refuses to attach
    // both ends to one block -- so emit the rest as-is rather than looping forever.
    if (next === undefined) {
      for (const e of pending) if (!placed.has(e.shape.name)) out.push(e.shape);
      break;
    }
    out.push(next.shape);
    placed.add(next.shape.name);
    for (const e of pending) e.waiting.delete(next.shape.name);
  }

  return out.every((s, i) => s === shapes[i]) ? shapes : out;
}

/**
 * The selected shapes as a self-contained document, or null when nothing whole is selected.
 *
 * `pruneOrphans` over the filtered sub-array is what implements "a connection comes along only
 * if both its blocks do": an unselected endpoint is simply absent, so the wire is an orphan.
 * Reusing it rather than hand-rolling the predicate settles cascades to a fixed point and keeps
 * the rule kind-agnostic.
 */
export function copyFragment(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
): SceneDoc | null {
  const keep = pruneOrphans(shapes.filter((s) => ids.has(s.name)));
  if (keep.length === 0) return null;
  // Safe over a sub-array: the only property that reads its `PropContext` is the computed
  // `zIndex`, and `serializeShape` skips computed keys.
  return serializeScene(dependencyOrder(keep));
}

/**
 * Rebuild a fragment under names that are free in `live`. Never throws; drops what it cannot
 * load, since a clipboard doc may have been hand-edited.
 */
export function readFragment(doc: unknown, live: ReadonlySet<ShapeName>): readonly Shape[] {
  // Loads under the fragment's ORIGINAL names. That is the point: the connections name blocks
  // that are in this same array, so `checkEndpoint` is satisfied even when every one of those
  // names is also taken in the live scene.
  const loaded = deserializeScene(doc);
  const normalized = loaded
    .map((s) => opsFor(s).normalize(s))
    .filter((s): s is Shape => s !== null);
  const clean = pruneOrphans(normalized);
  if (clean.length === 0) return [];

  /*
    Mint every name before applying any rename.

    Reserving the fragment's own names alongside the live ones is load-bearing, not caution. If
    minting only avoided live names, copying `block0` into a scene holding `block0` could mint
    `block1` -- the name of another, still-unrenamed shape in the same fragment. The rename
    sweep for `block0 -> block1` would then be followed by the sweep for `block1 -> block2`,
    which rewrites the endpoint the first sweep just wrote. A wire silently ends up with both
    ends on one block, which `pruneOrphans` cannot catch because that block does exist.
  */
  const taken = new Set<ShapeName>([...live, ...clean.map((s) => s.name)]);
  const renames = new Map<ShapeName, ShapeName>();
  for (const s of clean) {
    // Free in the scene: keep it. This is what makes paste into an unrelated document -- or
    // back after a cut -- restore the original names exactly.
    if (!live.has(s.name)) continue;
    const name = nextFreeIndexedName(s.name, taken);
    taken.add(name);
    renames.set(s.name, name);
  }
  if (renames.size === 0) return clean;

  // `renameRef` is the same seam `SceneStore.replaceShape` drives for an ordinary rename, so
  // the clipboard never has to know that a connection keeps its endpoints in `from`/`to`.
  let out = clean;
  for (const [from, to] of renames) {
    out = out.map((s) => opsFor(s).renameRef?.(s, from, to) ?? s);
  }
  return out.map((s) => {
    const name = renames.get(s.name);
    return name === undefined ? s : ({ ...s, name } as Shape);
  });
}

/**
 * The grid-aligned vector that puts the fragment's bounding-box centre on `at`.
 *
 * The *delta* is snapped, never the individual shapes: one vector for the whole fragment keeps
 * its internal geometry rigid. Snapping per shape after translating would shear it, and would
 * pull a `manual` route off its own endpoints, so `patchStart`/`patchEnd` would drag the first
 * and last runs to compensate and the route would arrive bent.
 */
export function centringDelta(shapes: readonly Shape[], at: Vec2): Vec2 {
  const b = unionBounds(shapes);
  if (b === null) return { x: 0, y: 0 };
  return snapPoint({ x: at.x - (b.x + b.w / 2), y: at.y - (b.y + b.h / 2) });
}

/** The offset a paste with no pointer anchor uses, cascading so repeats do not stack. */
export function cascadeDelta(step: number): Vec2 {
  return { x: GRID * step, y: GRID * step };
}

export function translateAll(shapes: readonly Shape[], d: Vec2): readonly Shape[] {
  if (d.x === 0 && d.y === 0) return shapes;
  return shapes.map((s) => opsFor(s).translate(s, d));
}
