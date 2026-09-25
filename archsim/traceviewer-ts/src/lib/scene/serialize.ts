import type { PropContext, PropertyBag } from '../props/spec';
import { hydrateShape, serializeShape } from '../props/project';
import { uniqueName } from './names';
import { opsFor, tryOpsForKind } from './registry';
import { pruneOrphans } from './resolve';
import type { Shape, ShapeName } from './shape';

export interface SceneDoc {
  /** 2 since properties became the file format. Iteration 1 wrote `1` with flat x/y/w/h. */
  readonly version: 2;
  /** Array order is the z-order, bottom first. This is why records carry no `zIndex`. */
  readonly shapes: readonly PropertyBag[];
}

/**
 * Editor state only. This is deliberately unrelated to the simulator's BEVE trace format --
 * that is input data, this is the diagram you drew, and one serializer should not serve both.
 *
 * A record here is exactly the property panel's document minus its computed keys, so the file
 * and the editor can never drift apart: there is one projection, used twice.
 */
export function serializeScene(shapes: readonly Shape[]): SceneDoc {
  return {
    version: 2,
    shapes: shapes.map((s, index) => serializeShape(opsFor(s).props, s, { shapes, index })),
  };
}

/**
 * Rebuild a document, leniently and in two passes.
 *
 * **Two passes, because one is order-sensitive and the order is not ours to choose.** A record's
 * writers see the shapes loaded so far -- `checkEndpoint` in `conn.props.ts` validates an
 * endpoint against them -- while the array order in the file is the *z-order*, which says
 * nothing about what depends on what. A connection stored below its blocks (one `Cmd+[` does
 * that) would have had its endpoints refused, kept `blank`'s empty `from`, and been dropped by
 * `normalize` without a word. Iteration 5.2 flagged it as latent; iteration 6 makes the
 * dependency chain three deep -- fabric to interface to connection -- which would have made it
 * ordinary rather than obscure.
 *
 * So pass one creates every shape under its final name, and pass two fills them in. By then
 * every name a writer might look up already exists, and the fix costs no reordering: sorting
 * the file topologically instead would have silently restacked the diagram, since array order
 * IS the z-order.
 *
 * Pass two mutates `out` in place as it goes, which is deliberate -- `ctx.shapes` is that same
 * array, so a writer sees final names throughout and real geometry for everything before it.
 */
export function deserializeScene(doc: unknown): Shape[] {
  if (typeof doc !== 'object' || doc === null) return [];
  const raw = (doc as { shapes?: unknown }).shapes;
  if (!Array.isArray(raw)) return [];

  const bags: PropertyBag[] = [];
  const out: Shape[] = [];
  const taken = new Set<ShapeName>();

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const bag = item as PropertyBag;
    // A missing registration means an unknown kind: a document from a newer build. Skip rather
    // than fail the load.
    const ops = tryOpsForKind(bag['kind']);
    if (ops === null) continue;

    // Identity is the name, so a document with two `alu` blocks has to be repaired rather than
    // loaded as-is. Suffixing keeps both, which is what someone merging two diagrams wants.
    const desired = typeof bag['name'] === 'string' ? bag['name'] : '';
    const name = uniqueName(desired, taken);
    taken.add(name);

    bags.push(bag);
    out.push(ops.blank(name));
  }

  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    const ctx: PropContext = { shapes: out, index: i };
    out[i] = hydrateShape(opsFor(s).props, s, bags[i]!, ctx);
  }
  return out;
}

/**
 * The full lenient read: rebuild, canonicalise, then drop what has nothing left to hang off.
 *
 * `deserializeScene` alone is not enough and never was, which the two callers that existed before
 * this function both knew and only one of them wrote down. It runs no `normalize`, so a
 * degenerate rect from a hand-edited file arrives with zero extent and is drawn as nothing; and
 * it runs no `pruneOrphans`, so a connection naming a block the file does not contain is kept
 * with an endpoint resolving nowhere. `readFragment` has always done all three -- this is that
 * pipeline, named, so the file path and the clipboard path cannot drift.
 *
 * `dropped` counts the records that did not survive, including the unknown kinds
 * `deserializeScene` skipped. A load that silently lost half a diagram is worse than one that
 * says so, and the count is the only thing a caller can say about it: which records went, and
 * why, is not a question this pipeline can answer without becoming a validator.
 */
export function readDocument(doc: unknown): { shapes: readonly Shape[]; dropped: number } {
  const raw = typeof doc === 'object' && doc !== null ? (doc as { shapes?: unknown }).shapes : null;
  const offered = Array.isArray(raw) ? raw.length : 0;
  const loaded = deserializeScene(doc);
  const normalized = loaded
    .map((s) => opsFor(s).normalize(s))
    .filter((s): s is Shape => s !== null);
  const shapes = pruneOrphans(normalized);
  return { shapes, dropped: offered - shapes.length };
}
