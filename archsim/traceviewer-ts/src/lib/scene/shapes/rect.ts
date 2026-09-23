import { alignStroke } from '../../canvas/pixel';
import { fitFontPx, fitText, sizedMeasurer, textMeasurer } from '../../canvas/text';
import {
  ANCHOR_BAND_PX,
  ANCHOR_HIT_PX,
  INSET_INK_ABOVE,
  INSET_INK_BELOW,
  INSET_INK_H,
  INSET_LEAD_PX,
  INSET_MARGIN_PX,
  INSET_TEXT_MIN_PX,
  LABEL_FONT_PX,
  SUBTITLE_FONT_PX,
  TAB_CORNER_R_PX,
  TAB_EST_CHAR_PX,
  TAB_FONT,
  TAB_FONT_PX,
  TAB_H_PX,
  TAB_INSET_PX,
  TAB_MIN_W_PX,
  TAB_PAD_X_PX,
} from '../../canvas/theme';
import {
  clampNum,
  expandRect,
  normalizeRect,
  pointInRect,
  rectFromPoints,
  rectsIntersect,
} from '../../geom/math';
import type { Anchor, Rect, Vec2 } from '../../geom/types';
import { GRID, snap } from '../../grid';
import { registerShape } from '../registry';
import type { DrawContext, RectShape, ShapeName, ShapeOps, ShapeTooltip } from '../shape';
import { rectProps } from './rect.props';

type Side = 'n' | 'e' | 's' | 'w';

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

const NORMALS: Readonly<Record<Side, Vec2>> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/** Length of a face, and the corner its offset is measured from (left for n/s, top for e/w). */
function faceLength(r: Rect, side: Side): number {
  return side === 'n' || side === 's' ? r.w : r.h;
}

/**
 * An anchor at `off` world units along `side`.
 *
 * `id` carries the offset as authored, not as clamped, so shrinking a block below an anchor and
 * growing it back puts the connection where the user left it rather than where the small
 * version of the block happened to end.
 */
function makeRectAnchor(r: Rect, side: Side, off: number, authored = off): Anchor {
  const len = faceLength(r, side);
  const t = clampNum(off, 0, len);
  const pos =
    side === 'n'
      ? { x: r.x + t, y: r.y }
      : side === 's'
        ? { x: r.x + t, y: r.y + r.h }
        : side === 'e'
          ? { x: r.x + r.w, y: r.y + t }
          : { x: r.x, y: r.y + t };
  return { id: `${side}:${authored}`, pos, normal: NORMALS[side] };
}

const ANCHOR_ID = /^([nesw])(?::(-?\d+))?$/;

/** Mid-drag a rect may carry negative w/h (the user flipped it). Everything reads through this. */
function box(s: RectShape): Rect {
  return normalizeRect({ x: s.x, y: s.y, w: s.w, h: s.h });
}

export function makeRect(a: Vec2, b: Vec2, name: ShapeName): RectShape {
  const r = rectFromPoints(a, b);
  return {
    kind: 'rect',
    name,
    label: '',
    subtitle: '',
    labelMode: 'inset',
    description: '',
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
  };
}

/** The text a block shows as its heading. Empty labels fall back to the identifier. */
function headline(s: RectShape): string {
  return s.label !== '' ? s.label : s.name;
}

/**
 * A tab's rectangle, plus the width its text may occupy.
 *
 * `textW` is carried rather than re-derived from `w` because the two live in different units.
 * The rectangle is world units, and `draw` projects it back to CSS pixels by dividing by the
 * zoom and multiplying by it again -- a round trip that at a fractional zoom loses the last
 * bit. Recomputing the text budget from the projected width therefore hands `fitText` the
 * measured width minus a hair, and a label that fits EXACTLY comes out ellipsized: "XBN" drew
 * as "X…" at 116%. Carrying the CSS-pixel budget straight through removes the round trip from
 * the decision rather than padding against it.
 */
export interface TabBox extends Rect {
  /** CSS pixels available to the label inside the tab, padding already removed. */
  readonly textW: number;
}

/** A tab measurer for callers that have a canvas, and an estimate for the ones that do not. */
export function tabMeasurer(ctx: CanvasRenderingContext2D | null): (t: string) => number {
  return textMeasurer(ctx, TAB_FONT, TAB_EST_CHAR_PX);
}

/**
 * Where a tabbed block's label tab sits, in world units, or null when it gets no tab.
 *
 * **The single source of that rectangle.** `draw` projects it and `hitTest` tests against it, so
 * the tab you can click is by construction the tab you can see. Computing it twice is how a
 * drawn box and a clickable box drift apart -- the defect `visibleFlags` exists to prevent in
 * the trace panel, and the same trap is set here.
 *
 * Sized in CSS pixels and converted, because everything about a tab -- its height, its padding,
 * its text -- is screen-sized. It therefore grows in world terms as you zoom out, which is what
 * keeps it legible, and is why it cannot be folded into `bounds`.
 */
export function tabRect(
  s: RectShape,
  worldPerPx: number,
  measure: (text: string) => number,
): TabBox | null {
  if (s.labelMode === 'inset') return null;

  const r = box(s);
  const wPx = r.w / worldPerPx;
  if (wPx < TAB_MIN_W_PX) return null;

  // Clamped to the block, so a tab never overhangs the corner it is aligned to.
  // Rounded up so the outline lands on whole pixels. The clamp stays below it, so a tab too
  // wide for its block is still truncated -- which is wanted.
  const tabPx = Math.min(
    Math.ceil(measure(headline(s)) + 2 * TAB_PAD_X_PX),
    wPx - 2 * TAB_INSET_PX,
  );
  if (tabPx <= 0) return null;

  const w = tabPx * worldPerPx;
  const inset = TAB_INSET_PX * worldPerPx;
  const h = TAB_H_PX * worldPerPx;
  const x = s.labelMode === 'tabbed_left' ? r.x + inset : r.x + r.w - inset - w;
  return { x, y: r.y - h, w, h, textW: tabPx - 2 * TAB_PAD_X_PX };
}

export const rectOps: ShapeOps<RectShape> = {
  kind: 'rect',
  props: rectProps,

  /** One grid cell at the origin. An import overwrites whatever it carries onto this. */
  blank(name) {
    return {
      kind: 'rect',
      name,
      label: '',
      subtitle: '',
      labelMode: 'inset',
      description: '',
      x: 0,
      y: 0,
      w: GRID,
      h: GRID,
    };
  },

  bounds: box,

  /**
   * The body only, deliberately -- the tab is excluded for the same reason `bounds` excludes
   * it. The tab is screen-sized and this signature has no `worldPerPx` to size it with, so a
   * band's answer would otherwise depend on the zoom it was drawn at.
   */
  intersects: (s, r) => rectsIntersect(box(s), r),

  /**
   * The body, or the tab above it.
   *
   * The tab has to be included: it carries the label, which is the most obvious thing on a
   * block to click, and it is drawn entirely outside the body. Only the tab's own rectangle
   * though -- widening this to the whole strip above the top edge would be an invisible dead
   * zone over every block, swallowing clicks meant for whatever is up there.
   */
  hitTest(s, p, hc) {
    if (pointInRect(p, box(s))) return true;
    const tab = tabRect(s, hc.worldPerPx, hc.measure ?? tabMeasurer(null));
    return tab !== null && pointInRect(p, tab);
  },

  tooltip(s): ShapeTooltip | null {
    // In the tabbed modes the subtitle is not drawn anywhere, so this is the only place it
    // appears. In `inset` it is already on the block and repeating it here would be noise.
    const lines = (s.labelMode === 'inset' ? [s.description] : [s.subtitle, s.description]).filter(
      (l) => l !== '',
    );
    return { title: headline(s), lines };
  },

  // Corners first so they win wherever they overlap an edge. `hitTest` returns on first match,
  // so this ordering is the whole mechanism -- do not sort this array.
  handles(s) {
    const r = box(s);
    const x2 = r.x + r.w;
    const y2 = r.y + r.h;
    return [
      { id: 'nw', geom: 'point', pos: { x: r.x, y: r.y }, cursor: 'nwse-resize', visible: true },
      { id: 'ne', geom: 'point', pos: { x: x2, y: r.y }, cursor: 'nesw-resize', visible: true },
      { id: 'se', geom: 'point', pos: { x: x2, y: y2 }, cursor: 'nwse-resize', visible: true },
      { id: 'sw', geom: 'point', pos: { x: r.x, y: y2 }, cursor: 'nesw-resize', visible: true },
      // Edges are invisible grab zones running the length of each side.
      {
        id: 'n',
        geom: 'segment',
        pos: { x: r.x, y: r.y },
        end: { x: x2, y: r.y },
        cursor: 'ns-resize',
        visible: false,
      },
      {
        id: 'e',
        geom: 'segment',
        pos: { x: x2, y: r.y },
        end: { x: x2, y: y2 },
        cursor: 'ew-resize',
        visible: false,
      },
      {
        id: 's',
        geom: 'segment',
        pos: { x: r.x, y: y2 },
        end: { x: x2, y: y2 },
        cursor: 'ns-resize',
        visible: false,
      },
      {
        id: 'w',
        geom: 'segment',
        pos: { x: r.x, y: r.y },
        end: { x: r.x, y: y2 },
        cursor: 'ew-resize',
        visible: false,
      },
    ];
  },

  /**
   * Only the dragged edges move; the opposite ones stay pinned. Flipping past the far edge is
   * allowed and produces negative w/h, which `normalize` folds back on commit -- clamping here
   * instead would make the rect stick to the cursor.
   */
  resize(s, handle, p, mods) {
    const h = String(handle);
    const movesN = h.includes('n');
    const movesS = h.includes('s');
    const movesW = h.includes('w');
    const movesE = h.includes('e');

    const ox1 = s.x;
    const oy1 = s.y;
    const ox2 = s.x + s.w;
    const oy2 = s.y + s.h;

    let px = p.x;
    let py = p.y;

    if (mods.shift && (movesN || movesS) && (movesE || movesW)) {
      // Square aspect about the pinned corner. Both deltas are grid multiples already, so the
      // larger of the two is too, and the result stays on the grid.
      const ax = movesW ? ox2 : ox1;
      const ay = movesN ? oy2 : oy1;
      const dx = px - ax;
      const dy = py - ay;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      px = ax + (dx < 0 ? -m : m);
      py = ay + (dy < 0 ? -m : m);
    }

    const x1 = movesW ? px : ox1;
    const y1 = movesN ? py : oy1;
    const x2 = movesE ? px : ox2;
    const y2 = movesS ? py : oy2;
    return { ...s, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  },

  translate(s, d) {
    return { ...s, x: s.x + d.x, y: s.y + d.y };
  },

  /** A sub-cell block would be invisible, unhittable and unresizable, so it is dropped. */
  normalize(s) {
    const r = box(s);
    if (r.w < GRID || r.h < GRID) return null;
    return { ...s, ...r };
  },

  draw(s, dc, flags) {
    const { ctx, theme } = dc;
    const r = box(s);

    ctx.fillStyle = flags.ghost ? theme.ghostFill : theme.shapeFill;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Outline in device space: a world-space hairline lands on fractional pixels at most zooms
    // and reads as a grey smudge next to the crisp grid.
    const restore = dc.toDeviceSpace();
    const a = dc.project({ x: r.x, y: r.y });
    const b = dc.project({ x: r.x + r.w, y: r.y + r.h });
    const wDev = Math.max(1, Math.round((flags.selected ? 2 : 1) * dc.dpr));
    const x0 = alignStroke(a.x * dc.dpr, wDev);
    const y0 = alignStroke(a.y * dc.dpr, wDev);
    const x1 = alignStroke(b.x * dc.dpr, wDev);
    const y1 = alignStroke(b.y * dc.dpr, wDev);

    ctx.lineWidth = wDev;
    ctx.strokeStyle = flags.ghost
      ? theme.ghostStroke
      : flags.selected
        ? theme.shapeStrokeSelected
        : theme.shapeStroke;
    if (flags.ghost) ctx.setLineDash([4 * dc.dpr, 4 * dc.dpr]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);

    if (!flags.ghost) {
      if (s.labelMode === 'inset')
        drawInsetLabel(s, dc, {
          x0,
          y0,
          x1,
          y1,
          /*
            Unaligned, unlike the four above. The outline snaps to whole device pixels and so
            jitters by one as the block is panned; those snapped coordinates are what the text
            must be CENTRED on, but a width budget that inherited the jitter would change the
            fitted size, and a block sitting near a size boundary would step its type -- or gain
            a letter -- while the user did nothing but drag it sideways.
          */
          boxW: (b.x - a.x) * dc.dpr,
          boxH: (b.y - a.y) * dc.dpr,
        });
      else drawTab(s, dc, flags.selected);
    }
    restore();
  },

  /**
   * Nearest perimeter point, grid-snapped along the face.
   *
   * Within `ANCHOR_BAND_PX` of the outline the offset tracks the cursor, which is what puts the
   * anchor exactly where the user pointed. Deeper inside the block the nearest face is both
   * ambiguous and jumpy -- a pixel of drift flips the dot to another side -- so the offset
   * collapses to the face midpoint and "click the middle of the target" becomes a stable
   * gesture instead of a lottery.
   */
  anchorAt(s, p, hc): Anchor | null {
    const r = box(s);
    const tol = ANCHOR_HIT_PX * hc.worldPerPx;
    if (!pointInRect(p, expandRect(r, tol))) return null;

    // Ties resolve in n, e, s, w order, so the id is a deterministic function of the point.
    const d: readonly number[] = [
      Math.abs(p.y - r.y),
      Math.abs(p.x - (r.x + r.w)),
      Math.abs(p.y - (r.y + r.h)),
      Math.abs(p.x - r.x),
    ];
    let best = 0;
    for (let i = 1; i < d.length; i++) {
      if (d[i]! < d[best]!) best = i;
    }
    const side = SIDES[best]!;

    const band = ANCHOR_BAND_PX * hc.worldPerPx;
    const inner = { x: r.x + band, y: r.y + band, w: r.w - 2 * band, h: r.h - 2 * band };
    const deep = inner.w > 0 && inner.h > 0 && pointInRect(p, inner);

    const len = faceLength(r, side);
    if (deep) return makeRectAnchor(r, side, Math.round(len / 2));
    const along = side === 'n' || side === 's' ? p.x - r.x : p.y - r.y;
    const off = clampNum(snap(along), 0, len);
    return makeRectAnchor(r, side, off);
  },

  /** `'e'` (the face midpoint) or `'e:48'` (offset from the face's start corner). */
  resolveAnchor(s, id): Anchor | null {
    const m = ANCHOR_ID.exec(id);
    if (m === null) return null;
    const r = box(s);
    const side = m[1] as Side;
    if (m[2] === undefined) {
      const mid = Math.round(faceLength(r, side) / 2);
      const a = makeRectAnchor(r, side, mid);
      return { ...a, id: side };
    }
    const off = Number(m[2]);
    return makeRectAnchor(r, side, off);
  },

  /** Edge midpoints. The discrete siblings of `anchorAt`; nothing consumes them yet. */
  anchors(s): readonly Anchor[] {
    const r = box(s);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return [
      { id: 'n', pos: { x: cx, y: r.y }, normal: { x: 0, y: -1 } },
      { id: 'e', pos: { x: r.x + r.w, y: cy }, normal: { x: 1, y: 0 } },
      { id: 's', pos: { x: cx, y: r.y + r.h }, normal: { x: 0, y: 1 } },
      { id: 'w', pos: { x: r.x, y: cy }, normal: { x: -1, y: 0 } },
    ];
  },
};

/**
 * How big a block's inset type may be, in CSS pixels, from the block's HEIGHT alone. Null when
 * there is no room for even a label.
 *
 * Type used to be a fixed 13px over a fixed 10px, present or absent: a block below 44 CSS px
 * showed nothing at all, so zooming a diagram out blanked every block at once -- well before
 * the blocks themselves stopped being legible shapes. Type now tracks the block down to the
 * floor below which glyphs are mush.
 *
 * The height is a BUDGET, not a threshold to clear. A line of N px type paints `INSET_INK_H * N`
 * of actual ink, so `availH / INSET_INK_H` is the largest line the block can hold, and
 * `LABEL_FONT_PX` stays the ceiling because the label is a name and not a headline. Rationing
 * against a reference square instead is what left a 30px block 22% inked, with 11.7px of dead
 * space above the text and below it.
 *
 * Height ALONE. Width used to be a term here, to keep 13px type out of a 20x400 block -- but it
 * was a proxy for a width problem and a poor one. It shrank the type of every tall block whether
 * or not the label actually overflowed, and when it guessed wrong `fillText`'s `maxWidth`
 * condensed the glyphs anyway. `drawInsetLabel` now answers width where it can be answered
 * honestly, by measuring the string. `pad` is the one width quantity left, and it is a constant.
 *
 * Two properties this keeps, both structural rather than tuned:
 *
 *  - The subtitle goes first, and by a wide margin: a label needs 13.6 CSS px of block height
 *    and the pair needs 28.9, so there is no size at which a subtitle appears under no label.
 *  - The lines cannot collide or overflow on the way down, because `room` is what is left of the
 *    budget once the label and the lead have been taken out of it.
 *
 * Pure and exported so the ramp can be checked as arithmetic rather than by counting lit pixels
 * at a dozen zoom levels.
 */
export function insetType(
  hCss: number,
  hasSubtitle: boolean,
): { label: number; subtitle: number; gap: number; pad: number } | null {
  const availH = hCss - 2 * INSET_MARGIN_PX;
  const label = Math.min(LABEL_FONT_PX, availH / INSET_INK_H);
  if (label < INSET_TEXT_MIN_PX) return null;
  /*
    Against LABEL_FONT_PX and not against `label`: the subtitle is paid for out of what is left
    once a FULL-SIZE label has been taken out, which is the rule being stated. The two agree
    today -- where `label` is under its ceiling there is no room for a second line either way --
    but they would stop agreeing the moment something other than height could shrink the label,
    which is exactly what `fitInsetLine` does downstream.
  */
  const room = (availH - INSET_INK_H * LABEL_FONT_PX - INSET_LEAD_PX) / INSET_INK_H;
  const second = Math.min(SUBTITLE_FONT_PX, room);
  const subtitle = hasSubtitle && second >= INSET_TEXT_MIN_PX ? second : 0;
  return {
    label,
    subtitle,
    // Ink to ink, so the blank between the lines is the same whatever sizes they came out at.
    // At full size the three terms add back up to INSET_LINE_GAP_PX, by INSET_LEAD_PX's
    // definition, which is why an ordinary block is spaced exactly as it always was.
    gap: subtitle === 0 ? 0 : INSET_INK_BELOW * label + INSET_INK_ABOVE * subtitle + INSET_LEAD_PX,
    pad: 2 * INSET_MARGIN_PX,
  };
}

/** The one font the inset lines are drawn in. Sizes vary per block and per frame; family never. */
const INSET_FAMILY = 'ui-sans-serif, system-ui, sans-serif';

/**
 * One inset line fitted to `maxW`: the largest whole device size in `[floorPx, ceilingPx]` that
 * holds the string, and the string itself cut with an ellipsis only once shrinking has bottomed
 * out at the floor and it still does not fit.
 *
 * Shrink before cut, because these labels are short identifiers. A 9px `REGFILE` says which
 * block this is and a 13px `REG...` does not; `XBN_ARB` and `XBN_MUX` truncate to the same
 * string, and so do `XU0`, `XU1` and `XU2`. Shrinking degrades legibility smoothly, where
 * truncating a shared-prefix identifier destroys identity in one step.
 *
 * The ceiling is the block's height budget and the floor is `INSET_TEXT_MIN_PX` -- the same
 * number below which `insetType` stops offering a line at all, so there is no second threshold
 * to keep in step with the first.
 *
 * A line that comes back as nothing but an ellipsis is returned empty instead. Inside a block,
 * with no chrome around it saying "label", it reads as a speck of dirt rather than as a name,
 * and the name is still on hover and in the property panel.
 *
 * Leaves `ctx.font` at the size it chose. Exported because it carries the property this whole
 * path exists for -- measure the returned string at the font left behind and it is never wider
 * than the budget it was given -- and checking that needs a real font in hand.
 */
export function fitInsetLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  ceilingPx: number,
  floorPx: number,
  maxW: number,
): { px: number; text: string } {
  const px = fitFontPx(sizedMeasurer(ctx, text, INSET_FAMILY), ceilingPx, floorPx, maxW);
  if (px !== 0) {
    // Usually the size the last probe already set, in which case the engine short-circuits.
    ctx.font = `${px}px ${INSET_FAMILY}`;
    return { px, text };
  }
  ctx.font = `${floorPx}px ${INSET_FAMILY}`;
  const cut = fitText(ctx, text, maxW);
  return { px: floorPx, text: cut === '\u2026' ? '' : cut };
}

/**
 * Label over subtitle, both centred. Device space, so the coordinates handed in are the same
 * aligned ones the outline was stroked with and the text sits square on it.
 *
 * Neither `fillText` here takes a `maxWidth`, and keeping it that way is the point of this
 * function's shape. That argument does not truncate and does not scale uniformly: it CONDENSES,
 * squashing the glyph run horizontally and leaving the em height alone, which is why a tall
 * narrow block drew type that read as vertically stretched. Measured on a 70x260 block labelled
 * `MEMORY`: at z=0.75 the glyphs were 81% of their natural width, at z=0.50, 65%.
 *
 * `insetType` says how big the block's HEIGHT allows; `fitInsetLine` says how much of that its
 * WIDTH can carry. The two are independent and the smaller wins.
 *
 * The subtitle's ceiling is its own budget, but never above the label's final size and never
 * below the floor. Without the first clamp a short subtitle under a long, width-shrunk label
 * comes out LARGER than the label and the hierarchy inverts; without the second it disappears
 * from a block with room for it, only because the line above it had to shrink.
 */
function drawInsetLabel(
  s: RectShape,
  dc: DrawContext,
  d: { x0: number; y0: number; x1: number; y1: number; boxW: number; boxH: number },
): void {
  const { ctx, theme, dpr } = dc;
  const ty = insetType(d.boxH / dpr, s.subtitle !== '');
  if (ty === null) return;

  const floorPx = Math.round(INSET_TEXT_MIN_PX * dpr);
  /*
    Down, not to nearest. The budget was solved to fill the height exactly, so rounding a size
    up spends margin that has already been allocated -- a whole CSS pixel of the three at dpr 1.
    The floor still wins, so that an awkward dpr cannot produce a ceiling beneath it.
  */
  const ceilingOf = (cssPx: number): number => Math.max(floorPx, Math.floor(cssPx * dpr));
  const maxW = d.boxW - ty.pad * dpr;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const label = fitInsetLine(ctx, headline(s), ceilingOf(ty.label), floorPx, maxW);
  // A subtitle under no label names nothing, so the label decides for both lines.
  if (label.text === '') return;

  const sub =
    ty.subtitle === 0
      ? { px: 0, text: '' }
      : fitInsetLine(
          ctx,
          s.subtitle,
          Math.max(
            floorPx,
            Math.min(
              ceilingOf(ty.subtitle),
              Math.floor((label.px * SUBTITLE_FONT_PX) / LABEL_FONT_PX),
            ),
          ),
          floorPx,
          maxW,
        );

  const cx = (d.x0 + d.x1) / 2;
  const cy = (d.y0 + d.y1) / 2;
  const half = Math.floor((ty.gap * dpr) / 2);
  const twoLine = sub.text !== '';

  /*
    Both lines are fitted before either is drawn, so the font each was measured at has to be
    selected again here. Two assignments per block per frame, against a guarantee that what was
    measured is what gets drawn -- which is the whole correctness argument for not passing
    `maxWidth`.

    The gap comes from `insetType`, i.e. from the sizes the HEIGHT allowed, not from the sizes
    width cut them down to. Deliberately: a rank of equally tall blocks then shares one pair of
    baselines however long their individual labels are. It can only ever be slack, never
    overflow, since the drawn sizes are bounded by the ones it was computed from.
  */
  ctx.fillStyle = theme.shapeLabel;
  ctx.font = `${label.px}px ${INSET_FAMILY}`;
  // The label is what the diagram is *about*; the name is the identifier behind it.
  ctx.fillText(label.text, cx, twoLine ? cy - half : cy);

  if (!twoLine) return;
  ctx.fillStyle = theme.shapeSubtitle;
  ctx.font = `${sub.px}px ${INSET_FAMILY}`;
  ctx.fillText(sub.text, cx, cy + half);
}

/**
 * The folder tab above a tabbed block's top corner.
 *
 * Drawn in CSS space rather than device space, which costs a crisp outline and buys the thing
 * that matters more: the width `tabRect` measured and the width `fillText` draws come from one
 * font string, so the clickable box cannot disagree with the drawn one by a rounding error. The
 * trace panel's flags make the same trade.
 *
 * Three sides, never four. Leaving the bottom open lets the block's own top edge close the
 * shape, so the tab reads as attached rather than as a box parked on top of a line. `fill()`
 * closes the subpath for filling and `stroke()` does not, which is exactly the asymmetry wanted.
 */
function drawTab(s: RectShape, dc: DrawContext, selected: boolean): void {
  const { ctx, theme } = dc;
  const tab = tabRect(s, dc.worldPerPx, tabMeasurer(ctx));
  if (tab === null) return;

  const restore = dc.toScreenSpace();
  const a = dc.project({ x: tab.x, y: tab.y });
  const b = dc.project({ x: tab.x + tab.w, y: tab.y + tab.h });
  const r = Math.min(TAB_CORNER_R_PX, (b.x - a.x) / 2, (b.y - a.y) / 2);

  ctx.beginPath();
  ctx.moveTo(a.x, b.y);
  ctx.lineTo(a.x, a.y + r);
  ctx.arcTo(a.x, a.y, a.x + r, a.y, r);
  ctx.lineTo(b.x - r, a.y);
  ctx.arcTo(b.x, a.y, b.x, a.y + r, r);
  ctx.lineTo(b.x, b.y);

  // Opaque, so the dot grid does not show through the tab.
  ctx.fillStyle = theme.background;
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? theme.shapeStrokeSelected : theme.shapeStroke;
  ctx.stroke();

  ctx.font = TAB_FONT;
  const text = fitText(ctx, headline(s), tab.textW);
  if (text !== '') {
    ctx.fillStyle = theme.shapeLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (a.x + b.x) / 2, (a.y + b.y) / 2 + TAB_FONT_PX / 10);
  }
  restore();
}

registerShape(rectOps);
