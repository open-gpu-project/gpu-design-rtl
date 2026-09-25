# Iteration 3 — the trace panel

2026-09-21 to 2026-09-22. Complete; the render-performance fix was later confirmed by the user in
real Safari.

The iteration has two parts. Part I is the trace panel: a timeline shaped to the real `ARCHTRC`
producer, and a selection made global across the diagram and the trace. Part II is render
performance: why the diagram canvas got slower the larger the window, measured in real Safari, and
the fix — the dot grid drawn as cached row strips.

## Scope

Part I delivered a `Trace` panel docked across the bottom of the workspace; a trace document model
shaped to the `ARCHTRC` wire format; a deterministic synthetic fixture; a canvas timeline with a
frozen name gutter, an adaptive three-tier tick ladder, event flags, and a snapping yellow time
cursor with an editable tick field; selection made global across the diagram and the trace; and the
property panel taught to show a selected event.

Deliberately **not** built in Part I: BEVE/`ARCHTRC` decoding, value-span lanes, the
trace-to-diagram link, row grouping/filtering/search/reordering, measurement markers.

The panel is hand-rolled canvas with no new dependency — ~34 KB raw, ~10 KB gzipped, taking the
production bundle from 1,014 KB / 328 KB to 1,047.71 KB / 338.62 KB gzipped.

Part II changed four things: the dot grid stopped emitting one primitive per visible dot every
frame; Safari's `gesturechange` joined the rAF accumulator every other input path already used; the
status bar's pointer readout stopped dirtying the document on every `pointermove`; and the property
panel stopped reminting its tree whenever its effect re-ran with nothing selected.

Deliberately **not** changed in Part II: the grid's appearance, the level-of-detail ladder, the
minor-tier fade, the 2D context attributes, the Ajv validator memo, and the timeline renderer —
which draws per row and per tick, not per unit of area, and so never had the defect.

- **3, the trace panel** — the data model, flags, tick ladder, time cursor, global selection and the
  property panel's event case.
- **3.1, render performance** — the diagnosis from the first Safari recording; the input and
  property-panel fixes; the bitmap-width fix; the strip design and its exactness argument.
- **3.2, measurement** — the second Safari recording through the level-of-detail boundary, the strip
  cache built and checked against a per-dot reference, and the real-Safari session that settled
  which renderer ships.

## Decisions that came from the user

| Decision                                                                                   | Note                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TS model plus synthetic fixtures**, not a BEVE reader yet                                | There is nothing on this branch to read and nothing to test a reader against. The model is shaped so the reader slots in behind it.                                                                                                                                                           |
| **Flags only**; value changes modelled but not drawn                                       | `display: 'value'` signals are in the document and excluded from `rows`. A span lane is additive.                                                                                                                                                                                             |
| **One canvas with a frozen name gutter**, not a DOM table                                  | Matches the no-scrollbars/virtual-camera convention, and keeps the two columns' vertical scroll in lockstep by construction rather than by synchronisation.                                                                                                                                   |
| **Same-tick records merge into one flag** carrying a count                                 | Chosen over fanning them out. It made the selection unit `(signal, tick)` rather than `(signal, tick, index)`, which is what lets the selected flag be derived.                                                                                                                               |
| _"When a flag is selected, the cursor should move to its position and the trace selected"_ | Falls out of the derived selection rather than being implemented; see _The selected flag is derived, not stored_.                                                                                                                                                                             |
| _"If a trace is selected and the cursor is right on a flag, select the flag"_              | The same derivation, reached from the other direction.                                                                                                                                                                                                                                        |
| **Fix the grid, Safari's pinch path, the pointer readout and the properties reset**        | The first Safari measurement's suggested order. The Properties panel's unexplained repainting was to be re-measured afterwards rather than chased, as most of it was predicted to follow from these.                                                                                          |
| **Deterministic browser checks**                                                           | Primitive counts and pixel diffs can be asserted without flaking; frame pacing is machine-dependent and cannot. A WebKit fps script was planned and never written; Playwright's WebKit understates Safari's cost (see _Render performance_), so its frame times would not have been evidence. |
| **The recording is not committed**                                                         | The 9.8 MB export measured the profiler as much as the app (see _The first recording measured the profiler_), so keeping it would be keeping a misleading artefact.                                                                                                                           |
| **Strips are the only renderer**                                                           | After the user's real-Safari session, in which strips beat every other renderer and the reported stutter was gone. The alternatives built for the comparison were deleted.                                                                                                                    |

## Load-bearing decisions: Part I — the trace panel

### Where the data model came from

The producer, `framework-cpp`, **is not on this branch.** It lives on `kevin/archsim-v2`, and no
sample trace is checked in anywhere in the repository. The model was read off that branch's
`tracer.h`, `tracer_codec.h` and `file_trace_sink.h` rather than guessed, because getting the shape
wrong now means migrating every consumer later.

| Producer fact                                                                                | Consequence here                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Traceable` admits "a leaf, or a struct exactly one level deep whose members are all leaves" | `TraceValue` is flat by construction. There is no nesting to render and no tree to walk.                                                                                           |
| Signals are named by `TracerBase::qualified_name` — the entity path plus a local name        | The signal name **is** the join key to a diagram block, whose identity is also its `name`. Nothing resolves it yet; the diagram link is future work.                               |
| The body is tick records and value records; there is no event record kind                    | An "event" is a value change on a struct-typed signal. Events and value changes are one mechanism, and `TraceSignal.display` is a **rendering** choice, not a format distinction.  |
| Several value records may sit between two tick markers                                       | Records can share a tick. Not an edge case — the XBN model on `kevin/xbnsim` appends a list of entries per cycle — so the fixture forces it and the renderer has a defined answer. |
| `Simulation::run_one_tick` pre-increments before writing                                     | The first tick on the wire is 1; tick 0 is anything emitted before it.                                                                                                             |
| `x-beve-enum` exists so `reinterpret_to_json` can restore enumerator names                   | The property panel shows `send`, not `1` (`enumNames` on the field). A number here would disagree with every other rendering of the same trace.                                    |

A traced value's grammar is structurally identical to the property editor's `PropValue` — both flat,
one level deep, no object case. They are still **separate types**: the scene document is editor
state and a trace is simulator input, and letting the two share a name is how one serializer ends up
serving both.

### The selected flag is derived, not stored

This is the decision the panel hangs off. `TraceStore` holds `selectedSignal` and `cursorTick`;
`selectedEvent` is a `$derived` over the two.

Both user rules then fall out of it. Clicking a flag sets exactly those two fields, and the event
follows; moving the cursor onto a flag of the selected trace reaches the same derivation from the
other side. Storing the selection as well would make "the cursor is at tick 640 but flag 812 is
highlighted" a representable state, and therefore eventually a real one. It is not representable.

The merge decision is what makes this work: with a fan-out, the selection would have needed an index
within the tick, which is not recoverable from the cursor.

### Global selection, without moving the scene's selection

`SceneStore.selection` could not simply be hoisted: it is recorded into every history entry as
`beforeSel`/`afterSel` and restored by undo and redo.

So the scene keeps it and gains one hook. Every write goes through a private `#setSelection` that
fires `onSelectionChanged`, mirroring the existing `onCommit` hook. `EditorSession` wires the two
halves:

- `selectSignal(id)` writes the trace selection, then clears the scene's.
- `onSelectionChanged` clears the trace selection **when the scene's becomes non-empty**.

That guard is what makes the halves compose rather than fight: `selectSignal` clears the scene,
which fires the hook, and an unguarded body would immediately undo the trace selection that
triggered it.

Routing undo and redo through the same setter was not tidiness. They used to assign `selection`
directly and never go through a tool, so a fix at the call sites — `SelectTool`, `ToolHost` — would
have missed them, and redoing a block creation would have left a block and a trace row selected at
once. `verify/trace.mjs` tests that path specifically.

### Flag geometry lives in one place

`visibleFlags()` in `timeline/layout.ts` is the single source of truth for where a flag is and how
wide it is, and **both the renderer and the hit test call it**, with the same text measurer. Flag
width depends on the label and on the gap to the next stem, so it is not derivable from the tick
alone; computing it twice is how the clickable box drifts from the drawn one, which presents as
"sometimes clicking a flag does nothing".

Its two other jobs: collapsing a run of equal ticks into one box with a count, and capping the walk
at `MAX_SCAN_PER_ROW` with a stride. Without the cap, a zoomed-out row holding a million records
walks all of them sixty times a second; at that density every pixel already holds several stems, so
the stride loses nothing distinguishable.

A flag's width is sized to its **text**, clamped by the gap — never to the gap alone; see _A flag
sized to its gap reads as a value span_.

### The tick ladder

`timeline/ticks.ts` (`tickTiers`) is the dot grid's level-of-detail ported to time, and it keeps
that module's two real properties: tiers climb so the hierarchy survives a zoom, and `minorAlpha` is
anchored to the same `MIN_TICK_PX` the ladder test uses, so the fade reaches zero exactly as the
tier is replaced.

Two things differ, both forced by the data. The ladder is decimal (1-2-5) because tick counts are
read as numbers. And every tier is a **whole number of ticks, floored at 1** — a simulation tick is
indivisible, and a gridline at 2.5 ticks points at nothing.

`medium` and `minor` must **divide** `major`. Rounding `major / 2` gives 3 for a major of 5, and
mediums every 3 under majors every 5 is a ruler that never lines up with itself. Ticks are walked by
index (`i * step`), never by adding `step`: the `tick % coarser === 0` test that stops a tier
drawing over a coarser one has to stay exact, and repeated addition drifts.

### A sibling camera, not a reuse

`TimelineView` is a sibling of `ViewController` with one axis replaced, not a reuse of it. The
diagram's `z` is a single isotropic scale; a timeline needs time (`zT`, CSS px per tick) to zoom
continuously while rows keep a fixed height and only scroll. Forcing both through one scale gives
either unreadable row text when zoomed out on time, or a time axis that cannot zoom on its own.

What the two share is everything iteration 1 paid for — `MAX_DPR = 2`, the
`{ alpha: false, desynchronized: true }` context, the identity-guarded `detach(canvas)`, the
zero-size bail in `syncCanvasSize` — and it now lives once, in the `CanvasViewport` base both
extend. The **centre** constraint in `clampCamera` is kept too: each time bound depends on a single
document edge, so extending a trace can never yank the view.

`zoomAt(anchor, factor)` and `pan(dx, dy)` keep the diagram's exact signatures, which is what lets
`WheelController` drive this class unmodified. That was the whole reason not to invent new ones —
and it is structural typing, so changing either signature silently breaks wheel input with no
compile error.

### Wheel policy is a parameter, not a fork

`WheelController` hardcoded "a discrete wheel notch zooms", which is right for the diagram — the
user asked for it — and wrong for a panel that can hold hundreds of rows. It takes
`{ wheelMeansZoom }`, defaulting true so the diagram is untouched, and its `view` is typed to a
structural `WheelTarget` rather than to `ViewController`.

With that one parameter every requested gesture falls out of the existing classifier: `Ctrl`+wheel
is already `'pinch'` (macOS synthesises `ctrlKey` for a trackpad pinch), `Shift`+wheel is already
`forcePan`, and horizontal trackpad deltas already pan.

### The panel clips itself

The gutter is frozen by **clipping the lane**, not by painting over it: ticks and flags are drawn
inside a clip rect starting at `gutterW`. Painting the gutter last would also work until the first
flag with a negative `x`, whose body would show through any gap in the fill.

This cannot be verified by geometry. `verify/trace.mjs` pans so early ticks map behind the gutter
and reads the pixels, asserting no accent blue in that column — plus the converse, that the lane
does contain accent blue, so the check is not vacuous.

### Keyboard ownership

Keyboard listeners are on `window`, so the trace panel's host takes an `acceptsKeys` gate exactly as
the diagram's does; without it both panels' arrow keys fire at once. `Home`/`End`/arrows move the
cursor only onto real events.

### The property panel's fourth case

`PropSchema` could not be reused: `PropContext` is `{shapes, index}` and an event has neither.
Rather than making the props system generic for one read-only consumer, `PropertiesView` gained a
fourth case alongside 0 / 1 / N blocks. An event is read-only, so `shownSpec` stays `null` — which
is already what drives `readOnly`, the validator, `onClassName` and the context-menu suppression.
None of the commit path is touched.

Iteration 2's rules applied unchanged and were the main risk:

- **Nothing handed to the editor may be derived from the selection.** `shownSignal` and `shownTick`
  are written only where a document is actually pushed.
- **`set()` inherits the caret and expands it against the incoming document.** The keys always
  differ between a block and an event, so the caret is dropped on every switch.
- `shown` became an identity **key** (`shape:<name>` / `event:<signal>@<tick>`) rather than a shape
  name, because "is this a different object" now has to mean different across kinds too.

The effect also defers on `timelineHost.isGesturing()`, with `timelineHost.gestureVersion` as its
wake-up. Dragging the time cursor changes the selected event on every `pointermove`, and
re-`set`ting the tree that often is both visibly slow and a caret-thrash — iteration 2's lesson
about deferring during a gesture, applied before it could bite.

### The dock layout key moved

`STORAGE_KEY` moved to `archsim.traceviewer.dock.v2`. Without that bump every existing user restores
a v1 layout, which passes validation — the guard rejects _unknown_ pane ids, never _missing_ known
ones — and never sees the new panel.

## Load-bearing decisions: Part II — render performance

### The diagnosis: the dot grid cost O(area)

The reported symptom was _"the larger the canvas, the laggier"_. The grid used to build one path
holding **one `ctx.rect()` per visible dot**, for both tiers, every frame. The dot count is

```
dots ≈ (cssW × cssH) / (GRID × z)²        GRID = 16
```

and `dpr` is not in it: `stepDev = step · z · dpr` and the loop bound is in device pixels, so it
cancels. Measured in WebKit at dpr 2 over a sustained pan, same code and same scene:

| Canvas CSS | Dots/frame | fps      |
| ---------- | ---------: | -------- |
| 1282×671   |      3 555 | **60.0** |
| 1475×768   |      4 654 | **54.6** |
| 1838×841   |      6 348 | **36.3** |
| 2161×1007  |      8 932 | **20.6** |

The knee is at **4 000–5 000 primitives**; below it 60 fps, above it fps falls roughly linearly with
count. Two controlled A/Bs isolate the cause: 64× fewer dots at an unchanged 34.8 MB bitmap restores
60 fps, while 4× fewer pixels at an unchanged dot count changes nothing. It is the dot geometry —
not fill rate, not bitmap size, and not the context's `desynchronized`/`alpha` flags, which were
A/B'd at every size and sat inside noise. Do not revisit those.

### The level-of-detail cost cliff at z = 0.5

The second report was _"when zooming between LoDs there is a lot of lag"_, and it is the same defect
at its sharpest. The ladder is

```
level      = max(0, ceil(log(MIN_DOT_PX / (GRID·z)) / log(MAJOR_EVERY)))
minorStep  = GRID · MAJOR_EVERY^level
minorAlpha = clamp((minorStep·z − MIN_DOT_PX) / 6, 0, 1)
```

with `MIN_DOT_PX = 8`, so `level` steps at `z = 0.5` whatever `MAJOR_EVERY` is. (Every count in this
part was measured while `MAJOR_EVERY` was 5; it is now 6, which makes the step steeper, not
different in kind.) At that instant `minorStep` shrinks by `MAJOR_EVERY`, the minor tier's dot count
multiplies by `MAJOR_EVERY²`, and `minorAlpha` restarts from **zero**. The fade that makes the
transition _look_ continuous is what makes its cost _maximally_ discontinuous: the tier switches on
at its densest and least visible.

Measured on a 1546×611 CSS canvas at dpr 2 (3092×1222 device px), drawn a dot at a time: **608 rects
at `z = 0.4999`, 14 668 at `z = 0.5001`** — and the new rects are painted at `globalAlpha ≈ 0.0003`,
a paint alpha of zero. The frame's inked pixels were exactly the major dots' and nothing else, so
the stuttering frame paid for ~14 700 primitives to draw a picture byte-identical to the one below
the boundary. That is the strongest evidence that cost tracks **primitive count**, not visible
output, and it is why the fix targets the tier that cannot be seen. The zoom buttons, stepping by
1.25 from 1.0, walk straight across it: 51.2 % → 41.0 % is one click.

The next boundary is `MIN_DOT_PX / (GRID · MAJOR_EVERY) ≈ 0.083`, below `ZOOM_MIN = 0.1`, so
`z = 0.5` is the only level change a user can provoke. `verify/grid.mjs` asserts the band below it
has no step; lowering `ZOOM_MIN` or reducing `MAJOR_EVERY` would bring a second cliff into reach.

The observation from the affected machine — stutter "when the canvas rendered the most highlighted
grid points" — was right about _where_ and wrong about _why_. Crossing `z = 0.5` steps both tiers at
once, so the major dots really are at their densest just above it; but they were under 4 % of the
primitives.

### The cost is paid in Safari's GPU process, so only counts can be asserted

In the second recording `Composite` was **6 280 ms of 20 s**, while script, layout, style and paint
together were 140 ms (0.7 %), and main-thread CPU sat at **3–13 %** through the worst of the pinch.
The page is blocked, not busy: the canvas display list is rasterized in Safari's GPU process, and
`Composite` is where the page waits for it. Attributing each composite to the zoom at the rAF that
started it:

| side of the boundary | frames | median rects | median `Composite` |      range |
| -------------------- | -----: | -----------: | -----------------: | ---------: |
| below `z = 0.5`      |     23 |          893 |         **3.4 ms** | 1.6–131 ms |
| above `z = 0.5`      |     35 |        8 468 |       **162.3 ms** | 1.5–330 ms |

The next rAF cannot fire until the composite completes, so the canvas ran at ~4 fps through the
pinch. Over the whole gesture Safari charged **~21 µs per `rect()`**, which predicts the peak (14
668 × 21 µs ≈ 308 ms) — though not the low end, where the slope over-predicts.

This decides what can be tested. `performance.now()` around `draw()` reads 0–1 ms at 20 fps —
script-time profiling cannot see the defect at all, which is why the first profile never pointed at
the grid. Playwright's WebKit reproduces the direction but understates the magnitude ~3.5×, because
it has no GPU-process canvas. So **primitive counts are asserted and frame times never are**; the
only frame-time check is a human in real Safari.

One thing in the recording rect count did not explain: after a long run of heavy frames, ~900-rect
frames kept costing 86–131 ms for a while. The mechanism was never resolved, but it argued for a fix
whose cost is **flat**, not merely smaller — a reduced peak could still leave the tail.

### The minor-tier fade is not a lever

Skipping the minor tier while it is nearly invisible reads as an obvious saving. It is not. Against
the background the tier changes zero output pixels only while `z < 0.5057` — about one percent of
one zoom step — and at `z = 0.79` it is 77 % opaque and still ~5 900 rects. A cutoff that is
perceptually free covers essentially none of the problem, and one large enough to matter removes a
real tint: the same class of mistake as a fade that bottoms out above zero and pops.

### Row strips

In the per-dot loop a dot's x depends only on its column index and its y only on its row index, so
**every row of a tier carries the same horizontal pattern**. A tier has exactly two kinds of row —
ordinary, and the `mod(j, skipEvery) === 0` rows that leave holes for the major dots to sit in.
`TierStrips` therefore caches one-row-tall offscreen canvases, `devW` wide — plain and holed — and
blits the right one once per visible row with the three-argument `drawImage`. `DotGrid` owns two
`TierStrips`, one per tier; the major tier has no holed strip.

A strip costs `O(devW / stepDev)` rects to build, and a frame costs one blit per row. Rows are
bounded by `devH / (MIN_DOT_PX · dpr)` at every zoom, because a minor tier is drawn only once its
spacing exceeds `MIN_DOT_PX`. O(area) becomes O(perimeter): at `z = 0.5001` on the measured
geometry, **a few hundred ops against 14 668 rects**, and doubling the canvas height doubles only
the blits while the rect count stays put. The boundary still steps — both `cols` and `rows` multiply
by `MAJOR_EVERY`, so strips step by its square root — but between two cheap frames far below the 4
000–5 000 knee, which is not a cliff.

`DotGrid` is a class owned by `Renderer`, which is built once per session and outlives pane
remounts. A module-level cache would thrash between two panes with different bitmap widths and let
one renderer's teardown clear another's strips.

### Why strips are exact

The property bought is **pixel identity with the per-dot renderer**, not an approximation.

- **Columns.** The reference writes each dot at `Math.round(x) - half` with `x` accumulated from
  `x0` by `stepDev`, and `x0`/`i0` are functions of `camX`, `step`, `z` and `dpr` alone. So the
  accumulated `x` sequence is not merely equal across rows but bit-identical. The strip is blitted
  at `dx = 0` and is `devW` wide, so a negative first column is clipped by the strip's left edge
  exactly as by the canvas, and the right edge matches too.
- **Rows.** The three-argument `drawImage` is specified as the nine-argument form with a full source
  rectangle, so it never takes the source-clipping branch; a destination hanging off the top or
  bottom is clipped against the destination bitmap, exactly as a rect would be.
- **Values.** Strip pixels are only ever `(color, 255)` or `(0, 0, 0, 0)` and both dot colours are
  opaque, so premultiplied equals straight and nothing rounds on the way in.
- **Rows never overlap**, which is what makes one blit per row safe: a minor tier drawn at all has
  `stepDev > MIN_DOT_PX · dpr ≥ 8` against a dot size of at most 3, and the major tier's step is
  `MAJOR_EVERY` times that against a size of at most 5.

Every one of those arguments is **per row and per column**, so none depends on how many rows there
are. That is what lets strips be the only renderer at every size, with no floor below which a direct
path takes over.

Which leaves `globalAlpha`. Blitting at alpha `a` computes `color·a + dst·(1−a)` for a dot pixel and
leaves a gap pixel alone — algebraically what filling the rect at that alpha does. For the major
tier and wherever `minorAlpha === 1` that is a true copy, and the result is exact. In the **minor
tier's blend band**, `z ∈ (0.5, 0.875)`, there are two quantization sites, and on a GPU-backed
canvas a solid fill and a textured blit are different shader programs, so the honest claim there is
**one LSB per channel**. `verify/grid.mjs` asserts it that way round: byte-exact everywhere except
the blend band, ≤ 1 LSB inside it. In practice it measured zero differing pixels at every zoom
tried.

The exactness is fragile in two specific ways, both recorded in the code:

- **The strip's column loop accumulates** (`x += stepDev`); only the index is exact. Tidying it to
  `x0 + k * stepDev` silently voids pixel identity.
- **The strip canvases take no context options.** `alpha` must stay true for the gaps to be
  transparent, and a `colorSpace` or `willReadFrequently` would move the blit onto a colour-managed
  or CPU-backed path. `imageSmoothingEnabled` is turned off for the blits and restored afterwards.

### Why the cache is keyed on `camX`, not `x0`

The holed strip depends on `mod(i0, skipEvery)`, which is independent of `x0`: panning by exactly
one step leaves `x0` bit-identical while moving which columns are punched out. An `x0`-keyed cache
would hit and draw the holes in the wrong places. `camX` implies both, so `StripKey` carries `camX`
(with `step`, `z`, `dpr`, `devW`, `size`, `skipEvery`, `color`).

It deliberately omits `camY` and `devH`, neither of which touches a strip's pixels, so a repeat
draw, a vertical-only pan or a vertical-only resize is a hit — zero rects, blits only. A pinch
misses on every frame, because `zoomTo` rewrites `z` _and_ `camX`; the win during a gesture is the
op count, not reuse. `verify/grid.mjs` walks one grid through a sequence of cameras including the
one-step pan and asserts a warm cache draws exactly what a cold one does.

The grid's `dispose()` (`TierStrips.release`) only drops the cache. `Renderer.dispose()` can fire
against a live renderer — the dock may run the new pane's `onMount` before the old one's cleanup —
so it must never leave the grid unable to draw; a spurious call costs one rebuild.

### Device-space background, bounds from the bitmap

`syncCanvasSize` sets `canvas.width = Math.round(cssW * dpr)`, and `cssW` comes from a
`ResizeObserver` on a pane sized by the dock's fractional splits — fractional in the **default**
layout. The grid used to bound its loops by the unrounded `cssW * dpr`, so the rightmost partial
column was under-drawn. `DotGrid.draw` now takes its device size from `ctx.canvas.width`/`height`
and has no `cssW` parameter to disagree with: the bitmap is the only thing that knows how many
device pixels exist, and `canvas.width` is an IDL `unsigned long`, so it is always an integer.

That is only half a fix on its own. `Renderer.draw` filled the background as
`fillRect(0, 0, cssW, cssH)` under the dpr transform, covering `[0, cssW · dpr)`; wherever
`syncCanvasSize` rounded up, the last device column got only fractional coverage. While the grid
never drew there that was invisible. Once it did, and because the context is `{ alpha: false }` and
never cleared, that column retained a fraction of the previous frame's dot colour every frame — a
smear down the right edge that builds over a sustained pan. So the background is filled in device
space, `fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)` under an identity transform, which also
hands `DotGrid` the space it resets to anyway. **Both halves have to move together.**

dpr is not only 1 or 2: `MAX_DPR` is a `Math.min` cap, so browser zoom gives 1.25, 1.5, 1.75, where
`cssW * dpr` is fractional for almost every integer `cssW`. Assigning either canvas dimension resets
all context state, so it happens only on a real size change — in `syncCanvasSize` and in the strips
alike.

### Alternatives rejected

- **`createPattern` with an integer-period tile**, which the first Safari measurement proposed. True
  dot positions are `round(x0 + (i0 + n·MAJOR_EVERY + k)·stepDev)`, but a replicated tile gives
  `tileOrigin(n) + round(k·stepDev)`, so the fractional phase varies from tile to tile and the
  pattern is wrong in every tile but one. A fractional pattern transform resamples, producing
  exactly the blurry dots device-space drawing exists to prevent.
- **A CSS `radial-gradient` layer moved by `background-position`.** The same periodicity objection:
  any strictly periodic representation is wrong wherever `stepDev` is not an integer, which is most
  zoom levels.
- **A full-viewport-plus-one-period cache blitted at an integer offset.** Exact, but it only
  reproduces the pattern when the camera moved a whole number of device pixels, and `pan()` divides
  the screen delta by `z`, so trackpad panning is fractional essentially always — a full rebuild
  every pan frame, at ~39 MB on top of the canvas.
- **One path per row** (`fill()` inside the row loop). Collapses each fill's bounding box from the
  whole canvas to one row, but still emits one primitive per dot, and Safari charges per primitive.
- **One `fillRect()` per dot, no path.** Removes path tessellation and keeps the per-dot count, so
  the same objection.
- **Column strips** instead of row strips. The construction is symmetric and equally exact; it just
  trades the counts the other way (fewer rects, more blits). Not needed.

The last three were built alongside strips and measured in the same real-Safari sitting; strips beat
all of them, and they were then deleted.

### Input fixes

The DOM's layer rasterization is queued into the same GPU process the canvas waits on — the second
recording re-rasterized ~20 Mdev-px of layers per frame for 3.8 Mdev-px of actual change — so how
often the document gets dirtied matters even though the CPU cost is small.

**Safari's pinch goes through the rAF accumulator.** `WheelController` exists to coalesce input —
_"A 120 Hz trackpad otherwise drives 120 separate camera updates and repaints in a second"_ — but
`onGestureChange` applied `zoomAt` and `onApplied()` synchronously, per event. Safari alone fires
`gesturechange`, and `#suppressPinchUntil` deliberately routes it away from the coalesced ctrl+wheel
path, so Safari was the only engine taking the uncoalesced one: 346 gesture events became 346 camera
updates and 232 full-document layouts. (Not 346 grid rebuilds — the frame loop already coalesced
draws — so this was never a multiplier on the grid cost.) The gesture is folded into the accumulator
that already exists rather than given a second: `#apply` computes `Math.exp(-#zoomExp)`, so a
gesture factor enters as `#zoomExp -= Math.log(factor)` and the separate gesture anchor goes away.
Two accumulators would have had to agree about anchor, ordering and clamping, and the bug being
fixed is what happens when one input path is special-cased. `verify/input.mjs` asserts zero camera
updates during a burst and that the coalesced zoom lands on the product of the per-event factors.

**The pointer readout updates at snap granularity.** `ToolHost.pointer` is `$state.raw` and used to
get a fresh object on every `pointermove`, so identity alone re-rendered the status bar: 60 moves
over the canvas produced 48 document layouts, 60 outside produced none. Its only reader shows the
snapped point, so the field narrowed to that point and is written only when it changes — once per
`GRID` world pixels. Narrowing matters as much as de-duplicating: keeping `{ world, snapped }` while
comparing on `snapped` would leave `world` stale between changes, a trap rather than a saving. It is
still written before the pan early-return, so the readout keeps up while dragging. The zoom `%`
readout needed no change: `view.z` is written at most once per frame on every path once the pinch is
coalesced, and the readout is already `tabular-nums` and fixed-width.

**The `switched` flag is set in all three branches.** `push(doc, reset)` skips its text-equality
guard whenever `reset === true`, and the nothing-selected branch of the property effect passed
`reset: true` unconditionally — so every re-run with nothing selected dropped the caret and called
`editor.set({ json: {} })`, reminting the tree for `{} → {}` (+12/−15 top-level mutations per
deselect, and in Safari a re-entry into Svelte's scheduler through `flushSync` mid-flush). The event
and single-shape branches already computed `switched` from an identity key; this branch now does
too, keyed `none` / `multi:<count>`. Carrying the count is what keeps the caret safe when a
multi-selection shrinks and a path like `/2/...` stops resolving. Making `push`'s guard
unconditional instead was rejected: `reset` also means _drop expansion state and caret_, which is a
different question from _is the text the same_, and collapsing them would make the guard mean
whichever the next caller wanted.

### Outcome

The user ran the comparison in real Safari, maximized on the large monitor: strips beat every other
renderer and the Safari problem was resolved. Strips are the only renderer; there are no modes and
no tier switch. `verify/grid.mjs` holds a per-dot reference renderer, defined in the suite with the
level-of-detail math deliberately copied rather than imported, and checks the strips against it.

The grid was the area half of the problem. A second Safari cost scales with **shape count** —
measuring text for labels on every frame — and is covered in iteration 6
([iter-6-components.md](./iter-6-components.md)), which added the text width cache.

## Defects, and what they teach

**A flag sized to its gap reads as a value span.** Flags were sized to the gap after them, not to
their text; the one record in front of the fixture's 600-tick idle hole ballooned to the maximum
width and read as a span covering that time. Every assertion passed — right place, right height,
correct hit test and selection — it just meant the wrong thing. Found from a screenshot. **A canvas
needs to be looked at, not only measured.**

**A second canvas broke every bare `locator('canvas')`.** Three existing suites hit strict-mode
violations. Cheap, but it is why existing suites have to be run, not assumed; `verify/harness.mjs`
exports `diagramCanvas(page)` and `traceCanvas(page)` for this.

**A hard-coded click point moved onto another panel.** `properties.mjs`'s "click empty space" was
`box.y + 600`; shrinking the diagram pane for the trace panel put that point on the panel below,
which selected a trace row. It surfaced as a timeout waiting for the property panel's veil, pointing
nowhere near the layout change. Replaced with `emptySpot(box)`, derived from the live box. Do not
hard-code canvas coordinates in a check.

**A setup step silently did nothing.** The new suite's block-drawing step never switched tools —
`acceptsKeys` had left the keyboard with the trace panel, so the digit shortcut was ignored and the
drag just panned — and the "selecting a block clears the trace selection" check was passing over an
empty scene. It was caught only because it also checked the shape count. **Assert the setup, not
just the outcome.**

**A test asserted an exact colour the design legitimately changes.** The first gutter check expected
a flat colour, and the row stripe tints it; it would have gone on failing for a correct panel.
Replaced with the bleed check, which tests the property that matters.

**A wording change broke a correct assertion.** The footer's empty state was reworded to "Select a
block or a trace event…". The test was right: the footer documents whichever property the caret is
on, so telling the user to select a block is nonsense when one is selected. Only the veil needed the
broader wording.

**The fixture could produce four merged records where three were promised.** Its collision block
kept anything the seed had already placed at tick 640 and added three. Caught in review; it now
drops that tick first, so the count is exactly three whatever the seed does.

**The first Safari recording did not contain the bug.** It was taken at a 1282×671 canvas — about 3
555 dots, below the knee. Measurements have to be taken where the symptom lives: maximized on the
large monitor, reporting `cssW × cssH`, `dpr` and `z` beside every number, and swept across
`z = 0.5` rather than taken at a point, because the symptom is a transition.

**The first recording measured the profiler.** Web Inspector's Screenshots instrument was on: one
full-page capture per frame, 12 frames and 12 whole-page repaints in a fully idle window, and a ~42
ms floor on every frame. Its "p50 41.5 ms / 11.7 fps" were artefacts, not a baseline. Turn the
instrument off; when it is on, `Composite` durations stay usable and frame durations do not.

**A screenshot's canvas is one frame behind its toolbar.** Each capture shows the zoom readout from
the end of the composite but the canvas from its start. Mapped naively, several 200 ms frames
appeared to happen at ~900 rects, which is how one concludes rect count does not matter. Every
number above uses zoom at the composite's start.

**Script-time profiling cannot see a canvas rasterization cost.** `Renderer.draw` read 0–1 ms at 20
fps and the whole analysis of the first recording rested on script time. **Compiling is not running,
running is not looking, and looking at the script is not looking at the frame.**

**Right diagnosis, wrong fix.** The first Safari measurement found the cause correctly and then
proposed `createPattern` or a CSS gradient, both of which are wrong at almost every zoom (see
_Alternatives rejected_), and put the worst case at `z ≥ 1`, when it is `z` just above 0.5 — about
4× denser. A fix direction in a report is a hypothesis, not a spec.

## How it was verified

Playwright against real Edge (`channel: 'msedge'`) at `deviceScaleFactor: 2`, plus one thing only
real Safari could answer.

The trace panel closed at **112 assertions across four suites**. `verify/trace.mjs` (44, new) covers
bitmap sizing at dpr 2; the gutter bleed check and its converse; the tick ladder's monotonicity,
integrality and divisibility across five zooms; ctrl+wheel zoom versus shift+wheel pan versus
plain-wheel row scroll; cursor snapping from a timescale click and a handle drag; `Home`/`End`/arrow
navigation landing only on real events; **clicking a flag body and its stem with the mouse**, which
is what proves the hit box matches the drawn box; merged same-tick flags reaching the property panel
as an array; enum decoding; the tick field in both directions and its clamp; both directions of the
global selection rule including redo; and arrow keys doing nothing while the diagram owns the
keyboard. `docking.mjs` asserts all three panels resolve from a restored layout; `production.mjs`
drives the built bundle through the DOM only.

The render work added two suites. `verify/grid.mjs` is a pure-function suite at the measured
geometry (3092×1222 device px, dpr 2, a fractional camera): it renders the strips and the per-dot
reference into canvases it owns, diffs them in the page, and counts `rect`/`fillRect`/`drawImage`
calls — byte-exact outside the blend band, ≤ 1 LSB inside it; rect count unchanged when the canvas
doubles in height; the worst zoom well under the primitive count where Safari degrades; a warm cache
equal to a cold one; the last device column reachable; and a live-canvas screenshot hash at a
fractional CSS width, the only place the right-edge smear could show. `verify/input.mjs` covers
pinch coalescing, the snap-granular pointer readout, and zero property-panel mutations on a repeat
deselect. Neither asserts a frame time.

The decisive check was by hand: the user in real Safari, Screenshots instrument off, maximized,
sweeping across `z = 0.5`.
