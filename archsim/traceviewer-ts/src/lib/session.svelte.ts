import { getContext, setContext } from 'svelte';
import { Renderer } from './canvas/renderer';
import { darkTheme } from './canvas/theme';
import { ViewController } from './canvas/view.svelte';
import { computeWorldBounds } from './scene/bounds';
import {
  parseSceneDoc,
  saveFileName,
  sceneFileText,
  SCENE_FILE_ACCEPT,
  SCENE_FILE_MIME,
} from './scene/file';
import { SceneStore } from './scene/scene.svelte';
import { readDocument, serializeScene, type SceneDoc } from './scene/serialize';
import { TimelineHost } from './timeline/host.svelte';
import { TimelineRenderer } from './timeline/renderer';
import { darkTimelineTheme } from './timeline/theme';
import { TimelineView } from './timeline/view.svelte';
import { demoTrace } from './trace/fixture';
import type { SignalId, TraceDoc } from './trace/model';
import { TraceStore } from './trace/store.svelte';
import { ToolHost } from './tools/host.svelte';
import { downloadText, pickTextFile } from './ui/file-transport';

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

  /* ------------------------------------------------------------------ the file ---- */

  /**
   * The name of the last file opened, or null before any has been.
   *
   * The whole of the editor's document-name concept, and it lives here rather than on the scene
   * because it is a property of where the document came from, not of the document -- undo must
   * not restore it, and a copied fragment must not carry it.
   */
  #openedName: string | null = null;

  /**
   * Write the diagram to a file.
   *
   * Commits nothing and pushes no history entry, so it needs no `isGesturing` guard -- the same
   * argument `copySelection` makes, and for the same reason: this reads the document and hands a
   * string to the browser.
   */
  saveDocument(): void {
    const name = saveFileName(this.#openedName);
    const doc = serializeScene(this.scene.shapes);
    downloadText(name, sceneFileText(doc), SCENE_FILE_MIME);
    this.host.setHint(`Saved \u201c${name}\u201d \u2014 ${countOf(this.scene.shapes.length)}.`);
  }

  /**
   * Ask for a file and load it. Nothing happens until one is chosen.
   *
   * Must be called from inside a user gesture, because `pickTextFile` is -- see its note. The
   * promise it returns is awaited rather than fired and forgotten so that a file which is not a
   * diagram can be reported instead of silently doing nothing.
   */
  async openDocument(): Promise<void> {
    const picked = await pickTextFile(SCENE_FILE_ACCEPT);
    if (picked === null) return;
    const doc = parseSceneDoc(picked.text);
    if (doc === null) {
      /*
        Refused WITHOUT committing, which is the one thing this path must get right. Loading an
        unreadable file as an empty document would wipe the diagram the user has open because
        they picked the wrong entry in a list -- recoverable through undo, but only if they
        realise what happened, and the file they wanted is still unopened either way.
      */
      this.host.setHint(
        `Could not open \u201c${picked.name}\u201d \u2014 that is not a diagram file.`,
      );
      return;
    }
    this.loadDocument(doc, picked.name);
  }

  /**
   * Replace the whole document, as one undoable step.
   *
   * Through `scene.commit`, which is not merely convenient but the only whole-array swap path
   * there is -- and it buys three things beyond the history entry. It clears the draft, so a
   * half-drawn rect cannot outlive the document it was being drawn into. It runs
   * `#expandChildren`, so a file recording `interfaces: 2` on a fabric without its two `nif`
   * records gets them minted as part of the load rather than one commit later. And it runs
   * `#resolveDependencies`, so every wire in the file is rerouted against the geometry it
   * actually arrived with.
   *
   * Selection goes through `setSelection`, never by assignment: that is `SceneStore`'s single
   * write path and the one `onSelectionChanged` cannot be bypassed on. `clearSelection` would
   * not do, because it early-returns when the selection is already empty.
   *
   * `host.documentReplaced()` comes after the commit, and the order is required -- see its note.
   */
  loadDocument(doc: SceneDoc, from: string): void {
    const { shapes, dropped } = readDocument(doc);
    this.scene.commit('load', () => {
      this.scene.shapes = shapes;
      this.scene.setSelection(new Set());
    });
    this.#openedName = from;
    this.host.documentReplaced();
    // A partial load is still a load. Saying how much went is the only honest thing available:
    // which records went, and why, is not something `readDocument` can report without becoming
    // a validator.
    this.host.setHint(
      dropped === 0
        ? `Opened \u201c${from}\u201d \u2014 ${countOf(shapes.length)}.`
        : `Opened \u201c${from}\u201d \u2014 ${countOf(shapes.length)}, ${dropped} could not be read.`,
    );
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

  focusPanel(id: PanelId): void {
    if (this.keyboardOwner !== id) this.keyboardOwner = id;
  }
}

/** `1 object`, not `1 objects`. The status bar tolerates the ugly form; a sentence does not. */
function countOf(n: number): string {
  return `${n} object${n === 1 ? '' : 's'}`;
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
