/**
 * Text fitting shared by both canvases.
 *
 * Lives under `canvas/` rather than `timeline/` for the same reason `alignStroke` does: the
 * timeline already imports from here, and nothing under `canvas/` may import from there.
 */

/** Truncate to fit `maxW`, with an ellipsis. Returns '' when not even the ellipsis fits. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  const ell = '…';
  if (ctx.measureText(ell).width > maxW) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ell : text.slice(0, lo) + ell;
}

/**
 * A text measurer bound to a font, with an estimate to fall back on.
 *
 * The fallback is what lets a hit test ask for a box before the canvas exists. It is wrong, but
 * it is wrong in the same direction every time, and the alternative is a null check at every
 * call site. `flagMeasurer` in `timeline/layout.ts` is the original of this pattern.
 */
export function textMeasurer(
  ctx: CanvasRenderingContext2D | null,
  font: string,
  estPerChar: number,
): (s: string) => number {
  if (ctx === null) return (s) => s.length * estPerChar;
  return (s) => {
    ctx.font = font;
    return ctx.measureText(s).width;
  };
}

/**
 * A measurer for one string across font sizes: the dual of `textMeasurer`, which fixes the font
 * and varies the string.
 *
 * Sizes are whole pixels in whatever unit the text will be drawn in. The inset path passes
 * DEVICE pixels, because that is the only size crisp type can be drawn at, and because
 * measuring in CSS pixels and scaling by `dpr` does not work: advances are grid-fitted at small
 * sizes, so `MEMORY` measures 56.80 at 13px but 109.50 at 26px -- 3.6% short of twice.
 */
export function sizedMeasurer(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
): (sizePx: number) => number {
  return (sizePx) => {
    ctx.font = `${sizePx}px ${family}`;
    return ctx.measureText(text).width;
  };
}

/**
 * The largest whole-pixel font size in `[floor, ceiling]` whose string fits `maxW`, or 0 when
 * even `floor` overflows.
 *
 * The alternative to `fillText`'s fourth argument, which fits text by CONDENSING it -- squashing
 * the glyph run horizontally and leaving its height alone, which is to say by distorting it. A
 * block taller than it is wide is where that shows, because width runs out while the type is
 * still at full size.
 *
 * Every size returned was measured at that exact size, never extrapolated. Width is not linear
 * in font size: the same string measures up to 10.6% more per pixel at the bottom of this range
 * than at the top, and the error runs the wrong way, so a size solved for in closed form comes
 * out too big and overflows again. The straight-line model is still the best guess available, so
 * it places the search's first split and does nothing else -- being wrong there costs a probe,
 * it cannot cost correctness.
 *
 * One probe when the ceiling already fits, which is every block at ordinary zoom; otherwise
 * `1 + ceil(log2(ceiling - floor + 1))`, which the 8..13 CSS px band bounds at 5.
 *
 * Correctness does not depend on width being monotone in size -- what comes back was measured
 * and fit. Monotonicity is only why it is the LARGEST such size, and that in turn is why the
 * answer never falls as `maxW` grows: type that shrinks when its block is widened would flicker
 * under the pointer.
 */
export function fitFontPx(
  measure: (sizePx: number) => number,
  ceiling: number,
  floor: number,
  maxW: number,
): number {
  if (ceiling < floor || maxW <= 0) return 0;
  if (measure(ceiling) <= maxW) return ceiling;

  // `lo` is a size that fits, or `floor - 1` for "none found yet"; `hi` is one that does not.
  let lo = floor - 1;
  let hi = ceiling;
  // Seeded with the straight-line guess rather than the midpoint: it is free, `measure(ceiling)`
  // is already in hand, and it lands within a pixel or two.
  let next = Math.floor((ceiling * maxW) / measure(ceiling));
  while (hi - lo > 1) {
    const mid = Math.min(Math.max(next, lo + 1), hi - 1);
    if (measure(mid) <= maxW) lo = mid;
    else hi = mid;
    next = (lo + hi) >> 1;
  }
  return lo < floor ? 0 : lo;
}
