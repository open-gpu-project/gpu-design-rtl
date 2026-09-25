import type { Side } from '../../geom/types';
import { registerShape } from '../registry';
import { plainBoxOps } from './plain-box';
import { rectProps } from './rect.props';

/**
 * A block offers all four borders to its interfaces, unlike a fabric.
 *
 * `'n'` first is what `expand` lays new ones out along -- see `spreadOffsets` for why every new
 * interface starts on one face rather than being distributed around the box.
 *
 * Its ports take no links on their inward edge: a wire between two ports across the inside of a
 * block would be describing something the block has not said it has.
 */
const RECT_SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

export const rectOps = plainBoxOps({
  kind: 'rect',
  props: rectProps,
  sides: RECT_SIDES,
  inward: false,
});

registerShape(rectOps);
