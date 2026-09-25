import { clampNum } from '../geom/math';
import { GRID, MAJOR_EVERY } from '../grid';
import { MIN_DOT_PX, type Theme } from './theme';

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

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

/** One tier's frame: the key, plus the two inputs that only decide where the rows land. */
interface TierParams extends StripKey {
  readonly camY: number;
  readonly devH: number;
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
 * One tier of the dot grid, drawn as one cached row bitmap blitted once per visible row.
 *
 * WHY STRIPS. Drawn a dot at a time, the grid costs O(area): up to 14 668 rects in one frame at
 * `z = 0.5001`. Safari rasterizes the canvas display list in its GPU process and charges per
 * primitive there, so that frame took a third of a second to composite while the main thread
 * sat idle (iteration 3). Strips make it O(perimeter) -- a few hundred primitives at any zoom.
 *
 * WHY THERE ARE ONLY TWO. The reference is one `rect(Math.round(x) - half, py, size, size)` per
 * dot, with `x` accumulated from `x0` by `stepDev` and `py = Math.round(y) - half`. Nothing in
 * that column loop depends on the row: `x0` and `i0` are functions of `camX`, `step`, `z` and
 * `dpr` alone, and the row enters only through `py` and through whether it is a row that leaves
 * holes for the major dots to sit in. The accumulated `x` sequence is therefore not merely equal
 * across rows but bit-identical, since it restarts from the same `x0` and adds the same
 * `stepDev`. So a tier has exactly two kinds of row -- ordinary, and holed -- and a row is
 * `drawImage` of the right one at `py`.
 *
 * WHY IT IS EXACT. A dot is written at `Math.round(x) - half` in the strip and the strip is
 * blitted at `dx = 0`, so a first column with a negative origin is clipped by the strip's left
 * edge exactly as it would be by the canvas; the strip is `devW` wide, so the right edge matches
 * too. Vertically, the 3-argument `drawImage` is specified as the 9-argument form with a full
 * source rectangle, so it never takes the source-clipping branch and a destination hanging off
 * the top or bottom is clipped against the destination bitmap -- again exactly as a rect would
 * be. Strip pixels are only ever `(color, 255)` or `(0, 0, 0, 0)`, and both dot colours are fully
 * opaque, so premultiplied equals straight and nothing rounds on the way in. Every one of those
 * arguments is per row and per column, so none of them depends on how many rows there are.
 *
 * Which leaves `globalAlpha`. Blitting at alpha `a` computes `color*a + dst*(1-a)` for a dot pixel
 * and leaves a gap pixel alone -- algebraically what filling the rect at that alpha does. For the
 * major tier and for `minorAlpha === 1` that is a true copy and the result is exact. In the blend
 * band `z` in (0.5, 0.875) there are two quantization sites, and on a GPU-backed canvas a solid
 * fill and a textured blit are different shader programs, so the honest claim there is one LSB per
 * channel, not zero. `verify/grid.mjs` asserts it that way round, against a per-dot reference.
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

  draw(ctx: CanvasRenderingContext2D, t: TierParams): void {
    const stepDev = t.step * t.z * t.dpr;
    if (!Number.isFinite(stepDev) || stepDev < 2) return;

    const s = this.#strips(t, stepDev);
    if (s === null) return;

    // floor, not (size-1)/2: an even size would otherwise put the dot on a half-pixel origin and
    // it would antialias into a blur instead of the crisp square this module exists for.
    const half = Math.floor(t.size / 2);
    // Indices rather than accumulated world coordinates: the major test must stay exact, and
    // repeatedly adding `step` drifts.
    const j0 = Math.ceil(t.camY / t.step);
    const y0 = (j0 * t.step - t.camY) * t.z * t.dpr;

    let j = j0;
    for (let y = y0; y < t.devH; y += stepDev, j++) {
      const majorRow = t.skipEvery > 0 && mod(j, t.skipEvery) === 0;
      ctx.drawImage(majorRow && s.holed !== null ? s.holed : s.plain, 0, Math.round(y) - half);
    }
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

  /**
   * The two strips for `k`, built or reused. Null when the tier has nothing to draw: a zero-width
   * bitmap or a NaN camera would put no dot on the canvas either.
   */
  #strips(
    k: StripKey,
    stepDev: number,
  ): { plain: HTMLCanvasElement; holed: HTMLCanvasElement | null } | null {
    if (this.#key !== null && sameKey(this.#key, k) && this.#plain !== null) {
      return { plain: this.#plain, holed: this.#holed };
    }
    this.#key = null;

    // `drawImage` throws InvalidStateError on a zero-dimension source.
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
    // One path for the strip, one `fill()`: `arc()` + `fill()` per dot is roughly ten times slower.
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

    const smoothing = ctx.imageSmoothingEnabled;
    // Belt and braces: a 1:1 blit at integer offsets does not resample on any engine tested, but
    // saying so costs nothing. Restored rather than left off, so a future `drawImage` elsewhere in
    // the renderer does not silently inherit nearest-neighbour.
    ctx.imageSmoothingEnabled = false;

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
    if (minorAlpha > 0) {
      ctx.globalAlpha = minorAlpha;
      this.#minor.draw(ctx, {
        camX,
        camY,
        step: minorStep,
        skipEvery: MAJOR_EVERY,
        z,
        dpr,
        devW,
        devH,
        size: Math.max(1, Math.round(1.5 * dpr)),
        color: theme.gridDotMinor,
      });
      ctx.globalAlpha = 1;
    }

    this.#major.draw(ctx, {
      camX,
      camY,
      step: majorStep,
      skipEvery: 0,
      z,
      dpr,
      devW,
      devH,
      size: Math.max(2, Math.round(2.5 * dpr)),
      color: theme.gridDotMajor,
    });

    ctx.imageSmoothingEnabled = smoothing;
  }

  /** Clears the strips and nothing else. Safe against a live renderer; see `TierStrips.release`. */
  dispose(): void {
    this.#minor.release();
    this.#major.release();
  }
}
