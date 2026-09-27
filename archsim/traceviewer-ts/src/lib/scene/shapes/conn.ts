import Spline from '@lucide/svelte/icons/spline';
import { alignStroke } from '../../canvas/pixel';
import {
  ANCHOR_DOT_R_PX,
  ARROW_HALF_W_PX,
  ARROW_LEN_PX,
  CONN_CORNER_R_PX,
  CONN_KNOB_PX,
  CONN_WIDTH_PX,
  CONN_LABEL_MIN_RUN_PX,
  CONN_WIDTH_SEL_PX,
  SANS,
  STROKE_HIT_PX,
} from '../../canvas/theme';
import { expandRect, pointInRect } from '../../geom/math';
import type { Anchor, Vec2 } from '../../geom/types';
import {
  autoWaypoints,
  collapseCurve,
  curveAt,
  curveEndDirection,
  curveSpans,
  flattenCurve,
  insertWaypoint,
  moveWaypoint,
  removeWaypoint,
} from '../curve';
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
  PathStyle,
  Shape,
  ShapeName,
  ShapeOps,
} from '../shape';
import { connProps } from './conn.props';

const SEGMENT_HANDLE = /^seg:(\d+)$/;
const END_HANDLE = /^end:(from|to)$/;
const WAYPOINT_HANDLE = /^way:(\d+)$/;
const INSERT_HANDLE = /^ins:(\d+)$/;

/** True for the spline family. Every rectilinear assumption below is guarded on this. */
function isCurve(s: ConnectionShape): boolean {
  return s.path === 'curve';
}

/**
 * The drawn polyline.
 *
 * For a curve this is a FLATTENING, not the control polygon -- centripetal Catmull-Rom bulges
 * outside its control points, so `bounds` and `hitTest` both taking their answer from here is
 * what stops the renderer culling the bulge, the hit test rejecting clicks inside it, and the
 * marquee selecting a curve whose bulge pokes out of the band.
 */
function drawnPoints(s: ConnectionShape): readonly Vec2[] {
  return isCurve(s) ? flattenCurve(s.points) : s.points;
}

/** Resolve one end against the block it is bound to. Null when the block cannot carry anchors. */
export function anchorOf(block: Shape | undefined, id: string): Anchor | null {
  if (block === undefined) return null;
  return opsFor(block).resolveAnchor?.(block, id) ?? null;
}

/** The family a shape asks for at its end of a link. A missing shape asks for nothing. */
export function preferredPathOf(s: Shape | undefined): PathStyle {
  return s === undefined ? 'ortho' : (opsFor(s).preferredPath?.(s) ?? 'ortho');
}

/**
 * The family of a link between two shapes: a curve only when BOTH ends ask for one. That is what
 * makes "a plain arrow may still be drawn to a network interface" true by construction -- draw
 * from a block to an interface and you get a square arrow, because only one end asked.
 */
export function pathBetween(a: Shape | undefined, b: Shape | undefined): PathStyle {
  return preferredPathOf(a) === 'curve' && preferredPathOf(b) === 'curve' ? 'curve' : 'ortho';
}

/**
 * The automatic route from `a` to `b` in `path`'s family.
 *
 * The one definition, shared by the connect tool's ghost, its commit and `reroute`. If they each
 * computed it, the line would visibly jump between the ghost and the committed shape the first
 * time two implementations drifted apart.
 *
 * `b` may be a bare point: the ghost's free end. A curve needs a normal at the far end to bow
 * away from and a point has none, so a curve to one runs straight until it lands on something.
 */
export function autoPoints(
  path: PathStyle,
  a: Anchor,
  b: Anchor | Vec2,
  corridors: CorridorQuery,
): readonly Vec2[] {
  if (path !== 'curve') return routeConnection(a, b, corridors);
  return 'normal' in b ? [a.pos, ...autoWaypoints(a, b), b.pos] : [a.pos, b];
}

/** A connection with this geometry, and every other field at its default. */
export function newConnection(g: {
  readonly name: ShapeName;
  readonly from: ShapeName;
  readonly fromAnchor: string;
  readonly to: ShapeName;
  readonly toAnchor: string;
  readonly path: PathStyle;
  readonly points: readonly Vec2[];
}): ConnectionShape {
  return {
    kind: 'conn',
    name: g.name,
    label: '',
    labelOffset: [0, 0],
    description: '',
    from: g.from,
    fromAnchor: g.fromAnchor,
    to: g.to,
    toAnchor: g.toAnchor,
    routing: 'auto',
    path: g.path,
    points: g.points,
  };
}

/**
 * Device-space coordinates for the route, snapped so the stroke lands on whole pixels.
 *
 * **A curve's interior control points are NOT snapped**, and only its two ends are. Aligning
 * every control point moves each of them by up to half a pixel in an arbitrary direction, and on
 * a spline that is a visible kink rather than the crisper line it buys on a rectilinear run. The
 * ends are worth aligning because that is where the line meets an anchor bead.
 */
function devicePoints(s: ConnectionShape, dc: DrawContext, widthDev: number): Vec2[] {
  const curve = isCurve(s);
  const last = s.points.length - 1;
  return s.points.map((p, i) => {
    const q = dc.project(p);
    if (curve && i !== 0 && i !== last) return { x: q.x * dc.dpr, y: q.y * dc.dpr };
    return {
      x: alignStroke(q.x * dc.dpr, widthDev),
      y: alignStroke(q.y * dc.dpr, widthDev),
    };
  });
}

/** Emit the spline through `dev` into the current path. */
function appendCurvePath(ctx: CanvasRenderingContext2D, dev: readonly Vec2[]): void {
  ctx.moveTo(dev[0]!.x, dev[0]!.y);
  // Spans computed from the PROJECTED control points: projection is affine, so the spline of
  // the projected polygon is the projection of the spline, and doing it here costs one pass.
  for (const sp of curveSpans(dev)) {
    ctx.bezierCurveTo(sp.c1.x, sp.c1.y, sp.c2.x, sp.c2.y, sp.p1.x, sp.p1.y);
  }
}

/** Emit the rounded route into the current path. */
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
  icon: Spline,
  props: connProps,

  /** Unbound and degenerate. `normalize` drops it, which is what an incomplete import deserves. */
  blank(name) {
    return newConnection({
      name,
      from: '',
      fromAnchor: 'e',
      to: '',
      toAnchor: 'w',
      path: 'ortho',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    });
  },

  /**
   * The bare point bbox. The arrowhead, the stroke, the knobs and the end beads are sized in
   * screen pixels and cannot be expressed here; they are covered by the renderer's own cull
   * margin, `CULL_MARGIN_PX` of world at every zoom, which always exceeds them.
   */
  bounds: (s) => routeBounds(drawnPoints(s)),

  hitTest(s, p, hc) {
    const pts = drawnPoints(s);
    const tol = STROKE_HIT_PX * hc.worldPerPx;
    if (!pointInRect(p, expandRect(routeBounds(pts), tol))) return false;
    return distToRoute(p, pts) <= tol;
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
    if (isCurve(s)) {
      /*
        Waypoints are VISIBLE handles, unlike a segment's.

        A segment handle's knob belongs at the middle of the run you grab, not at `Handle.pos`,
        which is a corner -- so `conn.draw` paints those itself and the handles stay invisible.
        A waypoint's knob belongs exactly at `Handle.pos`, so the select tool's own overlay loop
        draws it correctly for free.
      */
      for (let i = 1; i < s.points.length - 1; i++) {
        out.push({
          id: `way:${i}`,
          geom: 'point',
          pos: s.points[i]!,
          cursor: 'move',
          visible: true,
        });
      }
      // The insert badge, one per span, offset so it does not sit under the waypoint knobs.
      const spans = curveSpans(s.points);
      for (let i = 0; i < spans.length; i++) {
        out.push({
          id: `ins:${i}`,
          geom: 'point',
          pos: curveAt(s.points, (i + 0.5) / spans.length),
          cursor: 'copy',
          visible: true,
          role: 'action',
          glyph: 'plus',
        });
      }
      return out;
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

  /**
   * Move a waypoint, insert one, or slide a rectilinear run -- whichever the handle names.
   *
   * All three pin the route to `manual`: see `reroute`, which then only patches its ends. The
   * insert lives here rather than in the tool for the same reason the others do -- geometry is
   * the shape's business, and a tool that built a new point list would be a second place the
   * rules about what a route may look like are written down.
   */
  resize(s, handle, p) {
    const h = String(handle);

    if (isCurve(s)) {
      const w = WAYPOINT_HANDLE.exec(h);
      if (w !== null) {
        const points = moveWaypoint(s.points, Number(w[1]), p);
        return points === s.points ? s : { ...s, points, routing: 'manual' };
      }
      const i = INSERT_HANDLE.exec(h);
      if (i !== null) {
        return { ...s, points: insertWaypoint(s.points, Number(i[1]), p), routing: 'manual' };
      }
      return s;
    }

    const m = SEGMENT_HANDLE.exec(h);
    if (m === null) return s;
    const points = moveSegment(s.points, Number(m[1]), p);
    return points === s.points ? s : { ...s, points, routing: 'manual' };
  },

  subPartOf(s, handle) {
    if (!isCurve(s)) return null;
    const m = WAYPOINT_HANDLE.exec(String(handle));
    if (m === null) return null;
    const i = Number(m[1]);
    return i > 0 && i < s.points.length - 1 ? i : null;
  },

  subPart(s, index) {
    if (!isCurve(s)) return null;
    const pos = s.points[index];
    if (pos === undefined || index <= 0 || index >= s.points.length - 1) return null;
    return { count: s.points.length - 2, ordinal: index, pos, noun: 'waypoint' };
  },

  removeSubPart(s, index) {
    if (!isCurve(s)) return s;
    const points = removeWaypoint(s.points, index);
    return points === s.points ? s : { ...s, points, routing: 'manual' };
  },

  /**
   * Slide an end onto a different anchor, possibly on a different block.
   *
   * Deliberately does not touch `points`: `reroute` owns the geometry, and running it is
   * already the caller's job on both the preview and the commit. Writing a route here as well
   * would give the two a chance to disagree, which is the same mistake `autoPoints` exists to
   * prevent between the tool and the router.
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

    if (isCurve(s)) {
      // A curve-specific collapse: `collapseRoute` also drops axis-COLLINEAR interior points,
      // and a waypoint the user deliberately lined up is still holding the curve straight there.
      const points = collapseCurve(s.points);
      return points === s.points ? s : { ...s, points };
    }

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
    if (isCurve(s)) appendCurvePath(ctx, dev);
    else appendRoutePath(ctx, dev, CONN_CORNER_R_PX * dpr);
    ctx.stroke();

    // In device space for a curve, because the tangent there is the tangent on screen -- the
    // world-space one would be right only at a uniform zoom, which is all this app has today,
    // but taking it from the same points that were drawn removes the assumption.
    const dir = isCurve(s) ? curveEndDirection(dev) : endDirection(s.points);
    const tip = dev[dev.length - 1]!;
    if (dir !== null && headIsClear(s, dc, arrowBase(tip, dir, dpr))) {
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
      const lw = Math.max(1, Math.round(dpr));

      /*
        Mid-segment knobs, for a rectilinear route only.

        A curve has none: its waypoint handles are `visible`, so the select tool's own overlay
        draws a knob at each `Handle.pos` -- which for a waypoint is exactly the right place.
        A segment handle's `pos` is a corner rather than the middle of the run you grab, which
        is why those are invisible and painted here instead.
      */
      if (!isCurve(s)) {
        const size = Math.max(4, Math.round(CONN_KNOB_PX * dpr));
        ctx.beginPath();
        for (let i = 1; i < dev.length; i++) {
          const a2 = dev[i - 1]!;
          const b2 = dev[i]!;
          if (a2.x === b2.x && a2.y === b2.y) continue;
          const x = alignStroke((a2.x + b2.x) / 2 - size / 2, lw);
          const y = alignStroke((a2.y + b2.y) / 2 - size / 2, lw);
          ctx.rect(x, y, size, size);
        }
        ctx.fillStyle = theme.handleFill;
        ctx.fill();
        ctx.lineWidth = lw;
        ctx.strokeStyle = theme.handleStroke;
        ctx.stroke();
      }

      /*
        The two anchors, as round beads rather than square knobs. Both families get them: they
        are the rebind affordance, and a curve's ends move exactly as a route's do.

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

    // Restore everything touched. `lineJoin` in particular: a box body strokes with `strokeRect`,
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
      if (isCurve(s)) {
        /*
          Only the two ends move. A curve's interior points are the user's waypoints and mean the
          same thing wherever the anchors go -- unlike a rectilinear route, whose interior is a
          set of axis constraints that a moved end can invalidate, which is why `patchStart` and
          `patchEnd` have to re-hang a point and can fail.

          That is right for one end moving and wrong for both, which is why the case where both
          are moving never reaches here: `movesWith` translates such a connection bodily, and
          the patch below then finds its ends already correct and returns by reference.
        */
        const patched = [a.pos, ...s.points.slice(1, -1), b.pos];
        return samePoints(patched, s.points) ? s : { ...s, points: patched };
      }
      const patched = patchEnd(patchStart(s.points, a.pos), b.pos);
      if (patched.length >= 2 && isRectilinear(patched)) {
        return samePoints(patched, s.points) ? s : { ...s, points: patched };
      }
      // The hand-drawn route no longer describes a valid path between these two anchors. Fall
      // through and re-route, but keep the flag: the user's intent is lost for this move, not
      // permanently, and silently demoting them to 'auto' would lose every later edit too.
    }

    const points = autoPoints(s.path, a, b, rc.corridors);
    return samePoints(points, s.points) ? s : { ...s, points };
  },

  /*
    A curve contributes NO corridors.

    Corridors are a rectilinear bundling concept -- `CorridorIndex` records runs where two points
    share a coordinate, and a curve's control polygon would offer spurious ones wherever two
    control points happened to line up. Orthogonal wires would then snap onto a run that is not
    actually there.
  */
  corridors: (s) => (isCurve(s) ? null : s.points),

  /**
   * Heading is the name, not the label. A connection draws its `label` and never its `name`, so
   * hovering is the only place the identifier other objects refer to it by is visible at all.
   */
  tooltip: (s) => ({ title: s.name, lines: s.description !== '' ? [s.description] : [] }),
};

/** The back of the arrowhead: the midpoint of its base, one head-length behind the tip. */
function arrowBase(tip: Vec2, dir: Vec2, dpr: number): Vec2 {
  const len = ARROW_LEN_PX * dpr;
  return { x: tip.x - dir.x * len, y: tip.y - dir.y * len };
}

/**
 * Is there room for the arrowhead, or would it be drawn on top of a block?
 *
 * Only the two blocks this connection joins are considered. The head is a constant 9 CSS px
 * while the blocks shrink with the zoom, so the case that matters is the ordinary one: two
 * blocks a short gap apart, zoomed out until the gap is thinner than the head and the wedge
 * is sitting in the source block rather than pointing at the target. A bare line still says
 * everything a line can say; a blob says less than nothing.
 *
 * A manual route that has been dragged into its own target lands here too, which is right for
 * the same reason.
 *
 * **The question is where the WEDGE sits, not whether any ink touches it**, and the difference
 * became visible once straight diagonal links were the norm (iteration 6). A head arriving at 15
 * degrees off a port's face genuinely lays a barb across that face -- which is what an arrow
 * meeting a surface at a glancing angle looks like, and not a blob -- while the head's box, which
 * cannot rotate, reports an overlap for the same reason. Testing the box dropped the arrowhead from
 * every bus link in the app.
 *
 * So the test is the base point: outside every block means the wedge is in open space with its
 * tip on a border, which is an arrow. Inside one means it is buried, which is not. A point,
 * deliberately, so that nothing has to be deflated or discounted. The tip sits exactly ON the
 * target's outline by construction, and `alignStroke` rounds it by up to a device pixel, so any
 * test involving the tip needs a tolerance -- and deflating the block to supply one is wrong,
 * because zoomed out far enough a block is two or three device pixels across, which is
 * precisely the case this is here to catch, and a deflated version of it has no area left to
 * test. The base never lands on an outline by construction, so it needs no tolerance at all.
 */
function headIsClear(s: ConnectionShape, dc: DrawContext, base: Vec2): boolean {
  for (const name of [s.from, s.to]) {
    const r = dc.boundsOf(name);
    if (r === null) continue;
    const a = dc.project({ x: r.x, y: r.y });
    const b = dc.project({ x: r.x + r.w, y: r.y + r.h });
    const box = {
      x: a.x * dc.dpr,
      y: a.y * dc.dpr,
      w: (b.x - a.x) * dc.dpr,
      h: (b.y - a.y) * dc.dpr,
    };
    if (pointInRect(base, box)) return false;
  }
  return true;
}

/**
 * The label rides the longest run, which is the only one reliably long enough to hold text.
 *
 * `labelOffset` then nudges it off that run, in CSS pixels, along two axes derived from the run
 * itself: `par` follows the run in stored point order -- source towards target -- and `perp` is
 * that direction turned 90 degrees clockwise on screen, so for a left-to-right run `par` moves
 * the label towards the arrowhead and `perp` moves it below the line.
 *
 * Tying the axes to the run rather than to the screen is what makes one offset mean the same
 * thing on a horizontal wire and a vertical one. The cost is that re-routing an `auto`
 * connection can hand the label to a different run, and the offset then applies to that one.
 */
function drawLabel(s: ConnectionShape, dc: DrawContext, dev: readonly Vec2[]): void {
  const { dpr } = dc;
  let dir: Vec2;

  if (isCurve(s)) {
    /*
      A curve has no runs to ride, so the label sits at the middle of the arc and takes its axes
      from the tangent there.

      The tangent is normalised by hypot, unlike the rectilinear branch below, which can get away
      with `Math.sign` only because its runs are axis-aligned. On a diagonal that shortcut yields
      `(+/-1, +/-1)` -- not a unit vector -- so `par` would be scaled by root two and `perp`
      would point somewhere between the two axes.
    */
    const t = curveEndDirection(dev.slice(0, Math.max(2, Math.ceil(dev.length / 2) + 1)));
    const mid = curveAt(dev, 0.5);
    dir = t ?? { x: 1, y: 0 };
    const [par, perp] = s.labelOffset;
    drawLabelPlate(
      s,
      dc,
      mid.x + (dir.x * par - dir.y * perp) * dpr,
      mid.y + (dir.y * par + dir.x * perp) * dpr,
    );
    return;
  }

  let best = -1;
  let bestLen = 0;
  for (let i = 1; i < dev.length; i++) {
    const len = Math.abs(dev[i]!.x - dev[i - 1]!.x) + Math.abs(dev[i]!.y - dev[i - 1]!.y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  if (best < 0 || bestLen < CONN_LABEL_MIN_RUN_PX * dpr) return;

  const p0 = dev[best - 1]!;
  const p1 = dev[best]!;
  // Axis-aligned by construction, and `bestLen > 0` here, so this is exactly one of the four
  // unit vectors and needs no square root.
  dir = { x: Math.sign(p1.x - p0.x), y: Math.sign(p1.y - p0.y) };
  const [par, perp] = s.labelOffset;
  const cx = (p0.x + p1.x) / 2 + (dir.x * par - dir.y * perp) * dpr;
  const cy = (p0.y + p1.y) / 2 + (dir.y * par + dir.x * perp) * dpr;

  drawLabelPlate(s, dc, cx, cy);
}

/** The label and the plate under it, at a device-space point. */
function drawLabelPlate(s: ConnectionShape, dc: DrawContext, cx: number, cy: number): void {
  const { ctx, dpr, theme } = dc;
  ctx.font = `${Math.round(11 * dpr)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pad = 3 * dpr;
  const w = ctx.measureText(s.label).width + 2 * pad;
  const h = 14 * dpr;
  // A plate, so the line does not strike through its own label. One fill is enough here: a
  // connection sits on the canvas, not inside a filled box the way a FIFO's label does.
  ctx.fillStyle = theme.background;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = theme.connLabel;
  ctx.fillText(s.label, cx, cy);
}

registerShape(connOps);
