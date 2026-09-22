import type { ShapeName } from './shape';

/**
 * Name helpers.
 *
 * These exist because identity is the name (see `ShapeBase`). A duplicate name is not a
 * cosmetic annoyance the way it was in iteration 1 -- it is two shapes sharing one identity,
 * which breaks selection, hit results, and every `Map` keyed by name.
 */

/** Suffix already used to disambiguate, so repeated imports don't grow `a_2_2_2`. */
const SUFFIXED = /^(.*?)_(\d+)$/;

/** `desired` if it is free, otherwise the first free `desired_2`, `desired_3`, ... */
export function uniqueName(desired: string, taken: ReadonlySet<ShapeName>): ShapeName {
  const base = desired === '' ? 'block' : desired;
  if (!taken.has(base)) return base;
  const stem = SUFFIXED.exec(base)?.[1] ?? base;
  for (let n = 2; ; n++) {
    const candidate = `${stem}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The first free `<prefix>_N`. Used for auto-naming a freshly drawn shape. */
export function nextIndexedName(
  prefix: string,
  taken: ReadonlySet<ShapeName>,
  from = 1,
): ShapeName {
  for (let n = from; ; n++) {
    const candidate = `${prefix}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The first free `block_N`. */
export function nextBlockName(taken: ReadonlySet<ShapeName>, from = 1): ShapeName {
  return nextIndexedName('block', taken, from);
}
