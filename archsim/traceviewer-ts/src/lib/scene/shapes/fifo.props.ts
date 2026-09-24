import {
  descriptionProp,
  kindProp,
  labelModeProp,
  labelProp,
  nameProp,
  positionProp,
  subtitleProp,
  zIndexProp,
} from '../../props/common';
import { propSchema, type PropDef, type PropSchema, type WriteResult } from '../../props/spec';
import { GRID } from '../../grid';
import type { FifoShape } from '../shape';
import { fifoBox, flowIsFree, MAX_CELLS, MIN_SPACING } from './fifo-geom';

type Write = WriteResult<FifoShape>;

function bad(error: string): Write {
  return { ok: false, error };
}

function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function asIntPair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [a, b];
}

/**
 * The FIFO's properties.
 *
 * `cells`, `spacing` and `orientation` between them decide the box, which is why `size` is the
 * one key here that is not taken straight from `props/common.ts`: on this kind it is half
 * derived. None of the three writers touches `size`, and `size`'s writer touches only the axis
 * it owns -- see `flowExtent` for why that separation is load-bearing rather than tidy.
 */
const props: readonly PropDef<FifoShape>[] = [
  kindProp('fifo'),
  nameProp('queue'),
  labelProp('queue'),
  positionProp(),
  {
    key: 'size',
    title: 'Size',
    doc: 'Extent as [width, height] in world units. Only one of the two is yours to set: the length along the flow direction is the cell count times the spacing, so a value typed for it is ignored and the derived one is kept. The exception is an unbounded queue, where the length is free and resizing it stretches the gap in the middle rather than adding cells.',
    mode: 'edit',
    type: {
      type: 'tuple',
      items: [
        { type: 'integer', minimum: 1 },
        { type: 'integer', minimum: 1 },
      ],
      labels: ['width', 'height'],
    },
    // Through the box, so what the panel shows is what the canvas draws, derived axis included.
    read: (s) => {
      const r = fifoBox(s);
      return [r.w, r.h];
    },
    /*
      **Returns `s` by reference when the axis this writer owns is already right**, and that is
      not a micro-optimisation.

      `read` goes through `fifoBox`, so for a bounded queue it can never return the width the
      user typed. `applyDocument` skips a key only when the document value equals `read(s)`, so
      this writer is then called on EVERY subsequent commit -- and an unconditional `{ ...s }`
      hands back a content-identical shape with a fresh identity. `PropertiesView` guards on
      `result.shape === prev`, `replaceShape` maps unconditionally, and `commit` compares the
      array by identity: the result was one dead undo entry per edit, each of which appeared to
      do nothing when undone. Observed as three `edit size` entries restoring a byte-identical
      scene.
    */
    write: (s, v): Write => {
      const p = asIntPair(v);
      if (p === null) return bad('Size must be two whole numbers, [width, height].');
      if (p[0] < 1 || p[1] < 1) return bad('Width and height must both be at least 1.');
      const [w, h] = p;
      // The derived axis is dropped rather than refused: refusing would make a perfectly good
      // cross-axis change fail alongside it. An unbounded queue owns both axes, so both are kept.
      if (flowIsFree(s)) {
        if (w === s.w && h === s.h) return { ok: true, shape: s };
        return { ok: true, shape: { ...s, w, h } };
      }
      if (s.orientation === 'horizontal') {
        return h === s.h ? { ok: true, shape: s } : { ok: true, shape: { ...s, h } };
      }
      return w === s.w ? { ok: true, shape: s } : { ok: true, shape: { ...s, w } };
    },
  },
  {
    key: 'orientation',
    title: 'Orientation',
    doc: 'Which way the queue runs. “horizontal” draws the cells left to right and leaves the height yours to resize; “vertical” draws them top to bottom and leaves the width. Changing this does not rotate the box — the cells simply run the other way, and the axis you may resize swaps with them.',
    mode: 'edit',
    type: { type: 'enum', values: ['horizontal', 'vertical'] },
    read: (s) => s.orientation,
    write: (s, v): Write => {
      if (v !== 'horizontal' && v !== 'vertical') {
        return bad('Orientation must be “horizontal” or “vertical”.');
      }
      return v === s.orientation
        ? { ok: true, shape: s }
        : { ok: true, shape: { ...s, orientation: v } };
    },
  },
  {
    key: 'cells',
    title: 'Cells',
    doc: `How many entries the queue holds, drawn as that many dividers along its length. Set it to -1 for an unbounded queue, which is drawn as one cell, a gap you can stretch, and three more — the length then becomes yours to resize. Zero is not a queue and is refused. At most ${MAX_CELLS}: every cell is a divider drawn on every frame, and a queue deeper than that is what “unbounded” is for.`,
    mode: 'edit',
    /*
      The maximum is in the SCHEMA and not only in the writer, because ajv is what draws the live
      red annotation in the panel. Without it the editor accepted 1e9 without complaint, the
      writer took it, and the next frame tried to build a billion-segment path -- the tab froze
      before the commit that caused it could be undone.
    */
    type: { type: 'integer', minimum: -1, maximum: MAX_CELLS },
    read: (s) => s.cells,
    write: (s, v): Write => {
      const cells = asInt(v);
      if (cells === null) return bad('Cells must be a whole number.');
      if (cells === 0) return bad('A queue with no cells is not a queue. Use -1 for unbounded.');
      if (cells < -1) return bad('Cells must be -1 (unbounded) or a positive count.');
      if (cells > MAX_CELLS) {
        return bad(`At most ${MAX_CELLS} cells. Use -1 for a queue deeper than that.`);
      }
      return cells === s.cells ? { ok: true, shape: s } : { ok: true, shape: { ...s, cells } };
    },
  },
  {
    key: 'spacing',
    title: 'Spacing',
    doc: `The divider pitch in world units — one cell's extent along the flow direction, not the blank between two of them. A bounded queue's length is this times the cell count, so changing it here lengthens the box rather than squeezing the cells into it. Defaults to ${GRID}, one grid step, so the dividers line up with the dots behind them. At least ${MIN_SPACING}, below which the dividers are hairline mush at any useful zoom.`,
    mode: 'edit',
    type: { type: 'integer', minimum: MIN_SPACING },
    read: (s) => s.spacing,
    write: (s, v): Write => {
      const spacing = asInt(v);
      if (spacing === null) return bad('Spacing must be a whole number.');
      if (spacing < MIN_SPACING) return bad(`Spacing must be at least ${MIN_SPACING}.`);
      return spacing === s.spacing
        ? { ok: true, shape: s }
        : { ok: true, shape: { ...s, spacing } };
    },
  },
  subtitleProp('queue'),
  labelModeProp('queue'),
  descriptionProp('what this queue carries and what fills or drains it'),
  zIndexProp(),
];

export const fifoProps: PropSchema<FifoShape> = propSchema({
  kind: 'fifo',
  title: 'Queue',
  doc: `A FIFO, drawn as a run of cells. One grid step is ${GRID} world units.`,
  props,
});
