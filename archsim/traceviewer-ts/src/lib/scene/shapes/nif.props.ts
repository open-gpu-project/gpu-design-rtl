import { descriptionProp, kindProp, labelProp, nameProp, zIndexProp } from '../../props/common';
import { propSchema, type PropDef, type PropSchema, type WriteResult } from '../../props/spec';
import type { Channel, Modport, NifShape } from '../shape';
import { MIN_NIF_LENGTH } from './nif-geom';

type Write = WriteResult<NifShape>;

function bad(error: string): Write {
  return { ok: false, error };
}

function asIntPair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [a, b];
}

const SIDE_VALUES = ['n', 'e', 's', 'w'] as const;
const CHANNELS: readonly Channel[] = ['aw', 'w', 'b', 'ar', 'r', 'all'];
const MODPORTS: readonly Modport[] = ['master', 'slave'];

/**
 * The network interface's properties.
 *
 * `protocol` and `channel` are two keys rather than one because they answer different questions.
 * The protocol is which bus standard this is -- and it is the one that will mean something
 * outside this editor, once a diagram is checked against RTL. The channel is which wire of that
 * bus the interface carries. Folding them into a single `axi3_aw` enum would make adding a second
 * protocol a rewrite of the value set rather than one more entry.
 *
 * `position`, `size` and `parent` are absent on purpose. An interface has no position of its own:
 * it has a `side` and an `offset` on a parent, and its box follows from those. Offering an
 * editable `[x, y]` that the next commit overwrites is the read-only-field problem iteration 4.2
 * spent a whole pass removing.
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
    doc: 'Distance along the border from its start corner, in world units — measured from the left for the top and bottom borders, and from the top for the left and right ones. Kept as written rather than as clamped, so shrinking the parent past this interface and growing it back puts the interface where you left it. Dragging on the canvas snaps to the 16-unit grid; a value typed here is used exactly.',
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
    doc: `Extent as [along, across] in world units — how far the interface runs along the border, and how deep it is across it. The box straddles the border, so half of the depth is inside the parent and half outside. At least ${MIN_NIF_LENGTH} along.`,
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
    doc: 'Which bus standard this interface speaks. Only AXI3 so far. This is the field that will mean something outside the design editor — it is what a future check against the RTL would match on — so it is kept separate from the channel rather than folded into it.',
    mode: 'edit',
    type: { type: 'enum', values: ['axi3'] },
    read: (s) => s.protocol,
    write: (s, v): Write =>
      v === 'axi3'
        ? { ok: true, shape: { ...s, protocol: 'axi3' } }
        : bad('Protocol must be “axi3”.'),
  },
  {
    key: 'channel',
    title: 'Channel',
    doc: 'Which AXI3 channel this interface carries: “aw” write address, “w” write data, “b” write response, “ar” read address, “r” read data. Use “all” for an interface standing in for the whole bundle, which is compatible with any single channel — a diagram drawn at bundle level should not report five violations for one wire.',
    mode: 'edit',
    type: { type: 'enum', values: [...CHANNELS] },
    read: (s) => s.channel,
    write: (s, v): Write => {
      const channel = CHANNELS.find((c) => c === v);
      if (channel === undefined) return bad(`Channel must be one of ${CHANNELS.join(', ')}.`);
      return { ok: true, shape: { ...s, channel } };
    },
  },
  {
    key: 'modport',
    title: 'Modport',
    doc: 'Which end of the bus this is, following the SystemVerilog modport convention: a “master” drives the transaction and a “slave” answers it. Drawn as a tick on the outward face, pointing out for a master and in for a slave. A connection between two masters, or two slaves, is a violation.',
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
