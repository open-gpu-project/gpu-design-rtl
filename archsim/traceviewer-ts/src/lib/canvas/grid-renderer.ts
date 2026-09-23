import { clampNum } from '../geom/math';
import { GRID, MAJOR_EVERY } from '../grid';
import { MIN_DOT_PX, type Theme } from './theme';

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Which primitive the dot tiers are emitted with.
 *
 * Measurement scaffolding for iteration 3.2. Safari rasterizes the canvas display list in its GPU
 * process and charges roughly 21us per `ctx.rect()` there, which is 308ms of the 330ms composite
 * measured at the worst zoom -- but *which* primitive that cost attaches to decides whether the
 * fix is two lines or a strip cache, and no amount of script-time profiling can tell them apart.
 *
 * - `batch`     One path for the whole tier, one `fill()`. The shipped behaviour, and the control.
 * - `row-fill`  One path per row. Collapses each fill's bounding box from the whole canvas
 *               (~8.7Mpx) to `devW x size` (~13kpx). Iteration 3.1 section 4.1's experiment.
 * - `fill-rect` No path at all: one `fillRect()` per dot. Every engine special-cases solid
 *               axis-aligned fills away from path tessellation, so this separates "cost of
 *               tessellating a 14 668-subpath path" from "cost of a rect". Note that the batching
 *               comment on `batchDots` measured `arc()`, a curve -- it says nothing about
 *               `fillRect`.
 * - `strips`    One cached row bitmap per row kind, blitted once per visible row. Turns an
 *               O(area) frame into an O(perimeter) one. See `TierStrips`.
 *
 * The first three emit the same rects, in the same order, at the same `globalAlpha`, and dots
 * provably never overlap (iteration 3.1 section 8), so each pixel is blended exactly once in all
 * of them: they are pixel-identical by construction rather than by approximation, which is what
 * makes swapping between them a fair measurement. `strips` is identical too, but for a longer
 * reason -- see `TierStrips`.
 *
 * Deliberately NOT behind `import.meta.env.DEV`: the thing being measured must be the thing that
 * ships, and gating it behind a different build mode than the one under test is exactly the class
 * of mistake the two triage reports kept catching. The losing modes come out when 3.2 lands.
 */
export type GridMode = 'batch' | 'row-fill' | 'fill-rect' | 'strips';

let gridMode: GridMode = 'batch';

export function setGridMode(mode: GridMode): void {
  gridMode = mode;
}

export function getGridMode(): GridMode {
  return gridMode;
}

/**
 * Which tiers to draw at all. Orthogonal to `GridMode`, and scaffolding for the same session.
 *
 * Crossing z = 0.5 drops `level` by one, so `minorStep` goes 96 -> 16 and `majorStep` goes
 * 576 -> 96 **together**: both tiers reach their densest on-screen spacing at the same instant.
 * The major tier is 288 CSS px apart just below the boundary and 48 CSS px apart just above it,
 * which is the closest it ever gets at any zoom. So "the stutter is where the highlighted dots
 * are densest" and "the stutter is where the minor tier explodes" are the same observation, and
 * nothing about watching the canvas can separate them.
 *
 * What makes separating them worth a switch is that they predict opposite fixes. At z = 0.5001 the
 * minor tier emits 14 163 of the frame's 14 753 rects at a paint alpha of ZERO -- 96% of the cost
 * for no output pixels -- while the 590 major dots are the only thing visible. If drawing the
 * major tier alone stutters, cost is not proportional to primitive count and this whole iteration
 * is aimed at the wrong tier.
 *
 * The rect counts above were measured in iteration 3.1 at MAJOR_EVERY = 5, and iteration 5 raised
 * it to 6. Only the major tier's share moves -- it is now 36x sparser rather than 25x -- and the
 * minor tier at the boundary, which is where all of the cost is, is governed by MIN_DOT_PX and is
 * unchanged. The conclusion the numbers were taken to support survives the constant.
 */
export type GridTiers = 'both' | 'minor' | 'major';

let gridTiers: GridTiers = 'both';

export function setGridTiers(tiers: GridTiers): void {
  gridTiers = tiers;
}

export function getGridTiers(): GridTiers {
  return gridTiers;
}

/**
 * Visible rows per tier below which the direct path is kept instead of building strips.
 *
 * ROWS, not dots. A strip is `devW` wide whatever it holds, so building one costs `cols` rects
 * plus a clear and a fill of the full width; the direct path costs `cols * rows`. Striping
 * therefore pays for itself as soon as there are a few rows to amortize it over, and the
 * break-even is in `rows` alone -- `cols` cancels.
 *
 * A dot-count floor was tried first and was wrong in a way worth recording. The major tier is
 * always MAJOR_EVERY^2 = 36x sparser than the minor one, so any threshold high enough to exclude
 * a tiny high-zoom grid also excluded the major tier at every realistic window size -- leaving it
 * on the O(area) path, emitting 570 of the 910 rects per frame at report 2's geometry and 9 216 of
 * them on a 5120x2880 canvas. That defeats the entire point: the cost stops being flat. A
 * threshold on rows cannot do that, because rows grows with the canvas.
 *
 * Four is where two strip builds plus their clears stop being cheaper than the `4 * cols` rects
 * they replace, and at that size the whole grid is a couple of hundred primitives anyway.
 */
const STRIP_MIN_ROWS = 4;

/** Everything a strip's pixels depend on. Compared field by field; see `TierStrips`. */
interface StripKey {
  readonly camX: number;
  readonly step: number;
  readonly z: number;
  readonly dpr: number;
  readonly devW: number;
  readonly size: number;
  readonly skipEvery: number;
  readonly color: string;
}

function sameKey(a: StripKey, b: StripKey): boolean {
  return (
    a.camX === b.camX &&
    a.step === b.step &&
    a.z === b.z &&
    a.dpr === b.dpr &&
    a.devW === b.devW &&
    a.size === b.size &&
    a.skipEvery === b.skipEvery &&
    a.color === b.color
  );
}

/**
 * The row bitmaps for one tier.
 *
 * WHY THERE ARE ONLY TWO. Nothing in `batchDots`' inner column loop depends on the row index:
 * `x0` and `i0` are functions of `camX`, `step`, `z` and `dpr` alone, and `j` enters only through
 * `majorRow` (a boolean) and `py` (the rect's y). The accumulated `x` sequence is therefore not
 * merely equal across rows but bit-identical, since it restarts from the same `x0` and adds the
 * same `stepDev`. So a tier has exactly two kinds of row -- ordinary, and the ones that leave
 * holes for the major dots to sit in -- and a row is `drawImage` of the right one at `py`.
 *
 * WHY IT IS EXACT. A dot is written at `Math.round(x) - half` in the strip and the strip is
 * blitted at `dx = 0`, so a first column with a negative origin is clipped by the strip's left
 * edge exactly as it was clipped by the canvas; the strip is `devW` wide, so the right edge
 * matches too. Vertically, the 3-argument `drawImage` is specified as the 9-argument form with a
 * full source rectangle, so it never takes the source-clipping branch and a destination hanging
 * off the top or bottom is clipped against the destination bitmap -- again exactly as the rect
 * was. Strip pixels are only ever `(color, 255)` or `(0, 0, 0, 0)`, and both dot colours are
 * fully opaque, so premultiplied equals straight and nothing rounds on the way in.
 *
 * Which leaves `globalAlpha`. Blitting at alpha `a` computes `color*a + dst*(1-a)` for a dot pixel
 * and leaves a gap pixel alone -- algebraically what filling the rect at that alpha does. For the
 * major tier and for `minorAlpha === 1` that is a true copy and the result is exact. In the blend
 * band `z` in (0.5, 0.875) there are two quantization sites, and on a GPU-backed canvas a solid
 * fill and a textured blit are different shader programs, so the honest claim there is one LSB per
 * channel, not zero. `verify/grid.mjs` asserts it that way round.
 *
 * NOT KEYED ON `x0`. The hole positions depend on `mod(i0, skipEvery)`, which is independent of
 * `x0`: panning by exactly one `step` leaves `x0` bit-identical while moving which columns are
 * punched out. `camX` implies both, so the key carries `camX`. It deliberately omits `camY` and
 * `devH`, neither of which touches a strip's pixels -- which is what makes a purely vertical pan,
 * or a vertical-only pane resize, a hit.
 */
class TierStrips {
  #key: StripKey | null = null;
  #plain: HTMLCanvasElement | null = null;
  #holed: HTMLCanvasElement | null = null;

  /** Null when this tier cannot be striped at all -- a degenerate step or a zero-sized strip. */
  strips(k: StripKey): { plain: HTMLCanvasElement; holed: HTMLCanvasElement | null } | null {
    if (this.#key !== null && sameKey(this.#key, k) && this.#plain !== null) {
      return { plain: this.#plain, holed: this.#holed };
    }
    this.#key = null;

    const stepDev = k.step * k.z * k.dpr;
    if (!Number.isFinite(stepDev) || stepDev < 2) return null;
    // `drawImage` throws InvalidStateError on a zero-dimension source, and a NaN camera would
    // otherwise produce an empty strip and a row of no-op blits.
    if (!(k.devW >= 1) || !(k.size >= 1) || !Number.isFinite(k.camX)) return null;

    const half = Math.floor(k.size / 2);
    const i0 = Math.ceil(k.camX / k.step);
    const x0 = (i0 * k.step - k.camX) * k.z * k.dpr;

    const plain = this.#paint(this.#plain, k, x0, stepDev, i0, half, false);
    if (plain === null) return null;
    this.#plain = plain;

    if (k.skipEvery > 0) {
      const holed = this.#paint(this.#holed, k, x0, stepDev, i0, half, true);
      if (holed === null) return null;
      this.#holed = holed;
    } else {
      this.#holed = null;
    }

    this.#key = k;
    return { plain: this.#plain, holed: this.#holed };
  }

  /**
   * Only ever drops the cache.
   *
   * `Renderer.dispose()` can fire against a live renderer -- the dock may run the new pane's
   * `onMount` before the old one's cleanup, which is why `ViewController.detach` takes the canvas
   * it is detaching. So this must never leave the grid in a state that stops drawing; the next
   * frame rebuilds, and the only cost of a spurious call is one rebuild.
   */
  release(): void {
    this.#key = null;
    this.#plain = null;
    this.#holed = null;
  }

  #paint(
    reuse: HTMLCanvasElement | null,
    k: StripKey,
    x0: number,
    stepDev: number,
    i0: number,
    half: number,
    holed: boolean,
  ): HTMLCanvasElement | null {
    const c = reuse ?? document.createElement('canvas');
    // Assigning either dimension reallocates the backing store and resets all context state, so
    // only on a real change -- the same idiom, and the same reason, as `syncCanvasSize`. It also
    // means the strip context's `globalAlpha` and transform are always their defaults: nothing
    // here ever changes them, and a resize would reset them anyway.
    if (c.width !== k.devW) c.width = k.devW;
    if (c.height !== k.size) c.height = k.size;

    // No options. `alpha` must stay true -- the gaps between dots have to be transparent -- and a
    // `colorSpace` or `willReadFrequently` would put the blit on a colour-managed or CPU-backed
    // path and cost the exactness argument above.
    const cx = c.getContext('2d');
    if (cx === null) return null;

    cx.clearRect(0, 0, k.devW, k.size);
    cx.fillStyle = k.color;
    cx.beginPath();
    let i = i0;
    // Accumulated, never `x0 + n * stepDev`: only the index is exact, the pixel coordinate is not,
    // and the tidy-up silently voids pixel identity.
    for (let x = x0; x < k.devW; x += stepDev, i++) {
      if (holed && mod(i, k.skipEvery) === 0) continue;
      cx.rect(Math.round(x) - half, 0, k.size, k.size);
    }
    cx.fill();
    return c;
  }
}

/**
 * One batched path per tier: `arc()` + `fill()` per dot is roughly ten times slower, and a
 * 1920x1080 viewport holds about ten thousand dots at GRID = 16.
 *
 * `skipEvery > 0` omits positions where both indices are multiples of it, which is how the
 * minor pass leaves holes for the major dots to sit in.
 */
function batchDots(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  step: number,
  skipEvery: number,
  z: number,
  dpr: number,
  devW: number,
  devH: number,
  size: number,
  mode: GridMode,
): void {
  const stepDev = step * z * dpr;
  if (!Number.isFinite(stepDev) || stepDev < 2) return;

  // floor, not (size-1)/2: an even size would otherwise put the rect on a half-pixel origin
  // and each dot would antialias into a blur instead of the crisp square this module exists for.
  const half = Math.floor(size / 2);
  // Indices rather than accumulated world coordinates: the major test must stay exact, and
  // repeatedly adding `step` drifts.
  const i0 = Math.ceil(camX / step);
  const j0 = Math.ceil(camY / step);
  const x0 = (i0 * step - camX) * z * dpr;
  const y0 = (j0 * step - camY) * z * dpr;

  // Hoisted out of both loops: the mode is fixed for the frame, and the inner loop is duplicated
  // rather than branched per dot so that the control path is exactly the code that ships.
  const perDotFill = mode === 'fill-rect';
  const perRowPath = mode === 'row-fill';

  if (!perDotFill && !perRowPath) ctx.beginPath();
  let j = j0;
  for (let y = y0; y < devH; y += stepDev, j++) {
    const majorRow = skipEvery > 0 && mod(j, skipEvery) === 0;
    const py = Math.round(y) - half;
    if (perRowPath) ctx.beginPath();
    let i = i0;
    if (perDotFill) {
      for (let x = x0; x < devW; x += stepDev, i++) {
        if (majorRow && mod(i, skipEvery) === 0) continue;
        ctx.fillRect(Math.round(x) - half, py, size, size);
      }
    } else {
      for (let x = x0; x < devW; x += stepDev, i++) {
        if (majorRow && mod(i, skipEvery) === 0) continue;
        ctx.rect(Math.round(x) - half, py, size, size);
      }
    }
    if (perRowPath) ctx.fill();
  }
  if (!perDotFill && !perRowPath) ctx.fill();
}

/**
 * The same tier, one blit per row instead of one rect per dot.
 *
 * The row loop is deliberately the loop from `batchDots`, unchanged: same `j0`, same accumulated
 * `y`, same `py`. Only the inner column loop is gone, into the strip.
 */
function stripDots(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  step: number,
  skipEvery: number,
  z: number,
  dpr: number,
  devW: number,
  devH: number,
  size: number,
  color: string,
  cache: TierStrips,
): boolean {
  const stepDev = step * z * dpr;
  if (!Number.isFinite(stepDev) || stepDev < 2) return true;

  const s = cache.strips({ camX, step, z, dpr, devW, size, skipEvery, color });
  if (s === null) return false;

  const half = Math.floor(size / 2);
  const j0 = Math.ceil(camY / step);
  const y0 = (j0 * step - camY) * z * dpr;

  let j = j0;
  for (let y = y0; y < devH; y += stepDev, j++) {
    const majorRow = skipEvery > 0 && mod(j, skipEvery) === 0;
    ctx.drawImage(majorRow && s.holed !== null ? s.holed : s.plain, 0, Math.round(y) - half);
  }
  return true;
}

/**
 * Dot grid, drawn in device-pixel space. In world space a fractional camera puts every dot on a
 * fractional pixel and they render as four grey smudges instead of one crisp dot -- and trackpad
 * panning produces fractional camera positions constantly.
 *
 * Level of detail climbs in factors of MAJOR_EVERY so the hierarchy survives: minors fade out
 * and the old majors become the new minors. Snapping always uses the base GRID regardless.
 *
 * The device size comes from the bitmap, not from `cssW * dpr`. `syncCanvasSize` rounds when it
 * assigns `canvas.width`, and `cssW` is fractional in the default dock layout because the pane is
 * sized by the dock's fractional splits -- so the two disagreed and the rightmost partial column
 * was under-drawn. The bitmap is the only thing that knows how many device pixels exist, and
 * `canvas.width` is an IDL `unsigned long`, so it is always the integer the loop bound wants.
 *
 * A class, not a free function, only because the strips have to live somewhere. It is owned by
 * `Renderer`, which is built once per session and outlives pane remounts -- a module-level cache
 * would thrash between two panes with different bitmap widths and let one renderer's teardown
 * clear another's strips.
 *
 * Leaves the context in device-pixel space; the caller is expected to set its own transform
 * afterwards.
 */
export class DotGrid {
  #minor = new TierStrips();
  #major = new TierStrips();

  draw(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    z: number,
    dpr: number,
    theme: Theme,
  ): void {
    const level = Math.max(0, Math.ceil(Math.log(MIN_DOT_PX / (GRID * z)) / Math.log(MAJOR_EVERY)));
    const minorStep = GRID * MAJOR_EVERY ** level;
    const majorStep = minorStep * MAJOR_EVERY;

    const devW = ctx.canvas.width;
    const devH = ctx.canvas.height;

    // Read once per frame, so a switch can never split a frame between two implementations.
    const mode = gridMode;
    const tiers = gridTiers;
    const smoothing = ctx.imageSmoothingEnabled;
    // Belt and braces: a 1:1 blit at integer offsets does not resample on any engine tested, but
    // saying so costs nothing. Restored rather than left off, so a future `drawImage` elsewhere in
    // the renderer does not silently inherit nearest-neighbour.
    if (mode === 'strips') ctx.imageSmoothingEnabled = false;

    // Drop to raw device pixels. The caller fills the background in this same space, but shapes are
    // drawn in world space, so the transform cannot be assumed either way -- and without this reset
    // every dot would be drawn at dpr times its intended size and spacing, with the right and
    // bottom edges falling off the bitmap. The caller restores the world transform immediately
    // after this returns.
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Fade the minor tier out exactly as it reaches the density at which the next level takes
    // over. Anchoring this to MIN_DOT_PX is what makes the transition continuous: if the fade
    // bottomed out above zero, the tier would still be visible at the instant it was replaced.
    const minorAlpha = clampNum((minorStep * z - MIN_DOT_PX) / 6, 0, 1);
    if (minorAlpha > 0 && tiers !== 'major') {
      ctx.globalAlpha = minorAlpha;
      ctx.fillStyle = theme.gridDotMinor;
      this.#tier(
        ctx,
        camX,
        camY,
        minorStep,
        MAJOR_EVERY,
        z,
        dpr,
        devW,
        devH,
        Math.max(1, Math.round(1.5 * dpr)),
        theme.gridDotMinor,
        mode,
        this.#minor,
      );
      ctx.globalAlpha = 1;
    }

    if (tiers !== 'minor') {
      ctx.fillStyle = theme.gridDotMajor;
      this.#tier(
        ctx,
        camX,
        camY,
        majorStep,
        0,
        z,
        dpr,
        devW,
        devH,
        Math.max(2, Math.round(2.5 * dpr)),
        theme.gridDotMajor,
        mode,
        this.#major,
      );
    }

    if (mode === 'strips') ctx.imageSmoothingEnabled = smoothing;
  }

  /** Clears the strips and nothing else. Safe against a live renderer; see `TierStrips.release`. */
  dispose(): void {
    this.#minor.release();
    this.#major.release();
  }

  #tier(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    step: number,
    skipEvery: number,
    z: number,
    dpr: number,
    devW: number,
    devH: number,
    size: number,
    color: string,
    mode: GridMode,
    cache: TierStrips,
  ): void {
    const stepDev = step * z * dpr;
    const rows = devH / stepDev;
    if (mode === 'strips' && rows >= STRIP_MIN_ROWS) {
      // Falls through to the direct path if the strips could not be built at all, so a degenerate
      // geometry loses the optimization rather than the grid.
      if (stripDots(ctx, camX, camY, step, skipEvery, z, dpr, devW, devH, size, color, cache)) {
        return;
      }
    }
    batchDots(ctx, camX, camY, step, skipEvery, z, dpr, devW, devH, size, mode);
  }
}
