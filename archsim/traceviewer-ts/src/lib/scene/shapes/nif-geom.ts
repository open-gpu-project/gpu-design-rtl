import { clampNum } from '../../geom/math';
import type { Anchor, Rect, Side, Vec2 } from '../../geom/types';
import { GRID, snap } from '../../grid';
import { faceLength, NORMALS, OPPOSITE, SIDES } from './box';

/**
 * Where a network interface sits on its parent's border, as pure geometry.
 *
 * Its own module for the same structural reason as `fifo-geom.ts`: `nif.props.ts` needs these
 * for its `read`s, and importing them from `nif.ts` -- which registers the kind -- closes a cycle
 * that puts the constants in the temporal dead zone.
 */

/** Extent across the border. Deep enough to hold a label; see `nifBox` for why it is inside. */
export const NIF_DEPTH = GRID;

/** Extent along the border, by default. Three grid steps, so a short name fits without fitting. */
export const NIF_LENGTH = GRID * 3;

/** The shortest interface worth drawing, along the border. */
export const MIN_NIF_LENGTH = GRID / 2;

/**
 * The interface's box: flush INSIDE the parent's border, not straddling it.
 *
 * It used to be centred on the border with half of it hanging outside. That reads as a pin, and
 * a pin is the wrong picture -- an interface is a port ON the thing, the way a connector is part
 * of the chip package rather than a stub glued to it. Flush inside also gives the label somewhere
 * to go, and it is what makes an INWARD edge mean anything: the far edge of the box now faces the
 * parent's interior, which is where a fabric's internal routing has to land.
 *
 * The outward edge is coincident with the parent's border line, so a wire still stops at the
 * outline rather than short of it.
 *
 * `depth` is clamped to the parent the way `length` already is. Half of an over-deep box used to
 * hang outside where there was always room; the whole of one has nowhere to go, and would punch
 * through the far border.
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
  const across = side === 'n' || side === 's' ? pr.h : pr.w;
  const dep = Math.min(Math.max(depth, 1), Math.max(across, 1));
  if (side === 'n') return { x: pr.x + off, y: pr.y, w: l, h: dep };
  if (side === 's') return { x: pr.x + off, y: pr.y + pr.h - dep, w: l, h: dep };
  if (side === 'e') return { x: pr.x + pr.w - dep, y: pr.y + off, w: dep, h: l };
  return { x: pr.x, y: pr.y + off, w: dep, h: l };
}

/**
 * The two anchor ids, which are edges rather than compass points.
 *
 * Naming them by side was a live defect, not merely a clumsy spelling. `resolveAnchor` could
 * only redirect the face directly OPPOSITE the outward one, so dragging a port from the top
 * border to the right-hand one left its wire attached to the short end of the box, running
 * along the border instead of away from it. An id that does not name a side cannot go stale
 * when the side changes.
 */
export const NIF_OUT = 'out';
export const NIF_IN = 'in';

/**
 * The interface's connection points: the centre of its outward edge, and of its inward one.
 *
 * One function behind all three anchor seams -- `anchors`, `anchorAt` and `resolveAnchor` --
 * so they cannot disagree about where a wire lands.
 *
 * The normals are the shared references out of `NORMALS`, never fresh objects: identity on a
 * normal is a legitimate thing for a caller to test, and two equal-but-distinct vectors would
 * make that test quietly false.
 */
export function nifAnchors(r: Rect, side: Side, inward: boolean): readonly Anchor[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const mid = (f: Side): Vec2 =>
    f === 'n'
      ? { x: cx, y: r.y }
      : f === 's'
        ? { x: cx, y: r.y + r.h }
        : f === 'e'
          ? { x: r.x + r.w, y: cy }
          : { x: r.x, y: cy };

  const out: Anchor[] = [{ id: NIF_OUT, pos: mid(side), normal: NORMALS[side] }];
  if (inward) {
    const back = OPPOSITE[side];
    out.push({ id: NIF_IN, pos: mid(back), normal: NORMALS[back] });
  }
  return out;
}

/**
 * Which edge an anchor id names, with anything unrecognised meaning the outward one.
 *
 * `inward` is a parameter rather than an assumption, and that is what stops a hand-edited file
 * earning a false violation: an id of `'in'` on an interface whose parent does not offer an
 * inward edge is DRAWN on the outward edge, so the outward edge is what must be reported on.
 */
export function nifEdge(id: string, inward: boolean): 'in' | 'out' {
  return inward && id === NIF_IN ? 'in' : 'out';
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
