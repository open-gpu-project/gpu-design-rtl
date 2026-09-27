import { rectContains } from '../geom/math';
import type { Rect } from '../geom/types';
import { opsFor } from './registry';
import type { Shape, ShapeName } from './shape';

/**
 * The parent/child hierarchy: a pure function of the shape array, never stored on a shape.
 *
 * Because it is derived, undo, file load and paste need nothing: whatever array they restore,
 * its hierarchy follows from where things are. There is no way to group by hand, and no field
 * that could disagree with the geometry.
 *
 * Each shape's role is read off existing seams, so nothing here switches on `kind`:
 *
 *   owned   the kind has `childOf` (a box's interface)
 *                                    -> the owner it names if that is valid, else the top level
 *   link    no `childOf`, non-empty `dependsOn` (a connection)
 *                                    -> the shape whose own parts it joins, if there is one;
 *                                       else the first ADOPTING shape common to both ends'
 *                                       inclusive ancestor chains; else the top level
 *   placed  anything else (a block, a FIFO, a fabric)
 *                                    -> the smallest-area adopting shape whose bounds contain
 *                                       its bounds, edges included, else the top level
 *
 * **A valid owner** exists, is not the shape itself, and is not owned in turn. Ownership is one
 * level deep, which `expandChildren` already enforces on every commit by never emitting a
 * child's child, so the rule only bites on input nothing committed: the malformed documents the
 * object tree's checks feed it. A child without a valid owner -- a missing one, an empty one --
 * sits at the top level as a stray. It is a child kind still, so it is neither enclosed by a
 * block nor taken for a wire, although it depends on the parent it names.
 *
 * **Ties among placed parents.** Two rectangles with identical bounds nest by z-order: the
 * nearer LOWER one is the parent, so three identical rectangles form a chain rather than a
 * cycle, and a shape inside them all goes to the deepest. Two of equal area that are not nested
 * compare by name, with plain `<`, so the answer does not depend on z-order and re-seating it
 * cannot change it.
 *
 * **A wire among one shape's own parts is that shape's**, whether or not it adopts: between two of
 * its interfaces, or from the shape to one of them. That is how a fabric, which encloses nothing,
 * still holds its internal routing -- the links a crossbar makes between its own ports, which are
 * part of it wherever their route happens to run. For a block it changes nothing, since a block
 * adopts and would be the first common ancestor anyway.
 *
 * **Overlap without nesting cannot form a tree.** A shape inside two rectangles that only
 * partly overlap each other goes to the smaller one, and dragging the larger does not carry it.
 *
 * Nothing can have a connection as its parent: a link is never a candidate, not even as the shape
 * whose parts a wire joins, and `conn.props` refuses a connection as an endpoint, so no chain
 * passes through one. Nor can an interface: a wire's own-parts parent is an end's OWNER.
 */
export interface Hierarchy {
  /** The parent of `name`, or null at the top level or for a name not in the scene. */
  parentOf(name: ShapeName): ShapeName | null;
  /** Whether `name`'s parent OWNS it, rather than enclosing it or being a wire's container. */
  isOwned(name: ShapeName): boolean;
  /** Whether `name` is a link: it has no owner and depends on other shapes. A connection. */
  isLink(name: ShapeName): boolean;
  /**
   * Whether `name` is placed: neither owned nor a link, so its parent comes from its bounds. A
   * block, a FIFO, a fabric. What alignment snaps, and what it snaps to.
   */
  isPlaced(name: ShapeName): boolean;
  /** The top-level shapes, in z-order (bottom first). */
  readonly roots: readonly Shape[];
  /** Every child of `name`, owned or not, in z-order. */
  childrenOf(name: ShapeName): readonly Shape[];
  /** The children `name` owns: its interfaces. In z-order. */
  ownedOf(name: ShapeName): readonly Shape[];
  /** The children `name` does not own: what it encloses, and the wires it is the container of. */
  groupedOf(name: ShapeName): readonly Shape[];
  /** The parents of `name`, nearest first. Empty at the top level. */
  ancestors(name: ShapeName): readonly ShapeName[];
  /**
   * The parent a placed shape with bounds `b`, at z-index `index`, would get, with the adopters
   * in `skip` left out.
   *
   * For a shape that is not where the array says: one mid-gesture, whose moving set is `skip`,
   * or one being drawn, which is not in the array yet and passes `shapes.length` because it will
   * be appended on top. The rules, ties included, are the ones every placed shape gets.
   */
  parentFor(b: Rect, index: number, skip: ReadonlySet<ShapeName>): ShapeName | null;
}

const NONE: readonly Shape[] = [];
const NO_NAMES: readonly ShapeName[] = [];

/**
 * Memoised on array identity.
 *
 * Which is what lets the renderer, the object tree and the Properties row all ask on every
 * frame, preview frames included, for the price of one build per array. The price of the memo
 * is a rule: an array handed here must never be mutated afterwards. `deserializeScene` fills its
 * array in place while hydrating, so no property's `write` may call this; the array it returns
 * is finished, and is fine.
 */
const memo = new WeakMap<readonly Shape[], Hierarchy>();

export function hierarchyOf(shapes: readonly Shape[]): Hierarchy {
  let h = memo.get(shapes);
  if (h === undefined) {
    h = build(shapes);
    memo.set(shapes, h);
  }
  return h;
}

/** The owner a shape claims through `childOf`, with `''` read as none. */
function claimedOwner(s: Shape): ShapeName | null {
  const owner = opsFor(s).childOf?.(s) ?? null;
  return owner === null || owner === '' ? null : owner;
}

function adopts(s: Shape): boolean {
  return opsFor(s).adopts?.(s) === true;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

interface Candidate {
  readonly s: Shape;
  readonly index: number;
  readonly b: Rect;
  readonly area: number;
}

function build(shapes: readonly Shape[]): Hierarchy {
  const byName = new Map<ShapeName, Shape>();
  for (const s of shapes) byName.set(s.name, s);

  const parent = new Map<ShapeName, ShapeName>();
  const owned = new Set<ShapeName>();
  const links: Shape[] = [];
  const placed: Candidate[] = [];
  const adopters: Candidate[] = [];

  shapes.forEach((s, index) => {
    if (opsFor(s).childOf !== undefined) {
      const owner = claimedOwner(s);
      const o = owner === null ? undefined : byName.get(owner);
      if (o !== undefined && o.name !== s.name && claimedOwner(o) === null) {
        parent.set(s.name, o.name);
        owned.add(s.name);
      }
      return;
    }
    if ((opsFor(s).dependsOn?.(s) ?? NO_NAMES).length > 0) {
      links.push(s);
      return;
    }
    const b = opsFor(s).bounds(s);
    const c: Candidate = { s, index, b, area: b.w * b.h };
    placed.push(c);
    if (adopts(s)) adopters.push(c);
  });

  for (const c of placed) {
    const best = placedParent(c.b, c.index, adopters, (a) => a.s === c.s);
    if (best !== null) parent.set(c.s.name, best.s.name);
  }
  const placedNames = new Set(placed.map((c) => c.s.name));

  // Ancestors of owned and placed shapes only: a link's chain never passes through a link.
  const chain = (name: ShapeName): ShapeName[] => {
    const out = [name];
    for (let p = parent.get(name); p !== undefined; p = parent.get(p)) {
      // Acyclic by construction; the guard is for the day that stops being true.
      if (out.includes(p)) break;
      out.push(p);
    }
    return out;
  };

  const linkNames = new Set(links.map((s) => s.name));
  // What an end is part of: its owner if it is an interface, else itself.
  const unitOf = (e: ShapeName): ShapeName => (owned.has(e) ? parent.get(e)! : e);

  for (const s of links) {
    const ends = opsFor(s).dependsOn?.(s) ?? NO_NAMES;
    if (!ends.every((e) => byName.has(e))) continue;
    // One shape's own parts: that shape's. At least one end must be an interface, so a shape
    // wired to itself -- which only a hand-edited file can hold -- does not become a parent.
    const unit = unitOf(ends[0]!);
    if (
      !linkNames.has(unit) &&
      ends.some((e) => owned.has(e)) &&
      ends.every((e) => unitOf(e) === unit)
    ) {
      parent.set(s.name, unit);
      continue;
    }
    const others = ends.slice(1).map((e) => new Set(chain(e)));
    const common = chain(ends[0]!).find(
      (x) => adopts(byName.get(x)!) && others.every((o) => o.has(x)),
    );
    if (common !== undefined) parent.set(s.name, common);
  }

  const children = new Map<ShapeName, Shape[]>();
  const roots: Shape[] = [];
  for (const s of shapes) {
    const p = parent.get(s.name);
    if (p === undefined) {
      roots.push(s);
      continue;
    }
    const list = children.get(p);
    if (list === undefined) children.set(p, [s]);
    else list.push(s);
  }

  if (import.meta.env.DEV) assertAcyclic(parent);

  const ownedLists = new Map<ShapeName, readonly Shape[]>();
  const groupedLists = new Map<ShapeName, readonly Shape[]>();
  for (const [p, list] of children) {
    ownedLists.set(
      p,
      list.filter((c) => owned.has(c.name)),
    );
    groupedLists.set(
      p,
      list.filter((c) => !owned.has(c.name)),
    );
  }

  return {
    parentOf: (name) => parent.get(name) ?? null,
    isOwned: (name) => owned.has(name),
    isLink: (name) => linkNames.has(name),
    isPlaced: (name) => placedNames.has(name),
    roots,
    childrenOf: (name) => children.get(name) ?? NONE,
    ownedOf: (name) => ownedLists.get(name) ?? NONE,
    groupedOf: (name) => groupedLists.get(name) ?? NONE,
    ancestors: (name) => (parent.has(name) ? chain(name).slice(1) : NO_NAMES),
    parentFor: (b, index, skip) =>
      placedParent(b, index, adopters, (a) => skip.has(a.s.name))?.s.name ?? null,
  };
}

/**
 * The smallest-area adopting shape that contains bounds `b` at z-index `index`, with the ties
 * documented on `Hierarchy`. `excluded` names the adopters that may not be the answer: the shape
 * itself, or a gesture's moving set.
 *
 * Containment is tested before area is compared, so a shape with no usable geometry -- NaN
 * bounds, as a hand-fed record without a position has -- contains nothing and is contained by
 * nothing, and simply sits at the top level.
 */
function placedParent(
  b: Rect,
  index: number,
  adopters: readonly Candidate[],
  excluded: (a: Candidate) => boolean,
): Candidate | null {
  let best: Candidate | null = null;
  for (const a of adopters) {
    if (excluded(a) || !rectContains(a.b, b)) continue;
    // An identical rectangle is a parent only from below, which is what makes a chain of them.
    if (a.index > index && sameRect(a.b, b)) continue;
    if (best === null || a.area < best.area) {
      best = a;
    } else if (a.area === best.area) {
      if (sameRect(a.b, best.b)) {
        // Both identical: the higher one is the lower one's child, so it is the nearer parent.
        if (a.index > best.index) best = a;
      } else if (a.s.name < best.s.name) {
        best = a;
      }
    }
  }
  return best;
}

function assertAcyclic(parent: ReadonlyMap<ShapeName, ShapeName>): void {
  for (const start of parent.keys()) {
    const seen = new Set<ShapeName>([start]);
    for (let p = parent.get(start); p !== undefined; p = parent.get(p)) {
      if (seen.has(p)) throw new Error(`hierarchy cycle through shape: ${start}`);
      seen.add(p);
    }
  }
}

/**
 * `ids` and everything under them, transitively. Returns `ids` BY REFERENCE when none of them
 * has a child, so a caller can tell "nothing to add" by identity.
 */
export function withDescendants(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
): ReadonlySet<ShapeName> {
  if (ids.size === 0) return ids;
  const h = hierarchyOf(shapes);
  const added = new Set<ShapeName>();
  const queue = [...ids];
  while (queue.length > 0) {
    for (const c of h.childrenOf(queue.pop()!)) {
      if (ids.has(c.name) || added.has(c.name)) continue;
      added.add(c.name);
      queue.push(c.name);
    }
  }
  return added.size === 0 ? ids : new Set([...ids, ...added]);
}

/** Every ancestor of anything in `ids`, excluding `ids` themselves. */
export function ancestorsOf(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
): ReadonlySet<ShapeName> {
  const h = hierarchyOf(shapes);
  const out = new Set<ShapeName>();
  for (const id of ids) {
    for (const a of h.ancestors(id)) {
      if (out.has(a)) break;
      if (!ids.has(a)) out.add(a);
    }
  }
  return out;
}

/**
 * The array in pre-order: each shape, then its owned children, then the subtrees of what it
 * groups, with every sibling list passed through `arrange` first.
 *
 * Owned children come straight after their owner, which is the invariant `expandChildren` has
 * always kept -- `hitTest` and `anchorHitTest` walk top-down and must find an interface above
 * the box it is glued to, and `rerouteAll` settles in one sweep because a port follows its
 * parent. The grouped subtrees then sit above both, so a child is always drawn over the block
 * that contains it.
 *
 * Returns null if the forest does not cover the array. It always does, since every shape has a
 * parent or is a root and the parents cannot cycle; the null is so a broken invariant costs a
 * re-seat rather than a shape.
 */
function emitForest(
  shapes: readonly Shape[],
  arrange: (siblings: readonly Shape[]) => readonly Shape[],
): Shape[] | null {
  const h = hierarchyOf(shapes);
  const out: Shape[] = [];
  const visit = (s: Shape): void => {
    out.push(s);
    for (const c of arrange(h.ownedOf(s.name))) visit(c);
    for (const c of arrange(h.groupedOf(s.name))) visit(c);
  };
  for (const r of arrange(h.roots)) visit(r);
  return out.length === shapes.length ? out : null;
}

function sameOrder(a: readonly Shape[], b: readonly Shape[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/**
 * Re-seat every child above its parent, on every commit.
 *
 * Roots and every sibling list keep their existing relative order, so this is the identity on a
 * flat scene and on any array it has already seated -- and returns its input BY REFERENCE then,
 * which `SceneStore.commit` relies on to record no entry for a commit that changed nothing.
 */
export function seatByHierarchy(shapes: readonly Shape[]): readonly Shape[] {
  const out = emitForest(shapes, (list) => list);
  return out === null || sameOrder(out, shapes) ? shapes : out;
}

/**
 * A restack applied within each sibling list, then re-emitted in pre-order.
 *
 * `fn` is one of the four `zorder.ts` transforms. Run over the whole array, a transform can step a
 * child past its own parent or out of its parent's block, and the next commit's re-seat would
 * silently put it back -- after recording an undo entry for a move that did not happen. Run per
 * sibling list, a child brought to front stays inside its parent's block, a child sent to back
 * stays above its parent, and a parent carries its subtree. Returns `shapes` by reference when
 * nothing moved.
 */
export function restackTree(
  shapes: readonly Shape[],
  ids: ReadonlySet<ShapeName>,
  fn: (shapes: readonly Shape[], ids: ReadonlySet<ShapeName>) => readonly Shape[],
): readonly Shape[] {
  if (ids.size === 0) return shapes;
  const out = emitForest(shapes, (list) => fn(list, ids));
  return out === null || sameOrder(out, shapes) ? shapes : out;
}
