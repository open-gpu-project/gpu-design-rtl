import { normalizeRect } from '../../geom/math';
import type { Rect } from '../../geom/types';
import { GRID } from '../../grid';
import type { FifoShape } from '../shape';

/**
 * The FIFO's geometry, as pure functions of the shape.
 *
 * **A separate module from `fifo.ts` for a structural reason, not a stylistic one.** A kind's
 * `<kind>.ts` registers itself and therefore owns the import that pulls the pair in, while
 * `fifo.props.ts` needs `fifoBox` for `size`'s `read` and `MIN_SPACING` for its own declaration.
 * Importing that from `fifo.ts` closes a cycle, and because both are consumed while
 * `fifo.props.ts` is still evaluating its top-level `props` array, the constants land in the
 * temporal dead zone: the app dies at load with "Cannot access 'MIN_SPACING' before
 * initialization". `rect` and `conn` never met this because their props files need nothing back.
 *
 * So: geometry here, ops in `fifo.ts`, declarations in `fifo.props.ts`, and the arrows only ever
 * point this way. The same split `route.ts` has from `conn.ts`, for the same reason it is pure.
 */

/**
 * An unbounded queue is drawn as one cell, a gap, then three -- so it reads as "and so on"
 * without needing an ellipsis glyph.
 *
 * Asymmetric on purpose: three cells is the smallest run that reads as a *sequence* rather than
 * as a pair, and one is the smallest that reads as a cell at all. Putting the run at the tail
 * matches how a queue is drawn on a whiteboard, with the head it drains from on the left.
 */
export const HEAD_CELLS = 1;
export const TAIL_CELLS = 3;

/** The smallest divider pitch worth drawing. Below this the cells are hairline mush. */
export const MIN_SPACING = GRID / 2;

/** The smallest gap an unbounded queue keeps between its head cell and its tail run. */
export const MIN_GAP = GRID;

/** Is the flow axis authored by the user, or derived from the cell count? */
export function flowIsFree(s: FifoShape): boolean {
  return s.cells < 0;
}

/** The flow axis for this orientation: `'w'` when the cells run left to right. */
export function flowKey(s: FifoShape): 'w' | 'h' {
  return s.orientation === 'horizontal' ? 'w' : 'h';
}

/**
 * Extent along the flow axis, in world units.
 *
 * **The whole reason this exists as a function.** While the queue is bounded the extent is
 * `cells * spacing` and the stored `w` (or `h`) is ignored entirely -- so a `cells` writer and a
 * `spacing` writer never have to reach over and recompute a sibling key. Iteration 4.1's rule is
 * that a writer touching another property becomes order-dependent, since `applyDocument` writes
 * in canonical key order and the alphabetically later key wins; deriving sidesteps that rather
 * than having to reason about it.
 */
export function flowExtent(s: FifoShape): number {
  const spacing = Math.max(MIN_SPACING, s.spacing);
  if (!flowIsFree(s)) return Math.max(1, s.cells) * spacing;
  const stored = Math.abs(s[flowKey(s)]);
  return Math.max(stored, (HEAD_CELLS + TAIL_CELLS) * spacing + MIN_GAP);
}

/**
 * The box, and the single read-through everything uses -- `bounds`, `draw`, `hitTest`, the
 * handles, the anchors and `size`'s `read`.
 *
 * Mid-drag a FIFO may carry a negative cross extent (the user flipped it), which `normalizeRect`
 * folds, exactly as `rect`'s `box` does.
 */
export function fifoBox(s: FifoShape): Rect {
  const flow = flowExtent(s);
  return s.orientation === 'horizontal'
    ? normalizeRect({ x: s.x, y: s.y, w: flow, h: s.h })
    : normalizeRect({ x: s.x, y: s.y, w: s.w, h: flow });
}

/**
 * Where the dividers fall, as offsets along the flow axis from the box's start corner, paired
 * with whether each one borders the unbounded gap.
 *
 * Interior only: the two ends of the run are the outline, already stroked. A gap border is drawn
 * dashed, which is what says "this queue continues" without spending a glyph on it.
 */
export function dividers(s: FifoShape): readonly { at: number; gap: boolean }[] {
  const spacing = Math.max(MIN_SPACING, s.spacing);
  const out: { at: number; gap: boolean }[] = [];

  if (!flowIsFree(s)) {
    for (let i = 1; i < Math.max(1, s.cells); i++) out.push({ at: i * spacing, gap: false });
    return out;
  }

  const flow = flowExtent(s);
  out.push({ at: HEAD_CELLS * spacing, gap: true });
  for (let i = TAIL_CELLS; i >= 1; i--) {
    out.push({ at: flow - i * spacing, gap: i === TAIL_CELLS });
  }
  return out;
}
