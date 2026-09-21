import { clampNum } from '../geom/math';
import type { Rect, Vec2 } from '../geom/types';
import { computeWorldBounds } from '../scene/bounds';
import { ZOOM_MAX, ZOOM_MIN } from './theme';

/** Hard cap: a 3x bitmap costs 2.25x the fill of a 2x one for no visible gain on hairlines. */
const MAX_DPR = 2;

/**
 * The camera. `(camX, camY)` is the world coordinate at the viewport's top-left corner.
 *
 * There is no scroll container and no spacer element: panning and zooming are arithmetic on
 * these three numbers, so neither forces layout, and the browser can never clamp a scroll
 * offset behind our back and jump the content.
 */
export class ViewController {
  camX = $state(0);
  camY = $state(0);
  z = $state(1);

  /** Viewport size in CSS pixels. Zero while the view is in a hidden tab or collapsed pane. */
  cssW = $state(0);
  cssH = $state(0);
  dpr = $state(1);

  /** The pannable extent. Set from the scene's content bounds on every commit. */
  world = $state.raw<Rect>(computeWorldBounds(null));

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

  get ready(): boolean {
    return this.ctx !== null && this.cssW > 0 && this.cssH > 0;
  }

  get worldPerPx(): number {
    return 1 / this.z;
  }

  get viewportWorld(): Rect {
    return { x: this.camX, y: this.camY, w: this.cssW / this.z, h: this.cssH / this.z };
  }

  get viewportCenter(): Vec2 {
    return { x: this.cssW / 2, y: this.cssH / 2 };
  }

  toWorld(screen: Vec2): Vec2 {
    return { x: this.camX + screen.x / this.z, y: this.camY + screen.y / this.z };
  }

  toScreen(world: Vec2): Vec2 {
    return { x: (world.x - this.camX) * this.z, y: (world.y - this.camY) * this.z };
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

  setWorld(next: Rect): void {
    this.world = next;
    this.clampCamera();
  }

  /** Drag semantics: moving the pointer right by `dx` pulls the content right. */
  pan(dxScreen: number, dyScreen: number): void {
    this.camX -= dxScreen / this.z;
    this.camY -= dyScreen / this.z;
    this.clampCamera();
  }

  panWorld(dx: number, dy: number): void {
    this.camX += dx;
    this.camY += dy;
    this.clampCamera();
  }

  /** Zoom so the world point currently under `anchorScreen` stays under it. */
  zoomTo(nextZ: number, anchorScreen: Vec2): void {
    const target = clampNum(nextZ, ZOOM_MIN, ZOOM_MAX);
    if (target === this.z) return;
    const anchorWorld = this.toWorld(anchorScreen);
    this.z = target;
    this.camX = anchorWorld.x - anchorScreen.x / target;
    this.camY = anchorWorld.y - anchorScreen.y / target;
    this.clampCamera();
  }

  zoomAt(anchorScreen: Vec2, factor: number): void {
    this.zoomTo(this.z * factor, anchorScreen);
  }

  /** Toolbar buttons and keyboard: zoom about the viewport centre in fixed steps. */
  zoomByStep(steps: number): void {
    this.zoomTo(this.z * Math.pow(1.25, steps), this.viewportCenter);
  }

  resetZoom(): void {
    this.zoomTo(1, this.viewportCenter);
  }

  zoomToFit(content: Rect | null, pad = 64): void {
    if (this.cssW <= 0 || this.cssH <= 0) return;
    const target = content ?? this.world;
    const z = clampNum(
      Math.min(this.cssW / (target.w + 2 * pad), this.cssH / (target.h + 2 * pad)),
      ZOOM_MIN,
      ZOOM_MAX,
    );
    this.z = z;
    this.camX = target.x + target.w / 2 - this.cssW / (2 * z);
    this.camY = target.y + target.h / 2 - this.cssH / (2 * z);
    this.clampCamera();
  }

  /**
   * The only place the camera is constrained: the centre of the viewport must stay inside the
   * world. That is what makes panning bounded without being able to disturb the view.
   *
   * Constraining the viewport EDGES instead would make each bound depend on the world's size,
   * so a commit that extended the world leftwards could yank the camera with it. Here each
   * bound depends on a single world edge, and the world never retreats on the side content grew
   * into -- so growing the world can never move the camera, at any zoom. Only deleting content
   * can, which is both expected and unavoidable.
   *
   * It also leaves `zoomTo`'s anchor solution alone, so the point under the cursor stays put
   * even when the whole world fits on screen. Centring the world is an explicit action
   * (`zoomToFit`), not something a constraint should impose.
   */
  clampCamera(): void {
    const halfW = this.cssW / this.z / 2;
    const halfH = this.cssH / this.z / 2;
    const w = this.world;
    this.camX = clampNum(this.camX, w.x - halfW, w.x + w.w - halfW);
    this.camY = clampNum(this.camY, w.y - halfH, w.y + w.h - halfH);
  }
}
