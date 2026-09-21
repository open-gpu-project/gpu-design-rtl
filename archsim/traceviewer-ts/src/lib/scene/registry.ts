import { hydrateShape } from '../props/project';
import type { PropContext, PropertyBag } from '../props/spec';
import type { Shape, ShapeBase, ShapeName, ShapeOps } from './shape';

const registry = new Map<string, ShapeOps<never>>();

/** True once any registered kind implements the connection seams, so commit can skip the walk. */
let anyDependent = false;

export function registerShape<S extends ShapeBase>(ops: ShapeOps<S>): void {
  if (registry.has(ops.kind)) {
    // Hot reload re-runs module side effects, so replacing is the only workable dev behaviour.
    if (!import.meta.env.DEV) throw new Error(`duplicate shape kind: ${ops.kind}`);
  }
  registry.set(ops.kind, ops as unknown as ShapeOps<never>);
  if (ops.dependsOn !== undefined) anyDependent = true;
}

/** A missing registration is a programming error, not a data error, so this throws. */
export function opsForKind(kind: string): ShapeOps<Shape> {
  const ops = registry.get(kind);
  if (ops === undefined) throw new Error(`no ShapeOps registered for kind: ${kind}`);
  return ops as unknown as ShapeOps<Shape>;
}

export function opsFor(s: Shape): ShapeOps<Shape> {
  return opsForKind(s.kind);
}

/** Non-throwing lookup, for data that came from a file rather than from this build. */
export function tryOpsForKind(kind: unknown): ShapeOps<Shape> | null {
  if (typeof kind !== 'string') return null;
  return (registry.get(kind) as unknown as ShapeOps<Shape> | undefined) ?? null;
}

export function registryHasDependencies(): boolean {
  return anyDependent;
}

/**
 * Rebuild one shape from a file record under a caller-chosen name.
 *
 * The name is a parameter rather than read from `bag` because identity is the name: only the
 * caller loading the whole document can see the other names and resolve a collision.
 */
export function deserializeShape(
  bag: PropertyBag,
  name: ShapeName,
  ctx: PropContext,
): Shape | null {
  const ops = tryOpsForKind(bag['kind']);
  if (ops === null) return null;
  return hydrateShape(ops.props, ops.blank(name), bag, ctx);
}
