/** Hard cap: a 3x bitmap costs 2.25x the fill of a 2x one for no visible gain on hairlines. */
const MAX_DPR = 2;

/**
 * What both panels' cameras share: a canvas, its size in CSS pixels, and the device pixel ratio
 * its bitmap is built at. The cameras themselves differ -- the diagram's is one isotropic scale,
 * the timeline's zooms time and only scrolls rows -- so each subclass supplies its own state and
 * its own `clampCamera`.
 */
export abstract class CanvasViewport {
  /** Viewport size in CSS pixels. Zero while the pane is a hidden tab or fully collapsed. */
  cssW = $state(0);
  cssH = $state(0);
  dpr = $state(1);

  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  }

  /**
   * Takes the canvas it is detaching so a late teardown cannot clobber a live attachment.
   *
   * The dock re-mounts a pane when it is floated or maximized, and Svelte may run the new
   * component's `onMount` before the old one's cleanup. An unconditional detach would then
   * null out the context that was just installed, leaving a permanently blank canvas.
   */
  detach(canvas: HTMLCanvasElement): void {
    if (this.canvas !== canvas) return;
    this.canvas = null;
    this.ctx = null;
  }

  /**
   * Resize the backing bitmap. Returns false for a zero-sized container -- a hidden tab or a
   * fully collapsed splitter pane -- so callers can skip rendering instead of producing a 0x0
   * canvas that has to be rebuilt on the way back.
   */
  syncCanvasSize(cssW: number, cssH: number, rawDpr: number): boolean {
    if (cssW <= 0 || cssH <= 0) return false;
    const dpr = Math.min(rawDpr || 1, MAX_DPR);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));

    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;

    const canvas = this.canvas;
    if (canvas !== null) {
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      // Assigning width/height resets all 2D context state, so only do it on a real change.
      // The renderer sets the transform at the top of every frame regardless.
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
    }
    this.clampCamera();
    return true;
  }

  /** The one place the camera is constrained. Called after every resize. */
  abstract clampCamera(): void;
}
