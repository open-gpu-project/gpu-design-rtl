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

/** A trailing decimal counter, with no separator required: `block0`, `conn_7`, `u12`. */
const TRAILING_INDEX = /^(.*?)(\d+)$/;

/**
 * A free name for a *copy* of `desired`: the same prefix, carrying the lowest free number at or
 * above its own. A copy of `block0` beside `block0, block2, block4` becomes `block1`.
 *
 * Deliberately a second function rather than a smarter `uniqueName`. They answer different
 * questions: `uniqueName` repairs a duplicate *inside* one document and only understands the
 * `_N` form, while this one names a copy, and a copy should look like it belongs to the series
 * it came from.
 */
export function nextFreeIndexedName(desired: string, taken: ReadonlySet<ShapeName>): ShapeName {
  if (!taken.has(desired)) return desired;

  const m = TRAILING_INDEX.exec(desired);
  const start = m === null ? NaN : Number(m[2]);
  // No trailing digits, or a run of them too long to count in -- names come off disk, so this
  // is reachable. `uniqueName` still has a sane answer for both.
  if (m === null || !Number.isSafeInteger(start)) return uniqueName(desired, taken);

  const prefix = m[1] ?? '';
  const digits = m[2] ?? '';
  // Pad only when the original was padded: `block007` -> `block008`, but `block10` -> `block11`.
  const width = digits.length > 1 && digits.startsWith('0') ? digits.length : 0;

  /*
    Probing upward from the *desired* number is what keeps a copy next to its original. The
    obvious alternative -- the lowest free number for the prefix -- pastes a copy of `block999`
    into a scene holding `block0` as `block1`, which reads as a different block entirely.

    Membership is tested on the formatted string, never on the number, so padding stays purely
    cosmetic and `block7` and `block07` can coexist without colliding.
  */
  for (let n = start + 1; ; n++) {
    const candidate = `${prefix}${String(n).padStart(width, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
}
