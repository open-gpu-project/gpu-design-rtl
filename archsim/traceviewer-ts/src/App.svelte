<script lang="ts">
  import ChromeTooltip from './components/ChromeTooltip.svelte';
  import WorkspaceShell from './components/WorkspaceShell.svelte';
  import { DotGrid } from './lib/canvas/grid-renderer';
  import { cachedTextWidth, clearTextCache, textCacheSize } from './lib/canvas/text';
  import { darkTheme } from './lib/canvas/theme';
  import { keys } from './lib/keys';
  import { clearWorkspace } from './lib/dock/layout';
  import { parseSceneDoc, saveFileName } from './lib/scene/file';
  import type { Vec2 } from './lib/geom/types';
  import { opsFor, opsForKind } from './lib/scene/registry';
  import {
    collapseRoute,
    CorridorIndex,
    isRectilinear,
    moveSegment,
    NO_CORRIDORS,
    patchStart,
    ROUTE_MAX_SEGMENTS,
    routeConnection,
  } from './lib/scene/route';
  import { shapesInRect } from './lib/scene/bounds';
  import { outlineOf, outlineRows } from './lib/scene/outline';
  import { movesWith, rerouteAll } from './lib/scene/resolve';
  import {
    autoWaypoints,
    collapseCurve,
    curveAt,
    curveEndDirection,
    flattenCurve,
  } from './lib/scene/curve';
  import { makeFifo } from './lib/scene/shapes/fifo';
  import {
    fitInsetLine,
    fitInsetLines,
    insetBaselines,
    insetType,
    subtitleLines,
  } from './lib/scene/shapes/heading';
  import { copyFragment, readFragment } from './lib/scene/fragment';
  import { nextFreeIndexedName } from './lib/scene/names';
  import { deserializeScene, readDocument, serializeScene } from './lib/scene/serialize';
  import type { Shape } from './lib/scene/shape';
  import { EditorSession, provideSession } from './lib/session.svelte';
  import { tickTiers } from './lib/timeline/ticks';
  import { toolTipText } from './lib/tools/registry';

  // Constructed here, not in the canvas panel: a docked pane is remounted when it is maximized,
  // floated, or popped out, and the document must not be able to die with it.
  const session = new EditorSession();
  provideSession(session);

  /*
    The two document shortcuts, at WINDOW level and in here rather than in `ToolHost`.

    `ToolHost.#globalKey` is the wrong home for all three of its own reasons. `onKeyDown` refuses
    keys unless the diagram pane owns the keyboard, so Cmd+S would do nothing precisely when the
    property panel has focus -- and Safari's Save Page dialog would appear instead. It also
    refuses when the target is editable, so Cmd+S with the caret in the JSON editor would fall
    through to the browser the same way. And its window listeners are registered in
    `CanvasSurface`'s `onMount`, so they die whenever the dock remounts that pane; a shortcut for
    the document cannot be owned by one view of it.

    `App` is where `ChromeTooltip` is mounted for the same reason: it outlives every pane.

    `preventDefault` is the whole point, not politeness -- it is what stops Safari's Save Page and
    Open File panels. `e.code`, matching `#globalKey`'s convention, so a non-QWERTY layout binds
    the same physical key. Shift is excluded so Shift+Cmd+S stays the browser's Save As.

    CAPTURE, and this is the part that was measured rather than assumed. `svelte-jsoneditor`'s
    editable cell calls `stopPropagation` on every keydown it sees, so a bubble-phase listener on
    `window` never fires at all while the caret is in the property panel -- which is precisely
    where a user reaches for Cmd+S, and precisely where the browser's own dialog would have
    answered instead. Window capture is the first handler in the tree, so nothing can swallow it
    and there is no `defaultPrevented` to consult: these two chords mean "the document", app-wide,
    and no widget gets to redefine them.
  */
  $effect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.code === 'KeyS') {
        e.preventDefault();
        session.saveDocument();
      } else if (e.code === 'KeyO') {
        e.preventDefault();
        // Inside the keydown task, so Safari still counts this as a user gesture and opens the
        // picker. Awaiting it here would not: the gesture ends with the handler.
        void session.openDocument();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __session: session,
      __scene: session.scene,
      __view: session.view,
      __host: session.host,
      __trace: session.trace,
      __timeline: session.timeline,
      // Pure, and the one part of the timeline a browser check cannot reach through the DOM.
      __tickTiers: tickTiers,
      /*
        The grid as a pure function of a context it is handed, so a browser check can render it
        into its own canvas and diff it against a per-dot reference.

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
        The text width cache, so a check can start from a cold one and bound its size. Through
        the app's own module instance, since the cache is module state.
      */
      __textCache: { clear: clearTextCache, size: textCacheSize, width: cachedTextWidth },
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
        CorridorIndex,
        NO_CORRIDORS,
        ROUTE_MAX_SEGMENTS,
      },
      /*
        The dependency fold itself, which no other handle can stand in for.

        `resolve.ts` imports the registry, so a check cannot import it by URL without getting a
        second, empty copy of that registry (see `__ops`). And without a handle on it the one
        property it exists for -- that the array comes back SETTLED, in one call, rather than one
        level per commit -- could only be seen by driving two commits and watching the geometry
        catch up on the second.
      */
      __resolve: { rerouteAll, movesWith },
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
      __fragment: { copyFragment, readFragment },
      /** The two naming rules, so the series behaviour can be asserted without a scene. */
      __names: { nextFreeIndexedName },
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
        Multi-line subtitles, pure and exported for the same reason `insetType` is: the split rules,
        the shared size and the baseline quantisation are all arithmetic, and counting lit pixels at
        a dozen zoom levels would not settle any of them. The baselines in particular have to be
        checked against the exact integers the one-line code produced, which is the only way a
        `round` where a `trunc` belongs gets caught.
      */
      __subtitleLines: subtitleLines,
      __insetBaselines: insetBaselines,
      __insetFitLines: fitInsetLines,
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
        A queue from two corners, as the creation drag builds it.

        Exposed for the one case a gesture can no longer reach: the pointer is grid-snapped and
        the pitch is now one grid step, so every dragged extent is a whole number of cells and
        `makeFifo`'s rounding is unreachable from the canvas. It is still the rule for any other
        caller, so it still needs a check.
      */
      __makeFifo: makeFifo,
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
      /*
        The object tree's model, as pure functions, so `verify/objects.mjs` can compare the
        rendered rows against it and feed it malformed documents -- a cycle, a dangling parent --
        that the scene would never let it commit.
      */
      __outline: { outlineOf, outlineRows },
      /*
        One kind's operations, out of the LIVE registry.

        Exposed because a check that wants to ask "what handles would this shape have" about a
        shape it has not committed -- a FIFO with a different cell count, a queue mid-flip -- has
        no other honest way in. The tempting alternative, `await import('/src/lib/scene/registry.ts')`
        from inside `page.evaluate`, is the trap iteration 4 wrote down: after any HMR update
        the app's own copy is behind a versioned URL, so a bare specifier resolves to a SECOND
        module instance whose registry is empty, and every `opsFor` throws `no ShapeOps
        registered`. That kills the suite with an uncaught error rather than a failed assertion,
        and takes every suite after it in the chain down too.
      */
      __ops: (kind: string) => opsForKind(kind),
      /*
        The spline algebra as pure functions, for the same reason `__route` exists.

        A curve is the part of a connection least likely to be wrong in a way a screenshot
        shows: whether the parameterisation cusps, whether the flattening is tight enough for
        the hit test, whether the end tangent really is parallel to the last chord -- all
        arithmetic, and none of it visible in a pixel diff.
      */
      __curve: {
        flattenCurve,
        curveEndDirection,
        curveAt,
        autoWaypoints,
        collapseCurve,
      },
      /** The file format, through the app's own registry, for the same reason as `__ops`. */
      __doc: { serializeScene, deserializeScene },
      /*
        The pure half of the file path. `parseSceneDoc` and `readDocument` are the two decisions a
        load makes before anything is committed -- is this a diagram at all, and what of it
        survives -- and both are answerable without a picker, a download or a pointer.
      */
      __file: { parseSceneDoc, saveFileName, readDocument },
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
