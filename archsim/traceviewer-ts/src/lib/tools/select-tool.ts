import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
import { anchorHitTest } from '../canvas/hit';
import { alignStroke } from '../canvas/pixel';
import { DRAG_SLOP_PX, HANDLE_SIZE_PX } from '../canvas/theme';
import type { Vec2 } from '../geom/types';
import { serializeShape } from '../props/project';
import type { PropContext } from '../props/spec';
import { opsFor } from '../scene/registry';
import { movesWith, rerouteAll } from '../scene/resolve';
import { samePoint } from '../scene/route';
import type { DrawContext, Handle, Shape, ShapeName } from '../scene/shape';
import { keys } from '../keys';
import { addsToSelection } from './pointer';
import { pressTo, registerTool } from './registry';
import type { PointerInfo, Tool, ToolContext } from './tool';

type Drag =
  | {
      readonly kind: 'move';
      readonly snapshot: readonly Shape[];
      /**
       * What this gesture translates, which is NOT the selection -- see `movesWith`. Resolved
       * once at pointer-down, against the snapshot, so every frame of the drag and the commit
       * at the end of it move the same set.
       */
      readonly ids: ReadonlySet<ShapeName>;
      readonly start: Vec2;
      readonly downScreen: Vec2;
    }
  | {
      readonly kind: 'resize';
      readonly snapshot: readonly Shape[];
      readonly name: ShapeName;
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

/**
 * Did this drag actually change anything? Key order is deterministic because it comes from the
 * kind's `props` declaration, so string equality is a sound comparison.
 *
 * The empty context is safe only because `serializeShape` skips `computed` properties, which
 * are the only ones that read it. A `fixed` or `edit` property that consulted `ctx` would need
 * a real one here.
 */
const NO_CONTEXT: PropContext = { shapes: [], index: -1 };

function fingerprint(s: Shape): string {
  return JSON.stringify(serializeShape(opsFor(s).props, s, NO_CONTEXT));
}

export class SelectTool implements Tool {
  readonly defaultCursor = 'grab';

  #drag: Drag | null = null;
  /**
   * Latches once the pointer has travelled past DRAG_SLOP_PX. Without it, the pixel or two of
   * drift in an ordinary click moves the block a whole cell -- a whole cell being several
   * screen pixels of drift when zoomed out -- and pushes a spurious entry onto the undo stack.
   */
  #armed = false;
  /**
   * The selected sub-part -- a curve's waypoint -- or null.
   *
   * On the tool, not in `SceneStore`. `selection` is part of the undo record, and a waypoint
   * cursor is not document state: undo must not restore it, and `#setSelection` is also the
   * funnel `EditorSession` hangs the global trace-selection rule off, which a sub-part is not.
   * Mirrored onto `ToolHost` through `ToolContext.setSubPart` so the status bar can read it,
   * because the fields here are plain rather than runes.
   */
  #subPart: { shape: ShapeName; index: number } | null = null;

  isGesturing(): boolean {
    return this.#drag !== null;
  }

  onActivate(c: ToolContext): void {
    c.setHint(
      `Drag to pan. Hold ${keys('shift')} to select by area, ${keys('cmd')}-click to add.` +
        pressTo('rect', 'draw a block'),
    );
  }

  onDeactivate(c: ToolContext): void {
    this.#abort(c);
  }

  onPointerDown(p: PointerInfo, c: ToolContext): void {
    if (p.button !== 0) return;

    const hit = c.hitTest(p);

    if (hit.type === 'handle') {
      const ops = opsFor(hit.shape);

      /*
        An `action` handle does its thing once, on press, and commits -- it does not wait for a
        drag. The insert-waypoint badge is the only one: clicking it has to produce a waypoint
        whether or not the pointer then moves, and the drag that may follow is an ordinary move
        of the point it just made.
      */
      if (hit.handle.role === 'action') {
        const before = c.scene.shapes;
        const next = ops.resize(hit.shape, hit.handle.id, p.snapped, p.mods);
        if (next === hit.shape) {
          c.requestFrame();
          return;
        }
        c.scene.commit('insert point', () => {
          c.scene.shapes = before.map((x) => (x.name === hit.shape.name ? next : x));
        });

        /*
          Then carry straight on into a drag of the point just made, so click-and-place is one
          gesture. The new point's own handle is found by asking the shape which sub-part each
          of its handles names and taking the one that now sits under the cursor -- rather than
          by guessing an id, which would put the `ins:N` / `way:N` grammar in this file too.
        */
        const made = c.scene.shapes.find((x) => x.name === hit.shape.name);
        if (made !== undefined) {
          const madeOps = opsFor(made);
          const knob = madeOps
            .handles(made)
            .find((h) => madeOps.subPartOf?.(made, h.id) !== null && samePoint(h.pos, p.snapped));
          if (knob !== undefined) {
            this.#setSubPart(c, {
              shape: made.name,
              index: madeOps.subPartOf?.(made, knob.id) ?? 0,
            });
            this.#drag = {
              kind: 'resize',
              snapshot: c.scene.shapes,
              name: made.name,
              handle: knob,
              downScreen: p.screen,
            };
            this.#armed = false;
          }
        }
        c.requestFrame();
        return;
      }

      // Clicking a sub-part's handle selects that sub-part. Held on the tool, not in the
      // document: it is a cursor, not something undo should restore.
      const part = ops.subPartOf?.(hit.shape, hit.handle.id) ?? null;
      this.#setSubPart(c, part === null ? null : { shape: hit.shape.name, index: part });

      this.#drag = {
        kind: 'resize',
        snapshot: c.scene.shapes,
        name: hit.shape.name,
        handle: hit.handle,
        downScreen: p.screen,
      };
      this.#armed = false;
      return;
    }

    // Any press that is not on a sub-part's handle drops the cursor.
    this.#setSubPart(c, null);

    if (hit.type === 'empty') {
      if (!addsToSelection(p.mods)) c.scene.clearSelection();
      c.startPan(p);
      return;
    }

    if (addsToSelection(p.mods)) {
      c.scene.toggleSelected(hit.shape.name);
      c.requestFrame();
      return;
    }

    // Pressing an unselected shape selects it and starts the move in the same gesture, as every
    // other editor does. Settled in iteration 1: selecting and moving are not two gestures.
    if (!c.scene.selection.has(hit.shape.name)) c.scene.selectOnly(hit.shape.name);

    this.#drag = {
      kind: 'move',
      snapshot: c.scene.shapes,
      ids: movesWith(c.scene.shapes, c.scene.selection),
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
      // Re-route inside the preview, not just on commit: `previewShapes` deliberately bypasses
      // `#resolveDependencies`, so without this every connection would trail a cell behind its
      // block for the whole drag and snap into place only on release.
      c.scene.previewShapes(
        rerouteAll(
          dx === 0 && dy === 0
            ? drag.snapshot
            : drag.snapshot.map((s) =>
                drag.ids.has(s.name) ? opsFor(s).translate(s, { x: dx, y: dy }) : s,
              ),
        ),
      );
    } else if (drag.handle.role === 'rebind') {
      const original = drag.snapshot.find((s) => s.name === drag.name);
      if (original === undefined) return;
      /*
        The drop target is resolved here rather than inside the shape, because only the tool
        can see the rest of the scene -- and it is resolved against the pristine snapshot, so
        the answer is a pure function of the pointer no matter how long the drag has run.

        `p.world`, not `p.snapped`: the perimeter decides where the anchor lands and already
        snaps the offset along the face, so snapping the cursor first would only make the
        chosen face flicker near a corner.
      */
      const hit = anchorHitTest(drag.snapshot, p.world, { worldPerPx: c.view.worldPerPx });
      const next =
        opsFor(original).rebind?.(
          original,
          drag.handle.id,
          hit === null ? null : { shape: hit.shape.name, anchor: hit.anchor },
        ) ?? original;
      c.scene.previewShapes(
        rerouteAll(drag.snapshot.map((s) => (s.name === drag.name ? next : s))),
      );
    } else {
      const original = drag.snapshot.find((s) => s.name === drag.name);
      if (original === undefined) return;
      const next = opsFor(original).resize(original, drag.handle.id, p.snapped, p.mods);
      c.scene.previewShapes(
        rerouteAll(drag.snapshot.map((s) => (s.name === drag.name ? next : s))),
      );

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

    // `drag.ids` is the move set, not the selection, so a carried connection is normalized
    // here and counted in the change test below rather than slipping through both.
    const affected = drag.kind === 'move' ? drag.ids : new Set<ShapeName>([drag.name]);
    const before = new Map(drag.snapshot.map((s) => [s.name, s]));

    // A block resized down to nothing reverts rather than disappearing; deleting on an
    // over-drag is surprising even with undo available.
    const normalized = c.scene.shapes.map((s) => {
      if (!affected.has(s.name)) return s;
      return opsFor(s).normalize(s) ?? before.get(s.name) ?? s;
    });

    const after = new Map(normalized.map((s) => [s.name, s]));
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
    c.scene.commitPreview(
      drag.kind === 'move' ? 'move' : drag.handle.role === 'rebind' ? 'reanchor' : 'resize',
      drag.snapshot,
    );
    c.requestFrame();
  }

  onPointerCancel(c: ToolContext): void {
    this.#abort(c);
  }

  /**
   * `Delete` removes the selected SUB-PART when there is one, and otherwise falls through.
   *
   * This is the whole of the waypoint-delete feature, and nothing in `ToolHost` changes for it:
   * `host.onKeyDown` gives the active tool first refusal before `#globalKey` ever sees the key,
   * which is the same seam `ConnectTool` uses to intercept undo mid-gesture. Returning `false`
   * is what lets the ordinary "delete the selected shapes" path run.
   */
  onKeyDown(e: KeyboardEvent, c: ToolContext): boolean {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const cur = this.#liveSubPart(c);
      if (cur === null) return false;
      const shape = c.scene.shapes.find((x) => x.name === cur.shape);
      if (shape === undefined) return false;
      const next = opsFor(shape).removeSubPart?.(shape, cur.index) ?? shape;
      if (next === shape) return false;
      const before = c.scene.shapes;
      c.scene.commit('delete point', () => {
        c.scene.shapes = before.map((x) => (x.name === cur.shape ? next : x));
      });
      this.#setSubPart(c, null);
      c.requestFrame();
      return true;
    }

    if (e.key !== 'Escape') return false;
    if (this.#drag !== null) {
      this.#abort(c);
      return true;
    }
    if (this.#subPart !== null) {
      this.#setSubPart(c, null);
      c.requestFrame();
      return true;
    }
    if (c.scene.selection.size > 0) {
      c.scene.clearSelection();
      c.requestFrame();
      return true;
    }
    return false;
  }

  /**
   * The cursor, re-validated on every read rather than maintained.
   *
   * Deriving beats invalidating here. The cursor dies for four unrelated reasons -- the shape
   * was deselected, several things were selected, the shape was deleted, the index stopped
   * existing after a collapse -- and checking the three conditions that actually matter at the
   * point of use covers all of them without a hook per cause. Undo and redo are the exception:
   * they swap the document wholesale with nothing to observe, so `ToolHost` clears it there.
   */
  #liveSubPart(c: ToolContext): { shape: ShapeName; index: number } | null {
    const cur = this.#subPart;
    if (cur === null) return null;
    if (c.scene.selection.size !== 1 || !c.scene.selection.has(cur.shape)) return null;
    const shape = c.scene.shapes.find((x) => x.name === cur.shape);
    if (shape === undefined) return null;
    return opsFor(shape).subPart?.(shape, cur.index) === null ? null : cur;
  }

  #setSubPart(c: ToolContext, next: { shape: ShapeName; index: number } | null): void {
    const same =
      (this.#subPart === null && next === null) ||
      (this.#subPart !== null &&
        next !== null &&
        this.#subPart.shape === next.shape &&
        this.#subPart.index === next.index);
    if (same) return;
    this.#subPart = next;
    c.setSubPart(next);
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

    const plus: { x: number; y: number }[] = [];

    for (const s of c.scene.shapes) {
      if (!selection.has(s.name)) continue;
      for (const h of opsFor(s).handles(s)) {
        if (!h.visible) continue;
        const p = dc.project(h.pos);
        if (h.glyph === 'plus') {
          // Gathered and drawn after, so the two kinds of knob are two batches rather than a
          // style change per handle.
          plus.push({ x: p.x * dpr, y: p.y * dpr });
          continue;
        }
        // Knobs are sized in screen pixels, so the grab zone feels identical at every zoom.
        const x = alignStroke(p.x * dpr - size / 2, lw);
        const y = alignStroke(p.y * dpr - size / 2, lw);
        ctx.fillRect(x, y, size, size);
        ctx.strokeRect(x, y, size, size);
      }
    }

    /*
      The insert badges, deliberately quieter and smaller than a resize knob.

      They sit on the same line as the waypoints they insert between, and drawn identically the
      two read as one row of interchangeable handles -- nothing says which you drag and which
      you click. Smaller, dimmer, and with a cross through it says "add one here".
    */
    if (plus.length > 0) {
      // Big enough that the cross inside it is legible: at 2.6 the arms came out 1.4 CSS px and
      // the handle read as a small blank square rather than as a plus.
      const r = Math.max(4, Math.round((HANDLE_SIZE_PX * dpr) / 2.2));
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (const q of plus) {
        const x = alignStroke(q.x - r, lw);
        const y = alignStroke(q.y - r, lw);
        ctx.rect(x, y, r * 2, r * 2);
      }
      ctx.fillStyle = dc.theme.handleFill;
      ctx.fill();
      ctx.strokeStyle = dc.theme.handleStroke;
      ctx.stroke();

      ctx.beginPath();
      for (const q of plus) {
        const x = alignStroke(q.x, lw);
        const y = alignStroke(q.y, lw);
        ctx.moveTo(x - r + lw, y);
        ctx.lineTo(x + r - lw, y);
        ctx.moveTo(x, y - r + lw);
        ctx.lineTo(x, y + r - lw);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
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
  id: 'pointer',
  label: 'Pointer',
  group: 'tool',
  order: 0,
  icon: MousePointer2,
  make: () => new SelectTool(),
});
