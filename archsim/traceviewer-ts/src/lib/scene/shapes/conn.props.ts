import type { Vec2 } from '../../geom/types';
import {
  propSchema,
  type PropContext,
  type PropDef,
  type PropSchema,
  type WriteResult,
} from '../../props/spec';
import { opsFor } from '../registry';
import { collapseRoute, isRectilinear } from '../route';
import type { ConnectionShape, Shape } from '../shape';

type Write = WriteResult<ConnectionShape>;

function bad(error: string): Write {
  return { ok: false, error };
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** A `[block, anchor]` pair. Both halves are text; neither may be empty. */
function asEndpoint(v: unknown): [string, string] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [block, anchor] = v;
  if (typeof block !== 'string' || typeof anchor !== 'string') return null;
  if (block === '' || anchor === '') return null;
  return [block, anchor];
}

function asPointList(v: unknown): Vec2[] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const out: Vec2[] = [];
  for (const entry of v) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [x, y] = entry;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    out.push({ x, y });
  }
  return out;
}

/** Validate one end against the live scene, so a bad edit is refused rather than cascade-deleted. */
function checkEndpoint(
  ctx: PropContext,
  block: string,
  anchor: string,
  other: string,
): string | null {
  if (block === other) {
    return 'A connection needs two different blocks; it cannot start and end on the same one.';
  }
  const target: Shape | undefined = ctx.shapes.find((o, i) => i !== ctx.index && o.name === block);
  if (target === undefined) return `No block is named “${block}”.`;
  const ops = opsFor(target);
  if (ops.resolveAnchor === undefined)
    return `“${block}” is not something a connection can attach to.`;
  if (ops.resolveAnchor(target, anchor) === null) {
    return `“${anchor}” is not a valid anchor. Use a side (n, e, s, w) optionally followed by a distance along it, such as “e:48”.`;
  }
  return null;
}

/**
 * The connection's properties.
 *
 * Read this as the definition of what a connection *is*. As with a block, every consumer -- the
 * panel rows, the JSON Schema, the footer documentation and the saved record -- follows from
 * this one list, in the order `propSchema` sorts it into rather than the order written here.
 *
 * Note that there is no version bump anywhere for adding this kind. A record is a property bag
 * keyed by `kind`, so a new kind is new data in the same format, not a new format.
 */
const props: readonly PropDef<ConnectionShape>[] = [
  {
    key: 'kind',
    title: 'Kind',
    doc: 'Which type of object this is. Selects how it is drawn and which properties it has. Fixed when the object is created.',
    mode: 'fixed',
    type: { type: 'enum', values: ['conn'] },
    read: () => 'conn',
  },
  {
    key: 'name',
    title: 'Name',
    doc: 'Internal identifier for this connection. Must be unique across the diagram — connections and blocks share one namespace — and cannot be empty.',
    mode: 'edit',
    type: { type: 'string', minLength: 1 },
    read: (s) => s.name,
    write: (s, v, ctx): Write => {
      const name = asString(v);
      if (name === null) return bad('Name must be text.');
      if (name === '')
        return bad('Name cannot be empty — it is how this connection is identified.');
      const clash = ctx.shapes.some((o, i) => i !== ctx.index && o.name === name);
      if (clash) return bad(`Another object is already named “${name}”.`);
      return { ok: true, shape: { ...s, name } };
    },
  },
  {
    key: 'label',
    title: 'Label',
    doc: 'Text drawn beside the line on the canvas — a bus width, a protocol name. Purely cosmetic and empty by default; unlike a block, a connection with no label draws no text rather than falling back to its name.',
    mode: 'edit',
    type: { type: 'string' },
    read: (s) => s.label,
    write: (s, v): Write => {
      const label = asString(v);
      return label === null ? bad('Label must be text.') : { ok: true, shape: { ...s, label } };
    },
  },
  {
    key: 'source',
    title: 'Source',
    doc: 'Where the connection starts, as [block, anchor]. The anchor is a side — n, e, s or w — optionally followed by a distance in world units along that side from its top or left corner, such as “e:48”. A bare side means the middle of that side.',
    mode: 'edit',
    type: {
      type: 'tuple',
      items: [
        { type: 'string', minLength: 1 },
        { type: 'string', minLength: 1 },
      ],
      labels: ['block', 'anchor'],
    },
    read: (s) => [s.from, s.fromAnchor],
    write: (s, v, ctx): Write => {
      const e = asEndpoint(v);
      if (e === null) return bad('Source must be two non-empty strings, [block, anchor].');
      const error = checkEndpoint(ctx, e[0], e[1], s.to);
      if (error !== null) return bad(error);
      return { ok: true, shape: { ...s, from: e[0], fromAnchor: e[1] } };
    },
  },
  {
    key: 'target',
    title: 'Target',
    doc: 'Where the connection ends, as [block, anchor], in the same form as the source. This is the end that carries the arrowhead — swapping source and target reverses the arrow.',
    mode: 'edit',
    type: {
      type: 'tuple',
      items: [
        { type: 'string', minLength: 1 },
        { type: 'string', minLength: 1 },
      ],
      labels: ['block', 'anchor'],
    },
    read: (s) => [s.to, s.toAnchor],
    write: (s, v, ctx): Write => {
      const e = asEndpoint(v);
      if (e === null) return bad('Target must be two non-empty strings, [block, anchor].');
      const error = checkEndpoint(ctx, e[0], e[1], s.from);
      if (error !== null) return bad(error);
      return { ok: true, shape: { ...s, to: e[0], toAnchor: e[1] } };
    },
  },
  {
    key: 'routing',
    title: 'Routing',
    doc: 'Whether the route is maintained automatically. “auto” re-derives the whole path whenever either block moves, and prefers to run alongside existing connections so parallel lines bundle together. “manual” keeps the path you drew and only slides its two ends. Dragging a segment on the canvas switches this to “manual”; setting it back to “auto” here re-routes immediately.',
    mode: 'edit',
    type: { type: 'enum', values: ['auto', 'manual'] },
    read: (s) => s.routing,
    write: (s, v): Write => {
      const routing = asString(v);
      if (routing !== 'auto' && routing !== 'manual')
        return bad('Routing must be “auto” or “manual”.');
      return { ok: true, shape: { ...s, routing } };
    },
  },
  {
    key: 'points',
    title: 'Route',
    doc: 'The path as a list of [x, y] points in world units. The first point sits on the source anchor and the last on the target anchor, and every point must share exactly one coordinate with the next, since the route only runs horizontally and vertically. Editing this switches routing to “manual”, unless the same edit sets routing itself.',
    mode: 'edit',
    type: {
      type: 'list',
      item: {
        type: 'tuple',
        items: [{ type: 'integer' }, { type: 'integer' }],
        labels: ['x', 'y'],
      },
      minItems: 2,
    },
    read: (s) => s.points.map((p) => [p.x, p.y]),
    write: (s, v): Write => {
      const pts = asPointList(v);
      if (pts === null)
        return bad('Route must be a list of at least two [x, y] whole-number pairs.');
      // A diagonal would break corner rounding, corridor extraction and the segment handles all
      // at once, so it is refused here rather than degrading three things quietly.
      if (!isRectilinear(pts)) {
        return bad(
          'Each point must share exactly one coordinate with the next: the route runs only horizontally and vertically.',
        );
      }
      return { ok: true, shape: { ...s, points: collapseRoute(pts), routing: 'manual' } };
    },
  },
  {
    key: 'description',
    title: 'Description',
    doc: 'Free-text note describing what this connection carries. Never drawn on the canvas; it is here to document the design for whoever reads the diagram next.',
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
    doc: 'Position in the drawing stack, 0 being the bottom. Computed from the order of the scene rather than stored. For a connection this also decides which other connections it may bundle onto: it can only join the route of something below it in the stack.',
    mode: 'computed',
    type: { type: 'integer', minimum: 0 },
    read: (_s, ctx: PropContext) => ctx.index,
  },
];

export const connProps: PropSchema<ConnectionShape> = propSchema({
  kind: 'conn',
  title: 'Connection',
  doc: 'A directed link between two blocks, drawn as a rectilinear arrow.',
  props,
});
