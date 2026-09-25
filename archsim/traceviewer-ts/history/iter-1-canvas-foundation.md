# Iteration 1 — architecture-diagram canvas foundation

2026-09-20. Complete and verified in a real browser.

## Scope

The first revision of `traceviewer-ts`: a Vite + Svelte 5 + TS client-only SPA with zero runtime
dependencies. It delivered a virtual-camera canvas with **no scrollbars anywhere**; a major/minor
dot grid with level-of-detail; grid-snapped rectangles drawn by click-and-drag; select, move, resize
(8 handles), delete, z-order, undo/redo; wheel zoom with first-class trackpad support; drag-to-pan.

**This canvas is the hardware-architecture diagram view** of an `archsim` trace viewer (traces are
BEVE containers with an `ARCHTRC` magic, signals × ticks): the design as a schematic of entities
and, later, their connections, which the user selects to inspect trace values. **Waveforms are
explicitly not this canvas's job** — they get their own panel. If you find yourself adding time-axis
or per-signal-row concepts to the diagram, you are in the wrong file.

Deliberately not built: trace loading or BEVE decoding, connections, ports, labels-as-entities, an
inspector, a layers panel, a minimap, marquee selection, the tab/split shell, any test suite.

## Decisions that came from the user

Reversing any of these is a product decision, not a refactor.

| Decision                                                        | Note                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No nvm.** Use whatever Node is on PATH                        | `~/.nvm` has no versions and fish can't source it. `engines: { node: ">=22" }` records the floor only.                                                                                                                                                                    |
| **No scrollbars, anywhere** — virtual camera                    | Not on the page, not on the canvas. Replaced an earlier scroll-container design.                                                                                                                                                                                          |
| **Mouse wheel zooms; trackpad two-finger scroll pans**          | Both explicitly asked for. They are the same DOM event; see _Wheel input_.                                                                                                                                                                                                |
| **Click-and-drag to draw**                                      | An earlier two-click design was rejected for having no affordance.                                                                                                                                                                                                        |
| **Drag empty space to pan; drag a selected object to move it**  | So the pointer tool has no rubber band; multi-select was shift+click only in this iteration (marquee selection later arrived as its own tool).                                                                                                                            |
| **Pressing an unselected shape selects it and starts the move** | The user's rule — "click and grab to move, as long as an object isn't selected; if that object is selected, then we move it" — left the unselected case open; it was settled as one gesture, as every other editor does. The rule is simply the code in `select-tool.ts`. |
| **Full edit UX**                                                | select+move, Delete, toolbar, undo/redo, z-order — all in this revision.                                                                                                                                                                                                  |
| **Major/minor grid**                                            | Majors on both axes; `MAJOR_EVERY` is now 6 steps (five minor dots between majors).                                                                                                                                                                                       |
| **Z-order is user-controllable**; a layers panel comes later    |                                                                                                                                                                                                                                                                           |
| **Tailwind yes, Shoelace later**                                | Shoelace to arrive with the tab/split shell, where its widgets earn their keep. Nothing server-side.                                                                                                                                                                      |

## Load-bearing decisions

### Virtual camera, not a scroll container

The camera is `{ camX, camY, z }` on `ViewController` (`canvas/view.svelte.ts`), where
`(camX, camY)` is the world coordinate at the viewport's top-left. No scroll container, no
world-sized spacer.

```
screen → world:  wx = camX + sx / z          world → screen:  sx = (wx - camX) * z
frame transform: ctx.setTransform(dpr*z, 0, 0, dpr*z, -camX*dpr*z, -camY*dpr*z)
```

The first design used an `overflow:auto` container with a spacer for native scrollbars. Dropping it
deleted the most fragile part of the system: cursor-anchored zoom became three lines of arithmetic
with no forced layout, and the class of bugs where the browser clamps `scrollLeft` behind your back
stopped being possible. **`ViewController` is the sole owner of camera state** — that is what keeps
a future minimap or custom scrollbar a one-file change.

### The camera clamp is a centre constraint

`clampCamera()` constrains the _centre_ of the viewport to the world rect:

```ts
camX = clamp(camX, w.x - halfW, w.x + w.w - halfW);
```

Constraining the viewport _edges_ (the obvious version) makes each bound a function of the world's
size, so a commit that extended the world leftwards yanked the camera sideways — the diagram sliding
under the cursor on mouse-up. With a centre constraint each bound depends on a single world edge,
and the world never retreats on the side content grew into, so **growing the world can never move
the camera, at any zoom.** Only deleting content can.

It also leaves `zoomTo`'s anchor solution alone, so the point under the cursor stays put even when
the whole world fits on screen; an earlier version re-centred a small world and silently destroyed
the anchor. **Centring is an explicit action (`zoomToFit`), never a constraint.**

### Bounded world

World = content bounding box + `BUFFER` (1024) on every side, quantized to `Q`
(`GRID * MAJOR_EVERY * 2`, now 192), floored at 2048×1536 — constants in `lib/grid.ts`. Quantizing
stops the world twitching every time a block moves one cell. The world is deliberately independent
of zoom. `computeWorldBounds(content)` in `scene/bounds.ts` is one pure function: an explicit fixed
extent (e.g. imported from a design) would change only that.

### Wheel input is a heuristic with deterministic escape hatches

All gesture sources arrive as `wheel` events; `classifyWheel()` in `canvas/wheel.ts` separates them:

| Input                                              | Action                                      |
| -------------------------------------------------- | ------------------------------------------- |
| `ctrlKey` wheel (macOS pinch)                      | zoom at cursor                              |
| horizontal component, or fractional/small `deltaY` | pan (trackpad)                              |
| large integer `deltaY`, or `deltaMode ≠ 0`         | zoom at cursor (mouse wheel)                |
| `⌘`+wheel / `Shift`+wheel                          | **always** zoom / **always** horizontal pan |

The classifier can misfire on high-resolution or free-spin mice that emit small smooth deltas; the
modifier overrides are the guaranteed path. If it annoys in practice, the intended fix is a
wheel-mode toggle (auto / zoom / pan), not a cleverer heuristic. `preventDefault()` on **every**
wheel event, listener `{ passive: false }` — otherwise macOS rubber-bands the page and Chrome can
back-navigate on horizontal deltas. Deltas accumulate and apply once per frame.

### Rendering

`$state.raw` for scene data, immutable shapes, whole-array replacement. Deep `$state` would proxy
every shape with a signal per property — slow for a renderer that reads every field every frame, and
an identity trap (a proxied shape is not `===` the raw one, so `indexOf` on a hit-test result can
fail).

**Nothing draws inside an `$effect`.** The effect in `CanvasSurface.svelte` touches an explicit
dependency list and requests a frame; the rAF loop (now `canvas/frame-loop.ts` `FrameLoop`) draws
untracked. Drawing in the effect body would make every value the renderer reads a tracked dependency
and flush per microtask instead of per frame.

Draw order: background (CSS-px space) → dot grid (**device-pixel space**) → shapes in array order
(world space) → tool overlay → draft ghost. **Device-pixel space is a contract:** `grid-renderer.ts`
and anything using `DrawContext.toDeviceSpace()` emit coordinates already multiplied by `dpr` and
must reset the transform first. Getting it wrong is invisible at dpr 1 and doubles everything at
dpr 2.

### Undo granularity comes for free

`SceneStore.commit()` is the only thing that pushes history. Mid-gesture, tools call
`previewShapes()`, which touches no bounds, no history, no camera — so **a whole drag is exactly one
history entry** with no debouncing. A new tool must preview during the gesture and commit once on
release. Snapshots are arrays of existing references (O(n) pointers, not deep copies), capacity 200.
Camera state is deliberately not in history: undo restores the document, not the viewport.

### Extension seams

Each shape kind is one file implementing `ShapeOps` and calling `registerShape`; each tool calls
`registerTool`; both are imported from `register.ts`, and the toolbar renders from the registry.
**Nothing else switches on `kind`.** `SceneStore.commit()` was built from the start to call
`dependsOn`/`reroute` — cascade-delete to a fixed point, then re-route survivors, then prune the
selection — so that connections could arrive without touching any existing mutation path (tested in
[iteration 4](iter-4-connections.md)). The scene document is editor state and **its serializer stays
away from BEVE**, which is trace input: unrelated formats, one serializer must not serve both.
`shapes` array order **is** the z-order (index 0 = bottom). `DiagramView.svelte` is container-sized
and never assumes it owns the window; the surface tolerates a 0×0 container and re-clamps the camera
on every resize.

## Defects, and what they teach

`svelte-check` and `tsc` were clean and `vite build` succeeded — and the app threw on first load and
carried two more defects invisible on a non-Retina display. **For this codebase a green type-check
means almost nothing.** Anything touching the canvas, the camera or DPI must run in a real browser
at `deviceScaleFactor: 2` before it is believed.

**Rune in a plain `.ts` file.** `$state` in `tools/host.ts` threw `rune_outside_svelte` at load.
Svelte declares the runes as ambient globals, so they type-check in any `.ts` file; only the
`.svelte.ts` suffix makes them compile. The first verification pass compiled every module but never
executed the app — compiling is not running.

**Canvas sized to half its container at dpr 2.** `devicePixelContentBoxSize` is specified in device
px but Chromium reports CSS px under an emulated scale factor. Size from `contentRect` and derive
the bitmap as `cssSize * dpr`.

**Grid drawn 2× too large, right/bottom edges unpainted.** A missing transform reset before
device-pixel drawing; only manifests at dpr ≠ 1. Likewise even-sized dots blurred at dpr 1 from
half-pixel rect origins.

**Delete mid-drag poisoned the undo stack.** Committing underneath a tool's uncommitted preview left
one Delete needing two undos. Document mutations are gated on `isGesturing()`; the bug lived in
ordering across three modules.

**Firefox wheel zoom ~30× too weak.** `deltaMode: LINE` deltas were used as pixels; `wheel.ts` now
normalises by mode.

**Camera jumped when the world grew** while smaller than the viewport — emergent from the edge-clamp
formula; the reason the clamp is a centre constraint.

**`DRAG_SLOP_PX` declared and never used**, so 2 px of click drift moved a block a whole cell. An
unused _export_ fires no diagnostic; the select (and later marquee) tool now latches movement past
the slop.

**Minor-dot LOD fade bottomed out at 0.667**, so the tier popped at z = 0.5: an off-by-a-constant in
a blend, visible only by looking.

## How it was verified

No permanent suite yet. Pure logic (camera, bounds, z-order, rect ops, wheel classification): 38
assertions in a throwaway `vite build --ssr` harness under Node. Real browser: Playwright driving
the installed Microsoft Edge (`channel: 'msedge'`; the Chromium download is blocked), at
`deviceScaleFactor: 2`, asserting on `getImageData` pixels and on live state via the DEV-only
`window.__scene` / `window.__view` / `window.__dump()` — 33 interaction checks, 22 regression checks
for the fixes, 10 against the production bundle. The rune, sizing and grid-scale defects were found
by driving the app; the rest by a five-pass multi-lens source audit with adversarial verifiers, each
confirmed against the source by hand.
