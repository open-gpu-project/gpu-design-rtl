import { clampNum } from '../../geom/math';
import type { Rect, Side, Vec2 } from '../../geom/types';
import { GRID, snap } from '../../grid';
import { faceLength, SIDES } from './box';

/**
 * Where a network interface sits on its parent's border, as pure geometry.
 *
 * Its own module for the same structural reason as `fifo-geom.ts`: `nif.props.ts` needs these
 * for its `read`s, and importing them from `nif.ts` -- which registers the kind -- closes a cycle
 * that puts the constants in the temporal dead zone.
 */

/** Extent across the border. One grid step, so a pin reads as a pin and not as a second box. */
export const NIF_DEPTH = GRID / 2;

/** Extent along the border, by default. */
export const NIF_LENGTH = GRID * 2;

/** The shortest interface worth drawing, along the border. */
export const MIN_NIF_LENGTH = GRID / 2;

/**
 * The interface's box.
 *
 * It STRADDLES the border, centred on it, so that half the box is inside the parent and half
 * outside. That is what makes it read as part of the parent rather than as a separate box parked
 * against it, and it leaves an outward face clear of the parent's fill for a wire to land on.
 *
 * `offset` is clamped here and not where it is stored. Shrinking a parent past an interface and
 * growing it back therefore restores the interface's place, the same property `makeBoxAnchor`
 * keeps by carrying an unclamped offset in its anchor id.
 */
export function nifBox(pr: Rect, side: Side, offset: number, length: number, depth: number): Rect {
  const len = faceLength(pr, side);
  // A parent narrower than one interface still gets an interface; it just fills the face.
  const l = Math.min(Math.max(length, MIN_NIF_LENGTH), Math.max(len, MIN_NIF_LENGTH));
  const off = clampNum(offset, 0, Math.max(0, len - l));
  const half = depth / 2;
  if (side === 'n') return { x: pr.x + off, y: pr.y - half, w: l, h: depth };
  if (side === 's') return { x: pr.x + off, y: pr.y + pr.h - half, w: l, h: depth };
  if (side === 'e') return { x: pr.x + pr.w - half, y: pr.y + off, w: depth, h: l };
  return { x: pr.x - half, y: pr.y + off, w: depth, h: l };
}

/** Distance from `p` to the infinite LINE of a face, not to the face segment. */
function distToFaceLine(pr: Rect, side: Side, p: Vec2): number {
  if (side === 'n') return Math.abs(p.y - pr.y);
  if (side === 's') return Math.abs(p.y - (pr.y + pr.h));
  if (side === 'e') return Math.abs(p.x - (pr.x + pr.w));
  return Math.abs(p.x - pr.x);
}

/**
 * Which allowed face a dragged interface landed on, and where along it.
 *
 * Measured to each face's LINE rather than to its segment, which is what makes dragging feel
 * right: pulling an interface off the end of the top border keeps it on the top border until it
 * is genuinely closer to the bottom one, instead of snapping sideways to whichever segment
 * happens to be nearest in the corner.
 *
 * The offset is grid-snapped, matching every other committed geometry in the editor; a value
 * typed into the property panel is still used exactly as written.
 */
export function projectPin(
  pr: Rect,
  centre: Vec2,
  allowed: readonly Side[],
  length: number,
): { side: Side; offset: number } {
  const faces = allowed.length > 0 ? allowed : SIDES;
  let side = faces[0]!;
  let best = Infinity;
  for (const f of faces) {
    const d = distToFaceLine(pr, f, centre);
    // Strict, so ties resolve to the earlier entry and the answer is a pure function of `centre`.
    if (d < best) {
      best = d;
      side = f;
    }
  }
  const len = faceLength(pr, side);
  const along = side === 'n' || side === 's' ? centre.x - pr.x : centre.y - pr.y;
  const offset = clampNum(snap(along - length / 2), 0, Math.max(0, len - length));
  return { side, offset };
}

/**
 * Offsets for `count` interfaces spread evenly along one face.
 *
 * Every new interface goes on the FIRST allowed face, deliberately. Alternating them between a
 * fabric's two borders would be a guess about which side is upstream, and the user can drag one
 * across in a single gesture; starting them all in a row they can see is the honest default.
 */
export function spreadOffsets(
  pr: Rect,
  side: Side,
  count: number,
  length: number,
): readonly number[] {
  const len = faceLength(pr, side);
  const room = Math.max(0, len - length);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Cell centres, so the row is balanced about the face's midpoint rather than flush to one end.
    const centre = ((i + 0.5) * len) / Math.max(1, count);
    out.push(clampNum(snap(centre - length / 2), 0, room));
  }
  return out;
}

/** Do two interfaces of length `length` at these offsets overlap along their shared face? */
function overlaps(a: number, b: number, length: number): boolean {
  return a < b + length && b < a + length;
}

/**
 * A free offset for one more interface on `side`, given what is already there.
 *
 * **Why this is not just the next entry from `spreadOffsets`.** Raising the count leaves the
 * interfaces already placed alone -- they may have been dragged, and re-laying them out would
 * throw that away. But the even spread for N and the even spread for N+2 do not line up, so
 * taking positions 5 and 6 of a six-way spread while four interfaces sit at the four-way
 * positions lands one of the new ones on top of an old one. Observed: a fourth interface at 288
 * and a sixth at 304, overlapping by 28 of their 32 units.
 *
 * So: walk the face on the grid and take the first offset that collides with nothing. Falling
 * back to the spread position when the face is genuinely full is the one case where an overlap is
 * the truth -- there is nowhere else to put it, and a hidden interface would be worse than a
 * visibly crowded one.
 */
export function freeOffset(
  pr: Rect,
  side: Side,
  length: number,
  occupied: readonly number[],
  wanted: number,
): number {
  const room = Math.max(0, faceLength(pr, side) - length);
  const clear = (at: number): boolean => !occupied.some((o) => overlaps(at, o, length));

  // The even spread first, so a fresh row of interfaces is actually spread. Scanning
  // unconditionally would pack every one of them flush from the face's start corner, which is
  // not what "spread evenly along the border" means.
  const first = clampNum(wanted, 0, room);
  if (clear(first)) return first;

  const step = Math.max(GRID, snap(length));
  for (let at = 0; at <= room; at += step) {
    if (clear(at)) return at;
  }
  // The far end is worth trying on its own: the loop only lands on multiples of the step, and a
  // face whose length is not a whole number of steps has room flush against its last corner.
  if (room > 0 && clear(room)) return room;
  // Genuinely full. An overlap is the truth here -- there is nowhere else, and a hidden
  // interface would be worse than a visibly crowded one.
  return first;
}
