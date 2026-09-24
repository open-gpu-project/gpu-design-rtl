import type { PropDef, WriteResult } from '../../props/spec';
import type { ShapeBase } from '../shape';
import { MAX_INTERFACES } from './interfaces';

/**
 * The `interfaces` count, shared by every kind that carries network interfaces.
 *
 * The count is AUTHORITATIVE: `expandChildren` creates and removes `nif` children to match it,
 * and `nifOps.deletable` returns false so the two can never disagree. That is a deliberate
 * choice about where the truth lives -- the alternative, deriving the count from however many
 * children happen to exist, makes "how many ports does this have" a thing you discover rather
 * than a thing you state.
 */
export function interfacesProp<S extends ShapeBase & { interfaces: number }>(
  noun: string,
  where: string,
): PropDef<S> {
  return {
    key: 'interfaces',
    title: 'Interfaces',
    doc: `How many network interfaces this ${noun} carries. New ones are spread evenly along ${where}, and you drag them from there; raising the count adds to the end and leaves the ones already placed alone, lowering it removes from the end. This number is the truth — an interface cannot be deleted on its own, because that would leave the count saying something the diagram does not. At most ${MAX_INTERFACES}.`,
    mode: 'edit',
    type: { type: 'integer', minimum: 0, maximum: MAX_INTERFACES },
    read: (s) => s.interfaces,
    write: (s, v): WriteResult<S> => {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        return { ok: false, error: 'Interfaces must be a whole number.' };
      }
      if (v < 0) return { ok: false, error: 'Interfaces cannot be negative.' };
      if (v > MAX_INTERFACES) {
        return { ok: false, error: `At most ${MAX_INTERFACES} interfaces on one object.` };
      }
      return { ok: true, shape: { ...s, interfaces: v } as S };
    },
  };
}
