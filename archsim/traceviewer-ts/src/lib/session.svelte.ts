import { getContext, setContext } from 'svelte';
import { Renderer } from './canvas/renderer';
import { darkTheme } from './canvas/theme';
import { ViewController } from './canvas/view.svelte';
import { computeWorldBounds } from './scene/bounds';
import { SceneStore } from './scene/scene.svelte';
import type { ShapeName } from './scene/shape';
import { TimelineHost } from './timeline/host.svelte';
import { TimelineRenderer } from './timeline/renderer';
import { darkTimelineTheme } from './timeline/theme';
import { TimelineView } from './timeline/view.svelte';
import { demoTrace } from './trace/fixture';
import { entityPath, type SignalId, type TraceDoc } from './trace/model';
import { TraceStore } from './trace/store.svelte';
import { ToolHost } from './tools/host.svelte';

/** Matches the `id` of a registered panel and of the `DockPane` that hosts it. */
export type PanelId = string;

/** The canvas panel. Keyboard ownership starts here so tool shortcuts work before any click. */
export const DIAGRAM_PANEL: PanelId = 'diagram';

/** The trace panel. Owns the keyboard while focused, so its arrow keys do not reach the canvas. */
export const TRACE_PANEL: PanelId = 'trace';

/**
 * Everything that must outlive any one panel.
 *
 * In iteration 1 `DiagramView.svelte` constructed all four of these in its own component body,
 * which was fine while it owned the window. It no longer does: a docked pane is remounted when
 * it is maximized, floated, or popped out -- and, without `keepAlive`, on every tab switch. The
 * document cannot live inside something that disposable.
 */
export class EditorSession {
  readonly scene = new SceneStore();
  readonly view = new ViewController();
  readonly host: ToolHost;
  readonly renderer: Renderer;

  readonly trace = new TraceStore();
  readonly timeline = new TimelineView();
  readonly timelineHost: TimelineHost;
  readonly timelineRenderer: TimelineRenderer;

  /**
   * Which panel the keyboard belongs to. `ToolHost` refuses keys unless this is the diagram, so
   * Delete in the property editor removes a JSON node instead of a block. Tree mode calls
   * `preventDefault` on Delete/Ctrl+A but never `stopPropagation`, so a window-level listener
   * would otherwise fire for both.
   */
  keyboardOwner = $state<PanelId>(DIAGRAM_PANEL);

  constructor() {
    // `renderer` is only read from inside these closures, which run well after both are built.
    this.host = new ToolHost(
      this.scene,
      this.view,
      () => this.renderer.requestFrame(),
      () => this.keyboardOwner === DIAGRAM_PANEL,
    );
    this.renderer = new Renderer(this.view, darkTheme, () => ({
      shapes: this.scene.shapes,
      selection: this.scene.selection,
      draft: this.scene.draft,
      overlay: (dc) => this.host.drawOverlay(dc),
    }));

    this.timelineHost = new TimelineHost(
      this.timeline,
      this.trace,
      () => this.timelineRenderer.requestFrame(),
      () => this.keyboardOwner === TRACE_PANEL,
      (id) => this.selectSignal(id),
    );
    this.timelineRenderer = new TimelineRenderer(this.timeline, darkTimelineTheme, () => ({
      doc: this.trace.doc,
      rows: this.trace.rows,
      cursorTick: this.trace.cursorTick,
      selectedSignal: this.trace.selectedSignal,
      selectedEvent: this.trace.selectedEvent,
    }));

    // Synchronous, not an `$effect`: an effect would let the browser paint one frame with the
    // world already changed but the camera not yet re-clamped.
    this.scene.onCommit = () => {
      this.view.setWorld(computeWorldBounds(this.scene.contentBounds));
    };

    // Half of the global selection rule. The other half is `selectSignal`.
    //
    // Guarded on the selection becoming NON-empty, which is what makes the two halves
    // compose: `selectSignal` clears the scene, that fires this, and an unguarded body would
    // immediately undo the trace selection that triggered it.
    this.scene.onSelectionChanged = () => {
      if (this.scene.selection.size > 0) this.trace.selectedSignal = null;
    };

    // No reader on this branch yet -- `framework-cpp` lives on `kevin/archsim-v2`. See
    // `trace/fixture.ts`.
    this.loadTrace(demoTrace());
  }

  loadTrace(doc: TraceDoc): void {
    this.trace.load(doc);
    this.timeline.setContent(this.trace.rows.length, doc.lastTick);
  }

  /* --------------------------------------------------------- global selection ---- */

  /**
   * Select a trace row, or clear the trace selection.
   *
   * Selection is global: a row and a block are never selected at once, so this clears the
   * scene. The reverse direction is `scene.onSelectionChanged`, wired above.
   *
   * The selected *flag* is not set here. It is derived from this row plus the cursor tick, so
   * "clicking a flag selects it" and "moving the cursor onto a flag selects it" are the same
   * code path rather than two that can disagree.
   */
  selectSignal(id: SignalId | null): void {
    this.trace.selectedSignal = id;
    if (id !== null) this.scene.clearSelection();
  }

  clearSelection(): void {
    this.trace.selectedSignal = null;
    this.scene.clearSelection();
  }

  /**
   * The seam for "selecting a trace selects the block it belongs to".
   *
   * A signal name is a fully-qualified entity path (`top.xu_0.primary_bus`) and a shape's
   * identity is its `name`, so the join is a lookup on the path minus its last segment. It is
   * deliberately **not** wired up yet: doing it properly needs the diagram to actually contain
   * blocks named after entities, which is a separate piece of work.
   *
   * When it is wired up, note that it is not mutual exclusion -- one click would populate both
   * selections -- so it belongs here rather than inside `selectSignal`.
   */
  signalToShape(signalName: string): ShapeName | null {
    const path = entityPath(signalName);
    if (path === '') return null;
    return this.scene.shapes.find((s) => s.name === path)?.name ?? null;
  }

  focusPanel(id: PanelId): void {
    if (this.keyboardOwner !== id) this.keyboardOwner = id;
  }
}

const SESSION = Symbol('archsim.session');

export function provideSession(s: EditorSession): void {
  setContext(SESSION, s);
}

/**
 * Context inherits along the instantiation chain, so this reaches a panel through the dock
 * library's own components (SvDockManager -> SvDockLayout -> DockNodeView -> PanelHost).
 */
export function useSession(): EditorSession {
  const s = getContext<EditorSession | undefined>(SESSION);
  if (s === undefined) throw new Error('EditorSession missing: panel rendered outside <App>');
  return s;
}
