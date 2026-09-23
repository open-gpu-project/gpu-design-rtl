import { keys } from '../../keys';
import {
  propSchema,
  type PropContext,
  type PropDef,
  type PropSchema,
  type WriteResult,
} from '../../props/spec';
import type { RectShape } from '../shape';

type Write = WriteResult<RectShape>;

function bad(error: string): Write {
  return { ok: false, error };
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** A tuple of exactly two integers. Used by both `position` and `size`. */
function asIntPair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [a, b];
}

/**
 * The rectangle's properties.
 *
 * Read this as the definition of what a block *is*. Adding a property is one entry here: the
 * JSON Schema, the ajv validation, the tree editor's rows, the footer documentation and the
 * saved file all follow from it, and nothing else needs to change.
 *
 * Where in this array is not one of the things that follows from it: `propSchema` sorts on the
 * way out, so put a new property wherever it reads best next to its neighbours.
 *
 * Every `doc` is written for someone opening the diagram for the first time, because it is what
 * the panel footer shows -- it is documentation, not a code comment that happens to be a string.
 */
const props: readonly PropDef<RectShape>[] = [
  {
    key: 'kind',
    title: 'Kind',
    doc: 'Which type of object this is. Selects how it is drawn and which properties it has. Fixed when the object is created.',
    mode: 'fixed',
    type: { type: 'enum', values: ['rect'] },
    read: () => 'rect',
  },
  {
    key: 'name',
    title: 'Name',
    doc: 'Internal identifier for this block. Must be unique across the diagram and cannot be empty. This is what connections and queries refer to, so renaming it rewrites every reference.',
    mode: 'edit',
    type: { type: 'string', minLength: 1 },
    read: (s) => s.name,
    write: (s, v, ctx): Write => {
      const name = asString(v);
      if (name === null) return bad('Name must be text.');
      if (name === '') return bad('Name cannot be empty — it is how this block is identified.');
      // Compare by index, not by name: `s` may already carry an edit from an earlier writer
      // in the same document, so its own name is not a reliable way to exclude itself.
      const clash = ctx.shapes.some((o, i) => i !== ctx.index && o.name === name);
      if (clash) return bad(`Another block is already named “${name}”.`);
      return { ok: true, shape: { ...s, name } };
    },
  },
  {
    key: 'label',
    title: 'Label',
    doc: 'Text drawn inside the block on the canvas. Purely cosmetic and may be left empty, in which case the name is drawn instead. Unlike the name it does not have to be unique.',
    mode: 'edit',
    type: { type: 'string' },
    read: (s) => s.label,
    write: (s, v): Write => {
      const label = asString(v);
      return label === null ? bad('Label must be text.') : { ok: true, shape: { ...s, label } };
    },
  },
  {
    key: 'position',
    title: 'Position',
    doc: 'Top-left corner as [x, y] in world units. Unbounded in every direction and may be negative; the origin is wherever the diagram was started, not a corner of the page. Dragging on the canvas snaps to the 16-unit grid, but a value typed here is used exactly as written.',
    mode: 'edit',
    type: {
      type: 'tuple',
      items: [{ type: 'integer' }, { type: 'integer' }],
      labels: ['x', 'y'],
    },
    read: (s) => [s.x, s.y],
    write: (s, v): Write => {
      const p = asIntPair(v);
      if (p === null) return bad('Position must be two whole numbers, [x, y].');
      return { ok: true, shape: { ...s, x: p[0], y: p[1] } };
    },
  },
  {
    key: 'size',
    title: 'Size',
    doc: 'Extent as [width, height] in world units. Both must be at least 1. Note that a block much smaller than one 16-unit grid cell is very hard to click on the canvas, so the property panel may be the only way to get it back.',
    mode: 'edit',
    type: {
      type: 'tuple',
      items: [
        { type: 'integer', minimum: 1 },
        { type: 'integer', minimum: 1 },
      ],
      labels: ['width', 'height'],
    },
    read: (s) => [s.w, s.h],
    write: (s, v): Write => {
      const p = asIntPair(v);
      if (p === null) return bad('Size must be two whole numbers, [width, height].');
      if (p[0] < 1 || p[1] < 1) return bad('Width and height must both be at least 1.');
      return { ok: true, shape: { ...s, w: p[0], h: p[1] } };
    },
  },
  {
    key: 'subtitle',
    title: 'Subtitle',
    doc: 'A second, shorter line under the label — what this block is, where the label is what it is called. In the “inset” label mode it is drawn under the label on the canvas, in a smaller and quieter type, and it disappears before the label does as the block shrinks. In the two tabbed modes there is nowhere on the block to put it, so it moves to the top of the hover tooltip instead. May be left empty.',
    mode: 'edit',
    type: { type: 'string' },
    read: (s) => s.subtitle,
    write: (s, v): Write => {
      const subtitle = asString(v);
      return subtitle === null
        ? bad('Subtitle must be text.')
        : { ok: true, shape: { ...s, subtitle } };
    },
  },
  {
    key: 'labelMode',
    title: 'Label mode',
    doc: 'Where the label goes. “inset” centres it in the block with the subtitle beneath it, which is the usual choice for a block big enough to hold text. “tabbed_left” and “tabbed_right” put it in a small tab above the block’s top-left or top-right corner and leave the body empty, which suits a block whose shape matters more than its text, or one too short for two lines. The tab is part of the block: clicking it selects the block.',
    mode: 'edit',
    type: { type: 'enum', values: ['inset', 'tabbed_left', 'tabbed_right'] },
    read: (s) => s.labelMode,
    write: (s, v): Write => {
      const m = asString(v);
      if (m !== 'inset' && m !== 'tabbed_left' && m !== 'tabbed_right') {
        return bad('Label mode must be “inset”, “tabbed_left” or “tabbed_right”.');
      }
      return { ok: true, shape: { ...s, labelMode: m } };
    },
  },
  {
    key: 'description',
    title: 'Description',
    doc: 'Free-text note describing what this hardware block does. Not drawn on the canvas — it appears as a tooltip when you hover the block, so it can be as long as it needs to be without crowding the diagram.',
    mode: 'edit',
    type: { type: 'string' },
    read: (s) => s.description,
    write: (s, v): Write => {
      const description = asString(v);
      return description === null
        ? bad('Description must be text.')
        : { ok: true, shape: { ...s, description } };
    },
  },
  {
    key: 'zIndex',
    title: 'Draw order',
    doc: `Position in the drawing stack, 0 being the bottom. Computed from the order of the scene rather than stored, so it cannot be typed here — use the bring-forward and send-backward buttons in the toolbar, or ${keys('cmd', '[')} and ${keys('cmd', ']')}.`,
    mode: 'computed',
    type: { type: 'integer', minimum: 0 },
    read: (_s, ctx: PropContext) => ctx.index,
  },
];

export const rectProps: PropSchema<RectShape> = propSchema({
  kind: 'rect',
  title: 'Block',
  doc: 'A rectangular hardware entity in the architecture diagram.',
  props,
});
