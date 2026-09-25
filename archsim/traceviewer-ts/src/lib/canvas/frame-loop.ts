/**
 * Owns the animation frame for one renderer.
 *
 * **Nothing draws inside an `$effect`.** Drawing there would make every value the draw reads a
 * tracked dependency, flush once per microtask instead of once per frame, and give no guarantee
 * that layout has settled. So `CanvasSurface`'s effect reads an explicit dependency list and
 * calls `request`; the draw runs here, untracked, at most once per frame.
 */
export class FrameLoop {
  #dirty = false;
  #raf = 0;

  /**
   * `draw` is called afresh every frame. A renderer passes `() => this.draw()` rather than a
   * bound method, so a check that shadows `draw` on the instance sees every frame.
   */
  constructor(private readonly draw: () => void) {}

  request(): void {
    this.#dirty = true;
    if (this.#raf !== 0) return;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  cancel(): void {
    if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#dirty = false;
  }

  #tick = (): void => {
    this.#raf = 0;
    if (!this.#dirty) return;
    this.#dirty = false;
    this.draw();
  };
}
