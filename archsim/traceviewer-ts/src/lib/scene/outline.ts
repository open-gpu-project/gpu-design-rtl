import { opsFor } from './registry';
import type { Shape, ShapeName } from './shape';

/**
 * The object tree's model: every shape, nested under the shape that owns it.
 *
 * Pure, and reads ownership through the `childOf` seam, so nothing here switches on `kind` --
 * a fabric's interfaces sit under the fabric because the `nif` kind says whose they are.
 */
export interface OutlineNode {
  readonly name: ShapeName;
  readonly kind: string;
  readonly label: string;
  readonly children: readonly OutlineNode[];
}

/** One diagram's worth of nodes, under a root row of its own. */
export interface OutlineRoot {
  /** The diagram's panel id. Never contains `:`, which is what keeps a row key unambiguous. */
  readonly id: string;
  readonly title: string;
  readonly nodes: readonly OutlineNode[];
}

/**
 * One visible row, flattened, with everything the markup reads and nothing else.
 *
 * The ARIA position fields are here rather than worked out in the markup so that the identity
 * check in `outlineRows` covers every value a row renders.
 */
export interface OutlineRow {
  /** `${diagram}` for a root row, `${diagram}:${name}` for an object. */
  readonly key: string;
  readonly diagram: string;
  /** Null for a diagram's root row. */
  readonly name: ShapeName | null;
  /** Null for a diagram's root row. */
  readonly kind: string | null;
  /** The shape's label, or the diagram's title on a root row. */
  readonly label: string;
  /** 1-based, as `aria-level` wants it: a root is 1, a top-level object 2. */
  readonly level: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly posinset: number;
  readonly setsize: number;
}

/**
 * Nest `shapes` by ownership, topmost first at every level -- the order a layers panel reads.
 *
 * A shape whose parent is missing, empty or itself sits at the top level. A malformed cycle
 * cannot lose a shape or loop: `placed` is checked before every descent, and whatever the walk
 * from the top level never reached is added at the top level afterwards, so every shape appears
 * exactly once.
 */
export function outlineOf(shapes: readonly Shape[]): OutlineNode[] {
  const names = new Set(shapes.map((s) => s.name));
  const children = new Map<ShapeName, Shape[]>();
  const top: Shape[] = [];

  // `shapes` is bottom-first, the order it paints in.
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    const parent = opsFor(s).childOf?.(s) ?? null;
    if (parent === null || parent === '' || parent === s.name || !names.has(parent)) {
      top.push(s);
      continue;
    }
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [s]);
    else list.push(s);
  }

  const placed = new Set<ShapeName>();
  const build = (s: Shape): OutlineNode => {
    placed.add(s.name);
    const kids: OutlineNode[] = [];
    for (const c of children.get(s.name) ?? []) {
      if (!placed.has(c.name)) kids.push(build(c));
    }
    return { name: s.name, kind: s.kind, label: s.label, children: kids };
  };

  const out: OutlineNode[] = [];
  for (const s of top) if (!placed.has(s.name)) out.push(build(s));
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (!placed.has(s.name)) out.push(build(s));
  }
  return out;
}

/**
 * The rows the tree shows, given which keys are open.
 *
 * Returns `prev` itself when every row matches it on every field -- the identity rule `reroute`
 * follows. A drag previews a new `shapes` array on every pointermove but never renames,
 * restacks or reparents, so the tree re-renders nothing for the whole of it.
 */
export function outlineRows(
  roots: readonly OutlineRoot[],
  open: ReadonlySet<string>,
  prev: readonly OutlineRow[] | null = null,
): readonly OutlineRow[] {
  const rows: OutlineRow[] = [];

  const walk = (diagram: string, nodes: readonly OutlineNode[], level: number): void => {
    nodes.forEach((n, i) => {
      const key = `${diagram}:${n.name}`;
      const expandable = n.children.length > 0;
      const expanded = expandable && open.has(key);
      rows.push({
        key,
        diagram,
        name: n.name,
        kind: n.kind,
        label: n.label,
        level,
        expandable,
        expanded,
        posinset: i + 1,
        setsize: nodes.length,
      });
      if (expanded) walk(diagram, n.children, level + 1);
    });
  };

  roots.forEach((r, i) => {
    const expanded = open.has(r.id);
    rows.push({
      key: r.id,
      diagram: r.id,
      name: null,
      kind: null,
      label: r.title,
      level: 1,
      expandable: true,
      expanded,
      posinset: i + 1,
      setsize: roots.length,
    });
    if (expanded) walk(r.id, r.nodes, 2);
  });

  return prev !== null && sameRows(prev, rows) ? prev : rows;
}

function sameRows(a: readonly OutlineRow[], b: readonly OutlineRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.key !== y.key ||
      x.diagram !== y.diagram ||
      x.name !== y.name ||
      x.kind !== y.kind ||
      x.label !== y.label ||
      x.level !== y.level ||
      x.expandable !== y.expandable ||
      x.expanded !== y.expanded ||
      x.posinset !== y.posinset ||
      x.setsize !== y.setsize
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The names of the shapes that own `name`, nearest first. Stops at a missing parent and at a
 * cycle, so a malformed document gives a short answer rather than a hang.
 */
export function ancestorsOf(shapes: readonly Shape[], name: ShapeName): ShapeName[] {
  const byName = new Map(shapes.map((s) => [s.name, s]));
  const out: ShapeName[] = [];
  const seen = new Set<ShapeName>([name]);
  let s = byName.get(name);
  while (s !== undefined) {
    const parent = opsFor(s).childOf?.(s) ?? null;
    if (parent === null || seen.has(parent) || !byName.has(parent)) break;
    out.push(parent);
    seen.add(parent);
    s = byName.get(parent);
  }
  return out;
}
