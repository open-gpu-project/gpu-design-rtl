import { hitTest, type HitResult } from '../canvas/hit';
import { HOVER_DELAY_MS, HOVER_SLOP_PX } from '../canvas/theme';
import type { ViewController } from '../canvas/view.svelte';
import { WheelController } from '../canvas/wheel';
import type { Vec2 } from '../geom/types';
import {
  cascadeDelta,
  centringDelta,
  copyFragment,
  readFragment,
  translateAll,
} from '../scene/fragment';
import { opsFor } from '../scene/registry';
import { tabMeasurer } from '../scene/shapes/rect';
import type { DrawContext, Shape, ShapeName, ShapeTooltip } from '../scene/shape';
import type { SceneStore } from '../scene/scene.svelte';
import type { SceneDoc } from '../scene/serialize';
import { bringForward, bringToFront, sendBackward, sendToBack } from '../scene/zorder';
import { buildPointerInfo } from './pointer';
import { allTools, toolDescriptor, toolForShortcut, toolGroups } from './registry';
import type { PointerInfo, Tool, ToolContext, ToolId } from './tool';

/**
 * Walks ancestors, not just the immediate target: the property editor focuses wrapper divs and
 * the caret often sits in a child of the contenteditable, so an exact-target test misses both.
 */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
  );
}

type Restack = (shapes: readonly Shape[], ids: ReadonlySet<ShapeName>) => readonly Shape[];

/** A tooltip and where on the stage to hang it. `x`/`y` are stage CSS pixels. */
export interface HoverTip extends ShapeTooltip {
  readonly shape: ShapeName;
  readonly x: number;
  readonly y: number;
}

/**
 * Translates DOM events into tool calls, and owns the two things that must work regardless of
 * which tool is active: panning and the global key bindings.
 */
export class ToolHost {
  activeToolId = $state<ToolId>('pointer');
  cursor = $state('grab');
  hint = $state('');
  /** Bumped when a tool's internal state changes in a way the scene signals do not cover. */
  overlayVersion = $state(0);
  /**
   * Bumped whenever a pointer gesture ends, however it ended.
   *
   * Anything that defers work while `isGesturing()` is true needs a signal telling it to look
   * again, and the scene alone is not that signal: a click that only changes the selection
   * starts a move-drag, is refused by the deferral, and then commits nothing -- so the waiter
   * would never wake. `isGesturing` is deliberately plain state (a filter, not a dependency),
   * which is exactly why this counter has to exist separately.
   */
  gestureVersion = $state(0);
  /**
   * Live cursor readout for the status bar, snapped to the grid.
   *
   * The snapped point and nothing else: `StatusBar` is the only reader and only ever showed
   * `snapped`, rounded. Keeping `{ world, snapped }` and comparing on `snapped` would have left
   * `world` stale between snap changes, which is a trap rather than a saving -- so the field
   * narrows rather than just de-duplicating.
   */
  pointer = $state.raw<Vec2 | null>(null);
  /**
   * The hover tooltip, or null. Written only when the dwell timer fires, never per pointermove.
   *
   * `$state.raw`, and the object is rebuilt from scratch each time, so the surface re-renders
   * exactly when the tooltip appears, moves to another shape, or goes away.
   */
  hover = $state.raw<HoverTip | null>(null);

  readonly wheel: WheelController;

  #instances = new Map<ToolId, Tool>();
  #tool: Tool;
  #ctx: ToolContext;
  #pan: { last: Vec2 } | null = null;
  #spaceHeld = false;
  #hoverTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Where the pointer was at the last move, in stage CSS pixels and in world units.
   *
   * A plain field, deliberately. The whole point of the dwell is that a move costs nothing but
   * a `clearTimeout` and two assignments: reading this through a signal would put a
   * full-document invalidation on every pointermove, which is the cost iteration 3.2 spent a
   * whole pass removing.
   */
  #hoverAt: { screen: Vec2; world: Vec2 } | null = null;
  /**
   * The clipboard: a real `SceneDoc`, so what you copy is what the file format already
   * describes. Held here rather than at module scope because the session outlives a pane
   * remount, and a plain field rather than `$state` because nothing renders from it.
   */
  #clipboard: SceneDoc | null = null;
  /** Cascade counter, so repeat pastes at one spot step apart instead of stacking. */
  #pasteStep = 0;
  #pasteAnchor: Vec2 | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #stage: HTMLElement | null = null;
  #stageRect: DOMRect = new DOMRect(0, 0, 0, 0);

  constructor(
    private readonly scene: SceneStore,
    private readonly view: ViewController,
    private readonly invalidate: () => void,
    /**
     * Whether the diagram panel currently owns the keyboard. Defaults to always, so a lone
     * canvas behaves exactly as it did before docking existed.
     */
    private readonly acceptsKeys: () => boolean = () => true,
  ) {
    this.#ctx = {
      scene,
      view,
      hitTest: (p: PointerInfo): HitResult =>
        hitTest(scene, p.world, {
          worldPerPx: view.worldPerPx,
          measure: tabMeasurer(view.ctx),
        }),
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

  /** The same tools, clustered the way the toolbar draws them. */
  get toolGroups() {
    return toolGroups();
  }

  isGesturing(): boolean {
    return this.#pan !== null || this.#tool.isGesturing();
  }

  attach(canvas: HTMLCanvasElement, stage: HTMLElement): void {
    this.#canvas = canvas;
    this.#stage = stage;
    this.refreshRect();
  }

  /** Identity-guarded for the same reason as `ViewController.detach`. */
  detach(canvas: HTMLCanvasElement): void {
    if (this.#canvas !== canvas) return;
    this.#clearHover();
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
    this.#clearHover();
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
    this.#clearHover();
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
    // Only on a real change. This is `$state.raw`, so it compares by identity and a fresh object
    // per event re-rendered the status bar on every single pointermove -- 48 full-document
    // layouts per 60 moves over the canvas, against 0 for 60 moves outside it. The readout only
    // changes when the SNAPPED point does, which is once per GRID world pixels, so most moves
    // become no-ops. Written before the pan early-return below, as it always was: the readout has
    // to keep up while dragging.
    const was = this.pointer;
    if (was === null || was.x !== p.snapped.x || was.y !== p.snapped.y) {
      this.pointer = p.snapped;
    }

    this.#armHover(p);

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
    try {
      if (this.#pan !== null) {
        this.#endPan();
        return;
      }
      this.#tool.onPointerUp?.(p, this.#ctx);
    } finally {
      // After the tool has cleared its drag, so a reader sees `isGesturing() === false`.
      this.gestureVersion += 1;
    }
  }

  onPointerCancel(): void {
    this.#clearHover();
    this.#pan = null;
    this.#tool.onPointerCancel?.(this.#ctx);
    this.cursor = this.#tool.defaultCursor;
    this.gestureVersion += 1;
    this.invalidate();
  }

  onPointerLeave(): void {
    this.pointer = null;
    this.#clearHover();
    // No `invalidate` here. The tool repaints only if it actually dropped something, which keeps
    // a pointer that merely grazes the canvas edge from costing a frame.
    this.#tool.onPointerLeave?.(this.#ctx);
  }

  onWheel(e: WheelEvent): void {
    this.#clearHover();
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
    // Three independent filters, because each one alone has a hole: `acceptsKeys` misses a panel
    // the user drives without ever focusing it, `defaultPrevented` misses keys a widget consumes
    // without preventing, and `isEditableTarget` misses the tabindex divs the JSON tree focuses.
    if (!this.acceptsKeys()) return;
    if (e.defaultPrevented) return;
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
    this.#clearHover();
    this.#spaceHeld = false;
    this.#pan = null;
    this.#tool.onPointerCancel?.(this.#ctx);
    this.cursor = this.#tool.defaultCursor;
    this.gestureVersion += 1;
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
    this.#deleteIds(this.scene.selection, 'delete');
  }

  /**
   * Put the selection on the clipboard. Commits nothing and pushes no history entry, which is
   * why it needs no `isGesturing` guard.
   *
   * A connection rides along only when both of its blocks do, so the fragment is always a
   * self-contained diagram rather than a wire dangling off something that was left behind.
   */
  copySelection(): void {
    const doc = copyFragment(this.scene.shapes, this.scene.selection);
    if (doc === null) return;
    this.#clipboard = doc;
    this.#pasteStep = 0;
    this.#pasteAnchor = null;

    // Best effort and deliberately not awaited: the in-memory doc above is the source of
    // truth, and this only makes the fragment readable outside the app. Reading the system
    // clipboard back is focus-gated and async, so paste does not depend on it.
    try {
      void navigator.clipboard?.writeText(JSON.stringify(doc, null, 2)).catch(() => {});
    } catch {
      // Throws synchronously in an insecure context. Nothing here is load-bearing.
    }
  }

  cutSelection(): void {
    if (this.isGesturing()) return;
    const ids = this.scene.selection;
    // An empty cut must not clobber a clipboard that still holds something useful.
    if (ids.size === 0) return;
    this.copySelection();
    /*
      Cut can remove more than it copied: a half-selected connection is excluded from the
      fragment, then cascade-deleted by `pruneOrphans` inside this commit. That is the right
      reading of cut -- the fragment is exactly what paste can put back -- and undo restores
      the wire either way.
    */
    this.#deleteIds(ids, 'cut');
  }

  paste(): void {
    if (this.isGesturing()) return;
    const doc = this.#clipboard;
    if (doc === null) return;

    const live = new Set(this.scene.shapes.map((s) => s.name));
    const fragment = readFragment(doc, live);
    // Appending nothing still allocates a new array, and `commit` decides whether to push
    // history on array identity -- so an empty fragment here would be a no-op undo entry.
    if (fragment.length === 0) return;

    const placed = translateAll(fragment, this.#pasteDelta(fragment));
    this.scene.commit('paste', () => {
      this.scene.shapes = [...this.scene.shapes, ...placed];
      // Through `setSelection`, so `onSelectionChanged` fires and the trace panel's selection
      // is cleared for free.
      this.scene.setSelection(new Set(placed.map((s) => s.name)));
    });
    this.invalidate();
  }

  selectAll(): void {
    this.scene.setSelection(new Set(this.scene.shapes.map((s) => s.name)));
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

  /* ---------------------------------------------------------------------- hover ---- */

  /**
   * Restart the dwell clock. Called on every pointermove, so it has to stay this cheap.
   *
   * No hit test here: the test runs once, when the clock runs out. A hover tooltip is by
   * definition about a pointer that has stopped, so testing on the moves in between would be
   * work thrown away -- at 60 Hz, all but one of it.
   *
   * An already-visible tooltip is dismissed as soon as the pointer really moves. Slop, rather
   * than any movement at all, because a tooltip that flickers away under a one-pixel tremor is
   * worse than one that lingers: reading it requires holding still, and nobody holds perfectly
   * still.
   */
  #armHover(p: PointerInfo): void {
    const showing = this.hover;
    if (showing !== null) {
      const dx = p.screen.x - showing.x;
      const dy = p.screen.y - showing.y;
      if (Math.abs(dx) > HOVER_SLOP_PX || Math.abs(dy) > HOVER_SLOP_PX) this.hover = null;
      else return;
    }

    this.#hoverAt = { screen: p.screen, world: p.world };
    if (this.#hoverTimer !== null) clearTimeout(this.#hoverTimer);
    this.#hoverTimer = setTimeout(() => {
      this.#hoverTimer = null;
      this.#showHover();
    }, HOVER_DELAY_MS);
  }

  /** The dwell expired: test once, and publish whatever is under the pointer. */
  #showHover(): void {
    const at = this.#hoverAt;
    // Mid-gesture there is a drag in flight and the pointer is busy saying where it goes, not
    // asking what it is over.
    if (at === null || this.isGesturing() || this.#spaceHeld) return;

    const hit = hitTest(this.scene, at.world, {
      worldPerPx: this.view.worldPerPx,
      measure: tabMeasurer(this.view.ctx),
    });
    if (hit.type !== 'body') return;

    const tip = opsFor(hit.shape).tooltip?.(hit.shape);
    if (tip === undefined || tip === null) return;
    if (tip.title === '' && tip.lines.length === 0) return;

    this.hover = { ...tip, shape: hit.shape.name, x: at.screen.x, y: at.screen.y };
  }

  #clearHover(): void {
    if (this.#hoverTimer !== null) {
      clearTimeout(this.#hoverTimer);
      this.#hoverTimer = null;
    }
    this.#hoverAt = null;
    if (this.hover !== null) this.hover = null;
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

  /**
   * Remove `ids` as one history entry. Shared by delete and cut, which differ only in the
   * label the undo menu shows.
   */
  #deleteIds(ids: ReadonlySet<ShapeName>, label: string): void {
    // Mid-gesture the tool holds an uncommitted preview and a pre-drag snapshot. Committing a
    // delete underneath it would be undone by the next pointermove restoring that snapshot,
    // and the eventual pointerup would then push the resurrected shape back into history.
    if (this.isGesturing()) return;
    if (ids.size === 0) return;
    this.scene.commit(label, () => {
      this.scene.shapes = this.scene.shapes.filter((s) => !ids.has(s.name));
      this.scene.setSelection(new Set());
    });
    this.invalidate();
  }

  /**
   * Where a paste lands: centred under the pointer, or a cascading grid step when there is no
   * pointer over the canvas to centre on.
   *
   * The cascade is keyed on the anchor rather than applied every time, because two pastes at
   * two different places should both land where they were asked to -- it is only a repeat
   * paste at one unmoved pointer that would otherwise stack an exact, invisible overlap.
   */
  #pasteDelta(fragment: readonly Shape[]): Vec2 {
    const at = this.pointer;
    if (at === null) {
      this.#pasteStep += 1;
      this.#pasteAnchor = null;
      return cascadeDelta(this.#pasteStep);
    }
    const same =
      this.#pasteAnchor !== null && this.#pasteAnchor.x === at.x && this.#pasteAnchor.y === at.y;
    this.#pasteStep = same ? this.#pasteStep + 1 : 0;
    this.#pasteAnchor = at;
    const d = centringDelta(fragment, at);
    const step = cascadeDelta(this.#pasteStep);
    return { x: d.x + step.x, y: d.y + step.y };
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
        case 'KeyC':
          this.copySelection();
          return true;
        case 'KeyX':
          this.cutSelection();
          return true;
        case 'KeyV':
          this.paste();
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
      default: {
        const d = toolForShortcut(e.key);
        if (d === null) return false;
        this.setTool(d.id);
        return true;
      }
    }
  }
}
