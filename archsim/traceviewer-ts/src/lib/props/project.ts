import type { ShapeBase } from '../scene/shape';
import type { PropContext, PropertyBag, PropSchema, PropValue } from './spec';

/** Structural equality over the `PropValue` grammar. No object case exists, so this is total. */
export function sameValue(a: PropValue | undefined, b: PropValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  return a === b;
}

/** The property panel's document: every declared property, in declaration order. */
export function projectShape<S extends ShapeBase>(
  ps: PropSchema<S>,
  s: S,
  ctx: PropContext,
): PropertyBag {
  const out: Record<string, PropValue> = {};
  for (const d of ps.props) out[d.key] = d.read(s, ctx);
  return out;
}

/**
 * The on-disk record: the same document minus `computed` properties.
 *
 * `zIndex` is dropped because the shapes array order already carries it; writing it would give
 * the file two sources of truth for draw order that could disagree.
 */
export function serializeShape<S extends ShapeBase>(
  ps: PropSchema<S>,
  s: S,
  ctx: PropContext,
): PropertyBag {
  const out: Record<string, PropValue> = {};
  for (const d of ps.props) {
    if (d.mode === 'computed') continue;
    out[d.key] = d.read(s, ctx);
  }
  return out;
}

export type ApplyResult<S> =
  | { readonly ok: true; readonly shape: S; readonly changed: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Apply an edited document to a shape. Pure, and strict: this is the editor's commit path, so
 * anything it lets through ends up in the scene and in history.
 *
 * Read-only enforcement lives at step 3. The greyed styling from `onClassName` and the schema's
 * `readOnly` annotation are signposting only -- svelte-jsoneditor has no per-node read-only, so
 * this rejection is the actual mechanism.
 */
export function applyDocument<S extends ShapeBase>(
  ps: PropSchema<S>,
  s: S,
  doc: unknown,
  ctx: PropContext,
): ApplyResult<S> {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, error: 'A block’s properties must be a JSON object.' };
  }
  const bag = doc as Record<string, unknown>;

  // 1. Key set. The schema also catches this, but validation is advisory in this editor:
  //    an invalid document is still handed to onChange, so the commit path re-checks.
  const declared = new Set(ps.props.map((d) => d.key));
  for (const key of Object.keys(bag)) {
    if (!declared.has(key)) return { ok: false, error: `Unknown property “${key}”.` };
  }
  for (const d of ps.props) {
    if (!(d.key in bag)) return { ok: false, error: `Missing property “${d.key}”.` };
  }

  // 2. Read-only properties must be untouched.
  for (const d of ps.props) {
    if (d.mode === 'edit') continue;
    if (sameValue(bag[d.key] as PropValue, d.read(s, ctx))) continue;
    const how =
      d.mode === 'computed' ? `“${d.key}” is computed, not stored` : `“${d.key}” cannot be changed`;
    return { ok: false, error: `${how}. ${d.doc}` };
  }

  // 3. Write the ones that actually differ.
  let next = s;
  const changed: string[] = [];
  for (const d of ps.props) {
    if (d.mode !== 'edit' || d.write === undefined) continue;
    if (sameValue(bag[d.key] as PropValue, d.read(s, ctx))) continue;
    const r = d.write(next, bag[d.key], ctx);
    if (!r.ok) return { ok: false, error: r.error };
    next = r.shape;
    changed.push(d.key);
  }

  return { ok: true, shape: next, changed };
}

/**
 * Build a shape from an imported record, leniently.
 *
 * Unlike `applyDocument` this never fails: a missing key keeps the blank's default and a bad
 * value is skipped. Loading a diagram someone else saved should degrade, not abort -- the same
 * reasoning that makes `deserializeScene` skip unknown kinds rather than throw.
 */
export function hydrateShape<S extends ShapeBase>(
  ps: PropSchema<S>,
  blank: S,
  bag: unknown,
  ctx: PropContext,
): S {
  if (typeof bag !== 'object' || bag === null) return blank;
  const record = bag as Record<string, unknown>;
  let next = blank;
  for (const d of ps.props) {
    if (d.mode !== 'edit' || d.write === undefined) continue;
    if (!(d.key in record)) continue;
    const r = d.write(next, record[d.key], ctx);
    if (r.ok) next = r.shape;
  }
  return next;
}
