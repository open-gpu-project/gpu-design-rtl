import { clampNum, expandRect, rectContains } from '../geom/math';
import type { Rect, Vec2 } from '../geom/types';
import { computeWorldBounds } from '../scene/bounds';
import { REVEAL_INSET_PX, ZOOM_MAX, ZOOM_MIN } from './theme';
import { CanvasViewport } from './viewport.svelte';

/**
 * The camera. `(camX, camY)` is the world coordinate at the viewport's top-left corner.
 *
 * There is no scroll container and no spacer element: panning and zooming are arithmetic on
 * these three numbers, so neither forces layout, and the browser can never clamp a scroll
 * offset behind our back and jump the content.
 */
export class ViewController extends CanvasViewport {
  camX = $state(0);
  camY = $state(0);
  z = $state(1);

  /** The pannable extent. Set from the scene's content bounds on every commit. */
  world = $state.raw<Rect>(computeWorldBounds(null));

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

  /**
   * Pan, never zoom, so `r` is on screen, if it is not already. The diagram's `revealTick`.
   *
   * "Already" means inside the viewport inset by `REVEAL_INSET_PX`, and an object already in
   * view leaves the camera exactly where it was: a click in the object tree that moved the
   * canvas every time would lose the user's place for nothing. Otherwise recentre rather than
   * nudge, for the reason `revealTick` gives.
   */
  revealRect(r: Rect): void {
    if (this.cssW <= 0 || this.cssH <= 0) return;
    if (rectContains(expandRect(this.viewportWorld, -REVEAL_INSET_PX / this.z), r)) return;
    this.camX = r.x + r.w / 2 - this.cssW / (2 * this.z);
    this.camY = r.y + r.h / 2 - this.cssH / (2 * this.z);
    this.clampCamera();
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
  override clampCamera(): void {
    const halfW = this.cssW / this.z / 2;
    const halfH = this.cssH / this.z / 2;
    const w = this.world;
    this.camX = clampNum(this.camX, w.x - halfW, w.x + w.w - halfW);
    this.camY = clampNum(this.camY, w.y - halfH, w.y + w.h - halfH);
  }
}
