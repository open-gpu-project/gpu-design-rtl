import {
  allManagerPaneIds,
  dedupeManagerNodeIds,
  dockGroup,
  dockPane,
  dockTabs,
  type DockManagerState,
  type DockNode,
  type DockPane,
} from '@svgrid/grid';
import { allPanels, panelFor } from '../panels/registry';
import { DIAGRAM_PANEL, TRACE_PANEL, type PanelId } from '../session.svelte';

/** Bump to invalidate every saved layout after a structural change to the default. */
const STORAGE_KEY = 'archsim.traceviewer.dock.v2';

function paneFor(id: PanelId): DockPane {
  const d = panelFor(id);
  return dockPane(id, d?.title ?? id, {
    closable: d?.closable ?? true,
    ...(d?.minSize !== undefined ? { minSize: d.minSize } : {}),
  });
}

/**
 * Canvas on the left, properties on the right, trace across the bottom.
 *
 * "Docked at the bottom" is not a distinct concept in the dock model -- it is a `column` group
 * whose second child spans the full width. The trace strip therefore sits under *both* the
 * canvas and the properties panel, which is what "horizontally spanning the page" means.
 */
export function defaultWorkspace(): DockManagerState {
  return {
    main: dockGroup(
      'column',
      [
        dockGroup(
          'row',
          [dockTabs([paneFor(DIAGRAM_PANEL)]), dockTabs([paneFor('properties')])],
          [0.72, 0.28],
        ),
        dockTabs([paneFor(TRACE_PANEL)]),
      ],
      [0.66, 0.34],
    ),
    floating: [],
    autoHide: [],
  };
}

function isDockNode(v: unknown): v is DockNode {
  if (typeof v !== 'object' || v === null) return false;
  const t = (v as { type?: unknown }).type;
  return t === 'group' || t === 'tabs';
}

/**
 * Restore the saved arrangement, or fall back to the default.
 *
 * Two non-obvious requirements:
 *
 * 1. Every pane id has to resolve to a registered panel. A layout naming a panel this build no
 *    longer has would otherwise leave a permanently blank pane.
 * 2. `dedupeManagerNodeIds` is mandatory. The library mints node ids from a module-scoped
 *    counter that resets on reload, so a restored tree can collide with freshly created nodes
 *    and blow up a keyed `{#each}`.
 */
export function loadWorkspace(): DockManagerState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return defaultWorkspace(); // private mode, or storage disabled
  }
  if (raw === null) return defaultWorkspace();

  try {
    const parsed = JSON.parse(raw) as Partial<DockManagerState>;
    const state: DockManagerState = {
      main: isDockNode(parsed.main) ? parsed.main : null,
      floating: Array.isArray(parsed.floating) ? parsed.floating : [],
      autoHide: Array.isArray(parsed.autoHide) ? parsed.autoHide : [],
      ...(typeof parsed.maximizedLeaf === 'string' ? { maximizedLeaf: parsed.maximizedLeaf } : {}),
    };

    const ids = allManagerPaneIds(state);
    if (ids.length === 0) return defaultWorkspace();
    if (ids.some((id) => panelFor(id) === undefined)) return defaultWorkspace();

    return dedupeManagerNodeIds(state);
  } catch {
    return defaultWorkspace();
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced: a splitter drag fires `onChange` continuously. */
export function saveWorkspace(w: DockManagerState): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
    } catch {
      // Quota or private mode. Losing the layout is not worth breaking the app over.
    }
  }, 250);
}

export function clearWorkspace(): void {
  clearTimeout(timer);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see above */
  }
}

/** Panels that exist but are not currently anywhere in the workspace, for a "reopen" menu. */
export function missingPanels(w: DockManagerState): readonly PanelId[] {
  const present = new Set(allManagerPaneIds(w));
  return allPanels()
    .map((p) => p.id)
    .filter((id) => !present.has(id));
}
