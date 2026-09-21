# Iteration 3 — the trace panel

Status: **complete and verified in a real browser.** 2026-09-21.

Read [iteration 1](./iter-1-canvas-foundation.md) and
[iteration 2](./iter-2-docking-and-properties.md) first; their conventions still hold and are
not repeated here. This document records the trace data model and where it came from, the one
decision the whole panel hangs off, and the defects that a green type-check and a plausible
screenshot did not reveal.

---

## 1. Scope

Delivered: a `Trace` panel docked across the bottom of the workspace; a trace document model
shaped to the real `ARCHTRC` wire format; a deterministic synthetic fixture; a canvas timeline
with a frozen name gutter, an adaptive three-tier tick ladder, event flags, and a snapping
yellow time cursor with an editable tick field; selection made global across the diagram and the
trace; and the property panel taught to show a selected event.

Deliberately **not** built: BEVE/`ARCHTRC` decoding, value-span lanes, the trace-to-diagram
link, row grouping/filtering/search/reordering, measurement markers, and a real test suite.

14 new files, ~2,400 lines of source plus a 564-line browser suite. Production bundle
**1,047.71 KB (338.62 KB gzipped)** plus 137.76 KB (18.57 KB gzipped) of CSS, up from iteration
2's 1,014 KB / 328 KB. The panel is ~34 KB raw, ~10 KB gzipped: it is hand-rolled canvas with no
new dependency, so iteration 2 §6.2's warning about code-splitting "before there is a third
heavy panel" does not bind. That warning is still live for whatever the fourth panel is.

## 2. Where the data model came from

`framework-cpp` — the producer — **is not on this branch.** It lives on `kevin/archsim-v2`, and
no sample trace is checked in anywhere in the repository. The model here was read off that
branch's `tracer.h`, `tracer_codec.h` and `file_trace_sink.h` rather than guessed, because
getting the shape wrong now means migrating every consumer later.

What those files establish, and what this iteration encodes:

| Producer fact                                                                                | Consequence here                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Traceable` admits "a leaf, or a struct exactly one level deep whose members are all leaves" | `TraceValue` is flat by construction. There is no nesting to render, and no tree to walk.                                                                                                     |
| Signals are named by `TracerBase::qualified_name` — the entity path plus a local name        | The signal name **is** the join key to a diagram block, whose identity is also its `name`. `entityPath()` and `signalToShape()` exist for that.                                               |
| The body is tick records and value records; there is no event record kind                    | An "event" is a value change on a struct-typed signal. Events and value changes are one mechanism, and `TraceSignal.display` is a **rendering** choice, not a format distinction.             |
| Several value records may sit between two tick markers                                       | Records can share a tick. This is not an edge case — the XBN model on `kevin/xbnsim` appends `list[XuTraceEntry]` per cycle — so the fixture forces it and the renderer has a defined answer. |
| `Simulation::run_one_tick` pre-increments before writing                                     | The first tick on the wire is 1; tick 0 is anything emitted before it.                                                                                                                        |
| `x-beve-enum` exists so `reinterpret_to_json` can restore enumerator names                   | The property panel shows `send`, not `1`. Matching the producer's own transform is the point; a number here would disagree with every other rendering of the same trace.                      |

A traced value's grammar turns out to be structurally identical to the property editor's
`PropValue` — both are flat, one level deep, no object case. They are still **separate types**.
Iteration 1 §5.4 is explicit that the scene document is editor state and a trace is simulator
input, and letting the two share a name is how one serializer ends up serving both.

## 3. Decisions that came from the user

| Decision                                                    | Note                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TS model plus synthetic fixtures**, not a BEVE reader yet | There is nothing on this branch to read, and nothing to test a reader against. The model is shaped so the reader slots in behind it.                        |
| **Flags only**; value changes modelled but not drawn        | `display: 'value'` signals are in the document and excluded from `rows`. A span lane is additive.                                                           |
| **One canvas with a frozen name gutter**, not a DOM table   | Matches the no-scrollbars/virtual-camera convention, and keeps the two columns' vertical scroll in lockstep by construction rather than by synchronisation. |
| **Same-tick records merge into one flag** carrying a count  | Chosen over fanning them out. It made the selection unit `(signal, tick)` rather than `(signal, tick, index)`, which is what let §4.1 work.                 |

## 4. Load-bearing architecture

### 4.1 The selected flag is derived, not stored

This is the decision the panel hangs off. `TraceStore` holds `selectedSignal` and `cursorTick`;
`selectedEvent` is a `$derived` over the two.

Both rules asked for then fall out of it rather than being implemented:

- _"When a flag is selected, the cursor should move to its position and the respective trace
  should be selected"_ — clicking a flag sets exactly those two fields, and the event follows.
- _"If a trace is selected, and the cursor is right on a flag, the flag should be selected
  automatically"_ — that is the same derivation, reached from the other direction.

Storing the selection as well would make "the cursor is at tick 640 but flag 812 is highlighted"
a representable state, and therefore eventually a real one. It is not representable.

The merge decision in §3 is what makes this work: with a fan-out, the selection would have
needed an index within the tick, which is not recoverable from the cursor.

### 4.2 Global selection, without moving the scene's selection

`SceneStore.selection` could not simply be hoisted: it is recorded into every history entry as
`beforeSel`/`afterSel` and restored by undo and redo.

So the scene keeps it, and gains one hook. Every write goes through a private `#setSelection`
that fires `onSelectionChanged` — mirroring the existing `onCommit` hook. `EditorSession` wires
the two halves:

- `selectSignal(id)` writes the trace selection, then clears the scene's.
- `onSelectionChanged` clears the trace selection **when the scene's becomes non-empty**.

That guard is what makes the halves compose rather than fight: `selectSignal` clears the scene,
which fires the hook, and an unguarded body would immediately undo the trace selection that
triggered it.

Routing undo and redo through the same setter was not tidiness. They assign `selection`
directly and never go through a tool, so a fix applied at the call sites — `SelectTool`,
`ToolHost` — would have missed them, and redoing a block creation would have left a block and a
trace row selected at once. `verify/trace.mjs` tests that path specifically.

### 4.3 Flag geometry lives in one place

`visibleFlags()` in `timeline/layout.ts` is the single source of truth for where a flag is and
how wide it is, and **both the renderer and the hit test call it**, with the same text
measurer. Flag width depends on the label and on the gap to the next stem, so it is not
derivable from the tick alone; computing it twice is how the clickable box drifts away from the
drawn one, which presents as "sometimes clicking a flag does nothing".

Its two other jobs: collapsing a run of equal ticks into one box with a count, and capping the
walk at `MAX_SCAN_PER_ROW` with a stride. Without the cap, a zoomed-out row holding a million
records walks all of them, sixty times a second; at that density every pixel already holds
several stems, so the stride loses nothing distinguishable.

### 4.4 The tick ladder

`timeline/ticks.ts` is the dot grid's level-of-detail (`canvas/grid-renderer.ts`) ported to
time, and it keeps that module's two real properties: tiers climb so the hierarchy survives a
zoom, and `minorAlpha` is anchored to the same `MIN_TICK_PX` the ladder test uses, so the fade
reaches zero exactly as the tier is replaced.

Two things are different, both forced by the data. The ladder is decimal (1-2-5) because tick
counts are read as numbers. And every tier is a **whole number of ticks, floored at 1** — a
simulation tick is indivisible, and a gridline at 2.5 ticks points at nothing.

`medium` and `minor` must **divide** `major`. Rounding `major / 2` gives 3 for a major of 5, and
mediums every 3 under majors every 5 is a ruler that never lines up with itself.

### 4.5 A fork of the camera, not a reuse

`TimelineView` is a copy of `ViewController` with one axis replaced. The diagram's `z` is a
single isotropic scale; a timeline needs time to zoom continuously while rows keep a fixed
height. Forcing both through one scale gives either unreadable row text when zoomed out on time,
or a time axis that cannot zoom on its own.

What is kept verbatim is everything iteration 1 paid for: `MAX_DPR = 2`, the
`{alpha: false, desynchronized: true}` context, the identity-guarded `detach(canvas)`, the
zero-size bail in `syncCanvasSize`, and the **centre** constraint in `clampCamera` — each time
bound depends on a single document edge, so extending a trace can never yank the view.

`zoomAt(anchor, factor)` and `pan(dx, dy)` keep the diagram's exact signatures, which is what
lets `WheelController` drive this class. That was the whole reason not to invent new ones.

### 4.6 Wheel policy is a parameter, not a fork

`WheelController` hardcoded "a discrete wheel notch zooms", which is right for the diagram — the
user asked for it — and wrong for a panel that can hold hundreds of rows. It now takes
`{ wheelMeansZoom }`, defaulting true so the diagram is untouched, and its `view` is typed to a
structural `WheelTarget` rather than to `ViewController`.

With that one parameter, every gesture asked for falls out of the existing classifier: `Ctrl`
+wheel is already `'pinch'` (macOS synthesises `ctrlKey` for a trackpad pinch), `Shift`+wheel is
already `forcePan`, and horizontal trackpad deltas already pan.

### 4.7 The panel clips itself

The gutter is frozen by **clipping the lane**, not by painting over it: ticks and flags are
drawn inside a clip rect starting at `gutterW`. Painting the gutter last would also work until
the first flag with a negative `x`, whose body would show through any gap in the fill.

This cannot be verified by geometry. `verify/trace.mjs` pans so early ticks map behind the
gutter and then reads the pixels, asserting no accent blue in that column — plus the converse,
that the lane does contain accent blue, so the check is not vacuous.

### 4.8 The property panel's fourth case

`PropSchema` could not be reused: `PropContext` is `{shapes, index}` and an event has neither.
Rather than making the props system generic for one read-only consumer, `PropertiesView` gained
a fourth case alongside 0 / 1 / N blocks. An event is read-only, so `shownSpec` stays `null` —
which is already what drives `readOnly`, the validator, `onClassName` and the context-menu
suppression. None of the commit path is touched.

Iteration 2's rules apply unchanged and were the main risk:

- **Nothing handed to the editor may be derived from the selection** (§3.8). `shownSignal` and
  `shownTick` are written only where a document is actually pushed.
- **`set()` inherits the caret and expands it against the incoming document** (defect 8). The
  keys always differ between a block and an event, so the caret is dropped on every switch.
- `shown` became an identity **key** (`shape:<name>` / `event:<id>@<tick>`) rather than a shape
  name, because "is this a different object" now has to mean different across kinds too.

One addition: the effect also defers on `timelineHost.isGesturing()`, with
`timelineHost.gestureVersion` as its wake-up. Dragging the time cursor changes the selected
event on every `pointermove`, and re-`set`ting the tree that often is both visibly slow and a
caret-thrash. This is iteration 2 defect 1's lesson applied before it could bite.

---

## 5. Defects this iteration, and what they teach

| #   | Bug                                                                                                                                                                                                                                                      | Where                                                 | Why it was not obvious                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Flags were sized to the gap after them, not to their text.** The one record standing in front of the fixture's 600-tick idle hole ballooned to the 132px maximum and read as a _value span_ covering that time.                                        | `timeline/layout.ts`                                  | Every assertion passed. The flag was in the right place, was the right height, hit-tested correctly, and selected correctly — it just meant the wrong thing. Found by looking at a screenshot. **A canvas needs to be looked at, not only measured.**                                         |
| 2   | `locator('canvas')` became a strict-mode violation across three existing suites.                                                                                                                                                                         | `verify/harness.mjs`, `docking.mjs`, `production.mjs` | The second canvas in the app is the first time this mattered. Cheap, but it is the reason the existing suites have to be run, not assumed.                                                                                                                                                    |
| 3   | **`properties.mjs` started selecting a trace row instead of deselecting.** Its "click empty space" was a hard-coded `box.y + 600`; shrinking the diagram pane to make room for the trace panel moved that point off the canvas and onto the panel below. | `verify/properties.mjs`                               | It surfaced as a 30-second timeout waiting for `.veil`, which points at the property panel and not at the layout change that caused it. Replaced with `emptySpot(box)`, derived from the live box so the next layout change cannot repeat it.                                                 |
| 4   | The new suite's block-drawing step **silently did nothing**, so the "selecting a block clears the trace selection" check was passing over an empty scene.                                                                                                | `verify/trace.mjs`                                    | `ToolHost.acceptsKeys` gates on the panel that owns the keyboard. Earlier steps had left it with the trace panel, so `Digit2` never switched tools and the drag just panned. The assertion caught it only because it also checked `shapes === 1`. **Assert the setup, not just the outcome.** |
| 5   | The first gutter check asserted an exact colour, and the row stripe legitimately tints it.                                                                                                                                                               | `verify/trace.mjs`                                    | A wrong test, not a wrong implementation — and it would have gone on failing for a correct panel. Replaced with the bleed check in §4.7, which tests the property that actually matters.                                                                                                      |
| 6   | Reworded the footer's empty state to "Select a block or a trace event…", breaking an existing assertion.                                                                                                                                                 | `PropertiesView.svelte`                               | The test was right and the change was wrong on its own terms: the footer documents whichever _property_ the caret is on, so telling the user to select a block is nonsense when one is already selected. Only the veil needed the broader wording.                                            |

Caught by review before it ran: the fixture's collision block kept any record the seed had
already placed at tick 640 _and_ added three, so it could produce four. It now drops that tick
first, and the count is exactly three whatever the seed does.

## 6. Scaffolding left for future iterations

- **The `ARCHTRC` reader** goes behind `TraceDoc` with no consumer change. It needs a BEVE
  decoder and a port of `reinterpret_to_json` driven by the `x-beve-order` / `x-beve-enum`
  sidecar. Note two producer details: the body's 8-byte record framing is deliberately _not_
  BEVE so a reader can skip values it does not understand, and a trace whose producer crashed
  has a valid header but **no `ARCHEND` trailer**, so the reader must tolerate that.
- **Value-span lanes.** `TraceSignal.display` already discriminates, the fixture already
  contains two `'value'` signals, and `TraceStore.load` is the one place that filters them out
  of `rows`.
- **The diagram link.** `EditorSession.signalToShape(name)` resolves a signal's entity path
  against shape names and is not called by anything. It is deliberately outside `selectSignal`,
  because selecting a block _and_ its trace is not mutual exclusion and should not be buried in
  the rule that enforces it.
- **Row order** is `TraceStore.rows`, a plain array of ids. Grouping, filtering and drag-reorder
  all hang off that one field.
- **`window.__trace`, `__timeline`, `__timelineHost` and `__tickTiers`** are DEV-only, alongside
  the existing hooks. `__tickTiers` is exported because the ladder is pure and is the one part
  of the panel a DOM assertion cannot reach.

## 7. Flagged for future work

1. **Still no real test suite.** `verify/` is now four Playwright scripts, 112 assertions.
   Iteration 1 §6.1's warning stands unchanged: under `environment: 'node'` a rune-based suite
   passes while testing nothing.
2. **The tick ladder is only unit-tested through the browser.** `tickTiers` is pure and would be
   the first thing a Vitest suite should cover; today it is reached via `window.__tickTiers`.
3. **Rows are fixed-height and unvirtualised beyond the visible window.** Fine at nine rows and
   at nine hundred; the per-frame cost is already bounded by `first`/`last`.
4. **`MAX_SCAN_PER_ROW` striding drops records** at extreme zoom-out. Visually indistinguishable,
   but a density strip would be more honest than a sampled one.
5. **No trace is loadable from disk.** `loadTrace()` exists and only the fixture calls it; there
   is no file input, exactly as import/export had none after iteration 2.
6. **The cursor readout overlaps the tick label it sits on.** Cosmetic; the pill shows the same
   number.
7. **Only one trace pane may exist**, for the same reason as the diagram: the session owns a
   single `TimelineView`, and two panes would fight over `attach()`.

## 8. Conventions and gotchas

- **Flag geometry must come from `visibleFlags`.** Anything that computes a flag's box
  independently will drift from the drawn one. The hit test passes the same measurer for the
  same reason.
- **Tick tiers must be whole numbers, and must divide each other.** See §4.4.
- **Walk ticks by index (`i * step`), never by adding `step`.** The `tick % coarser === 0` test
  that stops a tier drawing over a coarser one has to stay exact, and repeated addition drifts.
- **The lane is clipped; the gutter is not painted over the top.** See §4.7.
- **`TimelineView.zoomAt`/`pan` are `WheelController`'s interface.** Changing either signature
  silently breaks wheel input — the target is structural, so there is no compile error.
- **Every selection write in `SceneStore` goes through `#setSelection`.** Assigning `selection`
  directly anywhere in that class bypasses the global selection rule, and undo/redo are exactly
  the paths that used to.
- **The trace panel needs `acceptsKeys`**, like the diagram. Keyboard listeners are on `window`,
  so without it both panels' arrow keys fire at once.
- **A second canvas broke every bare `locator('canvas')`.** `verify/harness.mjs` exports
  `diagramCanvas(page)` and `traceCanvas(page)`; use them.
- **Do not hard-code canvas coordinates in a check.** Use `emptySpot(box)`; defect 3 is what
  happens otherwise.

## 9. How iteration 3 was verified

Four Playwright suites against real Edge (`channel: 'msedge'`) at `deviceScaleFactor: 2` — 112
assertions, all passing.

- `verify/trace.mjs` (44, new) — bitmap sizing at dpr 2; that the canvas is painted; the gutter
  bleed check and its converse; the tick ladder's monotonicity, integrality and divisibility
  across five zooms; ctrl+wheel zoom versus shift+wheel pan versus plain-wheel row scroll;
  cursor snapping from both a timescale click and a handle drag; row selection from the gutter;
  `Home`/`End`/arrow navigation landing only on real events; **clicking a flag body and its
  stem with the mouse**, which is what proves the hit box matches the drawn box; merged
  same-tick flags reaching the property panel as an array; enum decoding; the tick field in both
  directions plus its clamp; both directions of the global selection rule including the
  redo path; and that arrow keys do nothing while the diagram owns the keyboard.
- `verify/properties.mjs` (35) — unchanged in intent, two fixes from defects 2 and 3.
- `verify/docking.mjs` (18) — now asserts all three panels resolve from a restored layout.
- `verify/production.mjs` (15) — the built bundle under `vite preview`, through the DOM only.

`STORAGE_KEY` moved to `archsim.traceviewer.dock.v2`. Without that bump every existing user
restores a v1 layout, which passes validation — the guard rejects _unknown_ pane ids, never
_missing_ known ones — and never sees the new panel.

Of the six defects above, one came from a screenshot, three from running the existing suites
against the new layout, one from the new suite, and one was a bad test. **Iteration 1's
conclusion needs an addition: compiling is not running, and running is not looking.**
