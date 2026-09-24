import { alignStroke } from '../../canvas/pixel';
import { fitText } from '../../canvas/text';
import { NIF_LABEL_FONT, NIF_LABEL_PAD_PX } from '../../canvas/theme';
import { pointInRect, rectsIntersect } from '../../geom/math';
import type { Rect, Side } from '../../geom/types';
import { opsFor, registerShape } from '../registry';
import type { NifShape, Shape, ShapeName, ShapeOps } from '../shape';
import { boxAnchorAt, boxAnchors, NORMALS, OPPOSITE, resolveBoxAnchor, SIDES } from './box';
import { MIN_NIF_LENGTH, NIF_DEPTH, NIF_LENGTH, nifBox, projectPin } from './nif-geom';
import { nifProps } from './nif.props';

const NO_PENDING: readonly [number, number] = [0, 0];

/** The face a wire arrives on: the one pointing away from the parent. */
export function outwardSide(s: NifShape): Side {
  return s.side;
}

function box(s: NifShape): Rect {
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

/** Which faces this interface's parent permits, resolved through the parent rather than guessed. */
function allowedOn(parent: Shape): readonly Side[] {
  return opsFor(parent).interfaceSides?.(parent) ?? SIDES;
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
    // Placeholder. `reroute` runs in the same commit that creates this and owns the real box.
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
    if (
      settled &&
      side === s.side &&
      offset === s.offset &&
      b.x === s.x &&
      b.y === s.y &&
      b.w === s.w &&
      b.h === s.h
    ) {
      return s;
    }
    return { ...s, side, offset, pending: NO_PENDING, x: b.x, y: b.y, w: b.w, h: b.h };
  },

  /*
    Anchors on the OUTWARD face only.

    A wire has to arrive from outside, and the inward half of the box is buried in the parent's
    fill. Restricting the faces here is what stops a connection attaching to the back of an
    interface and then being drawn straight through the fabric it belongs to.
  */
  anchorAt: (s, p, hc) => boxAnchorAt(box(s), p, hc, [outwardSide(s)]),

  resolveAnchor(s, id) {
    const a = resolveBoxAnchor(box(s), id);
    if (a === null) return null;
    // A saved anchor on a face this interface no longer presents outward -- it was dragged to
    // another border -- is answered on the current outward face instead of refused, so the wire
    // follows the interface around the corner rather than vanishing.
    if (a.normal === NORMALS[OPPOSITE[outwardSide(s)]]) {
      return resolveBoxAnchor(box(s), outwardSide(s));
    }
    return a;
  },

  anchors: (s) => boxAnchors(box(s)).filter((a) => a.id === outwardSide(s)),

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

    ctx.lineWidth = wDev;
    ctx.strokeStyle = flags.selected ? theme.shapeStrokeSelected : theme.nifStroke;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    /*
      The modport, as a tick on the outward face rather than a glyph.

      A master DRIVES the bus, so its tick points out of the interface; a slave is driven, so it
      points in. At the size an interface is drawn -- half a grid cell across -- a letter would be
      illegible long before the box was, and the direction reads at any zoom.
    */
    const n = NORMALS[outwardSide(s)];
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const reach = Math.min(x1 - x0, y1 - y0) * 0.35;
    const sign = s.modport === 'master' ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx - n.x * reach * sign, cy - n.y * reach * sign);
    ctx.lineTo(cx + n.x * reach * sign, cy + n.y * reach * sign);
    ctx.strokeStyle = s.modport === 'master' ? theme.nifMarkMaster : theme.nifMarkSlave;
    ctx.stroke();
    restore();

    if (flags.ghost || s.label === '') return;

    /*
      The label goes OUTSIDE, past the outward face, because there is no room for it inside: the
      box is one grid step across. Drawn in CSS space so the width measured is the width drawn,
      and skipped entirely on a vertical face, where a horizontal string would run across the
      parent it belongs to.
    */
    const side = outwardSide(s);
    if (side !== 'n' && side !== 's') return;
    const screen = dc.toScreenSpace();
    const p0 = dc.project({ x: r.x, y: r.y });
    const p1 = dc.project({ x: r.x + r.w, y: r.y + r.h });
    ctx.font = NIF_LABEL_FONT;
    const text = fitText(ctx, s.label, Math.max(0, p1.x - p0.x) * 2);
    if (text !== '') {
      ctx.fillStyle = theme.shapeSubtitle;
      ctx.textAlign = 'center';
      ctx.textBaseline = side === 'n' ? 'bottom' : 'top';
      const y = side === 'n' ? p0.y - NIF_LABEL_PAD_PX : p1.y + NIF_LABEL_PAD_PX;
      ctx.fillText(text, (p0.x + p1.x) / 2, y);
    }
    screen();
  },
};

registerShape(nifOps);
