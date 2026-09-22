import { expandRect, rectsIntersect } from '../geom/math';
import type { Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import type { DrawContext, Shape, ShapeName } from '../scene/shape';
import { DotGrid } from './grid-renderer';
import type { Theme } from './theme';
import type { ViewController } from './view.svelte';

export interface RenderInput {
  readonly shapes: readonly Shape[];
  readonly selection: ReadonlySet<ShapeName>;
  /** Uncommitted preview, drawn above everything as a ghost. */
  readonly draft: Shape | null;
  /** The active tool's overlay: selection handles, marquees. Drawn in world space. */
  readonly overlay: ((dc: DrawContext) => void) | null;
}

/**
 * Owns the animation frame. Drawing from inside an `$effect` would make every value the draw
 * reads a tracked dependency, flush once per microtask instead of once per frame, and give no
 * guarantee that layout has settled -- so the effect only marks dirty and this does the work.
 */
export class Renderer {
  #dirty = false;
  #raf = 0;
  /**
   * Owned here rather than by the grid module, because it caches bitmaps sized to this canvas.
   * `Renderer` is built once per `EditorSession` and outlives pane remounts, which is the lifetime
   * a per-canvas cache wants; a module-level one would thrash between two panes.
   */
  #grid = new DotGrid();

  constructor(
    private readonly view: ViewController,
    private readonly theme: Theme,
    private readonly getInput: () => RenderInput,
  ) {}

  requestFrame(): void {
    this.#dirty = true;
    if (this.#raf !== 0) return;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  dispose(): void {
    if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#dirty = false;
    // Drops cached bitmaps only. This can run against a LIVE renderer -- the dock may mount the
    // new pane before tearing down the old one -- so it must not leave the grid unable to draw.
    this.#grid.dispose();
  }

  #tick = (): void => {
    this.#raf = 0;
    if (!this.#dirty) return;
    this.#dirty = false;
    this.draw();
  };

  draw(): void {
    const view = this.view;
    const ctx = view.ctx;
    if (ctx === null || view.cssW <= 0 || view.cssH <= 0) return;

    const { dpr, z, camX, camY } = view;
    const theme = this.theme;

    // Device space, not CSS space. `fillRect(0, 0, cssW, cssH)` under a dpr transform covers
    // `[0, cssW * dpr)`, but `syncCanvasSize` ROUNDS when it assigns `canvas.width` -- so
    // wherever it rounds up, the last device column got only fractional coverage. That was
    // invisible while the grid's loop bound was the same unrounded `cssW * dpr` and never drew
    // there. Now that the grid bounds itself by `canvas.width` it does, and because the context
    // is `{ alpha: false }` and is never cleared, a partially covered column would retain a
    // fraction of the previous frame's dot colour every frame -- a 1px smear down the right edge
    // that builds up over a sustained pan. Filling the bitmap outright also removes one of the
    // frame's two transform switches, and hands `drawDotGrid` the space it resets to anyway.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    this.#grid.draw(ctx, camX, camY, z, dpr, theme);

    const toWorldSpace = (): void => {
      ctx.setTransform(dpr * z, 0, 0, dpr * z, -camX * dpr * z, -camY * dpr * z);
    };
    toWorldSpace();

    const viewport = view.viewportWorld;
    const worldPerPx = 1 / z;
    const dc: DrawContext = {
      ctx,
      worldPerPx,
      dpr,
      viewport,
      theme,
      toScreenSpace() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return toWorldSpace;
      },
      toDeviceSpace() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return toWorldSpace;
      },
      project(p: Vec2): Vec2 {
        return { x: (p.x - camX) * z, y: (p.y - camY) * z };
      },
    };

    const input = this.getInput();
    // Margin covers strokes and handle knobs that stick out past the geometric bounds.
    const cull = expandRect(viewport, 16 * worldPerPx);

    for (const s of input.shapes) {
      const ops = opsFor(s);
      if (!rectsIntersect(ops.bounds(s), cull)) continue;
      ops.draw(s, dc, { selected: input.selection.has(s.name), ghost: false });
    }

    input.overlay?.(dc);

    if (input.draft !== null) {
      opsFor(input.draft).draw(input.draft, dc, { selected: false, ghost: true });
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
