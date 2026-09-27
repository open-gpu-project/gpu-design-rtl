import Network from '@lucide/svelte/icons/network';
import type { Side } from '../../geom/types';
import { registerShape } from '../registry';
import { fabricProps } from './fabric.props';
import { plainBoxOps } from './plain-box';

/**
 * The two borders a fabric offers its interfaces.
 *
 * Top and bottom only, because a fabric is drawn BETWEEN the things it connects: a port on its
 * left or right edge sits where the neighbour's own ports are and reads as belonging to them.
 * The restriction is on interface placement, not on wires -- `anchorAt` still takes a connection
 * anywhere on the perimeter.
 */
const FABRIC_SIDES: readonly Side[] = ['n', 's'];

export const fabricOps = plainBoxOps({
  kind: 'fabric',
  icon: Network,
  props: fabricProps,
  sides: FABRIC_SIDES,
  /*
    A fabric's ports take links on their inward edge too. It is the one place an inward link
    means something: a crossbar's internal routing is a real set of wires between its own ports,
    and drawing them is the whole reason the seam exists.
  */
  inward: true,
  /*
    It does not adopt. A fabric is drawn between the things it connects, and a block that happens
    to sit over one is not inside it in any sense the diagram means. The wires between its own
    ports are still its children, but by what they join rather than where they lie -- see
    `hierarchy.ts`.
  */
  adopts: false,
});

registerShape(fabricOps);
