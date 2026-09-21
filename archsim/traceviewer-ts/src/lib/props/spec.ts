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
 * - `edit`     editable, written to the file.
 * - `fixed`    not editable, written to the file. `kind` is the only one so far.
 * - `computed` not editable, NOT written to the file: re-derived from the document on load.
 *              `zIndex` is implied by a shape's position in the scene list.
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
   * Present only when `mode` is `'edit'`.
   *
   * Takes `unknown` rather than a narrowed type on purpose: the JSON editor treats validation
   * as an annotation and still hands the document to `onChange`, so every writer is a trust
   * boundary and has to check its own input.
   */
  write?(s: S, v: unknown, ctx: PropContext): WriteResult<S>;
}

/** Everything one object kind declares about its properties, in document key order. */
export interface PropSchema<S extends ShapeBase = Shape> {
  readonly kind: S['kind'];
  readonly title: string;
  readonly doc: string;
  readonly props: readonly PropDef<S>[];
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
