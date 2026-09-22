import { alignStroke } from '../../canvas/pixel';
import {
  ANCHOR_DOT_R_PX,
  ARROW_HALF_W_PX,
  ARROW_LEN_PX,
  CONN_CORNER_R_PX,
  CONN_KNOB_PX,
  CONN_WIDTH_PX,
  CONN_WIDTH_SEL_PX,
  LABEL_MIN_PX,
  STROKE_HIT_PX,
} from '../../canvas/theme';
import { expandRect, pointInRect } from '../../geom/math';
import type { Anchor, Vec2 } from '../../geom/types';
import { opsFor, registerShape } from '../registry';
import {
  collapseRoute,
  cornerRadius,
  distToRoute,
  endDirection,
  isRectilinear,
  moveSegment,
  patchEnd,
  patchStart,
  routeBounds,
  routeConnection,
  samePoint,
  samePoints,
} from '../route';
import type {
  ConnectionShape,
  CorridorQuery,
  DrawContext,
  Handle,
  Shape,
  ShapeName,
  ShapeOps,
} from '../shape';
import { connProps } from './conn.props';

const SEGMENT_HANDLE = /^seg:(\d+)$/;
const END_HANDLE = /^end:(from|to)$/;

/** Resolve one end against the block it is bound to. Null when the block cannot carry anchors. */
function anchorOf(block: Shape | undefined, id: string): Anchor | null {
  if (block === undefined) return null;
  return opsFor(block).resolveAnchor?.(block, id) ?? null;
}

/**
 * Build a connection from two live anchors.
 *
 * Exported so `ConnectTool` and `reroute` share one definition of what the route should be. If
 * they each computed it, the line would visibly jump between the ghost and the committed shape
 * the first time the two implementations drifted apart.
 */
export function makeConnection(
  name: ShapeName,
  from: ShapeName,
  a: Anchor,
  to: ShapeName,
  b: Anchor,
  corridors: CorridorQuery,
): ConnectionShape {
  return {
    kind: 'conn',
    name,
    label: '',
    description: '',
    from,
    fromAnchor: a.id,
    to,
    toAnchor: b.id,
    routing: 'auto',
    points: routeConnection(a, b, corridors),
  };
}

/** Device-space coordinates for the whole route, snapped so the stroke lands on whole pixels. */
function devicePoints(s: ConnectionShape, dc: DrawContext, widthDev: number): Vec2[] {
  return s.points.map((p) => {
    const q = dc.project(p);
    return {
      x: alignStroke(q.x * dc.dpr, widthDev),
      y: alignStroke(q.y * dc.dpr, widthDev),
    };
  });
}

/** Emit the rounded route into the current path. Separated so a future layer can batch routes. */
function appendRoutePath(ctx: CanvasRenderingContext2D, dev: readonly Vec2[], rDev: number): void {
  ctx.moveTo(dev[0]!.x, dev[0]!.y);
  for (let i = 1; i < dev.length - 1; i++) {
    const r = cornerRadius(dev[i - 1]!, dev[i]!, dev[i + 1]!, rDev);
    // A zero radius degenerates to a lineTo, so a corner between two short runs is still drawn.
    ctx.arcTo(dev[i]!.x, dev[i]!.y, dev[i + 1]!.x, dev[i + 1]!.y, r);
  }
  ctx.lineTo(dev[dev.length - 1]!.x, dev[dev.length - 1]!.y);
}

export const connOps: ShapeOps<ConnectionShape> = {
  kind: 'conn',
  props: connProps,

  /** Unbound and degenerate. `normalize` drops it, which is what an incomplete import deserves. */
  blank(name) {
    return {
      kind: 'conn',
      name,
      label: '',
      description: '',
      from: '',
      fromAnchor: 'e',
      to: '',
      toAnchor: 'w',
      routing: 'auto',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    };
  },

  /**
   * The bare point bbox. The arrowhead, the stroke, the knobs and the end beads are sized in
   * screen pixels and cannot be expressed here; they are covered by the renderer's own cull
   * margin, which is 16 CSS px of world at every zoom and so always exceeds them.
   */
  bounds: (s) => routeBounds(s.points),

  hitTest(s, p, hc) {
    const tol = STROKE_HIT_PX * hc.worldPerPx;
    if (!pointInRect(p, expandRect(routeBounds(s.points), tol))) return false;
    return distToRoute(p, s.points) <= tol;
  },

  /**
   * Two round beads on the anchors, then one grab zone per segment.
   *
   * All invisible here, and painted by `draw` instead: the select tool puts a square knob at
   * `Handle.pos`, which is the wrong place for a segment handle (its start point, a corner,
   * rather than the middle of the run you grab) and the wrong shape for an anchor.
   *
   * The two ends come first because `hitTest` takes the first handle it matches, and where an
   * end bead overlaps the segment leaving it, moving the anchor is what the user means -- the
   * rest of that segment is still available a few pixels along.
   */
  handles(s): readonly Handle[] {
    const out: Handle[] = [];
    const last = s.points[s.points.length - 1];
    if (s.points[0] !== undefined && last !== undefined) {
      out.push({
        id: 'end:from',
        geom: 'point',
        pos: s.points[0],
        cursor: 'crosshair',
        visible: false,
        role: 'rebind',
      });
      out.push({
        id: 'end:to',
        geom: 'point',
        pos: last,
        cursor: 'crosshair',
        visible: false,
        role: 'rebind',
      });
    }
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1]!;
      const b = s.points[i]!;
      if (samePoint(a, b)) continue;
      out.push({
        id: `seg:${i - 1}`,
        geom: 'segment',
        pos: a,
        end: b,
        cursor: a.x === b.x ? 'ew-resize' : 'ns-resize',
        visible: false,
      });
    }
    return out;
  },

  resize(s, handle, p) {
    const m = SEGMENT_HANDLE.exec(String(handle));
    if (m === null) return s;
    const points = moveSegment(s.points, Number(m[1]), p);
    // Hand-editing pins the route: see `reroute`, which then only patches its ends.
    return points === s.points ? s : { ...s, points, routing: 'manual' };
  },

  /**
   * Slide an end onto a different anchor, possibly on a different block.
   *
   * Deliberately does not touch `points`: `reroute` owns the geometry, and running it is
   * already the caller's job on both the preview and the commit. Writing a route here as well
   * would give the two a chance to disagree, which is the same mistake `makeConnection` exists
   * to prevent between the tool and the router.
   *
   * `routing` is left alone too. A hand-drawn route survives its ends being moved -- that is
   * exactly the case `patchStart` / `patchEnd` were written for.
   */
  rebind(s, handle, target) {
    const m = END_HANDLE.exec(String(handle));
    if (m === null || target === null) return s;
    const start = m[1] === 'from';
    // Landing on the block at the other end would make a self-connection, which `normalize`
    // deletes -- and the select tool answers a deleted shape by reverting the whole drag. Much
    // better to refuse now: the bead simply does not follow the cursor in there.
    if (target.shape === (start ? s.to : s.from)) return s;
    if (start) {
      if (s.from === target.shape && s.fromAnchor === target.anchor.id) return s;
      return { ...s, from: target.shape, fromAnchor: target.anchor.id };
    }
    if (s.to === target.shape && s.toAnchor === target.anchor.id) return s;
    return { ...s, to: target.shape, toAnchor: target.anchor.id };
  },

  translate(s, d) {
    if (d.x === 0 && d.y === 0) return s;
    return { ...s, points: s.points.map((p) => ({ x: p.x + d.x, y: p.y + d.y })) };
  },

  normalize(s) {
    // An unbound or self-referential connection is not a connection. The router does no
    // obstacle avoidance, so a same-block route would simply cut through the block.
    if (s.from === '' || s.to === '' || s.from === s.to) return null;
    if (s.points.length < 2) return null;
    const points = collapseRoute(s.points);
    if (!isRectilinear(points)) return null;
    return points === s.points ? s : { ...s, points };
  },

  draw(s, dc, flags) {
    const { ctx, dpr, theme } = dc;
    if (s.points.length < 2) return;

    const restore = dc.toDeviceSpace();
    const wDev = Math.max(
      1,
      Math.round((flags.selected ? CONN_WIDTH_SEL_PX : CONN_WIDTH_PX) * dpr),
    );
    const dev = devicePoints(s, dc, wDev);
    const stroke = flags.ghost
      ? theme.ghostStroke
      : flags.selected
        ? theme.connStrokeSelected
        : theme.connStroke;

    ctx.lineWidth = wDev;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
    if (flags.ghost) ctx.setLineDash([4 * dpr, 4 * dpr]);

    ctx.beginPath();
    appendRoutePath(ctx, dev, CONN_CORNER_R_PX * dpr);
    ctx.stroke();

    const dir = endDirection(s.points);
    if (dir !== null) {
      const tip = dev[dev.length - 1]!;
      const len = ARROW_LEN_PX * dpr;
      const half = ARROW_HALF_W_PX * dpr;
      const bx = tip.x - dir.x * len;
      const by = tip.y - dir.y * len;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(bx - dir.y * half, by + dir.x * half);
      ctx.lineTo(bx + dir.y * half, by - dir.x * half);
      ctx.closePath();
      ctx.fillStyle = stroke;
      ctx.fill();
    }

    if (flags.selected && !flags.ghost) {
      // One batched path of mid-segment knobs, so the whole affordance costs two primitives.
      const size = Math.max(4, Math.round(CONN_KNOB_PX * dpr));
      const lw = Math.max(1, Math.round(dpr));
      ctx.beginPath();
      for (let i = 1; i < dev.length; i++) {
        const a = dev[i - 1]!;
        const b = dev[i]!;
        if (a.x === b.x && a.y === b.y) continue;
        const x = alignStroke((a.x + b.x) / 2 - size / 2, lw);
        const y = alignStroke((a.y + b.y) / 2 - size / 2, lw);
        ctx.rect(x, y, size, size);
      }
      ctx.fillStyle = theme.handleFill;
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = theme.handleStroke;
      ctx.stroke();

      /*
        The two anchors, as round beads rather than square knobs.

        Round because they do a different job: a square moves a run of the line, a circle moves
        where the line attaches. And in the connect tool's colours, not the handle palette --
        filled amber on a dark rim, the exact inverse of the knobs -- because this is the same
        bead that tool shows while you are picking an anchor, doing the same thing.

        Both in one path, so the pair costs two primitives however long the route is.
      */
      const dotR = Math.max(2, Math.round(ANCHOR_DOT_R_PX * dpr));
      // Re-projected and re-aligned against the ring's own width rather than reusing `dev`,
      // which is aligned against the much thicker route stroke: at dpr 2 that is an odd width
      // against an even one, and the ring would land on half pixels and read as soft. Half a
      // device pixel of offset from the line's end is not visible; a blurred ring is.
      const ends = [s.points[0]!, s.points[s.points.length - 1]!].map((q) => {
        const d = dc.project(q);
        return { x: alignStroke(d.x * dpr, lw), y: alignStroke(d.y * dpr, lw) };
      });
      ctx.beginPath();
      for (const e of ends) {
        ctx.moveTo(e.x + dotR, e.y);
        ctx.arc(e.x, e.y, dotR, 0, Math.PI * 2);
      }
      ctx.fillStyle = theme.anchorDotFill;
      // Set again rather than inherited from the knobs above: a bead that silently took its
      // width from whatever ran before it would fatten the moment that block moved or went.
      ctx.lineWidth = lw;
      ctx.strokeStyle = theme.anchorDotStroke;
      ctx.fill();
      ctx.stroke();
    }

    if (!flags.ghost && s.label !== '') drawLabel(s, dc, dev);

    // Restore everything touched. `lineJoin` in particular: `rect.ts` strokes with `strokeRect`,
    // whose corners honour it, so leaving it round would soften every block drawn after this one.
    ctx.setLineDash([]);
    ctx.lineJoin = 'miter';
    restore();
  },

  renameRef(s, from, to) {
    if (s.from !== from && s.to !== from) return s;
    return {
      ...s,
      from: s.from === from ? to : s.from,
      to: s.to === from ? to : s.to,
    };
  },

  dependsOn: (s) => [s.from, s.to],

  /**
   * Re-derive the route after an endpoint moved.
   *
   * Returns `s` by reference whenever the geometry is unchanged, which is the contract
   * `SceneStore.commit` relies on to avoid recording empty undo entries.
   */
  reroute(s, deps, rc) {
    const a = anchorOf(deps.get(s.from), s.fromAnchor);
    const b = anchorOf(deps.get(s.to), s.toAnchor);
    if (a === null || b === null) return s;

    if (s.routing === 'manual') {
      const patched = patchEnd(patchStart(s.points, a.pos), b.pos);
      if (patched.length >= 2 && isRectilinear(patched)) {
        return samePoints(patched, s.points) ? s : { ...s, points: patched };
      }
      // The hand-drawn route no longer describes a valid path between these two anchors. Fall
      // through and re-route, but keep the flag: the user's intent is lost for this move, not
      // permanently, and silently demoting them to 'auto' would lose every later edit too.
    }

    const points = routeConnection(a, b, rc.corridors);
    return samePoints(points, s.points) ? s : { ...s, points };
  },

  corridors: (s) => s.points,
};

/** The label rides the longest run, which is the only one reliably long enough to hold text. */
function drawLabel(s: ConnectionShape, dc: DrawContext, dev: readonly Vec2[]): void {
  const { ctx, dpr, theme } = dc;
  let best = -1;
  let bestLen = 0;
  for (let i = 1; i < dev.length; i++) {
    const len = Math.abs(dev[i]!.x - dev[i - 1]!.x) + Math.abs(dev[i]!.y - dev[i - 1]!.y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  if (best < 0 || bestLen < LABEL_MIN_PX * dpr) return;

  const cx = (dev[best]!.x + dev[best - 1]!.x) / 2;
  const cy = (dev[best]!.y + dev[best - 1]!.y) / 2;
  ctx.font = `${Math.round(11 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pad = 3 * dpr;
  const w = ctx.measureText(s.label).width + 2 * pad;
  const h = 14 * dpr;
  // A plate, so the line does not strike through its own label.
  ctx.fillStyle = theme.background;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = theme.connLabel;
  ctx.fillText(s.label, cx, cy);
}

registerShape(connOps);
