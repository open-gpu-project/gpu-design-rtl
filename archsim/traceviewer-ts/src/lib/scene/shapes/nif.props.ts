import {
  asIntPair,
  bad,
  descriptionProp,
  kindProp,
  labelProp,
  nameProp,
  zIndexProp,
} from '../../props/common';
import { propSchema, type PropDef, type PropSchema, type WriteResult } from '../../props/spec';
import type { Modport, NifShape } from '../shape';
import { GRID } from '../../grid';
import { MIN_NIF_LENGTH, NIF_DEPTH, NIF_LENGTH } from './nif-geom';

type Write = WriteResult<NifShape>;

const SIDE_VALUES = ['n', 'e', 's', 'w'] as const;
const MODPORTS: readonly Modport[] = ['master', 'slave'];

/**
 * The network interface's properties.
 *
 * `protocol` is the one key here that will mean something outside this editor, once a diagram is
 * checked against RTL. Everything else is geometry or presentation.
 *
 * `position` is absent on purpose. An interface has no position of its own: it has a `side` and
 * an `offset` on a parent, and its box follows from those. Offering an editable `[x, y]` that the
 * next commit overwrites is the read-only-field problem iteration 4 spent a whole pass removing.
 * Its `size` is an along-and-across extent rather than a width and height, and its `parent` is
 * `fixed` rather than `computed`: an interface is owned, not enclosed, and the owner is saved.
 */
const props: readonly PropDef<NifShape>[] = [
  kindProp('nif'),
  nameProp('interface'),
  labelProp('interface'),
  {
    key: 'parent',
    title: 'Parent',
    doc: 'The block or fabric this interface is attached to. Set when the interface is created and not editable: interfaces exist because their parent asked for a number of them, so moving one to a different parent would leave both counts wrong. Delete or re-count on the parent instead.',
    mode: 'fixed',
    type: { type: 'string', minLength: 1 },
    read: (s) => s.parent,
    // Read-only to the user, but the loader needs a writer to put a saved value back -- the
    // asymmetry `hydrateShape` and `applyDocument` exist to express.
    write: (s, v): Write => {
      if (typeof v !== 'string' || v === '') return bad('Parent must be a non-empty name.');
      return { ok: true, shape: { ...s, parent: v } };
    },
  },
  {
    key: 'side',
    title: 'Side',
    doc: 'Which border of the parent this interface sits on, as a compass point — “n” is the top. A fabric only offers “n” and “s”; a block offers all four. Setting a side the parent does not offer falls back to one it does, rather than drawing the interface off the border. Dragging the interface on the canvas sets this too.',
    mode: 'edit',
    type: { type: 'enum', values: [...SIDE_VALUES] },
    read: (s) => s.side,
    write: (s, v): Write => {
      const side = SIDE_VALUES.find((c) => c === v);
      if (side === undefined) return bad('Side must be “n”, “e”, “s” or “w”.');
      return { ok: true, shape: { ...s, side } };
    },
  },
  {
    key: 'offset',
    title: 'Offset',
    doc: `Distance along the border from its start corner, in world units — measured from the left for the top and bottom borders, and from the top for the left and right ones. Kept as written rather than as clamped, so shrinking the parent past this interface and growing it back puts the interface where you left it. Dragging on the canvas snaps to the ${GRID}-unit grid; a value typed here is used exactly. A connection lands on the centre of an edge, so a snapped offset puts that point on a grid dot too — as long as the along extent stays a multiple of ${2 * GRID}, which the default ${NIF_LENGTH} is.`,
    mode: 'edit',
    type: { type: 'integer' },
    read: (s) => s.offset,
    write: (s, v): Write => {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        return bad('Offset must be a whole number.');
      }
      return { ok: true, shape: { ...s, offset: v } };
    },
  },
  {
    key: 'size',
    title: 'Size',
    doc: `Extent as [along, across] in world units — how far the interface runs along the border, and how deep it is into the parent. Defaults to [${NIF_LENGTH}, ${NIF_DEPTH}]. The box sits wholly INSIDE the border, with its outward edge on the border line, so the across extent is clamped to the parent rather than allowed to punch through the far side. At least ${MIN_NIF_LENGTH} along. Keep the along extent a multiple of ${2 * GRID} and this interface's connection points stay on the grid; ${NIF_LENGTH} is chosen for exactly that.`,
    mode: 'edit',
    type: {
      type: 'tuple',
      items: [
        { type: 'integer', minimum: MIN_NIF_LENGTH },
        { type: 'integer', minimum: 1 },
      ],
      labels: ['along', 'across'],
    },
    read: (s) => [s.length, s.depth],
    write: (s, v): Write => {
      const p = asIntPair(v);
      if (p === null) return bad('Size must be two whole numbers, [along, across].');
      if (p[0] < MIN_NIF_LENGTH) return bad(`The along extent must be at least ${MIN_NIF_LENGTH}.`);
      if (p[1] < 1) return bad('The across extent must be at least 1.');
      return { ok: true, shape: { ...s, length: p[0], depth: p[1] } };
    },
  },
  {
    key: 'protocol',
    title: 'Protocol',
    doc: 'Which bus standard this interface speaks. Only AXI3 so far. This is the field that will mean something outside the design editor — it is what a future check against the RTL would match on. An enum with one value rather than a fixed string, because what grows when a second standard is added is the value set and not the shape of the record.',
    mode: 'edit',
    type: { type: 'enum', values: ['axi3'] },
    read: (s) => s.protocol,
    write: (s, v): Write =>
      v === 'axi3'
        ? { ok: true, shape: { ...s, protocol: 'axi3' } }
        : bad('Protocol must be “axi3”.'),
  },
  {
    key: 'modport',
    title: 'Modport',
    doc: 'Which end of the bus this is, following the SystemVerilog modport convention: a “master” drives the transaction and a “slave” answers it. It is the colour of the interface’s border — violet for a master, sky for a slave — which is why selecting one, and turning that border amber, hides it until you deselect.',
    mode: 'edit',
    type: { type: 'enum', values: [...MODPORTS] },
    read: (s) => s.modport,
    write: (s, v): Write => {
      const modport = MODPORTS.find((c) => c === v);
      if (modport === undefined) return bad('Modport must be “master” or “slave”.');
      return { ok: true, shape: { ...s, modport } };
    },
  },
  descriptionProp('what this interface carries'),
  {
    key: 'inward',
    title: 'Inward edge',
    doc: 'Whether this interface also accepts connections on its inward edge — the one facing into the parent’s body. Decided by the parent, not here: a fabric offers it, because the links inside a crossbar are as real as the ones outside it, and a block does not. It is why some interfaces take two connections and others one.',
    mode: 'computed',
    type: { type: 'boolean' },
    read: (s) => s.inward,
  },
  {
    key: 'box',
    title: 'Box',
    doc: 'Where the interface actually ended up, as [x, y, width, height] in world units. Worked out from the parent’s border, the side and the offset, so it is neither typed here nor saved to the file — it is re-derived every time the parent moves or resizes.',
    mode: 'computed',
    type: {
      type: 'tuple',
      items: [{ type: 'integer' }, { type: 'integer' }, { type: 'integer' }, { type: 'integer' }],
      labels: ['x', 'y', 'width', 'height'],
    },
    read: (s) => [Math.round(s.x), Math.round(s.y), Math.round(s.w), Math.round(s.h)],
  },
  zIndexProp(),
];

export const nifProps: PropSchema<NifShape> = propSchema({
  kind: 'nif',
  title: 'Network interface',
  doc: 'A bus port on the border of a block or a fabric. Created by its parent’s interface count, not drawn directly.',
  props,
});
