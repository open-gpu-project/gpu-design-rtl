/**
 * Text fitting shared by both canvases, and the width cache underneath it.
 *
 * Lives under `canvas/` rather than `timeline/` for the same reason `alignStroke` does: the
 * timeline already imports from here, and nothing under `canvas/` may import from there.
 */

/*
  ---------------------------------------------------------------------- the cache ----

  A module-level table, and the reasoning for that rather than for an object owned by `Renderer`
  and threaded through `DrawContext`:

  A text advance is a pure function of `(font shorthand, string)` and of nothing per-surface. It
  does not depend on the canvas, on the device pixel ratio, or on the theme -- the dpr is already
  baked into the shorthand's pixel size (see `sizedMeasurer` on why sizes are whole DEVICE
  pixels), and the theme decides colour, not metrics. So the failure that made `DotGrid` a
  `Renderer`-owned class does not have an analogue here: a strip is a bitmap sized to one canvas,
  where an advance is a property of the font.

  And it has to be reachable from callers with no `DrawContext` at all. `tabRect` is driven from
  `hitTest` through the bare `HitContext.measure` callback, which `ToolHost` rebuilds on every
  hit test and every hover; `flagMeasurer` in `timeline/layout.ts` runs in a layout pass with no
  draw context in sight. Threading the cache through `DrawContext` would have left both of them
  on the uncached path, which is where half the per-frame cost was.

  WHAT THIS IS FOR. Iteration 6.3, and the Safari defect that stayed after the grid was fixed:
  interaction got slow in proportion to SHAPE COUNT in the 50-70% zoom band, which is the one
  axis neither triage report varied. `drawInsetLabel` reaches `measureText` through
  `fitFontPx`'s binary search, and `fitFontPx` takes its one-probe fast path only while the label
  fits at the ceiling. For typical block widths that stops being true at z around 0.48, and below
  z around 0.46 the fit bottoms out and falls through to `fitText`'s own probes -- so a box went
  from about one measure per frame to ten or sixteen, at integer sizes that change every frame
  during a pinch. Twenty boxes is two to three hundred shaping calls per frame, every frame.
*/

/**
 * Widths already measured, by font shorthand and then by string.
 *
 * KEYED ON THE SHORTHAND, not on `(size, family)`. It is the string `sizedMeasurer` builds
 * anyway and the one `ctx.font` is assigned; `textMeasurer` is handed a shorthand and has no size
 * to key on at all; and `TAB_FONT` and `NIF_LABEL_FONT` are already shorthand constants. One key
 * space serves all three callers.
 *
 * TWO LEVELS rather than one concatenated key. The outer map holds about twenty entries -- the
 * whole-device-pixel sizes inset type is drawn at, plus a few constants -- so the inner lookup is
 * one `Map.get` on the caller's own string and allocates nothing. A concatenated key would
 * allocate on every probe, five probes times twenty boxes times sixty frames a second, and would
 * need a separator that cannot occur in a font family list or in a user-typed label, which no
 * printable character is.
 */
const widths = new Map<string, Map<string, number>>();

/** Entries across every inner map, so the cap below is a bound on the whole table. */
let entries = 0;
let hits = 0;
let misses = 0;

/**
 * Entries kept before the table is dropped wholesale.
 *
 * The LIVE key space is about twenty shorthands times the distinct strings in the document, which
 * for any diagram a person draws is in the hundreds. It only grows without bound through EDITING
 * -- renaming a block fifty thousand times -- so this is a leak guard and not a working-set
 * bound. A clear costs at most one uncached frame, where an LRU needs a recency list and a touch
 * on every HIT: paying on the fast path to optimise a case that does not arise.
 *
 * Counted across the WHOLE table rather than per font, because per font is not a bound: one
 * string measured at eleven sizes is eleven entries in eleven maps, so a per-map cap of 4096
 * would hold 45 000 of them. `verify/labels.mjs` asserts the total.
 *
 * Three clears that are the obvious instinct and are all wrong, written down because each one
 * would quietly undo this:
 *
 *  - NOT per frame. Not surviving between frames is the entire defect.
 *  - NOT on a dpr change. The dpr is inside the shorthand, so entries for the old one simply stop
 *    being looked up and age out against the cap.
 *  - NOT on a theme change. Colour is not part of a metric.
 *
 * The one that WOULD be needed does not apply yet: every font stack in this app is system fonts
 * and there is no `@font-face` anywhere in `src/` or `index.html`, so there is no load event after
 * which a measurement could change. Adding a web font later means clearing on
 * `document.fonts.ready`, which is why this paragraph exists.
 */
const CACHE_CAP = 4096;

/**
 * The width of `text` at `font`, measured once.
 *
 * **Always assigns `ctx.font`, hit or miss.** Skipping it on a hit would also save the shorthand
 * parse, and is deliberately not done: what this exists to remove is the glyph shaping, which is
 * the larger half, and assigning unconditionally keeps every promise the callers already
 * document -- `fitInsetLine`'s "leaves `ctx.font` at the size it chose" in particular, which
 * `verify/labels.mjs` asserts by measuring the returned string at the font left behind. A
 * `lastFont` guard inside this module could not substitute for that, because `heading.ts`,
 * `nif.ts` and `conn.ts` all write `ctx.font` directly and would make it stale.
 */
export function cachedTextWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  ctx.font = font;
  return measureAt(ctx, font, text);
}

/**
 * The cached width, ASSUMING `ctx.font` is already `font`.
 *
 * The split exists so a caller measuring several strings at ONE size can assign the font once and
 * then look each of them up -- which is what a multi-line subtitle does, and it is the difference
 * between one font assignment per probe and `n` of them. `verify/labels.mjs` asserts it that way
 * round: three lines must cost no more font changes than one, because the whole reason they share
 * a size is that one binary search answers for all of them.
 *
 * Private, because the assumption is not one an outside caller should have to hold.
 */
function measureAt(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const byText = widths.get(font);
  const known = byText?.get(text);
  if (known !== undefined) {
    hits++;
    return known;
  }
  misses++;
  const w = ctx.measureText(text).width;
  if (entries >= CACHE_CAP) {
    widths.clear();
    entries = 0;
  }
  // Re-fetched, because the clear above may have dropped the map found before it.
  let into = widths.get(font);
  if (into === undefined) {
    into = new Map<string, number>();
    widths.set(font, into);
  }
  into.set(text, w);
  entries++;
  return w;
}

/**
 * How the cache is doing. Exposed on `window` un-gated, for the same reason `__gridMode` is: the
 * thing being measured has to be the thing that ships.
 */
export function textCacheStats(): { size: number; fonts: number; hits: number; misses: number } {
  return { size: entries, fonts: widths.size, hits, misses };
}

export function resetTextCacheStats(): void {
  hits = 0;
  misses = 0;
}

/** Drops every entry. For checks that need a cold cache; nothing in the app calls this. */
export function clearTextCache(): void {
  widths.clear();
  entries = 0;
  resetTextCacheStats();
}

/* ------------------------------------------------------------------- the fitters ---- */

/**
 * Truncate to fit `maxW`, with an ellipsis. Returns '' when not even the ellipsis fits.
 *
 * `font` is optional, and when given only the two WHOLE-STRING probes go through the cache: the
 * common case is that the string fits and the first probe is the only one that runs, once per
 * port and once per tab per frame. The binary search's probes are deliberately left direct --
 * each one measures a distinct `text.slice(0, n) + '…'` that is used once for this one `maxW`,
 * so caching them would fill the table with strings no later frame asks for. A caller that omits
 * `font` behaves exactly as it did before the cache existed.
 */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  font?: string,
): string {
  if (maxW <= 0) return '';
  const whole = (s: string): number =>
    font === undefined ? ctx.measureText(s).width : cachedTextWidth(ctx, font, s);
  if (whole(text) <= maxW) return text;
  const ell = '…';
  if (whole(ell) > maxW) return '';
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
  // Cached: this is the hit-test path as well as the draw path -- `tabMeasurer` is rebuilt on
  // every hover and every hit test, so the same tab label was being shaped several times per
  // pointer move before this.
  return (s) => cachedTextWidth(ctx, font, s);
}

/**
 * A measurer for one string across font sizes: the dual of `textMeasurer`, which fixes the font
 * and varies the string.
 *
 * Sizes are whole pixels in whatever unit the text will be drawn in. The inset path passes
 * DEVICE pixels, because that is the only size crisp type can be drawn at, and because
 * measuring in CSS pixels and scaling by `dpr` does not work: advances are grid-fitted at small
 * sizes, so `MEMORY` measures 56.80 at 13px but 109.50 at 26px -- 3.6% short of twice.
 *
 * @param text One string, or several to be measured as the WIDEST of them. The array case is
 * what lets a multi-line subtitle settle on one shared size from one binary search. It maxes
 * rather than sums, because the lines are stacked and not concatenated.
 */
export function sizedMeasurer(
  ctx: CanvasRenderingContext2D,
  text: string | readonly string[],
  family: string,
): (sizePx: number) => number {
  // Cached, and this is the probe that was costing the most: `fitFontPx` calls it up to five
  // times per line per box per frame, at sizes that step as the zoom changes.
  if (typeof text === 'string') {
    return (sizePx) => cachedTextWidth(ctx, `${sizePx}px ${family}`, text);
  }
  return (sizePx) => {
    const font = `${sizePx}px ${family}`;
    // Assigned ONCE for the whole probe, then one lookup per line. `n` calls to
    // `cachedTextWidth` would re-assign the same value `n` times -- see `measureAt`.
    ctx.font = font;
    let widest = 0;
    for (const line of text) widest = Math.max(widest, measureAt(ctx, font, line));
    return widest;
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
