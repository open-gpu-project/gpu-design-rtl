import { keys } from '../keys';
import { alignStroke } from '../canvas/pixel';
import { DRAG_SLOP_PX } from '../canvas/theme';
import { rectFromPoints } from '../geom/math';
import type { Rect, Vec2 } from '../geom/types';
import { shapesInRect } from '../scene/bounds';
import type { DrawContext, ShapeName } from '../scene/shape';
import { registerTool } from './registry';
import type { PointerInfo, Tool, ToolContext } from './tool';

interface Band {
  readonly from: Vec2;
  readonly to: Vec2;
  /** The selection when the press landed, so `Shift` can union and `Escape` can restore. */
  readonly base: ReadonlySet<ShapeName>;
  readonly additive: boolean;
  readonly downScreen: Vec2;
}

/**
 * Rubber-band selection.
 *
 * A separate tool rather than a gesture on the select tool, because on this canvas dragging
 * empty space already pans -- that is the primary pan gesture, not a fallback, and a marquee
 * cannot have it without taking it away.
 */
export class MarqueeTool implements Tool {
  readonly id = 'select';
  readonly label = 'Select';
  readonly defaultCursor = 'crosshair';

  #band: Band | null = null;
  /** Latches past DRAG_SLOP_PX, so a plain click is a click and not a zero-area band. */
  #armed = false;

  /** For `verify/`: the live band in world units, or null. */
  get band(): Rect | null {
    return this.#rect();
  }

  /** For `verify/`: what the band currently covers. */
  get hitNames(): readonly ShapeName[] {
    return this.#lastHits;
  }
  #lastHits: readonly ShapeName[] = [];

  isGesturing(): boolean {
    return this.#band !== null;
  }

  onActivate(c: ToolContext): void {
    // Instances are cached for the session, so a band abandoned by a tool switch would
    // otherwise still be here on the way back.
    this.#band = null;
    this.#armed = false;
    this.#lastHits = [];
    c.setHint(`Drag to select. Hold ${keys('shift')} to add. Press 1 to move things.`);
  }

  onDeactivate(c: ToolContext): void {
    this.#cancel(c, false);
  }

  onPointerDown(p: PointerInfo, c: ToolContext): void {
    if (p.button !== 0) return;
    // No hit test: a region tool treats a press on a block exactly like a press on empty space.
    this.#band = {
      from: p.world,
      to: p.world,
      base: c.scene.selection,
      additive: p.mods.shift,
      downScreen: p.screen,
    };
    this.#armed = false;
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    const band = this.#band;
    if (band === null) return;

    if (!this.#armed) {
      const moved = Math.hypot(p.screen.x - band.downScreen.x, p.screen.y - band.downScreen.y);
      if (moved < DRAG_SLOP_PX) return;
      this.#armed = true;
    }

    this.#band = { ...band, to: p.world };
    this.#apply(c);
    c.requestFrame();
  }

  onPointerUp(_p: PointerInfo, c: ToolContext): void {
    const band = this.#band;
    if (band === null) return;
    this.#band = null;

    // A press that never travelled is a click on empty space: clear, unless adding.
    if (!this.#armed) {
      if (!band.additive) c.scene.clearSelection();
      this.#lastHits = [];
    }
    c.requestFrame();
  }

  onPointerCancel(c: ToolContext): void {
    this.#cancel(c, true);
  }

  onKeyDown(e: KeyboardEvent, c: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    if (this.#band !== null) {
      this.#cancel(c, true);
      return true;
    }
    // The convention every non-select tool follows: Escape with nothing in flight goes home.
    c.setTool('pointer');
    return true;
  }

  drawOverlay(dc: DrawContext, _c: ToolContext): void {
    const r = this.#rect();
    if (r === null || !this.#armed) return;

    const restore = dc.toDeviceSpace();
    const { ctx, dpr } = dc;
    const lw = Math.max(1, Math.round(dpr));
    const a = dc.project({ x: r.x, y: r.y });
    const b = dc.project({ x: r.x + r.w, y: r.y + r.h });
    const x = alignStroke(a.x * dpr, lw);
    const y = alignStroke(a.y * dpr, lw);
    const w = Math.max(lw, b.x * dpr - a.x * dpr);
    const h = Math.max(lw, b.y * dpr - a.y * dpr);

    ctx.fillStyle = dc.theme.marqueeFill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = dc.theme.marqueeStroke;
    ctx.lineWidth = lw;
    ctx.setLineDash([4 * lw, 3 * lw]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    restore();
  }

  /**
   * The one box. The overlay draws it and the selection query tests against it, so the shapes
   * that light up are exactly the ones under the rectangle on screen.
   *
   * Built from `p.world`, not `p.snapped`. Every other gesture snaps because it commits
   * geometry; a selection region commits none, and snapping would make the band jump a whole
   * cell at low zoom while the shapes it is meant to catch stay put.
   */
  #rect(): Rect | null {
    const band = this.#band;
    return band === null ? null : rectFromPoints(band.from, band.to);
  }

  #apply(c: ToolContext): void {
    const band = this.#band;
    const r = this.#rect();
    if (band === null || r === null) return;

    const hits = shapesInRect(c.scene.shapes, r).map((s) => s.name);
    this.#lastHits = hits;
    c.scene.setSelection(band.additive ? new Set([...band.base, ...hits]) : new Set(hits));
  }

  #cancel(c: ToolContext, restore: boolean): void {
    const band = this.#band;
    if (band === null) return;
    this.#band = null;
    this.#armed = false;
    this.#lastHits = [];
    if (restore) c.scene.setSelection(band.base);
    c.requestFrame();
  }
}

/*
  A dashed box, as one filled path: registry icons are drawn `fill="currentColor"` with no
  stroke, so the dashes have to be eight separate rectangles rather than a stroked outline.
*/
registerTool({
  id: 'select',
  label: 'Select',
  group: 'tool',
  order: 1,
  icon:
    'M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 0h2v6h-6v-2h4v-4z' +
    'M11 3h2v2h-2V3zm0 16h2v2h-2v-2zM3 11h2v2H3v-2zm16 0h2v2h-2v-2z',
  make: () => new MarqueeTool(),
});
