import { hitTest, type HitResult } from '../canvas/hit';
import type { ViewController } from '../canvas/view.svelte';
import { WheelController } from '../canvas/wheel';
import type { Vec2 } from '../geom/types';
import type { SceneStore } from '../scene/scene.svelte';
import type { DrawContext, Shape, ShapeId } from '../scene/shape';
import { bringForward, bringToFront, sendBackward, sendToBack } from '../scene/zorder';
import { buildPointerInfo } from './pointer';
import { allTools, toolDescriptor } from './registry';
import type { PointerInfo, Tool, ToolContext, ToolId } from './tool';

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

type Restack = (shapes: readonly Shape[], ids: ReadonlySet<ShapeId>) => readonly Shape[];

/**
 * Translates DOM events into tool calls, and owns the two things that must work regardless of
 * which tool is active: panning and the global key bindings.
 */
export class ToolHost {
  activeToolId = $state<ToolId>('select');
  cursor = $state('grab');
  hint = $state('');
  /** Bumped when a tool's internal state changes in a way the scene signals do not cover. */
  overlayVersion = $state(0);
  /** Live cursor readout for the status bar. */
  pointer = $state.raw<{ readonly world: Vec2; readonly snapped: Vec2 } | null>(null);

  readonly wheel: WheelController;

  #instances = new Map<ToolId, Tool>();
  #tool: Tool;
  #ctx: ToolContext;
  #pan: { last: Vec2 } | null = null;
  #spaceHeld = false;
  #canvas: HTMLCanvasElement | null = null;
  #stage: HTMLElement | null = null;
  #stageRect: DOMRect = new DOMRect(0, 0, 0, 0);

  constructor(
    private readonly scene: SceneStore,
    private readonly view: ViewController,
    private readonly invalidate: () => void,
  ) {
    this.#ctx = {
      scene,
      view,
      hitTest: (p: PointerInfo): HitResult =>
        hitTest(scene, p.world, { worldPerPx: view.worldPerPx }),
      setCursor: (cursor: string) => {
        this.cursor = cursor;
      },
      setHint: (hint: string) => {
        this.hint = hint;
      },
      setTool: (id: ToolId) => this.setTool(id),
      startPan: (p: PointerInfo) => this.#startPan(p),
      requestFrame: () => this.invalidate(),
    };

    this.#tool = this.#instance(this.activeToolId);
    this.#tool.onActivate?.(this.#ctx);
    this.cursor = this.#tool.defaultCursor;

    this.wheel = new WheelController(view, () => this.invalidate());
  }

  get tool(): Tool {
    return this.#tool;
  }

  get tools() {
    return allTools();
  }

  isGesturing(): boolean {
    return this.#pan !== null || this.#tool.isGesturing();
  }

  attach(canvas: HTMLCanvasElement, stage: HTMLElement): void {
    this.#canvas = canvas;
    this.#stage = stage;
    this.refreshRect();
  }

  detach(): void {
    this.#canvas = null;
    this.#stage = null;
    this.wheel.dispose();
  }

  /** The stage rect is cached; call this whenever the element could have moved or resized. */
  refreshRect(): void {
    if (this.#stage !== null) this.#stageRect = this.#stage.getBoundingClientRect();
  }

  setTool(id: ToolId): void {
    if (id === this.activeToolId) return;
    this.#tool.onDeactivate?.(this.#ctx);
    this.activeToolId = id;
    this.#tool = this.#instance(id);
    this.#tool.onActivate?.(this.#ctx);
    this.cursor = this.#tool.defaultCursor;
    this.overlayVersion += 1;
    this.invalidate();
  }

  drawOverlay(dc: DrawContext): void {
    this.#tool.drawOverlay?.(dc, this.#ctx);
  }

  /* ------------------------------------------------------------------ pointer ---- */

  onPointerDown(e: PointerEvent): void {
    const p = this.#info(e);
    this.#canvas?.setPointerCapture(e.pointerId);

    // Middle-drag and space-drag pan in every tool, which is why panning lives here rather
    // than inside any single tool.
    if (e.button === 1 || (this.#spaceHeld && e.button === 0)) {
      e.preventDefault();
      this.#startPan(p);
      return;
    }
    this.#tool.onPointerDown?.(p, this.#ctx);
  }

  onPointerMove(e: PointerEvent): void {
    const p = this.#info(e);
    this.pointer = { world: p.world, snapped: p.snapped };

    if (this.#pan !== null) {
      this.view.pan(p.screen.x - this.#pan.last.x, p.screen.y - this.#pan.last.y);
      this.#pan = { last: p.screen };
      this.invalidate();
      return;
    }

    // While space is held the next press pans, so the tool must not advertise move or resize
    // cursors it will not honour.
    if (this.#spaceHeld && !this.#tool.isGesturing()) {
      this.cursor = 'grab';
      return;
    }
    this.#tool.onPointerMove?.(p, this.#ctx);
  }

  onPointerUp(e: PointerEvent): void {
    const p = this.#info(e);
    if (this.#canvas?.hasPointerCapture(e.pointerId) === true) {
      this.#canvas.releasePointerCapture(e.pointerId);
    }
    if (this.#pan !== null) {
      this.#endPan();
      return;
    }
    this.#tool.onPointerUp?.(p, this.#ctx);
  }

  onPointerCancel(): void {
    this.#pan = null;
    this.#tool.onPointerCancel?.(this.#ctx);
    this.cursor = this.#tool.defaultCursor;
    this.invalidate();
  }

  onPointerLeave(): void {
    this.pointer = null;
  }

  onWheel(e: WheelEvent): void {
    this.wheel.handleWheel(e, this.#screenOf(e));
  }

  onGestureStart(e: Event): void {
    this.wheel.onGestureStart(e, this.#gestureScreen(e));
  }

  onGestureChange(e: Event): void {
    this.wheel.onGestureChange(e, this.#gestureScreen(e));
  }

  onGestureEnd(e: Event): void {
    this.wheel.onGestureEnd(e);
  }

  /* ------------------------------------------------------------------ keyboard ---- */

  onKeyDown(e: KeyboardEvent): void {
    if (isEditableTarget(e.target)) return;

    if (e.code === 'Space' && !e.repeat) {
      this.#spaceHeld = true;
      if (this.#pan === null) this.cursor = 'grab';
      e.preventDefault();
      return;
    }

    if (this.#tool.onKeyDown?.(e, this.#ctx) === true) {
      e.preventDefault();
      return;
    }
    if (this.#globalKey(e)) e.preventDefault();
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.code !== 'Space') return;
    this.#spaceHeld = false;
    if (this.#pan === null) this.cursor = this.#tool.defaultCursor;
  }

  /** Alt-tabbing mid-gesture would otherwise leave a zombie ghost and a stuck capture. */
  onWindowBlur(): void {
    this.#spaceHeld = false;
    this.#pan = null;
    this.#tool.onPointerCancel?.(this.#ctx);
    this.cursor = this.#tool.defaultCursor;
    this.invalidate();
  }

  /* ------------------------------------------------------------------ commands ---- */

  undo(): void {
    if (this.isGesturing()) return;
    this.scene.undo();
    this.invalidate();
  }

  redo(): void {
    if (this.isGesturing()) return;
    this.scene.redo();
    this.invalidate();
  }

  deleteSelection(): void {
    // Mid-gesture the tool holds an uncommitted preview and a pre-drag snapshot. Committing a
    // delete underneath it would be undone by the next pointermove restoring that snapshot,
    // and the eventual pointerup would then push the resurrected shape back into history.
    if (this.isGesturing()) return;
    const ids = this.scene.selection;
    if (ids.size === 0) return;
    this.scene.commit('delete', () => {
      this.scene.shapes = this.scene.shapes.filter((s) => !ids.has(s.id));
      this.scene.setSelection(new Set());
    });
    this.invalidate();
  }

  selectAll(): void {
    this.scene.setSelection(new Set(this.scene.shapes.map((s) => s.id)));
    this.invalidate();
  }

  bringToFront(): void {
    this.#restack('bring to front', bringToFront);
  }

  sendToBack(): void {
    this.#restack('send to back', sendToBack);
  }

  bringForward(): void {
    this.#restack('bring forward', bringForward);
  }

  sendBackward(): void {
    this.#restack('send backward', sendBackward);
  }

  zoomToFit(): void {
    this.view.zoomToFit(this.scene.contentBounds);
    this.invalidate();
  }

  resetZoom(): void {
    this.view.resetZoom();
    this.invalidate();
  }

  zoomByStep(steps: number): void {
    this.view.zoomByStep(steps);
    this.invalidate();
  }

  /* ------------------------------------------------------------------ internals ---- */

  #instance(id: ToolId): Tool {
    let tool = this.#instances.get(id);
    if (tool === undefined) {
      tool = toolDescriptor(id).make();
      this.#instances.set(id, tool);
    }
    return tool;
  }

  #info(e: PointerEvent): PointerInfo {
    return buildPointerInfo(e, this.#stageRect, this.view);
  }

  #screenOf(e: MouseEvent): Vec2 {
    return { x: e.clientX - this.#stageRect.left, y: e.clientY - this.#stageRect.top };
  }

  #gestureScreen(e: Event): Vec2 {
    const g = e as Event & { clientX?: number; clientY?: number };
    if (typeof g.clientX === 'number' && typeof g.clientY === 'number') {
      return { x: g.clientX - this.#stageRect.left, y: g.clientY - this.#stageRect.top };
    }
    return this.view.viewportCenter;
  }

  #startPan(p: PointerInfo): void {
    this.#pan = { last: p.screen };
    this.cursor = 'grabbing';
    this.invalidate();
  }

  #endPan(): void {
    this.#pan = null;
    this.cursor = this.#spaceHeld ? 'grab' : this.#tool.defaultCursor;
    this.invalidate();
  }

  #restack(label: string, fn: Restack): void {
    if (this.isGesturing()) return; // same reasoning as deleteSelection
    const ids = this.scene.selection;
    if (ids.size === 0) return;
    const prev = this.scene.shapes;
    const next = fn(prev, ids);
    if (next.length === prev.length && next.every((s, i) => s === prev[i])) return;
    this.scene.commit(label, () => {
      this.scene.shapes = next;
    });
    this.invalidate();
  }

  #globalKey(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey) {
      switch (e.code) {
        case 'KeyZ':
          if (e.shiftKey) this.redo();
          else this.undo();
          return true;
        case 'KeyY':
          this.redo();
          return true;
        case 'KeyA':
          this.selectAll();
          return true;
        // e.key is '}' / '{' once shift is held, so these match on physical key.
        case 'BracketRight':
          if (e.shiftKey) this.bringForward();
          else this.bringToFront();
          return true;
        case 'BracketLeft':
          if (e.shiftKey) this.sendBackward();
          else this.sendToBack();
          return true;
        case 'Digit0':
          this.resetZoom();
          return true;
        case 'Digit1':
          this.zoomToFit();
          return true;
        default:
          return false;
      }
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        this.deleteSelection();
        return true;
      case '1':
        this.setTool('select');
        return true;
      case '2':
        this.setTool('rect');
        return true;
      default:
        return false;
    }
  }
}
