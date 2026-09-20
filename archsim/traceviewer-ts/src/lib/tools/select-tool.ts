import { alignStroke } from '../canvas/pixel';
import { DRAG_SLOP_PX, HANDLE_SIZE_PX, SELECT_ON_PRESS_BEGINS_MOVE } from '../canvas/theme';
import type { Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import type { DrawContext, Handle, Shape, ShapeId } from '../scene/shape';
import { registerTool } from './registry';
import type { PointerInfo, Tool, ToolContext } from './tool';

type Drag =
  | {
      readonly kind: 'move';
      readonly snapshot: readonly Shape[];
      readonly ids: ReadonlySet<ShapeId>;
      readonly start: Vec2;
      readonly downScreen: Vec2;
    }
  | {
      readonly kind: 'resize';
      readonly snapshot: readonly Shape[];
      readonly id: ShapeId;
      readonly handle: Handle;
      readonly downScreen: Vec2;
    };

const CORNER_CURSOR: Record<string, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
};

/**
 * Dragging an edge past its opposite is allowed, so the handle under the cursor may no longer
 * be the corner it started as. Only the cursor needs to know -- the resize math keeps working
 * off the pristine snapshot either way.
 */
function flippedCursor(handle: Handle, flipX: boolean, flipY: boolean): string {
  const id = String(handle.id);
  if (id.length !== 2) return handle.cursor; // edge handles: ns/ew are flip-invariant
  const v = flipY ? (id[0] === 'n' ? 's' : 'n') : id[0]!;
  const h = flipX ? (id[1] === 'w' ? 'e' : 'w') : id[1]!;
  return CORNER_CURSOR[v + h] ?? handle.cursor;
}

function fingerprint(s: Shape): string {
  return JSON.stringify(opsFor(s).serialize(s));
}

export class SelectTool implements Tool {
  readonly id = 'select';
  readonly label = 'Select';
  readonly defaultCursor = 'grab';

  #drag: Drag | null = null;
  /**
   * Latches once the pointer has travelled past DRAG_SLOP_PX. Without it, the pixel or two of
   * drift in an ordinary click moves the block a whole cell -- a whole cell being several
   * screen pixels of drift when zoomed out -- and pushes a spurious entry onto the undo stack.
   */
  #armed = false;

  isGesturing(): boolean {
    return this.#drag !== null;
  }

  onActivate(c: ToolContext): void {
    c.setHint('Drag to pan. Press 2 to draw a block.');
  }

  onDeactivate(c: ToolContext): void {
    this.#abort(c);
  }

  onPointerDown(p: PointerInfo, c: ToolContext): void {
    if (p.button !== 0) return;
    const hit = c.hitTest(p);

    if (hit.type === 'handle') {
      this.#drag = {
        kind: 'resize',
        snapshot: c.scene.shapes,
        id: hit.shape.id,
        handle: hit.handle,
        downScreen: p.screen,
      };
      this.#armed = false;
      return;
    }

    if (hit.type === 'empty') {
      if (!p.mods.shift) c.scene.clearSelection();
      c.startPan(p);
      return;
    }

    if (p.mods.shift) {
      c.scene.toggleSelected(hit.shape.id);
      c.requestFrame();
      return;
    }

    if (!c.scene.selection.has(hit.shape.id)) {
      c.scene.selectOnly(hit.shape.id);
      // The alternative reading of "click and grab to move, as long as an object isn't
      // selected" is that selecting and moving must be two separate gestures.
      if (!SELECT_ON_PRESS_BEGINS_MOVE) {
        c.requestFrame();
        return;
      }
    }

    this.#drag = {
      kind: 'move',
      snapshot: c.scene.shapes,
      ids: c.scene.selection,
      start: p.snapped,
      downScreen: p.screen,
    };
    this.#armed = false;
    c.setCursor('move');
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    const drag = this.#drag;
    if (drag === null) {
      const hit = c.hitTest(p);
      c.setCursor(
        hit.type === 'handle'
          ? hit.handle.cursor
          : hit.type === 'body'
            ? 'move'
            : this.defaultCursor,
      );
      return;
    }

    if (!this.#armed) {
      if (
        Math.hypot(p.screen.x - drag.downScreen.x, p.screen.y - drag.downScreen.y) < DRAG_SLOP_PX
      ) {
        return;
      }
      this.#armed = true;
    }

    // Always recompute from the original snapshot. Applying each move incrementally
    // accumulates snap error and the shape drifts away from the cursor.
    if (drag.kind === 'move') {
      const dx = p.snapped.x - drag.start.x;
      const dy = p.snapped.y - drag.start.y;
      c.scene.previewShapes(
        dx === 0 && dy === 0
          ? drag.snapshot
          : drag.snapshot.map((s) =>
              drag.ids.has(s.id) ? opsFor(s).translate(s, { x: dx, y: dy }) : s,
            ),
      );
    } else {
      const original = drag.snapshot.find((s) => s.id === drag.id);
      if (original === undefined) return;
      const next = opsFor(original).resize(original, drag.handle.id, p.snapped, p.mods);
      c.scene.previewShapes(drag.snapshot.map((s) => (s.id === drag.id ? next : s)));

      // After a flip the pinned edge becomes the opposite side of the box, which is something
      // bounds alone can report -- no need for any shape-kind specific sign checks.
      const ob = opsFor(original).bounds(original);
      const nb = opsFor(next).bounds(next);
      const id = String(drag.handle.id);
      const flipX = id.includes('e')
        ? nb.x + nb.w <= ob.x
        : id.includes('w')
          ? nb.x >= ob.x + ob.w
          : false;
      const flipY = id.includes('s')
        ? nb.y + nb.h <= ob.y
        : id.includes('n')
          ? nb.y >= ob.y + ob.h
          : false;
      c.setCursor(flippedCursor(drag.handle, flipX, flipY));
    }
    c.requestFrame();
  }

  onPointerUp(_p: PointerInfo, c: ToolContext): void {
    const drag = this.#drag;
    if (drag === null) return;
    this.#drag = null;

    const affected = drag.kind === 'move' ? drag.ids : new Set<ShapeId>([drag.id]);
    const before = new Map(drag.snapshot.map((s) => [s.id, s]));

    // A block resized down to nothing reverts rather than disappearing; deleting on an
    // over-drag is surprising even with undo available.
    const normalized = c.scene.shapes.map((s) => {
      if (!affected.has(s.id)) return s;
      return opsFor(s).normalize(s) ?? before.get(s.id) ?? s;
    });

    const after = new Map(normalized.map((s) => [s.id, s]));
    const changed = [...affected].some((id) => {
      const a = before.get(id);
      const b = after.get(id);
      return a === undefined || b === undefined || fingerprint(a) !== fingerprint(b);
    });

    if (!changed) {
      c.scene.previewShapes(drag.snapshot);
      c.requestFrame();
      return;
    }

    c.scene.previewShapes(normalized);
    c.scene.commitPreview(drag.kind === 'move' ? 'move' : 'resize', drag.snapshot);
    c.requestFrame();
  }

  onPointerCancel(c: ToolContext): void {
    this.#abort(c);
  }

  onKeyDown(e: KeyboardEvent, c: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    if (this.#drag !== null) {
      this.#abort(c);
      return true;
    }
    if (c.scene.selection.size > 0) {
      c.scene.clearSelection();
      c.requestFrame();
      return true;
    }
    return false;
  }

  drawOverlay(dc: DrawContext, c: ToolContext): void {
    const selection = c.scene.selection;
    if (selection.size === 0) return;

    const restore = dc.toDeviceSpace();
    const { ctx, dpr } = dc;
    const size = Math.max(4, Math.round(HANDLE_SIZE_PX * dpr));
    const lw = Math.max(1, Math.round(dpr));
    ctx.fillStyle = dc.theme.handleFill;
    ctx.strokeStyle = dc.theme.handleStroke;
    ctx.lineWidth = lw;

    for (const s of c.scene.shapes) {
      if (!selection.has(s.id)) continue;
      for (const h of opsFor(s).handles(s)) {
        if (!h.visible) continue;
        const p = dc.project(h.pos);
        // Knobs are sized in screen pixels, so the grab zone feels identical at every zoom.
        const x = alignStroke(p.x * dpr - size / 2, lw);
        const y = alignStroke(p.y * dpr - size / 2, lw);
        ctx.fillRect(x, y, size, size);
        ctx.strokeRect(x, y, size, size);
      }
    }
    restore();
  }

  #abort(c: ToolContext): void {
    const drag = this.#drag;
    if (drag === null) return;
    this.#drag = null;
    c.scene.previewShapes(drag.snapshot);
    c.setCursor(this.defaultCursor);
    c.requestFrame();
  }
}

registerTool({
  id: 'select',
  label: 'Select',
  shortcut: '1',
  icon: 'M5 3l14 8-6 1.5L10.5 19z',
  make: () => new SelectTool(),
});
