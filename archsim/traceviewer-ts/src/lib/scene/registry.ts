import type { SerializedShape, Shape, ShapeBase, ShapeOps } from './shape';

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

export function registryHasDependencies(): boolean {
  return anyDependent;
}

export function deserializeShape(data: SerializedShape): Shape {
  return opsForKind(data.kind).deserialize(data);
}
