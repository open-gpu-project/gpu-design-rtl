import { deserializeShape, opsFor } from './registry';
import type { SerializedShape, Shape } from './shape';

export interface SceneDoc {
  readonly version: 1;
  /** Array order is the z-order, bottom first. */
  readonly shapes: readonly SerializedShape[];
}

/**
 * Editor state only. This is deliberately unrelated to the simulator's BEVE trace format --
 * that is input data, this is the diagram you drew, and one serializer should not serve both.
 */
export function serializeScene(shapes: readonly Shape[]): SceneDoc {
  return { version: 1, shapes: shapes.map((s) => opsFor(s).serialize(s)) };
}

export function deserializeScene(doc: unknown): Shape[] {
  if (typeof doc !== 'object' || doc === null) return [];
  const raw = (doc as { shapes?: unknown }).shapes;
  if (!Array.isArray(raw)) return [];

  const out: Shape[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const data = item as SerializedShape;
    if (typeof data.kind !== 'string') continue;
    try {
      out.push(deserializeShape(data));
    } catch {
      // An unknown kind means a document from a newer build; skip rather than fail the load.
    }
  }
  return out;
}
