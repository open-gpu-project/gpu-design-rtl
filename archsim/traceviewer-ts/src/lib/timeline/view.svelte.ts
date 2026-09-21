import { clampNum } from '../geom/math';
import type { Vec2 } from '../geom/types';
import {
  GUTTER_MAX_W,
  GUTTER_MIN_W,
  GUTTER_W,
  REVEAL_MARGIN_PX,
  ROW_H,
  TIMESCALE_H,
  ZT_MAX,
  ZT_MIN,
} from './theme';

/** Same cap and same reason as the diagram: a 3x bitmap costs 2.25x the fill for no gain. */
const MAX_DPR = 2;

/**
 * The trace panel's camera.
 *
 * A fork of `ViewController`, not a reuse. The diagram's `z` is a single isotropic scale, and a
 * timeline needs the two axes to behave differently: time zooms continuously, rows have a fixed
 * height and only scroll. Forcing both through one scale would mean either unreadable row text
 * when zoomed out on time, or a time axis that cannot zoom independently.
 *
 * `zoomAt(anchor, factor)` and `pan(dx, dy)` keep the diagram's exact signatures so that
 * `WheelController` drives this class without modification.
 */
export class TimelineView {
  /** The tick at the left edge of the lane area (i.e. just right of the gutter). */
  camT = $state(0);

  /** Zoom: CSS pixels per tick. */
  zT = $state(0.35);

  /** Vertical scroll of the rows, in CSS pixels. */
  scrollY = $state(0);

  /** Viewport size in CSS pixels. Zero while the pane is a hidden tab or fully collapsed. */
  cssW = $state(0);
  cssH = $state(0);
  dpr = $state(1);

  /** Width of the frozen name column. */
  gutterW = $state(GUTTER_W);

  /** Set from the document so the camera can be clamped. */
  lastTick = $state(0);
  rowCount = $state(0);

  /**
   * Whether an initial zoom-to-fit has happened.
   *
   * Plain field, not a rune: it is read once per mount by the surface and never rendered. The
   * surface cannot fit at construction time because the pane's size is not known until the
   * first `ResizeObserver` callback, and a pane that starts collapsed never gets one.
   */
  fitted = false;

  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  }

  /**
   * Takes the canvas it is detaching, so a late teardown cannot clobber a live attachment.
   * The dock may run the new pane's `onMount` before the old one's cleanup (iter-2 defect 3).
   */
  detach(canvas: HTMLCanvasElement): void {
    if (this.canvas !== canvas) return;
    this.canvas = null;
    this.ctx = null;
  }

  get ready(): boolean {
    return this.ctx !== null && this.cssW > 0 && this.cssH > 0;
  }

  /* ------------------------------------------------------------------ geometry ---- */

  /** Left edge of the lane area, in CSS px. Everything left of this is the frozen gutter. */
  get laneX(): number {
    return this.gutterW;
  }

  get laneW(): number {
    return Math.max(0, this.cssW - this.gutterW);
  }

  /** Top of the first row, in CSS px. Everything above is the timescale strip. */
  get laneTop(): number {
    return TIMESCALE_H;
  }

  get laneH(): number {
    return Math.max(0, this.cssH - TIMESCALE_H);
  }

  /** Total height of all rows, whether or not they fit. */
  get contentH(): number {
    return this.rowCount * ROW_H;
  }

  get maxScrollY(): number {
    return Math.max(0, this.contentH - this.laneH);
  }

  /** Ticks spanned by the visible lane. */
  get visibleTicks(): number {
    return this.zT > 0 ? this.laneW / this.zT : 0;
  }

  toX(tick: number): number {
    return this.laneX + (tick - this.camT) * this.zT;
  }

  /** Fractional: callers that need a tick round it themselves, so snapping is explicit. */
  toTick(screenX: number): number {
    return this.camT + (screenX - this.laneX) / this.zT;
  }

  /** Top of a row, in CSS px, accounting for the scroll. */
  rowY(index: number): number {
    return this.laneTop + index * ROW_H - this.scrollY;
  }

  /** The row index under a y in CSS px, or -1 outside the lane or past the last row. */
  rowAt(screenY: number): number {
    if (screenY < this.laneTop) return -1;
    const i = Math.floor((screenY - this.laneTop + this.scrollY) / ROW_H);
    return i >= 0 && i < this.rowCount ? i : -1;
  }

  /* ---------------------------------------------------------------- mutations ---- */

  /**
   * Resize the backing bitmap. Returns false for a zero-sized container -- a hidden tab or a
   * collapsed splitter -- so the caller can skip rendering rather than build a 0x0 canvas.
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
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
    }
    this.clampCamera();
    return true;
  }

  setContent(rowCount: number, lastTick: number): void {
    this.rowCount = rowCount;
    this.lastTick = lastTick;
    this.clampCamera();
  }

  setGutterW(w: number): void {
    this.gutterW = clampNum(
      w,
      GUTTER_MIN_W,
      Math.min(GUTTER_MAX_W, Math.max(GUTTER_MIN_W, this.cssW - 80)),
    );
    this.clampCamera();
  }

  /** Drag semantics: dragging right pulls the content right; dragging up scrolls rows down. */
  pan(dxScreen: number, dyScreen: number): void {
    if (this.zT > 0) this.camT -= dxScreen / this.zT;
    this.scrollY -= dyScreen;
    this.clampCamera();
  }

  /** Zoom time so the tick currently under `anchorScreen.x` stays under it. */
  zoomTo(nextZ: number, anchorScreen: Vec2): void {
    const target = clampNum(nextZ, ZT_MIN, ZT_MAX);
    if (target === this.zT) return;
    const anchorTick = this.toTick(anchorScreen.x);
    this.zT = target;
    this.camT = anchorTick - (anchorScreen.x - this.laneX) / target;
    this.clampCamera();
  }

  zoomAt(anchorScreen: Vec2, factor: number): void {
    this.zoomTo(this.zT * factor, anchorScreen);
  }

  /** Buttons and keyboard: zoom about the centre of the lane in fixed steps. */
  zoomByStep(steps: number): void {
    this.zoomTo(this.zT * Math.pow(1.25, steps), { x: this.laneX + this.laneW / 2, y: 0 });
  }

  zoomToFit(pad = 24): void {
    if (this.laneW <= 0) return;
    this.fitted = true;
    const span = Math.max(1, this.lastTick);
    const z = clampNum((this.laneW - 2 * pad) / span, ZT_MIN, ZT_MAX);
    this.zT = z;
    this.camT = -pad / z;
    this.clampCamera();
  }

  /** Pan the time axis so `tick` is on screen, if it is not already. */
  revealTick(tick: number, margin = REVEAL_MARGIN_PX): void {
    if (this.laneW <= 0) return;
    const x = this.toX(tick);
    const lo = this.laneX + margin;
    const hi = this.cssW - margin;
    if (x >= lo && x <= hi) return;
    // Recentre rather than nudge to the edge: a next/previous jump that lands one pixel inside
    // the viewport leaves no context on the side it came from.
    this.camT = tick - this.visibleTicks / 2;
    this.clampCamera();
  }

  /** Scroll vertically so a row is fully visible. */
  revealRow(index: number): void {
    if (index < 0 || this.laneH <= 0) return;
    const top = index * ROW_H;
    const bottom = top + ROW_H;
    if (top < this.scrollY) this.scrollY = top;
    else if (bottom > this.scrollY + this.laneH) this.scrollY = bottom - this.laneH;
    this.clampCamera();
  }

  /**
   * The only place the camera is constrained.
   *
   * Time uses the diagram's **centre** constraint (iter-1 §3.2): the middle of the lane must
   * stay within the document, so each bound depends on a single document edge and extending the
   * trace can never yank the view. Rows use a plain edge clamp, because their extent is exact
   * and there is nothing to anchor past.
   */
  clampCamera(): void {
    const half = this.visibleTicks / 2;
    this.camT = clampNum(this.camT, -half, Math.max(0, this.lastTick) - half);
    this.scrollY = clampNum(this.scrollY, 0, this.maxScrollY);
  }
}
