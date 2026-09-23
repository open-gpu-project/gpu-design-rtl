import { WheelController } from '../canvas/wheel';
import type { Vec2 } from '../geom/types';
import type { SignalId } from '../trace/model';
import type { TraceStore } from '../trace/store.svelte';
import { hitTest, type TraceHit } from './hit';
import type { TimelineView } from './view.svelte';

/** Widened to walk ancestors: the property tree focuses tabindex divs, not just inputs. */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
  );
}

type Drag =
  | { readonly kind: 'pan'; last: Vec2 }
  /**
   * `grabDx` is where the pointer took hold relative to the stem, in CSS px, and is held
   * constant for the drag. Zero while the grab was on the stem itself, which is every press on
   * the timescale; non-zero when the flag body was grabbed, and the body can be forty pixels
   * wide, so without this the cursor would jump to the pointer the instant it was picked up.
   */
  | { readonly kind: 'cursor'; readonly grabDx: number }
  | { readonly kind: 'gutter'; readonly startX: number; readonly startW: number };

/**
 * Pointer, wheel and keyboard plumbing for the trace panel.
 *
 * A slimmed `ToolHost` rather than a reuse of it. `ToolContext` is typed to `SceneStore` and
 * `HitResult`, and the tool registry is global -- a timeline tool registered there would appear
 * in the *diagram's* toolbar, because `Toolbar.svelte` renders `host.tools` unconditionally.
 * The panel has one mode anyway, so the registry buys nothing here.
 *
 * What is carried over verbatim is the plumbing that iterations 1 and 2 found the hard way: the
 * cached stage rect (never `offsetX`), the identity-guarded detach, `isGesturing()` plus a
 * `gestureVersion` wake-up counter, and the three independent keyboard filters.
 */
export class TimelineHost {
  cursor = $state('default');

  /**
   * Bumped whenever a gesture ends, however it ends.
   *
   * Anything that defers work while `isGesturing()` needs this: a click that never moves
   * commits nothing, so no other signal is guaranteed to arrive (iter-2 defect 1).
   */
  gestureVersion = $state(0);

  #drag: Drag | null = null;
  #spaceHeld = false;
  #canvas: HTMLCanvasElement | null = null;
  #stage: HTMLElement | null = null;
  #stageRect: DOMRect = new DOMRect(0, 0, 0, 0);
  #wheel: WheelController;

  constructor(
    private readonly view: TimelineView,
    private readonly store: TraceStore,
    private readonly requestFrame: () => void,
    private readonly acceptsKeys: () => boolean,
    /** Routed through `EditorSession`, which is the only thing that can see both selections. */
    private readonly selectSignal: (id: SignalId | null) => void,
  ) {
    // A plain wheel scrolls rows here rather than zooming: this panel can hold hundreds of
    // rows, and pinch / Ctrl+wheel / Cmd+wheel still zoom.
    this.#wheel = new WheelController(this.view, () => this.requestFrame(), {
      wheelMeansZoom: false,
    });
  }

  attach(canvas: HTMLCanvasElement, stage: HTMLElement): void {
    this.#canvas = canvas;
    this.#stage = stage;
    this.refreshRect();
  }

  /** Identity-guarded: the dock may mount the new pane before unmounting the old one. */
  detach(canvas: HTMLCanvasElement): void {
    if (this.#canvas !== canvas) return;
    this.#canvas = null;
    this.#stage = null;
    this.#wheel.dispose();
  }

  refreshRect(): void {
    if (this.#stage !== null) this.#stageRect = this.#stage.getBoundingClientRect();
  }

  isGesturing(): boolean {
    return this.#drag !== null;
  }

  #at(e: PointerEvent | MouseEvent): Vec2 {
    return { x: e.clientX - this.#stageRect.left, y: e.clientY - this.#stageRect.top };
  }

  #hit(p: Vec2): TraceHit {
    return hitTest(this.view, this.store, p.x, p.y);
  }

  /* --------------------------------------------------------------- pointer ---- */

  onPointerDown(e: PointerEvent): void {
    const p = this.#at(e);
    this.#canvas?.setPointerCapture(e.pointerId);

    // Middle-drag and space-drag pan, as on the diagram canvas.
    if (e.button === 1 || (this.#spaceHeld && e.button === 0)) {
      e.preventDefault();
      this.#drag = { kind: 'pan', last: p };
      this.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    const hit = this.#hit(p);
    switch (hit.type) {
      case 'gutter-edge':
        this.#drag = { kind: 'gutter', startX: p.x, startW: this.view.gutterW };
        this.cursor = 'col-resize';
        break;
      case 'cursor':
        this.#drag = { kind: 'cursor', grabDx: p.x - this.view.toX(this.store.cursorTick) };
        this.cursor = 'ew-resize';
        break;
      case 'timescale':
        // The cursor has just been moved under the pointer, so there is no offset to hold.
        this.store.setCursor(hit.tick);
        this.#drag = { kind: 'cursor', grabDx: 0 };
        this.cursor = 'ew-resize';
        break;
      case 'flag':
        // Selecting a flag is exactly "select its row, put the cursor on it". The event
        // selection is derived from those two, so there is nothing else to set.
        this.selectSignal(hit.signal);
        this.store.setCursor(hit.tick);
        break;
      case 'row':
        this.selectSignal(hit.signal);
        break;
      case 'empty':
        this.selectSignal(null);
        break;
    }
    this.requestFrame();
  }

  onPointerMove(e: PointerEvent): void {
    const p = this.#at(e);
    const drag = this.#drag;

    if (drag !== null) {
      switch (drag.kind) {
        case 'pan':
          this.view.pan(p.x - drag.last.x, p.y - drag.last.y);
          drag.last = p;
          break;
        case 'cursor':
          this.store.setCursor(this.view.toTick(p.x - drag.grabDx));
          break;
        case 'gutter':
          this.view.setGutterW(drag.startW + (p.x - drag.startX));
          break;
      }
      this.requestFrame();
      return;
    }

    if (this.#spaceHeld) {
      this.cursor = 'grab';
      return;
    }
    const hit = this.#hit(p);
    this.cursor =
      hit.type === 'gutter-edge'
        ? 'col-resize'
        : hit.type === 'cursor'
          ? 'ew-resize'
          : hit.type === 'flag' || hit.type === 'timescale' || hit.type === 'row'
            ? 'pointer'
            : 'default';
  }

  onPointerUp(e: PointerEvent): void {
    if (this.#canvas?.hasPointerCapture(e.pointerId) === true) {
      this.#canvas.releasePointerCapture(e.pointerId);
    }
    this.#endDrag();
  }

  onPointerCancel(): void {
    this.#endDrag();
  }

  onPointerLeave(): void {
    if (this.#drag === null) this.cursor = 'default';
  }

  #endDrag(): void {
    if (this.#drag === null) return;
    this.#drag = null;
    this.cursor = this.#spaceHeld ? 'grab' : 'default';
    this.gestureVersion += 1;
    this.requestFrame();
  }

  /* ----------------------------------------------------------------- wheel ---- */

  onWheel(e: WheelEvent): void {
    this.#wheel.handleWheel(e, this.#at(e));
  }

  onGestureStart(e: Event): void {
    this.#wheel.onGestureStart(e, this.#gestureAt(e));
  }

  onGestureChange(e: Event): void {
    this.#wheel.onGestureChange(e, this.#gestureAt(e));
  }

  onGestureEnd(e: Event): void {
    this.#wheel.onGestureEnd(e);
  }

  #gestureAt(e: Event): Vec2 {
    const g = e as Event & { clientX?: number; clientY?: number };
    if (typeof g.clientX === 'number' && typeof g.clientY === 'number') {
      return { x: g.clientX - this.#stageRect.left, y: g.clientY - this.#stageRect.top };
    }
    return { x: this.view.laneX + this.view.laneW / 2, y: this.view.laneTop };
  }

  /* -------------------------------------------------------------- keyboard ---- */

  /**
   * Three independent filters, because each alone has a hole: `acceptsKeys` misses a panel the
   * user drives without focusing, `defaultPrevented` misses keys a widget consumes without
   * preventing, and `isEditableTarget` misses tabindex divs. The current-tick input is exactly
   * the case the third one catches -- typing a tick must not also step the cursor.
   */
  onKeyDown(e: KeyboardEvent): void {
    if (!this.acceptsKeys()) return;
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target)) return;

    const store = this.store;
    let moved = false;

    switch (e.key) {
      case ' ':
        this.#spaceHeld = true;
        if (this.#drag === null) this.cursor = 'grab';
        e.preventDefault();
        return;
      case 'ArrowRight':
        if (e.shiftKey) store.setCursor(store.cursorTick + 1);
        else store.nextEvent();
        moved = true;
        break;
      case 'ArrowLeft':
        if (e.shiftKey) store.setCursor(store.cursorTick - 1);
        else store.prevEvent();
        moved = true;
        break;
      case 'Home':
        store.firstEvent();
        moved = true;
        break;
      case 'End':
        store.lastEvent();
        moved = true;
        break;
      case 'Escape':
        this.selectSignal(null);
        break;
      default:
        if (e.key === '1' && (e.metaKey || e.ctrlKey)) this.view.zoomToFit();
        else if (e.key === '=' || e.key === '+') this.view.zoomByStep(1);
        else if (e.key === '-') this.view.zoomByStep(-1);
        else return;
        break;
    }

    e.preventDefault();
    if (moved) this.view.revealTick(store.cursorTick);
    this.requestFrame();
  }

  /**
   * Deliberately ungated, like `ToolHost`'s. A Space-keyup arriving while another panel has
   * focus would otherwise latch `#spaceHeld` forever.
   */
  onKeyUp(e: KeyboardEvent): void {
    if (e.key !== ' ') return;
    this.#spaceHeld = false;
    if (this.#drag === null) this.cursor = 'default';
  }

  onWindowBlur(): void {
    this.#spaceHeld = false;
    if (this.#drag !== null) {
      this.#drag = null;
      this.gestureVersion += 1;
    }
    this.cursor = 'default';
  }
}
