<script lang="ts">
  import ChromeTooltip from './components/ChromeTooltip.svelte';
  import WorkspaceShell from './components/WorkspaceShell.svelte';
  import {
    DotGrid,
    getGridMode,
    getGridTiers,
    setGridMode,
    setGridTiers,
    type GridMode,
    type GridTiers,
  } from './lib/canvas/grid-renderer';
  import { darkTheme } from './lib/canvas/theme';
  import { keys } from './lib/keys';
  import { clearWorkspace } from './lib/dock/layout';
  import type { Vec2 } from './lib/geom/types';
  import { opsFor } from './lib/scene/registry';
  import {
    collapseRoute,
    CorridorIndex,
    isRectilinear,
    moveSegment,
    NO_CORRIDORS,
    patchEnd,
    patchStart,
    ROUTE_MAX_SEGMENTS,
    routeConnection,
  } from './lib/scene/route';
  import { shapesInRect } from './lib/scene/bounds';
  import { arrowBox } from './lib/scene/shapes/conn';
  import { fitInsetLine, insetType } from './lib/scene/shapes/rect';
  import { copyFragment, dependencyOrder, readFragment, translateAll } from './lib/scene/fragment';
  import { nextFreeIndexedName, uniqueName } from './lib/scene/names';
  import { serializeScene } from './lib/scene/serialize';
  import type { Shape } from './lib/scene/shape';
  import { EditorSession, provideSession } from './lib/session.svelte';
  import { tickTiers } from './lib/timeline/ticks';
  import { toolTipText } from './lib/tools/registry';

  // Constructed here, not in the canvas panel: a docked pane is remounted when it is maximized,
  // floated, or popped out, and the document must not be able to die with it.
  const session = new EditorSession();
  provideSession(session);

  /*
    Iteration 3.2 measurement scaffolding, and deliberately NOT inside the DEV block below: the
    grid defect lives in Safari's GPU process, the sweep that measures it has to run against the
    build that ships, and gating the switch behind a different build mode than the one under test
    is the class of mistake both triage reports kept catching. Call with no argument to read the
    mode, with one to set it and repaint. Comes out when 3.2 picks a winner.
  */
  Object.assign(window, {
    __gridMode: (mode?: GridMode): GridMode => {
      if (mode !== undefined) {
        setGridMode(mode);
        session.renderer.requestFrame();
      }
      return getGridMode();
    },
    __gridTiers: (tiers?: GridTiers): GridTiers => {
      if (tiers !== undefined) {
        setGridTiers(tiers);
        session.renderer.requestFrame();
      }
      return getGridTiers();
    },
  });

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __session: session,
      __scene: session.scene,
      __view: session.view,
      __host: session.host,
      __trace: session.trace,
      __timeline: session.timeline,
      __timelineHost: session.timelineHost,
      // Pure, and the one part of the timeline a browser check cannot reach through the DOM.
      __tickTiers: tickTiers,
      /*
        The grid as a pure function of a context it is handed, so a browser check can render each
        `GridMode` into its own canvas and diff them against each other.

        Reading back from the live canvas instead would not do: it is created
        `{ desynchronized: true }`, and low-latency canvases have a history of returning unflushed
        or front-buffer content. A pixel diff is the entire justification for changing this code,
        so the diff needs a surface it controls.
      */
      __grid: {
        theme: darkTheme,
        /** A fresh grid per call, so each render starts from a COLD strip cache -- the worst case. */
        draw: (
          ctx: CanvasRenderingContext2D,
          camX: number,
          camY: number,
          z: number,
          dpr: number,
          theme = darkTheme,
        ): void => new DotGrid().draw(ctx, camX, camY, z, dpr, theme),
        /** For checks that need to hold one across renders, i.e. that test cache HITS. */
        DotGrid,
      },
      /*
        The router as a pure function, for the same reason as `__grid`: routing is the part of
        connections most likely to be subtly wrong in a way a screenshot will not show, and a
        browser check can drive it with no compositor and no pointer in the loop.
      */
      __route: {
        routeConnection,
        collapseRoute,
        isRectilinear,
        moveSegment,
        patchStart,
        patchEnd,
        CorridorIndex,
        NO_CORRIDORS,
        ROUTE_MAX_SEGMENTS,
      },
      __anchor: {
        anchorAt: (s: Shape, p: Vec2, worldPerPx: number) =>
          opsFor(s).anchorAt?.(s, p, { worldPerPx }) ?? null,
        resolveAnchor: (s: Shape, id: string) => opsFor(s).resolveAnchor?.(s, id) ?? null,
      },
      /*
        A shape's handles, by name. Reached through the session rather than by importing the
        registry, because a check that imports `registry.ts` by URL gets a second, empty copy
        of it the moment Vite has invalidated the app's own import of the same file.

        Worth exposing at all because the ORDER of this list is load-bearing: `hitTest` takes
        the first handle it matches, which is what puts an end bead ahead of the segment
        leaving it.
      */
      __handles: (name: string) => {
        const s = session.scene.shapes.find((x) => x.name === name);
        return s === undefined ? null : opsFor(s).handles(s);
      },
      /*
        The clipboard's pure half. `readFragment` is the part a browser check must be able to
        drive against a hand-built document: the rename rules it implements are invisible on
        screen right up until a pasted wire is attached to the wrong block.
      */
      __fragment: { copyFragment, readFragment, dependencyOrder, translateAll },
      /** The two naming rules, so the series behaviour can be asserted without a scene. */
      __names: { nextFreeIndexedName, uniqueName },
      /** What the marquee's band catches, as a pure function of a rectangle. */
      __bounds: { shapesInRect },
      /*
        How a block's inset type shrinks with the block.

        A pure function of one on-screen length, so the height budget -- where the subtitle
        goes, where the label goes, that neither ever grows past full size -- is arithmetic to
        check rather than a dozen zoom levels of lit pixels to count.
      */
      __insetType: insetType,
      /*
        The width half of the same decision, which `__insetType` deliberately knows nothing of.

        Not pure -- it needs a canvas to measure against -- which is exactly why it is exposed:
        the property the fix exists for, that a drawn line is never wider than its budget and so
        is never condensed, can only be asserted with a real font in hand. It leaves the font it
        chose installed on the context it was handed, so a check can measure its result straight
        afterwards and know it is measuring the size that would be drawn.
      */
      __insetFit: fitInsetLine,
      /*
        Where an arrowhead sits, for the purpose of deciding whether it fits.

        Pure, so the discount that keeps a tip resting on its own target from reading as an
        overlap can be pinned exactly, rather than inferred from which pixels went missing.
      */
      __arrowBox: arrowBox,
      /*
        The toolbar's tooltip text, as a pure function.

        Exposed because the case worth asserting -- a tool registered with no shortcut, which
        must read `Pan` and not `Pan ()` -- cannot be reached through the toolbar without
        registering a stub tool into the live registry and leaving it there.
      */
      __toolTipText: toolTipText,
      /*
        The shortcut formatter, as a pure function.

        Exposed for the one property the toolbar cannot exercise: every hint there is already
        written in canonical order, so only a direct call can prove that an out-of-order one
        sorts to the same string rather than rendering ⌘⇧Z.
      */
      __keys: keys,
      __dump: () => serializeScene(session.scene.shapes),
      __resetLayout: () => {
        clearWorkspace();
        location.reload();
      },
    });
  }
</script>

<main class="h-full w-full">
  <WorkspaceShell />
  <!-- Outside every pane on purpose; see the note in the component for what goes wrong inside one. -->
  <ChromeTooltip />
</main>
