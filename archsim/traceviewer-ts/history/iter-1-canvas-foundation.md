# Iteration 1 — architecture-diagram canvas foundation

Status: **complete and verified in a real browser.** 2026-09-20.

This is the record of the first revision of `traceviewer-ts`. Read it before changing the canvas,
the camera, or the tool layer — most of what follows is rationale that is invisible in the code,
plus the defects that survived a green type-check and what they imply for how you verify changes.

---

## 1. What this app is for

The larger app is a viewer for `archsim` traces: a BEVE container with an `ARCHTRC` magic, holding
signals × ticks. The producing C++ lives in `archsim/framework-cpp/` (`tracer.h`,
`file_trace_sink.h`) — not linked here because that directory is absent from the `kevin/traceviewer`
branch this iteration was committed on.

**This canvas is the hardware-architecture diagram view.** It shows the design as a schematic —
entities (blocks) and, later, the connections between them — that the user interacts with to
inspect traces. Selecting an entity will eventually populate a properties/values panel.

**Waveforms are explicitly not this canvas's job.** They get their own view panel later. The app is
expected to grow a tab-strip / split-view shell hosting several views, not all of them canvases.
If you find yourself adding time-axis or per-signal-row concepts here, you are in the wrong file.

### Scope of iteration 1

Delivered: Vite + Svelte 5 + TS client-only SPA; virtual-camera canvas with **no scrollbars
anywhere**; major/minor dot grid with level-of-detail; grid-snapped rectangles drawn by
click-and-drag; select, move, resize (8 handles), delete, z-order, undo/redo; wheel zoom with
first-class trackpad support; drag-to-pan.

Deliberately **not** built: any trace loading or BEVE decoding, connections between entities, ports,
labels-as-entities, an inspector panel, a layers panel, a minimap, rubber-band marquee selection,
the tab/split shell, and any test suite.

32 source files, ~2,900 lines. Production bundle 73 KB (26 KB gzipped), zero runtime dependencies.

---

## 2. Decisions that came from the user

Recorded because reversing any of these is a product decision, not a refactor.

| Decision                                                       | Note                                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No nvm.** Use whatever Node is on PATH                       | `~/.nvm` exists but has no versions installed and fish can't source it. `engines: { node: ">=22" }` records the floor only. Built against Node 25.9.0 / npm 11.12.1. |
| **No scrollbars, anywhere** — virtual camera                   | Not on the page, not on the canvas. Replaced an earlier scroll-container design; see §3.1.                                                                           |
| **Mouse wheel zooms; trackpad two-finger scrolls pans**        | Explicitly asked for both. They are the same DOM event; see §3.4.                                                                                                    |
| **Click-and-drag to draw**                                     | An earlier two-click design was rejected for having no affordance.                                                                                                   |
| **Drag empty space to pan; drag a selected object to move it** | Consequence: no rubber-band marquee. Multi-select is shift+click only.                                                                                               |
| **Full edit UX**                                               | select+move, Delete, toolbar, undo/redo, z-order — all in this revision.                                                                                             |
| **Major/minor grid**, every 5th dot major on both axes         |                                                                                                                                                                      |
| **Z-order is user-controllable**; a layers panel comes later   |                                                                                                                                                                      |
| **Tailwind yes, Shoelace later**                               | Shoelace arrives with the tab-strip / split-view shell, where its widgets actually earn their keep. Nothing else is permitted server-side.                           |

### One open assumption

`SELECT_ON_PRESS_BEGINS_MOVE = true` in [`theme.ts`](../src/lib/canvas/theme.ts). The user's rule was
_"click and grab to move, as long as an object isn't selected; if that object is selected, then we
move it."_ That does not say what pressing an **unselected** block should do. It currently selects
it and immediately begins a move, which is what every other editor does. The stricter reading —
require a prior click to select, pan otherwise — is a one-line flip of that constant. **Confirm with
the user before building anything that depends on either reading.**

---

## 3. Load-bearing architecture

### 3.1 Virtual camera, not a scroll container

The camera is `{ camX, camY, z }` in [`view.svelte.ts`](../src/lib/canvas/view.svelte.ts), where
`(camX, camY)` is the world coordinate at the viewport's top-left. There is no scroll container and
no world-sized spacer element.

```
screen → world:  wx = camX + sx / z          world → screen:  sx = (wx - camX) * z
frame transform: ctx.setTransform(dpr*z, 0, 0, dpr*z, -camX*dpr*z, -camY*dpr*z)
```

The first design used an `overflow:auto` container with a world-sized spacer to get native
scrollbars. Dropping it deleted the single most fragile part of the system: cursor-anchored zoom
became three lines of arithmetic with no forced layout, and the whole class of bugs where the
browser clamps `scrollLeft` behind your back and jumps the content stopped being possible.

**`ViewController` is the sole owner of camera state.** Keep it that way — it is what would make a
future custom-scrollbar or minimap overlay a one-file change.

### 3.2 The camera clamp is a **centre** constraint

`clampCamera()` constrains the _centre_ of the viewport to the world rect:

```ts
camX = clamp(camX, w.x - halfW, w.x + w.w - halfW);
```

This is not cosmetic and it is not the obvious formulation. Constraining the viewport **edges**
(the obvious version) makes each bound a function of the world's _size_, so a commit that extended
the world leftwards could yank the camera sideways — the whole diagram sliding under the cursor on
mouse-up. With a centre constraint each bound depends on a single world **edge**, and the world
never retreats on the side content grew into, so **growing the world can never move the camera, at
any zoom.** Only deleting content can, which is expected and unavoidable.

It also leaves `zoomTo`'s anchor solution alone, so the point under the cursor stays put even when
the whole world fits on screen. An earlier version re-centred a world smaller than the viewport and
silently destroyed the anchor. **Centring is an explicit action (`zoomToFit`), never a constraint.**

### 3.3 Bounded world

World = content bounding box + `BUFFER` (1024), quantized to `Q` (160), floored at 2048×1536.
Quantizing is what stops the world twitching every time a block moves one cell. The world is
deliberately **independent of zoom**.

`computeWorldBounds(content) => Rect` in [`bounds.ts`](../src/lib/scene/bounds.ts) is one pure
function. When the diagram gains an explicit fixed extent (e.g. imported from a design), that is
the only place to change.

### 3.4 Wheel input is a heuristic with deterministic escape hatches

All four gesture sources arrive as `wheel` events. `classifyWheel()` in
[`wheel.ts`](../src/lib/canvas/wheel.ts) separates them:

| Input                                              | Action                                      |
| -------------------------------------------------- | ------------------------------------------- |
| `ctrlKey` wheel (macOS pinch)                      | zoom at cursor                              |
| horizontal component, or fractional/small `deltaY` | pan (trackpad)                              |
| large integer `deltaY`, or `deltaMode ≠ 0`         | zoom at cursor (mouse wheel)                |
| `⌘`+wheel / `Shift`+wheel                          | **always** zoom / **always** horizontal pan |

The classifier **can misfire** on high-resolution or free-spin mice that emit small smooth deltas —
those will pan when the user wanted zoom. The modifier overrides are the guaranteed path. If this
turns out to annoy in practice, the intended fix is a toolbar wheel-mode toggle (auto / zoom / pan),
not a cleverer heuristic.

`preventDefault()` on **every** wheel event, listener registered `{ passive: false }` — otherwise
macOS rubber-bands the page and Chrome can trigger back-navigation on horizontal deltas. Deltas are
accumulated and applied once per `requestAnimationFrame`.

### 3.5 Rendering

`$state.raw` everywhere for scene data, with immutable shapes and whole-array replacement. Deep
`$state` would proxy every shape and create a signal per property — slow for a renderer that reads
every field every frame, and an identity trap (a proxied shape is not `===` the raw one, so
`indexOf` on a hit-test result can fail).

**Never draw inside an `$effect`.** The effect in `CanvasSurface.svelte` only touches an explicit
dependency list and calls `renderer.requestFrame()`; an imperative rAF loop does the drawing
untracked. Drawing in the effect body would make every value the renderer reads a tracked
dependency and flush once per microtask instead of once per frame.

Draw order per frame: background (CSS-px space) → dot grid (**device-pixel space**) → shapes in
array order (world space) → tool overlay → draft ghost.

**Device-pixel space is a real contract.** `grid-renderer.ts` and anything using
`DrawContext.toDeviceSpace()` emit coordinates already multiplied by `dpr`; they must reset the
transform first. Getting this wrong is invisible at dpr 1 and doubles everything at dpr 2 (bug 3).

### 3.6 Undo granularity comes for free

`SceneStore.commit()` is the only thing that pushes history. Mid-gesture, tools call
`previewShapes()`, which touches no bounds, no history, no camera. So **a whole drag is exactly one
history entry** with no debouncing anywhere. Preserve this property: if you add a tool, preview
during the gesture and commit once on release.

Snapshots are arrays of existing references — O(n) pointers per entry, not deep copies. Capacity 200. Camera state is deliberately **not** in history: undo restores the document, not the viewport.

---

## 4. Nine bugs that a green type-check did not catch

`svelte-check` and `tsc` reported zero errors and `vite build` succeeded — and the app still threw
on first load, then carried two more defects invisible on a non-Retina display. **This table is the
most useful thing in this document.**

| #   | Bug                                                                                     | Where                              | Why static checking missed it                                                                                    |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `$state` in a file not named `.svelte.ts` → `rune_outside_svelte` **at load**           | `tools/host.ts` → `host.svelte.ts` | Svelte declares the runes as ambient globals, so they type-check in _any_ `.ts` file                             |
| 2   | Canvas sized to **half** its container at dpr 2                                         | `CanvasSurface.svelte`             | `devicePixelContentBoxSize` is specified in device px but Chromium reports CSS px under an emulated scale factor |
| 3   | Dot grid drawn **2× too large**, right/bottom edges unpainted                           | `grid-renderer.ts`                 | Missing transform reset; only manifests at dpr ≠ 1                                                               |
| 4   | Delete mid-drag poisoned the undo stack (one Delete needed two undos)                   | `host.svelte.ts`                   | Interaction ordering across three modules                                                                        |
| 5   | Firefox wheel zoom ~30× too weak                                                        | `wheel.ts`                         | `deltaMode: LINE` deltas used as if they were pixels                                                             |
| 6   | Camera jumped when the world grew, if the world was smaller than the viewport           | `view.svelte.ts`                   | Emergent from a clamp formula                                                                                    |
| 7   | `DRAG_SLOP_PX` declared and never used — 2 px of click drift moved a block a whole cell | `select-tool.ts`                   | Unused _export_; no diagnostic fires                                                                             |
| 8   | Even-sized grid dots blurred at dpr 1                                                   | `grid-renderer.ts`                 | Half-pixel rect origins                                                                                          |
| 9   | Minor-dot LOD fade bottomed out at 0.667, so the tier popped at z=0.5                   | `grid-renderer.ts`                 | Off-by-a-constant in a blend                                                                                     |

**The lesson, stated plainly: for this codebase a green type-check means almost nothing.** Bugs 2,
3 and 8 are invisible on a dpr-1 display, and the primary development machine is a Retina Mac.
Anything touching the canvas, the camera, or DPI must be executed in a real browser at
`deviceScaleFactor: 2` before it is believed.

Bugs 1–3 were found by driving the app with Playwright. Bugs 4–9 came from a parallel multi-lens
audit and were then each verified against the source by hand.

---

## 5. Scaffolding deliberately left for future iterations

These exist now, unused, so that the next revisions are additive. Do not remove them as dead code.

### 5.1 Connections between entities — the next revision

`ShapeOps` ([`shape.ts`](../src/lib/scene/shape.ts)) reserves three optional methods:

```ts
dependsOn?(s): readonly ShapeId[]                       // a connection returns its two endpoints
reroute?(s, deps: ReadonlyMap<ShapeId, Shape>): S       // re-derive geometry after a dep moved
anchors?(s): readonly Anchor[]                          // where a connection may terminate
```

`SceneStore.commit()` **already calls through to these**: it cascade-deletes shapes whose
dependencies vanished (to a fixed point, since a drop can orphan another), then lets survivors
re-route, then prunes the selection. The whole walk is skipped via `registryHasDependencies()` while
no kind implements `dependsOn`, so it costs nothing today. `rectOps.anchors()` returns edge
midpoints — implemented so the seam is at least exercised.

**Adding a connection kind should require no change to any existing mutation path.** If it does,
that is a design bug worth fixing rather than working around.

> **This is the one part of the abstraction that is designed but unvalidated.** Build connections
> _next_, while it is still cheap to change, rather than after several more shape kinds calcify it.

### 5.2 Adding any shape kind

Write `src/lib/scene/shapes/<kind>.ts` implementing `ShapeOps`, call `registerShape` at the bottom
of it, widen the `Shape` union in `shape.ts`, add the import to
[`register.ts`](../src/lib/register.ts). **Nothing else switches on `kind`.**

### 5.3 Adding any tool

Write `src/lib/tools/<name>-tool.ts` implementing `Tool`, call `registerTool` at the bottom, add the
import to `register.ts`. The toolbar renders from the registry, so the button appears by itself.

### 5.4 The inspector panel

`ShapeBase.name` exists and `serialize()` returns a flat, human-readable record, so a first
inspector can render `serialize(shape)` generically before any per-kind schema exists.

**Keep `ShapeOps.serialize` away from BEVE.** The scene document is _editor_ state (blocks you drew);
BEVE is the _trace input_. Unrelated formats — one serializer must not serve both.
[`serialize.ts`](../src/lib/scene/serialize.ts) exists mainly to keep the round trip honest.

### 5.5 The layers panel

`shapes` array order **is** the z-order (index 0 = bottom). `reorder(shapes, id, toIndex)` in
[`zorder.ts`](../src/lib/scene/zorder.ts) is the primitive a layers panel will drag against; the
four restack commands are built on the same idea.

### 5.6 Hosting in a pane

[`DiagramView.svelte`](../src/views/DiagramView.svelte) is self-contained and **container-sized** —
it never assumes it owns the window. `CanvasSurface` guards against a 0×0 container (hidden tab,
fully-collapsed splitter) and re-clamps the camera on every size change.

> Verified by hiding and re-showing the container, but **never actually hosted in a real pane.**
> Re-check when the tab-strip / split-view shell lands.

### 5.7 Per-axis snapping

`snap(v, step)` takes the step as a **parameter** rather than reading `GRID`, because a connection
may want to snap along its own routing grid. Cheap now, painful to retrofit.

---

## 6. Flagged for future work

Ordered roughly by how likely they are to bite.

1. **No automated tests at all.** Every bug above was found by throwaway scripts that no longer
   exist. A plan for a permanent Vitest + Playwright suite exists outside the repo; its single most
   important finding is worth preserving here: **`vite-plugin-svelte` picks `generate: 'client' |
'server'` from the Vite environment, and Vitest's `environment: 'node'` selects server mode,
   where `$state` becomes a plain field and `$derived` a one-shot memo that never recomputes.** A
   rune-based unit suite under `environment: 'node'` would not fail — it would go quietly,
   catastrophically wrong. Use `environment: 'happy-dom'` plus `resolve.conditions: ['browser']`,
   and keep a canary test asserting a `$derived` actually recomputes.
2. **Unverifiable without real hardware:** whether a _real_ mouse wheel on macOS produces deltas
   large enough to classify as zoom rather than pan, and whether Safari's `gesturechange` pinch path
   double-applies. Synthetic events cannot settle either. The `⌘`/`Shift` overrides always work.
3. **No position affordance.** With no scrollbars there is nothing showing where the viewport sits
   in the world. Current mitigations: the StatusBar camera/world readout and `⌘1` zoom-to-fit. If
   orientation suffers on a large diagram, add a canvas-drawn minimap — **not scrollbars.**
4. **`BUFFER` caps reach.** You can only pan to empty space within 1024 units of existing content,
   so placing a block far from everything means working outward in steps. One constant; see §3.3.
5. **Trackpad two-finger pan is unavailable to mouse users** and wheel-zoom is unavailable to
   trackpad users, by construction (§3.4). Shift+wheel and ⌘+wheel cover both.
6. **Hit-testing is linear** over all shapes on every `pointermove`. Fine at current scale; when a
   real design gets large, add a bbox broadphase _inside_ `hitTest` — the signature does not change.
7. **Undo history is snapshot-based**, capacity 200. If shape counts reach tens of thousands, swap
   for patches behind the same `History` interface; nothing outside `history.svelte.ts` changes.
8. **Selection highlight shows without handles** while the rect tool is active, because handles
   belong to the select tool's overlay. Correct, arguably inconsistent. Cosmetic.
9. **A minor→major colour pop remains** at LOD transitions. Bug 9 fixed the alpha discontinuity; a
   true cross-fade needs a three-tier scheme. Probably not worth it.

---

## 7. Conventions and gotchas

- **Any file using a rune must be named `*.svelte.ts`.** This is the #1 bug above and it will not be
  caught by the type checker. Current rune files: `canvas/view.svelte.ts`,
  `scene/scene.svelte.ts`, `scene/history.svelte.ts`, `tools/host.svelte.ts`.
- **Never trust `devicePixelContentBoxSize`** for CSS size. Use `contentRect`; derive the bitmap
  from `cssSize * dpr`. See bug 2.
- **Reset the transform before drawing in device-pixel space.** See bug 3.
- **`dpr` is capped at 2** (`MAX_DPR` in `view.svelte.ts`) — a 3× bitmap costs 2.25× the fill for no
  visible gain on hairlines.
- **Resize/move must always recompute from the pre-drag snapshot**, never incrementally, or snap
  error accumulates and the shape drifts away from the cursor.
- **Document mutations must be gated on `isGesturing()`** (see `deleteSelection`, `#restack`).
  Committing underneath a tool's uncommitted preview corrupts history. See bug 4.
- The shape and tool **registries replace instead of throwing on duplicate in DEV**, because HMR
  re-runs module side effects and a hard throw wedges the dev server on every edit. They still throw
  in production.
- **Prettier is 2-space** here, deliberately against the repo's 3-space C++/Python convention —
  3-space TS fights every tool in the JS ecosystem. See `.prettierrc` and `.vscode/settings.json`.
- This project is **standalone npm and is not wired into CMake.** Keep it that way.
- `dist/` **cannot** be opened over `file://` — ES module scripts are CORS-blocked there. Use
  `npm run preview` or any static server.

---

## 8. How iteration 1 was verified

Because there is no test suite yet, recording the method matters:

- **Pure logic** (camera, bounds, z-order, rect ops, wheel classification) — 38 assertions in a
  throwaway harness built with `vite build --ssr` and run under Node.
- **Real browser** — Playwright driving the Microsoft Edge already installed on the machine
  (`channel: 'msedge'`; the Chromium download is blocked in this environment). 33 interaction
  checks in dev + 22 regression checks for the fixes + 10 against the production bundle, at
  `deviceScaleFactor: 2`, asserting on `getImageData` pixels and on live camera/scene state exposed
  via `window.__scene` / `window.__view` (DEV only).
- **Multi-lens source audit** — five independent review passes with three adversarial verifiers per
  finding.

`window.__scene`, `window.__view` and `window.__dump()` are exposed in DEV only, from
`DiagramView.svelte`. They are the hook any future browser test should drive.

**The gap that let bug 1 through:** the first verification pass compiled and type-checked every
module but never executed the app. Compiling is not running.
