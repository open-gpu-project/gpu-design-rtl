import { CONN_LABEL_OFFSET_MAX } from '../../canvas/theme';
import type { Vec2 } from '../../geom/types';
import {
  asIntPair,
  asString,
  bad,
  descriptionProp,
  kindProp,
  labelProp,
  nameProp,
  parentProp,
  zIndexProp,
} from '../../props/common';
import {
  propSchema,
  type PropContext,
  type PropDef,
  type PropSchema,
  type WriteResult,
} from '../../props/spec';
import { opsFor } from '../registry';
import { collapseCurve } from '../curve';
import { collapseRoute, isRectilinear } from '../route';
import type { ConnectionShape, Shape } from '../shape';

type Write = WriteResult<ConnectionShape>;

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

/**
 * Validate one end against the live scene, so a bad binding is refused rather than loaded and
 * then cascade-deleted. Reached from the loader now rather than from the panel, which is if
 * anything the case that needs it more: a hand-written or hand-merged file is exactly where a
 * connection pointing at a block that is not there comes from.
 */
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
    return `“${anchor}” is not a valid anchor. On a block use a side (n, e, s, w) optionally followed by a distance along it, such as “e:48”; on a network interface use “out” or “in”.`;
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
 * `source`, `target` and `points` are `fixed`: saved and restored like everything else, but
 * owned by the canvas. They are not three facts, they are one -- the first point sits on the
 * source anchor and the last on the target's -- and the gestures that change them (drag a
 * bead, drag a segment) keep them consistent by construction, while hand-editing one of the
 * three is a way to say something the other two contradict. Their writers survive because the
 * loader still needs them; see `hydrateShape`.
 *
 * `routing` is editable, and deliberately so even though the canvas sets it too. It is not
 * geometry, it is a choice about who maintains the geometry -- and dragging a segment can only
 * ever move that choice one way, so the panel is where it goes back. Setting it to `auto` is
 * the only way to un-pin a hand-drawn route.
 *
 * Note that there is no version bump anywhere for adding this kind. A record is a property bag
 * keyed by `kind`, so a new kind is new data in the same format, not a new format.
 */
const props: readonly PropDef<ConnectionShape>[] = [
  kindProp('conn'),
  nameProp(
    'connection',
    'Internal identifier for this connection. Must be unique across the diagram — connections and blocks share one namespace — and cannot be empty.',
  ),
  labelProp(
    'connection',
    'Text drawn beside the line on the canvas — a bus width, a protocol name. Purely cosmetic and empty by default; unlike a block, a connection with no label draws no text rather than falling back to its name.',
  ),
  {
    key: 'source',
    title: 'Source',
    doc: 'Where the connection starts, as [block, anchor]. On a block the anchor is a side — n, e, s or w — optionally followed by a distance in world units along that side from its top or left corner, such as “e:48”; a bare side means the middle of that side. A network interface has two named edges instead: “out”, facing away from its parent, and “in”, facing into it, which only a fabric’s interfaces offer. Anything else on an interface is read as “out”. Set on the canvas: drag the round bead at this end of the line along its edge, or onto a different block.',
    mode: 'fixed',
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
    doc: 'Where the connection ends, as [block, anchor], in the same form as the source. This is the end that carries the arrowhead, so swapping the two would reverse the arrow. Set on the canvas: drag the round bead at this end of the line along its edge, or onto a different block.',
    mode: 'fixed',
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
    doc: 'Whether the route is maintained automatically. “auto” re-derives the whole path whenever either block moves, and prefers to run alongside existing connections so parallel lines bundle together. “manual” keeps the path you drew and only slides its two ends — unless a single drag moves BOTH of them, as dragging a fabric moves both ends of a link between two of its own ports, in which case the whole route travels with them. Dragging a segment on the canvas switches this to “manual”; setting it back to “auto” here is how a hand-drawn route is handed back to the router, and it re-routes immediately.',
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
    key: 'path',
    title: 'Path',
    doc: 'Which shape the link is drawn as. “ortho” is the rectilinear router: horizontal and vertical runs with rounded corners. “curve” is a spline through waypoints you place, used for links between network interfaces, where the wire stands for a bus rather than a signal — with no waypoints it is a straight line, which is what an automatic bus link is unless a straight line would leave one port backwards or reach the other from behind. This is a separate question from “routing”, which says who maintains the geometry rather than what the geometry is. Changing it re-derives the path from scratch, so a hand-drawn route is lost.',
    mode: 'edit',
    type: { type: 'enum', values: ['ortho', 'curve'] },
    read: (s) => s.path,
    write: (s, v): Write => {
      const path = asString(v);
      if (path !== 'ortho' && path !== 'curve') return bad('Path must be “ortho” or “curve”.');
      if (path === s.path) return { ok: true, shape: s };
      /*
        Back to `auto` in the same write, and this is the one place a writer deliberately sets a
        sibling key. The two families do not share a vocabulary: an `ortho` route's interior
        points are axis constraints and a `curve`'s are waypoints, so keeping a hand-drawn one
        across the change would hand `reroute` a path that means something else entirely --
        `normalize` would reject the rectilinear case outright and delete the connection.
        `routing` sorts before `path`, so `applyDocument` applies this AFTER any `routing` edit
        in the same document, and this wins. Said here because that ordering is load-bearing.
      */
      return { ok: true, shape: { ...s, path, routing: 'auto' } };
    },
  },
  {
    key: 'points',
    title: 'Route',
    doc: 'The path as a list of [x, y] points in world units. The first sits on the source anchor and the last on the target anchor. What lies between depends on “path”: for “ortho” they are the corners of the route, and every point shares exactly one coordinate with the next, since it only runs horizontally and vertically; for “curve” they are the waypoints the spline is drawn through, and two points is a straight line. Set on the canvas — drag a square knob to slide a segment, a round waypoint to bend a curve, a “+” to insert one, or a bead to move an end. A path drawn by hand is kept only while “routing” says “manual”.',
    mode: 'fixed',
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
      /*
        A curve's control polygon has no shape rule to enforce -- any polygon is a valid spline,
        and `collapseCurve` only drops points that are doing nothing. Both guards below are
        therefore `ortho`-only.

        `path` sorts before `points` (`edit` before `fixed`, then alphabetical), so on a document
        that changes both, this writer already sees the new family.
      */
      if (s.path === 'curve') return { ok: true, shape: { ...s, points: collapseCurve(pts) } };

      // A diagonal would break corner rounding, corridor extraction and the segment handles all
      // at once, so it is refused here rather than degrading three things quietly.
      if (!isRectilinear(pts)) {
        return bad(
          'Each point must share exactly one coordinate with the next: an “ortho” route runs only horizontally and vertically.',
        );
      }
      // Does NOT touch `routing`, and that is the whole reason this pair is safe to write in
      // either order. The gesture that draws a route by hand is what pins it -- `connOps.resize`
      // sets `manual` in the same write that moves the segment -- so a record's `routing` is
      // already the answer and this writer has no business second-guessing it. A hand-written
      // file that lists points but no mode therefore gets the router, which is what not saying
      // “manual” means.
      return { ok: true, shape: { ...s, points: collapseRoute(pts) } };
    },
  },
  {
    key: 'labelOffset',
    title: 'Label offset',
    doc: 'Nudge for the drawn label, as [par, perp], to move it clear of whatever it collides with. The two axes come from the run the label sits on, not from the screen, so one offset means the same thing on a horizontal wire and a vertical one: “par” slides the label along the run in the direction of the arrow, and “perp” pushes it sideways, positive being to the right of that direction — below a left-to-right run. Measured in screen pixels rather than world units, unlike every other geometry here, because the label is drawn at a fixed size at every zoom and a nudge in world units would drift away from its wire as you zoom in. An automatically routed connection can move its label to a different run when the blocks move, and the offset then applies to that run.',
    mode: 'edit',
    type: {
      type: 'tuple',
      items: [
        { type: 'integer', minimum: -CONN_LABEL_OFFSET_MAX, maximum: CONN_LABEL_OFFSET_MAX },
        { type: 'integer', minimum: -CONN_LABEL_OFFSET_MAX, maximum: CONN_LABEL_OFFSET_MAX },
      ],
      labels: ['par', 'perp'],
    },
    read: (s) => [s.labelOffset[0], s.labelOffset[1]],
    write: (s, v): Write => {
      const p = asIntPair(v);
      if (p === null) return bad('Label offset must be two whole numbers, [par, perp].');
      // Re-checked here and not left to the schema: ajv is advisory in this editor, and an
      // offset past the renderer's cull margin makes the label vanish near the viewport edge.
      if (p.some((n) => Math.abs(n) > CONN_LABEL_OFFSET_MAX)) {
        return bad(
          `Label offset must be between -${CONN_LABEL_OFFSET_MAX} and ${CONN_LABEL_OFFSET_MAX} pixels.`,
        );
      }
      return { ok: true, shape: { ...s, labelOffset: [p[0], p[1]] } };
    },
  },
  descriptionProp(
    'what this connection carries',
    'Free-text note describing what this connection carries. Not drawn on the canvas — it appears as a tooltip when you hover the wire, under the connection’s name, so it can be as long as it needs to be without crowding the diagram.',
  ),
  parentProp(
    'connection',
    'The innermost block that both ends of this connection lie inside, or empty when they share none — or, when it joins two interfaces of one block or fabric, that block or fabric. Worked out from where its ends are rather than stored, so it follows the blocks it joins. Moving that parent carries the connection with it.',
  ),
  zIndexProp(
    'Position in the drawing stack, 0 being the bottom. Computed from the order of the scene rather than stored. For a connection this also decides which other connections it may bundle onto: it can only join the route of something below it in the stack.',
  ),
];

export const connProps: PropSchema<ConnectionShape> = propSchema({
  kind: 'conn',
  title: 'Connection',
  doc: 'A directed link between two blocks: a rectilinear arrow, or — between two network interfaces — a curved bus link. See “path”.',
  props,
});
