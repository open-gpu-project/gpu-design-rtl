import { hierarchyOf } from './hierarchy';
import type { Shape, ShapeName } from './shape';

/**
 * The object tree's model: every shape, nested under its parent in the hierarchy.
 *
 * Pure, and reads the nesting from `hierarchyOf`, so it is the same nesting a drag carries, a
 * delete takes and the canvas highlights: a block under the block it lies in, an interface under
 * its owner, a wire under the block both its ends lie in. Nothing here switches on `kind`.
 *
 * Links are folded. A diagram has a wire for every pair of things that talk, and listed one row
 * each they buried the blocks the tree is for. So wherever two or more links lie next to each
 * other in one parent's list, they go under a single row in the place they would have had, and a
 * link with an object on either side of it stays a row of its own.
 */
export type OutlineNode = OutlineObject | OutlineWires;

/** One shape, and what it contains. */
export interface OutlineObject {
  readonly type: 'object';
  readonly name: ShapeName;
  readonly kind: string;
  readonly label: string;
  readonly children: readonly OutlineNode[];
}

/** Two or more links side by side in one parent's list, folded into one row. */
export interface OutlineWires {
  readonly type: 'wires';
  /** The links, topmost first, as they would have been listed unfolded. None has children. */
  readonly children: readonly OutlineObject[];
}

/** One diagram's worth of nodes, under a root row of its own. */
export interface OutlineRoot {
  /**
   * The diagram's panel id. Never contains `:` or `/`, which is what keeps a row key
   * unambiguous whatever the shapes are named.
   */
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
  /**
   * `${diagram}` for a root row, `${diagram}:${name}` for an object, and
   * `${diagram}/wires:${name}` for folded links, after the bottom-most of them. That one is
   * usually the oldest, and a link drawn later lands on top, so the key -- and whether the row
   * is open -- survives drawing more.
   */
  readonly key: string;
  readonly diagram: string;
  readonly role: 'diagram' | 'object' | 'wires';
  /** The object's name. Null on a root row and on folded links. */
  readonly name: ShapeName | null;
  /** The object's kind, or on folded links the first one's, for the icon. Null on a root row. */
  readonly kind: string | null;
  /** The shape's label, or the diagram's title on a root row. Empty on folded links. */
  readonly label: string;
  /** How many links a folded row holds; 0 on every other row. */
  readonly count: number;
  /** 1-based, as `aria-level` wants it: a root is 1, a top-level object 2. */
  readonly level: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly posinset: number;
  readonly setsize: number;
}

/**
 * Nest `shapes` by the hierarchy, topmost first at every level -- the order a layers panel reads.
 *
 * Topmost first among a node's children too, owned or not. On a committed array the grouped
 * children are seated above their parent's interfaces, so a block lists what it contains first
 * and its own interfaces last.
 *
 * Every shape appears exactly once, which rests on `hierarchyOf` being a forest over the whole
 * array for any input at all -- a cycle, a dangling owner, a shape with no geometry.
 * `verify/objects.mjs` feeds it those through here. Folding never hides anything a link
 * contains, because nothing can have a link as its parent.
 */
export function outlineOf(shapes: readonly Shape[]): OutlineNode[] {
  const h = hierarchyOf(shapes);
  const rows = (list: readonly Shape[]): OutlineNode[] => {
    const out: OutlineNode[] = [];
    let run: OutlineObject[] = [];
    const flush = (): void => {
      if (run.length > 1) out.push({ type: 'wires', children: run });
      else out.push(...run);
      run = [];
    };
    // `list` is bottom-first, the order it paints in, hence walking it backwards.
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]!;
      const node: OutlineObject = {
        type: 'object',
        name: s.name,
        kind: s.kind,
        label: s.label,
        children: rows(h.childrenOf(s.name)),
      };
      if (h.isLink(s.name)) {
        run.push(node);
      } else {
        flush();
        out.push(node);
      }
    }
    flush();
    return out;
  };
  return rows(h.roots);
}

const keyOf = (diagram: string, n: OutlineNode): string =>
  n.type === 'object'
    ? `${diagram}:${n.name}`
    : `${diagram}/wires:${n.children[n.children.length - 1]!.name}`;

/**
 * The keys of the rows that must be open for `name`'s row to show, outermost first: the
 * diagram's root, every ancestor, and the folded row it sits in if it does. Null when the
 * diagram has no such object.
 */
export function pathTo(root: OutlineRoot, name: ShapeName): string[] | null {
  const find = (nodes: readonly OutlineNode[], path: string[]): string[] | null => {
    for (const n of nodes) {
      if (n.type === 'object' && n.name === name) return path;
      const found = find(n.children, [...path, keyOf(root.id, n)]);
      if (found !== null) return found;
    }
    return null;
  };
  return find(root.nodes, [root.id]);
}

/**
 * The rows the tree shows, given which keys are open.
 *
 * Returns `prev` itself when every row matches it on every field -- the identity rule `reroute`
 * follows. A drag previews a new `shapes` array on every pointermove but never renames or
 * restacks, so the tree re-renders nothing for it -- except when the drag carries something
 * across a block's border. Then the row moves to its new parent while the drag is still going,
 * as the canvas's ancestor outline does, and settles again at once.
 */
export function outlineRows(
  roots: readonly OutlineRoot[],
  open: ReadonlySet<string>,
  prev: readonly OutlineRow[] | null = null,
): readonly OutlineRow[] {
  const rows: OutlineRow[] = [];

  const walk = (diagram: string, nodes: readonly OutlineNode[], level: number): void => {
    nodes.forEach((n, i) => {
      const key = keyOf(diagram, n);
      const expandable = n.children.length > 0;
      const expanded = expandable && open.has(key);
      const folded = n.type === 'wires';
      rows.push({
        key,
        diagram,
        role: folded ? 'wires' : 'object',
        name: folded ? null : n.name,
        kind: folded ? n.children[0]!.kind : n.kind,
        label: folded ? '' : n.label,
        count: folded ? n.children.length : 0,
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
      role: 'diagram',
      name: null,
      kind: null,
      label: r.title,
      count: 0,
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
      x.role !== y.role ||
      x.name !== y.name ||
      x.kind !== y.kind ||
      x.label !== y.label ||
      x.count !== y.count ||
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
