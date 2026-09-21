import type { PropContext, PropertyBag } from '../props/spec';
import { serializeShape } from '../props/project';
import { uniqueName } from './names';
import { deserializeShape, opsFor } from './registry';
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

export function deserializeScene(doc: unknown): Shape[] {
  if (typeof doc !== 'object' || doc === null) return [];
  const raw = (doc as { shapes?: unknown }).shapes;
  if (!Array.isArray(raw)) return [];

  const out: Shape[] = [];
  const taken = new Set<ShapeName>();

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const bag = item as PropertyBag;

    // Identity is the name, so a document with two `alu` blocks has to be repaired rather than
    // loaded as-is. Suffixing keeps both, which is what someone merging two diagrams wants.
    const desired = typeof bag['name'] === 'string' ? bag['name'] : '';
    const name = uniqueName(desired, taken);

    const ctx: PropContext = { shapes: out, index: out.length };
    const shape = deserializeShape(bag, name, ctx);
    // A null means an unknown kind: a document from a newer build. Skip rather than fail the load.
    if (shape === null) continue;

    taken.add(shape.name);
    out.push(shape);
  }
  return out;
}
