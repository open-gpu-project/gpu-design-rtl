import { fitFontPx, fitText, sizedMeasurer, textMeasurer } from '../../canvas/text';
import {
  INSET_INK_ABOVE,
  INSET_INK_BELOW,
  INSET_INK_H,
  INSET_LEAD_PX,
  INSET_MARGIN_PX,
  INSET_TEXT_MIN_PX,
  LABEL_FONT_PX,
  SANS,
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
import { pointInRect } from '../../geom/math';
import type { Rect, Vec2 } from '../../geom/types';
import type { Theme } from '../../canvas/theme';
import type { DrawContext, Headed, HitContext, RenderFlags, ShapeTooltip } from '../shape';

/** The text a box shows as its heading. Empty labels fall back to the identifier. */
export function headline(s: Headed): string {
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
 * Where a tabbed box's label tab sits, in world units, or null when it gets no tab.
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
  s: Headed,
  body: Rect,
  worldPerPx: number,
  measure: (text: string) => number,
): TabBox | null {
  if (s.labelMode === 'inset') return null;

  const wPx = body.w / worldPerPx;
  if (wPx < TAB_MIN_W_PX) return null;

  // Clamped to the box, so a tab never overhangs the corner it is aligned to.
  // Rounded up so the outline lands on whole pixels. The clamp stays below it, so a tab too
  // wide for its box is still truncated -- which is wanted.
  const tabPx = Math.min(
    Math.ceil(measure(headline(s)) + 2 * TAB_PAD_X_PX),
    wPx - 2 * TAB_INSET_PX,
  );
  if (tabPx <= 0) return null;

  const w = tabPx * worldPerPx;
  const inset = TAB_INSET_PX * worldPerPx;
  const h = TAB_H_PX * worldPerPx;
  const x = s.labelMode === 'tabbed_left' ? body.x + inset : body.x + body.w - inset - w;
  return { x, y: body.y - h, w, h, textW: tabPx - 2 * TAB_PAD_X_PX };
}

/**
 * Is `p` on the tab above `body`? The half of a box kind's `hitTest` that is about the heading.
 *
 * The tab has to be hittable: it carries the label, which is the most obvious thing on a box to
 * click, and it is drawn entirely outside the body. Only the tab's own rectangle though --
 * widening this to the whole strip above the top edge would be an invisible dead zone over every
 * box, swallowing clicks meant for whatever is up there.
 */
export function headingHit(s: Headed, body: Rect, p: Vec2, hc: HitContext): boolean {
  const tab = tabRect(s, body, hc.worldPerPx, hc.measure ?? tabMeasurer(null));
  return tab !== null && pointInRect(p, tab);
}

/**
 * A subtitle as the lines it was typed as. `[]` for an empty one.
 *
 * The property editor is a JSON editor, so a subtitle has always been able to hold a `\n` -- the
 * writer validates with a bare `typeof v === 'string'`, and `serializeScene` round-trips it. What
 * did not happen until iteration 6 was DRAWING it: canvas 2D treats every whitespace character
 * including a newline as a space, so `"AW\nslave"` came out as one long run and was shrunk and
 * ellipsised as if the user had typed a space.
 *
 * `/\r?\n/`, so a subtitle pasted out of a Windows editor splits the same way. A lone `\r` is
 * NOT a separator: nothing produces classic-Mac line endings, and treating it as one would split
 * a string a user could reasonably have typed.
 *
 * The list is trimmed at both ends and preserved in the middle, which is one rule: a stray Enter
 * at the start or end of the field is a typo and must not reserve a line of the box's height,
 * while a blank BETWEEN two lines is a layout the user typed. Dropping an interior blank would
 * also renumber the lines, changing which one the shared font size was fitted to.
 *
 * Exported and pure, so the rules are arithmetic to check rather than pixels to count.
 */
export function subtitleLines(subtitle: string): readonly string[] {
  if (subtitle === '') return [];
  const lines = subtitle.split(/\r?\n/);
  let lo = 0;
  let hi = lines.length;
  while (lo < hi && lines[lo] === '') lo++;
  while (hi > lo && lines[hi - 1] === '') hi--;
  return lines.slice(lo, hi);
}

/**
 * What hovering a box kind should say.
 *
 * In the tabbed modes the subtitle is not drawn anywhere, so this is the only place it appears.
 * In `inset` it is already on the box and repeating it here would be noise.
 *
 * A multi-line subtitle becomes one paragraph per line, because `ShapeTooltip.lines` is rendered
 * as `<p>` elements and a newline inside one collapses in HTML. The `filter` drops interior
 * blanks that `subtitleLines` preserves, which is right here and not on the canvas: a blank line
 * spaces a block's text, where an empty paragraph is three pixels of nothing in a tooltip.
 */
export function headingTooltip(s: Headed): ShapeTooltip {
  const lines = (
    s.labelMode === 'inset' ? [s.description] : [...subtitleLines(s.subtitle), s.description]
  ).filter((l) => l !== '');
  return { title: headline(s), lines };
}

/**
 * How big a box's inset type may be, in CSS pixels, from the box's HEIGHT alone. Null when
 * there is no room for even a label.
 *
 * Type used to be a fixed 13px over a fixed 10px, present or absent: a block below 44 CSS px
 * showed nothing at all, so zooming a diagram out blanked every block at once -- well before
 * the blocks themselves stopped being legible shapes. Type now tracks the box down to the
 * floor below which glyphs are mush.
 *
 * The height is a BUDGET, not a threshold to clear. A line of N px type paints `INSET_INK_H * N`
 * of actual ink, so `availH / INSET_INK_H` is the largest line the box can hold, and
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
 *  - The subtitle goes first, and by a wide margin: a label needs 13.6 CSS px of box height
 *    and the pair needs 28.9, so there is no size at which a subtitle appears under no label.
 *  - The lines cannot collide or overflow on the way down, because `room` is what is left of the
 *    budget once the label and the leads have been taken out of it.
 *
 * Generalised from one subtitle line to `n` in iteration 6, with the 0- and 1-line answers
 * unchanged to the last bit -- which is what makes `verify/labels.mjs`'s existing numbers the
 * regression net for the change.
 *
 * Pure and exported so the ramp can be checked as arithmetic rather than by counting lit pixels
 * at a dozen zoom levels.
 *
 * @param subtitleLines How many lines the subtitle HAS. The returned `lines` says how many fit.
 */
export function insetType(
  hCss: number,
  subtitleLines: number,
): {
  label: number;
  /** The ONE size every subtitle line is drawn at. 0 when `lines` is 0. */
  subtitle: number;
  /**
   * How many subtitle lines the height affords -- at most `subtitleLines`.
   *
   * The largest PREFIX that fits, not all or nothing. Under the old rule, generalising to `n`
   * would have meant that adding a second line made the ENTIRE subtitle vanish from a box that
   * had been showing one: a regression bought by a feature. Lines drop from the bottom, where
   * the reader has already got the gist, and the full text is still on hover and in the panel.
   */
  lines: number;
  /** Label baseline to FIRST subtitle baseline. 0 when `lines` is 0. */
  gap: number;
  /** Subtitle baseline to the next. 0 when `lines` is under 2, so the short records stay total. */
  step: number;
  pad: number;
} | null {
  const availH = hCss - 2 * INSET_MARGIN_PX;
  const label = Math.min(LABEL_FONT_PX, availH / INSET_INK_H);
  if (label < INSET_TEXT_MIN_PX) return null;
  /*
    Against LABEL_FONT_PX and not against `label`: the subtitle is paid for out of what is left
    once a FULL-SIZE label has been taken out, which is the rule being stated. The two agree
    today -- where `label` is under its ceiling there is no room for a second line either way --
    but they would stop agreeing the moment something other than height could shrink the label,
    which is exactly what `fitInsetLine` does downstream.

    `n` lines cost `n` line-heights AND `n` leads: one lead under the label and one between each
    later pair. So `subFor(1)` is the old single-line `room`, exactly.
  */
  const subFor = (n: number): number =>
    (availH - INSET_INK_H * LABEL_FONT_PX - n * INSET_LEAD_PX) / (n * INSET_INK_H);
  /*
    Closed form, not a loop. `subFor` is decreasing in `n`, so `subFor(n) >= INSET_TEXT_MIN_PX`
    rearranges to a single bound -- and at `n = 1` it reduces to `availH >= 22.89`, i.e.
    `hCss >= 28.89`, which is the threshold the one-line version already had.
  */
  const affordable = Math.floor(
    (availH - INSET_INK_H * LABEL_FONT_PX) / (INSET_INK_H * INSET_TEXT_MIN_PX + INSET_LEAD_PX),
  );
  const lines = Math.min(subtitleLines, Math.max(0, affordable));
  const subtitle = lines === 0 ? 0 : Math.min(SUBTITLE_FONT_PX, subFor(lines));
  return {
    label,
    subtitle,
    lines,
    // Ink to ink, so the blank between the lines is the same whatever sizes they came out at.
    // At full size the three terms add back up to INSET_LINE_GAP_PX, by INSET_LEAD_PX's
    // definition, which is why an ordinary box is spaced exactly as it always was.
    gap: lines === 0 ? 0 : INSET_INK_BELOW * label + INSET_INK_ABOVE * subtitle + INSET_LEAD_PX,
    // Between two subtitle lines both terms are the same size, so this is one line-height plus
    // the lead -- the `gap` formula with `label` replaced by `subtitle`.
    step: lines < 2 ? 0 : INSET_INK_H * subtitle + INSET_LEAD_PX,
    pad: 2 * INSET_MARGIN_PX,
  };
}

/**
 * The baselines of the whole text block, as DEVICE-pixel offsets from the box centre, label
 * first: `lines + 1` of them.
 *
 * `Math.trunc`, and this is not a nicety -- it is what makes the one-line case reproduce the old
 * code exactly. That placed the pair at `cy - half` and `cy + half` for
 * `half = Math.floor(gap * dpr / 2)`, i.e. a symmetric floor of the MAGNITUDE, and `trunc` is
 * what floors a magnitude on both sides of zero. A `Math.round` here is off by a device pixel
 * wherever `gap * dpr` is not even, which is every size the label has been shrunk to.
 *
 * Centred on the baseline SET rather than on its ink, again because that is what the one-line
 * code did. The ink is very slightly asymmetric about it (`INSET_INK_ABOVE` 0.43 against
 * `INSET_INK_BELOW` 0.52), which at full size leaves the block 0.39 CSS px high of centre -- not
 * worth a correction that would move every existing diagram by a fraction of a pixel.
 *
 * Exported so the placement is checkable as arithmetic: that the block stays centred, that
 * consecutive midpoints increase so two plates cannot invert, and that one line is exactly the
 * pair the old code drew.
 */
export function insetBaselines(
  ty: { gap: number; step: number },
  lines: number,
  dpr: number,
): readonly number[] {
  const span = lines === 0 ? 0 : ty.gap + (lines - 1) * ty.step;
  const out: number[] = [Math.trunc((-span / 2) * dpr)];
  for (let i = 1; i <= lines; i++) {
    out.push(Math.trunc((ty.gap + (i - 1) * ty.step - span / 2) * dpr));
  }
  return out;
}

/** The one font the inset lines are drawn in. Sizes vary per box and per frame; family never. */
const INSET_FAMILY = SANS;

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
 * The ceiling is the box's height budget and the floor is `INSET_TEXT_MIN_PX` -- the same
 * number below which `insetType` stops offering a line at all, so there is no second threshold
 * to keep in step with the first.
 *
 * A line that comes back as nothing but an ellipsis is returned empty instead. Inside a box,
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
  const r = fitInsetLines(ctx, [text], ceilingPx, floorPx, maxW);
  return { px: r.px, text: r.lines[0] ?? '' };
}

/**
 * `n` inset lines at ONE shared size, chosen by fitting the WIDEST of them.
 *
 * **One `fitFontPx` over a measurer that maxes across the lines, not `n` independent searches.**
 * Two reasons, and the first is the one a reader sees: lines at different sizes read as ragged,
 * which is the same argument the note above makes for clamping the subtitle below the label. The
 * second is cost -- the probe count stays `fitFontPx`'s five whatever `n` is, where `n` searches
 * would have multiplied it, and a two-line subtitle would then have been a per-frame regression on
 * Safari at exactly the zoom band the text width cache exists for. With `cachedTextWidth` behind it
 * the measures are `n` on a cold cache and none on a warm one.
 *
 * A line that cuts down to nothing but an ellipsis comes back empty but KEEPS ITS SLOT. Dropping
 * it would shift every line below it up, so the text would jump as the box was zoomed past the
 * width at which that one line stopped fitting. An empty line in the middle is legal anyway --
 * see `subtitleLines` -- so it is indistinguishable from one the user typed.
 *
 * Leaves `ctx.font` at the size it chose, the promise `fitInsetLine` has always made.
 */
export function fitInsetLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  ceilingPx: number,
  floorPx: number,
  maxW: number,
): { px: number; lines: readonly string[] } {
  if (lines.length === 0) return { px: 0, lines: [] };
  const px = fitFontPx(sizedMeasurer(ctx, lines, INSET_FAMILY), ceilingPx, floorPx, maxW);
  if (px !== 0) {
    // Usually the size the last probe already set, in which case the engine short-circuits.
    ctx.font = `${px}px ${INSET_FAMILY}`;
    return { px, lines };
  }
  /*
    Only the lines that overflow at the floor are cut, and they are cut independently. The fit
    above failed because the WIDEST line did not fit at `floorPx`; the narrower ones still do,
    and `fitText` returns them untouched.
  */
  ctx.font = `${floorPx}px ${INSET_FAMILY}`;
  const cut = lines.map((l) => {
    const t = fitText(ctx, l, maxW);
    return t === '…' ? '' : t;
  });
  return { px: floorPx, lines: cut };
}

/**
 * The aligned device-space outline of a box body, as `drawBoxBody` stroked it.
 *
 * `boxW`/`boxH` are deliberately NOT aligned, unlike the four corners. The outline snaps to whole
 * device pixels and so jitters by one as the box is panned; those snapped coordinates are what
 * the text must be CENTRED on, but a width budget that inherited the jitter would change the
 * fitted size, and a box sitting near a size boundary would step its type -- or gain a letter --
 * while the user did nothing but drag it sideways.
 */
export interface DeviceBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly boxW: number;
  readonly boxH: number;
  /** Device-pixel width of the outline, so a label plate can stay inside it. */
  readonly stroke: number;
}

/**
 * An opaque plate the exact colour of the box body, so a line of text can blot out whatever the
 * kind painted inside it -- a FIFO's cell dividers, specifically.
 *
 * **Two fills, not one, and this is the trap.** `theme.shapeFill` is translucent
 * (`rgba(96, 165, 250, 0.14)`), so filling with it alone composites over the dividers instead of
 * hiding them: the result looks almost right and fails only where a divider passes under a
 * glyph. Painting `background` first and the body fill over it reproduces the body colour
 * exactly and is opaque. `conn.ts`'s label plate has the simpler job -- it sits on the canvas,
 * so one `background` fill is enough there.
 */
function drawPlate(
  dc: DrawContext,
  d: DeviceBox,
  cx: number,
  w: number,
  top: number,
  bottom: number,
): void {
  const { ctx, theme } = dc;
  /*
    Clamped INSIDE the outline, which is the other half of getting this right.

    A label wider than its box -- easy on a FIFO, whose length is fixed by its cell count -- gave
    a plate wider than the box, and two opaque fills then punched a hole straight through both
    vertical outlines at the label's height. Measured: a 16-character label on a 128x64 queue
    erased 22 device pixels of stroke on each side. The outline is stroked CENTRED on the aligned
    coordinate, so the first pixel the plate may touch is half a stroke width inside it.
  */
  const inset = Math.ceil(d.stroke / 2);
  const lo = Math.min(d.x0, d.x1) + inset;
  const hi = Math.max(d.x0, d.x1) - inset;
  const x = Math.max(lo, cx - w / 2);
  const right = Math.min(hi, cx + w / 2);
  if (right <= x) return;
  ctx.fillStyle = theme.background;
  ctx.fillRect(x, top, right - x, bottom - top);
  ctx.fillStyle = theme.shapeFill;
  ctx.fillRect(x, top, right - x, bottom - top);
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
 * `insetType` says how big the box's HEIGHT allows; `fitInsetLine` says how much of that its
 * WIDTH can carry. The two are independent and the smaller wins.
 *
 * The subtitle's ceiling is its own budget, but never above the label's final size and never
 * below the floor. Without the first clamp a short subtitle under a long, width-shrunk label
 * comes out LARGER than the label and the hierarchy inverts; without the second it disappears
 * from a box with room for it, only because the line above it had to shrink.
 */
function drawInsetLabel(s: Headed, dc: DrawContext, d: DeviceBox, plate: boolean): void {
  const { ctx, theme, dpr } = dc;
  const wanted = subtitleLines(s.subtitle);
  const ty = insetType(d.boxH / dpr, wanted.length);
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

  // `ty.lines` and not `wanted.length`: the height may afford fewer than were typed, and the
  // prefix is what gets drawn -- see the note on `insetType`'s `lines`.
  const sub = fitInsetLines(
    ctx,
    wanted.slice(0, ty.lines),
    Math.max(
      floorPx,
      Math.min(ceilingOf(ty.subtitle), Math.floor((label.px * SUBTITLE_FONT_PX) / LABEL_FONT_PX)),
    ),
    floorPx,
    maxW,
  );

  const cx = (d.x0 + d.x1) / 2;
  const cy = (d.y0 + d.y1) / 2;
  /*
    Every line cut away to nothing is the one-line case's "the whole subtitle vanishes",
    generalised -- and re-placing with zero lines is what keeps the label on the box's centre
    rather than pushed up by a block of reserved height with nothing in it.
  */
  const drawn = sub.lines.some((l) => l !== '') ? sub.lines.length : 0;
  const baselines = insetBaselines(ty, drawn, dpr);

  /*
    Both lines are fitted before either is drawn, so the font each was measured at has to be
    selected again here. Two assignments per box per frame, against a guarantee that what was
    measured is what gets drawn -- which is the whole correctness argument for not passing
    `maxWidth`.

    The gap comes from `insetType`, i.e. from the sizes the HEIGHT allowed, not from the sizes
    width cut them down to. Deliberately: a rank of equally tall boxes then shares one pair of
    baselines however long their individual labels are. It can only ever be slack, never
    overflow, since the drawn sizes are bounded by the ones it was computed from.
  */
  const padX = 4 * dpr;
  const at = (i: number): number => cy + baselines[i]!;
  /*
    Consecutive plates MEET at the midpoint of the two baselines they sit between, rather than
    each hugging its own ink: two plates sized to their own ink leave a sliver of whatever is
    underneath showing between them -- on a FIFO, a stub of divider floating between two lines.
    At one subtitle line the midpoint is `cy` integer-exactly, because the two offsets are the
    same integer either side of zero, so this is the old behaviour generalised rather than
    changed.
  */
  const boundary = (i: number): number => (at(i) + at(i + 1)) / 2;

  ctx.font = `${label.px}px ${INSET_FAMILY}`;
  /*
    Measured at the font just selected, which is the one it will be drawn at -- the same
    guarantee `fitInsetLine` exists to provide.
  */
  if (plate) {
    /*
      The INK box, not a box centred on the line.

      `textBaseline` is `middle`, and the ink around that middle is asymmetric --
      `INSET_INK_ABOVE` 0.43 against `INSET_INK_BELOW` 0.52 -- so a plate of height
      `px * INSET_INK_H` centred on the line falls short at the descenders by 0.045 of the font
      size, and a `y` or a `g` sitting over a divider keeps a line through its tail. One device
      pixel of pad on each side covers the rounding.
    */
    drawPlate(
      dc,
      d,
      cx,
      ctx.measureText(label.text).width + 2 * padX,
      at(0) - INSET_INK_ABOVE * label.px - dpr,
      drawn === 0 ? at(0) + INSET_INK_BELOW * label.px + dpr : boundary(0),
    );
  }
  ctx.fillStyle = theme.shapeLabel;
  // The label is what the diagram is *about*; the name is the identifier behind it.
  ctx.fillText(label.text, cx, at(0));

  if (drawn === 0) return;
  // One assignment for the whole block rather than one per line: every subtitle line shares the
  // size `fitInsetLines` chose, which is the point of fitting them together.
  ctx.font = `${sub.px}px ${INSET_FAMILY}`;
  for (let i = 1; i <= drawn; i++) {
    if (sub.lines[i - 1] === '') continue;
    if (plate) {
      drawPlate(
        dc,
        d,
        cx,
        ctx.measureText(sub.lines[i - 1]!).width + 2 * padX,
        boundary(i - 1),
        i === drawn ? at(i) + INSET_INK_BELOW * sub.px + dpr : boundary(i),
      );
    }
    ctx.fillStyle = theme.shapeSubtitle;
    ctx.fillText(sub.lines[i - 1]!, cx, at(i));
  }
}

/**
 * The folder tab above a tabbed box's top corner.
 *
 * Drawn in CSS space rather than device space, which costs a crisp outline and buys the thing
 * that matters more: the width `tabRect` measured and the width `fillText` draws come from one
 * font string, so the clickable box cannot disagree with the drawn one by a rounding error. The
 * trace panel's flags make the same trade.
 *
 * Three sides, never four. Leaving the bottom open lets the box's own top edge close the
 * shape, so the tab reads as attached rather than as a box parked on top of a line. `fill()`
 * closes the subpath for filling and `stroke()` does not, which is exactly the asymmetry wanted.
 */
function drawTab(s: Headed, body: Rect, dc: DrawContext, role: StrokeRole): void {
  const { ctx, theme } = dc;
  const tab = tabRect(s, body, dc.worldPerPx, tabMeasurer(ctx));
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
  ctx.lineWidth = role === 'selected' ? 2 : 1;
  ctx.strokeStyle = strokeColor(theme, role);
  ctx.stroke();

  // `fitText` assigns the font, and caches the whole-string probe. One tab label per tabbed box
  // per frame, plus one per hit test through `tabMeasurer`.
  const text = fitText(ctx, headline(s), tab.textW, TAB_FONT);
  if (text !== '') {
    ctx.fillStyle = theme.shapeLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (a.x + b.x) / 2, (a.y + b.y) / 2 + TAB_FONT_PX / 10);
  }
  restore();
}

/**
 * Draw whichever heading `s.labelMode` asks for. Called from device space, inside the
 * `toDeviceSpace()` that stroked the outline `d` describes -- `drawTab` switches to CSS space
 * itself and switches back.
 *
 * `plate` backs each inset line with an opaque patch of the body colour, for a kind that paints
 * inside its own body. The tabbed modes never need it: the tab sits outside the box and already
 * fills opaque.
 */
export function drawHeading(
  s: Headed,
  body: Rect,
  dc: DrawContext,
  d: DeviceBox,
  role: StrokeRole,
  plate = false,
): void {
  if (s.labelMode === 'inset') drawInsetLabel(s, dc, d, plate);
  else drawTab(s, body, dc, role);
}

/**
 * Which outline a box and its tab get, strongest first: selected, then containing the
 * selection, then plain. Here rather than in `box.ts` because the tab is drawn here and has to
 * match the body it hangs from; a ghost is drawn from its own colours and never asks.
 */
export type StrokeRole = 'normal' | 'selected' | 'ancestor';

export function strokeRole(flags: RenderFlags): StrokeRole {
  if (flags.selected) return 'selected';
  return flags.ancestor ? 'ancestor' : 'normal';
}

export function strokeColor(theme: Theme, role: StrokeRole): string {
  if (role === 'selected') return theme.shapeStrokeSelected;
  return role === 'ancestor' ? theme.shapeStrokeAncestor : theme.shapeStroke;
}
