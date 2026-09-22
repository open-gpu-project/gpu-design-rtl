import type { Shape, ShapeBase } from '../scene/shape';

/**
 * A property value.
 *
 * Deliberately has no object case: properties are flat by construction. The only nesting
 * permitted is a list of primitives, or a list of fixed-length lists of primitives (a polyline
 * is `list[tuple[int, int]]`). Nothing in this app needs a nested string-keyed map, and not
 * allowing one is what keeps the tree editor, the JSON Schema and the footer lookup simple.
 */
export type PropValue = string | number | boolean | readonly PropValue[];

/** One object's properties, flat. This is both the editor document and the file record. */
export type PropertyBag = Readonly<Record<string, PropValue>>;

export type PropScalar =
  | { readonly type: 'string'; readonly minLength?: number }
  | { readonly type: 'integer'; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: 'boolean' }
  | { readonly type: 'enum'; readonly values: readonly string[] };

/** A fixed-length list of scalars. `position` is a tuple of two integers. */
export interface PropTuple {
  readonly type: 'tuple';
  readonly items: readonly PropScalar[];
  /** Parallel to `items`. Names the slots for the footer: "[width, height]". */
  readonly labels: readonly string[];
}

/** A variable-length list. Its item may be a tuple, which is the `list[list[int]]` case. */
export interface PropList {
  readonly type: 'list';
  readonly item: PropScalar | PropTuple;
  readonly minItems?: number;
}

export type PropType = PropScalar | PropTuple | PropList;

/**
 * - `edit`     editable in the panel, written to the file, restored from it.
 * - `fixed`    not editable in the panel, written to the file, restored from it.
 * - `computed` not editable, NOT written to the file: re-derived from the document on load.
 *              `zIndex` is implied by a shape's position in the scene list.
 *
 * `fixed` is a claim about authority, not about storage. A connection's route and its two
 * endpoints are as real and as saved as anything else it owns; the canvas simply decides them,
 * and typing a polyline into a tree editor is not how anyone wants to move a wire. So read-only
 * here means "another part of the app is in charge of this", which is why a `fixed` value still
 * round-trips through the file and a `computed` one does not.
 */
export type PropMode = 'edit' | 'fixed' | 'computed';

/** What a property's `read` and `write` can see beyond the shape itself. */
export interface PropContext {
  /** The committed document. Lets a property see its siblings (uniqueness, ordering). */
  readonly shapes: readonly Shape[];
  /** This shape's index in `shapes` — that is, its draw order. */
  readonly index: number;
}

export type WriteResult<S> =
  { readonly ok: true; readonly shape: S } | { readonly ok: false; readonly error: string };

export interface PropDef<S extends ShapeBase = Shape> {
  readonly key: string;
  /** Short heading for the footer. */
  readonly title: string;
  /**
   * Human-readable documentation. The single source for BOTH the generated JSON Schema's
   * `description` and the text the property panel's footer shows when this key is selected.
   * Write it as prose a hardware designer reading the diagram for the first time would want.
   */
  readonly doc: string;
  readonly mode: PropMode;
  readonly type: PropType;

  read(s: S, ctx: PropContext): PropValue;

  /**
   * Absent on `computed`, which stores nothing, and on `kind`, which the loader has already
   * acted on by the time it picks a blank to fill in. Present on everything else, read-only
   * included: `applyDocument` refuses to call it for a non-`edit` key, but `hydrateShape` needs
   * it to put a saved value back.
   *
   * Takes `unknown` rather than a narrowed type on purpose: the JSON editor treats validation
   * as an annotation and still hands the document to `onChange`, so every writer is a trust
   * boundary and has to check its own input. A writer reachable only from the loader is no
   * less of one -- that input came off disk, and the disk is not this program.
   */
  write?(s: S, v: unknown, ctx: PropContext): WriteResult<S>;
}

/** Everything one object kind declares about its properties, in document key order. */
export interface PropSchema<S extends ShapeBase = Shape> {
  readonly kind: S['kind'];
  readonly title: string;
  readonly doc: string;
  /** Canonically ordered by `propSchema`; a declaration's own order carries no meaning. */
  readonly props: readonly PropDef<S>[];
}

/** `kind` above everything, then what you can change, then what the app works out for you. */
function rank<S extends ShapeBase>(d: PropDef<S>): number {
  if (d.key === 'kind') return 0;
  return d.mode === 'edit' ? 1 : 2;
}

/**
 * The canonical key order: `kind`, then the editable keys, then the derived ones, each group
 * alphabetical.
 *
 * Sorted rather than hand-arranged so that a key's place is a fact about what it *is* -- can I
 * change this? -- and not about where its author happened to paste it. `kind` is exempt because
 * it is what tells you how to read everything under it, and a document whose first line is
 * `description` reads like a mistake.
 *
 * One order serves every consumer: the panel rows, the generated schema, the saved record, and
 * the sequence `applyDocument` writes in. That last one is worth knowing when two writers on the
 * same object interact -- the alphabetically later key is applied second and wins.
 */
export function orderProps<S extends ShapeBase>(
  props: readonly PropDef<S>[],
): readonly PropDef<S>[] {
  // Plain `<` rather than `localeCompare`: keys are ASCII identifiers, and the saved file's key
  // order must not depend on the machine's locale.
  return [...props].sort(
    (a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * Declare a kind's properties. Wrap the declaration rather than assigning it directly, so
 * `orderProps` is the single place document order is decided.
 */
export function propSchema<S extends ShapeBase>(ps: PropSchema<S>): PropSchema<S> {
  return { ...ps, props: orderProps(ps.props) };
}

export function defFor<S extends ShapeBase>(
  ps: PropSchema<S>,
  key: string | undefined,
): PropDef<S> | undefined {
  if (key === undefined) return undefined;
  return ps.props.find((d) => d.key === key);
}

export function isEditable<S extends ShapeBase>(
  ps: PropSchema<S>,
  key: string | undefined,
): boolean {
  return defFor(ps, key)?.mode === 'edit';
}
