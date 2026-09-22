<script lang="ts">
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
  import { serializeScene } from './lib/scene/serialize';
  import type { Shape } from './lib/scene/shape';
  import { EditorSession, provideSession } from './lib/session.svelte';
  import { tickTiers } from './lib/timeline/ticks';

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
</main>
