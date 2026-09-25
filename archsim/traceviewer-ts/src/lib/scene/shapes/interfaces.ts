import type { Rect, Side } from '../../geom/types';
import type { NifShape, Shape, ShapeName } from '../shape';
import { makeNif } from './nif';
import { freeOffset, NIF_LENGTH, spreadOffsets, type NifSpan } from './nif-geom';

/**
 * The `expand` half of a kind that carries network interfaces: how a count becomes children,
 * and in particular what happens when the count goes DOWN.
 *
 * Called from `plainBoxOps`, which is how both `rect` and `fabric` reach it. Kept apart from
 * that file because these reconcile rules are about interfaces, not about boxes.
 */

/** The most interfaces one parent may carry. A guard against a typo, not a design limit. */
export const MAX_INTERFACES = 64;

/**
 * Bring `existing` into line with `want`.
 *
 * **Returns `existing` by reference when the count already matches**, which is what keeps a
 * commit that changed nothing out of the undo history. Note it compares only the COUNT: an
 * existing interface's side, offset and protocol are the user's, and re-deriving them here would
 * undo every drag on the next commit.
 *
 * Growing lays each new interface at its place in the even spread for the new total, and only
 * looks for another slot if that place is already taken -- see `freeOffset` for why the spread
 * alone is not enough once some interfaces have been dragged.
 *
 * Shrinking drops from the END rather than picking by position, because the end of the list is
 * the only choice that is stable under dragging: removing "the rightmost one" would make the
 * interface that vanishes depend on where the user last dragged something.
 */
export function expandInterfaces(
  parent: ShapeName,
  box: Rect,
  side: Side,
  want: number,
  existing: readonly Shape[],
  mint: (prefix: string) => ShapeName,
): readonly Shape[] {
  const n = Math.max(0, Math.min(Math.round(want), MAX_INTERFACES));
  if (n === existing.length) return existing;
  if (n < existing.length) return existing.slice(0, n);

  const spread = spreadOffsets(box, side, n, NIF_LENGTH);
  const out: Shape[] = [...existing];
  /*
    Each neighbour's OWN length, not the default, and rebuilt as we go so two interfaces minted in
    one pass cannot be given the same slot. `length` is a saved property: a fabric from a document
    saved when the default was 48 units carries 48-unit ports, and packing a new 32-unit one against
    32-unit assumptions put it through a real neighbour.
  */
  const occupied: NifSpan[] = existing
    .filter((s): s is NifShape => s.kind === 'nif' && s.side === side)
    .map((s) => ({ offset: s.offset, length: s.length }));

  for (let i = existing.length; i < n; i++) {
    const at = freeOffset(box, side, NIF_LENGTH, occupied, spread[i] ?? 0);
    occupied.push({ offset: at, length: NIF_LENGTH });
    out.push(makeNif(mint(`${parent}.if`), parent, side, at));
  }
  return out;
}
