import { alignStroke } from '../../canvas/pixel';
import { fitText } from '../../canvas/text';
import {
  ANCHOR_HIT_PX,
  NIF_LABEL_FONT,
  NIF_LABEL_MIN_PX,
  NIF_LABEL_PAD_PX,
} from '../../canvas/theme';
import { dist2, expandRect, pointInRect, rectsIntersect } from '../../geom/math';
import type { Anchor, Rect, Side } from '../../geom/types';
import { opsFor, registerShape } from '../registry';
import type { NifShape, Shape, ShapeName, ShapeOps } from '../shape';
import { SIDES } from './box';
import { MIN_NIF_LENGTH, NIF_DEPTH, NIF_LENGTH, nifAnchors, nifBox, projectPin } from './nif-geom';
import { nifProps } from './nif.props';

const NO_PENDING: readonly [number, number] = [0, 0];

function box(s: NifShape): Rect {
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

/** Which faces this interface's parent permits, resolved through the parent rather than guessed. */
function allowedOn(parent: Shape): readonly Side[] {
  return opsFor(parent).interfaceSides?.(parent) ?? SIDES;
}

/** Whether the parent offers an inward edge. Same rule: ask the parent, never the child's kind. */
function inwardOn(parent: Shape): boolean {
  return opsFor(parent).interfaceInward?.(parent) ?? false;
}

/** The anchors this interface presents, which is the single source all three seams read. */
function anchorsOf(s: NifShape): readonly Anchor[] {
  return nifAnchors(box(s), s.side, s.inward);
}

export function makeNif(
  name: ShapeName,
  parent: ShapeName,
  side: Side,
  offset: number,
  channel: NifShape['channel'] = 'all',
): NifShape {
  return {
    kind: 'nif',
    name,
    label: '',
    description: '',
    parent,
    side,
    offset,
    length: NIF_LENGTH,
    depth: NIF_DEPTH,
    protocol: 'axi3',
    channel,
    modport: 'slave',
    pending: NO_PENDING,
    // Placeholders, both of them. `reroute` runs in the same commit that creates this and owns
    // the real box, and the real answer about the parent's inward edge.
    inward: false,
    x: 0,
    y: 0,
    w: NIF_LENGTH,
    h: NIF_DEPTH,
  };
}

export const nifOps: ShapeOps<NifShape> = {
  kind: 'nif',
  props: nifProps,

  blank(name) {
    return makeNif(name, '', 'n', 0);
  },

  bounds: box,

  intersects: (s, r) => rectsIntersect(box(s), r),

  hitTest: (s, p) => pointInRect(p, box(s)),

  tooltip: (s) => ({
    title: s.label !== '' ? `${s.label} (${s.name})` : s.name,
    lines: [
      `${s.protocol.toUpperCase()} ${s.channel === 'all' ? 'all channels' : s.channel.toUpperCase()} · ${s.modport}`,
      ...(s.description !== '' ? [s.description] : []),
    ],
  }),

  /*
    No handles at all.

    An interface's length and depth are property-panel values, and its POSITION is the parent's
    border -- there is nothing a corner knob could mean. Dragging the body is the gesture, and
    `translate` below is where it lands.
  */
  handles: () => [],

  resize: (s) => s,

  /**
   * Record the gesture; let `reroute` decide what it meant.
   *
   * Sliding along the current border could be done here -- the along-face axis follows from
   * `side` alone -- but moving to a DIFFERENT border cannot, because it depends on the parent's
   * extent and `translate` is not given the parent. Splitting the two would make a drag behave
   * differently depending on whether it happened to cross a border, so both go through
   * `pending` and `reroute` resolves the whole gesture in one place.
   */
  translate(s, d) {
    if (d.x === 0 && d.y === 0) return s;
    return { ...s, pending: [s.pending[0] + d.x, s.pending[1] + d.y] };
  },

  /** An interface with no parent is not an interface; `pruneOrphans` would drop it regardless. */
  normalize(s) {
    if (s.parent === '') return null;
    if (s.length < MIN_NIF_LENGTH || s.depth <= 0) return null;
    return s;
  },

  childOf: (s) => (s.parent === '' ? null : s.parent),

  /** A link between two interfaces is a bus, and a bus is drawn as a curve. */
  preferredPath: () => 'curve',

  /** You change the count on the parent; you do not delete interfaces off it. */
  deletable: () => false,

  renameRef(s, from, to) {
    return s.parent === from ? { ...s, parent: to } : s;
  },

  dependsOn: (s) => [s.parent],

  /**
   * Re-glue to the parent, and resolve any drag recorded in `pending`.
   *
   * Returns `s` by reference whenever nothing moved, which `SceneStore.commit` relies on to
   * avoid recording empty undo entries.
   */
  reroute(s, deps) {
    const parent = deps.get(s.parent);
    if (parent === undefined) return s;
    const pr = opsFor(parent).bounds(parent);
    const allowed = allowedOn(parent);
    const inward = inwardOn(parent);

    // A parent may narrow what it permits -- or the interface may arrive from a file naming a
    // face this parent does not offer. Fall back to a legal one rather than draw off the border.
    let side = allowed.includes(s.side) ? s.side : (allowed[0] ?? s.side);
    let offset = s.offset;

    if (s.pending[0] !== 0 || s.pending[1] !== 0) {
      const at = nifBox(pr, side, offset, s.length, s.depth);
      const centre = {
        x: at.x + at.w / 2 + s.pending[0],
        y: at.y + at.h / 2 + s.pending[1],
      };
      ({ side, offset } = projectPin(pr, centre, allowed, s.length));
    }

    const b = nifBox(pr, side, offset, s.length, s.depth);
    const settled = s.pending === NO_PENDING || (s.pending[0] === 0 && s.pending[1] === 0);
    /*
      Every field in the returned object participates here. A guard that misses one allocates on
      a commit that changed nothing, and `SceneStore.commit` -- which compares by identity --
      records an undo entry that undoes nothing.
    */
    if (
      settled &&
      side === s.side &&
      offset === s.offset &&
      inward === s.inward &&
      b.x === s.x &&
      b.y === s.y &&
      b.w === s.w &&
      b.h === s.h
    ) {
      return s;
    }
    return {
      ...s,
      side,
      offset,
      inward,
      pending: NO_PENDING,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    };
  },

  /*
    Two anchors, not a face of them.

    A box kind offers a continuous perimeter because a wire may meaningfully land anywhere along
    a block's edge. An interface is not a surface, it is a port: it has an outward edge, and --
    where its parent allows it -- an inward one. Two discrete points is what it actually offers,
    and offering a slider along the edge only invited a wire to attach somewhere the port does
    not mean anything.

    All three seams read `nifAnchors`, so none of them can drift from the others.
  */
  anchorAt(s, p, hc) {
    const r = box(s);
    const tol = ANCHOR_HIT_PX * hc.worldPerPx;
    // The same halo test `boxAnchorAt` uses, so the reach of a port is the reach of a block's
    // edge and the connect tool feels no different over one.
    if (!pointInRect(p, expandRect(r, tol))) return null;

    let best: Anchor | null = null;
    let bestD = Infinity;
    for (const a of anchorsOf(s)) {
      const d = dist2(p, a.pos);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  },

  /**
   * Anything unrecognised resolves to the OUTWARD edge rather than to nothing.
   *
   * That covers three cases with one rule: a legacy `'n:16'` from a file written before the ids
   * were edges, an `'in'` on an interface whose parent does not offer one, and plain nonsense.
   * A wire that cannot find its end would otherwise vanish, and the outward edge is the one an
   * interface always has.
   */
  resolveAnchor(s, id) {
    const all = anchorsOf(s);
    return all.find((a) => a.id === id) ?? all[0] ?? null;
  },

  anchors: anchorsOf,

  draw(s, dc, flags) {
    const { ctx, theme, dpr } = dc;
    const r = box(s);
    if (r.w <= 0 || r.h <= 0) return;

    ctx.fillStyle = flags.ghost ? theme.ghostFill : theme.nifFill;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    const restore = dc.toDeviceSpace();
    const a = dc.project({ x: r.x, y: r.y });
    const b = dc.project({ x: r.x + r.w, y: r.y + r.h });
    const wDev = Math.max(1, Math.round((flags.selected ? 2 : 1) * dpr));
    const x0 = alignStroke(a.x * dpr, wDev);
    const y0 = alignStroke(a.y * dpr, wDev);
    const x1 = alignStroke(b.x * dpr, wDev);
    const y1 = alignStroke(b.y * dpr, wDev);

    /*
      The modport is the BORDER's colour, not a tick inside it.

      The tick it replaces claimed to point out for a master and in for a slave -- and did not:
      both branches drew the same two endpoints in the opposite order, so the two differed only
      in colour anyway. Colour is also the half that survived being drawn at half a grid cell
      across, which is what the old geometry gave it. Selection still wins, because a selected
      thing is amber everywhere else on this canvas; `nifMarkMaster` is kept clear of that amber
      so a selected slave cannot be misread as a master.
    */
    ctx.lineWidth = wDev;
    ctx.strokeStyle = flags.ghost
      ? theme.ghostStroke
      : flags.selected
        ? theme.shapeStrokeSelected
        : s.modport === 'master'
          ? theme.nifMarkMaster
          : theme.nifMarkSlave;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    restore();

    if (flags.ghost || s.label === '') return;

    /*
      The label goes INSIDE the box, which is the point of a box deep enough to hold one.

      In CSS-pixel space, so the width measured by `fitText` is the width drawn. On a vertical
      border the text is turned a quarter turn so it runs ALONG the border rather than across
      the parent -- always anticlockwise, so it reads bottom-to-top on both sides and never
      upside down. The old code simply dropped the label on `e` and `w`, which silently lost
      half the positions a block offers.
    */
    const screen = dc.toScreenSpace();
    const p0 = dc.project({ x: r.x, y: r.y });
    const p1 = dc.project({ x: r.x + r.w, y: r.y + r.h });
    const vertical = s.side === 'e' || s.side === 'w';
    const along = vertical ? p1.y - p0.y : p1.x - p0.x;
    const across = vertical ? p1.x - p0.x : p1.y - p0.y;

    if (across >= NIF_LABEL_MIN_PX) {
      ctx.font = NIF_LABEL_FONT;
      const text = fitText(ctx, s.label, Math.max(0, along - 2 * NIF_LABEL_PAD_PX));
      /*
        Nothing at all, rather than a bare ellipsis. The gate above is on the ACROSS extent, so
        there is a band of zoom where the box is deep enough for a label while the 32-unit width
        holds only the ellipsis `fitText` fell back to -- and a lone `…` inside a port reads as
        a rendering fault rather than as a name that did not fit.
      */
      if (text !== '' && text !== '…') {
        ctx.save();
        ctx.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        if (vertical) ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = theme.shapeLabel;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
    screen();
  },
};

registerShape(nifOps);
