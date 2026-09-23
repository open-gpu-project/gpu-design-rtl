# Iteration 5 — the document says more than the canvas shows

2026-09-23. Complete. Five unrelated papercuts found by using the app, not by reading it. No
file-format change, no router change, no new subsystem.

Read [iter-2-docking-and-properties.md](./iter-2-docking-and-properties.md) §3 for the property
grammar, [iter-3-trace-panel.md](./iter-3-trace-panel.md) §4 for the flag idiom this iteration
extends to the cursor, and [iter-4-2-read-only-geometry.md](./iter-4-2-read-only-geometry.md)
§3.1 for what `fixed` means.

---

## 1. Scope

What connects five unrelated fixes is that four of them are the same sentence: **the document
already holds something the canvas never shows you.** `description` existed on both kinds and
was documented as "Never drawn on the canvas". A connection's `name` — the identifier every
other record refers to it by — was invisible, because a wire draws its `label` and nothing else.
A block could carry one line of text however much there was to say about it.

**Changed.**

- Blocks gain `subtitle` and `labelMode` (`inset` | `tabbed_left` | `tabbed_right`), and
  `description` becomes a hover tooltip ([rect.ts](../src/lib/scene/shapes/rect.ts),
  [rect.props.ts](../src/lib/scene/shapes/rect.props.ts)). §3.1, §3.2.
- The trace cursor's arrow-plus-detached-readout becomes one flag on the stem
  ([timeline/renderer.ts](../src/lib/timeline/renderer.ts)). §3.3.
- Connections gain `labelOffset`, a `[par, perp]` nudge in screen pixels relative to the run the
  label rides ([conn.ts](../src/lib/scene/shapes/conn.ts)). §3.4.
- Hovering a block or a wire raises a tooltip, from a new `ShapeOps.tooltip` seam and a new
  `CanvasTooltip.svelte`. §3.2.
- An editable enum property renders as a dropdown rather than a text row
  ([PropertiesView.svelte](../src/views/PropertiesView.svelte)). §3.5.
- `MAJOR_EVERY` 5 → 6, so five minor dots sit between two majors
  ([grid.ts](../src/lib/grid.ts)). §3.6.
- `fitText` moved from `timeline/renderer.ts` to a new
  [canvas/text.ts](../src/lib/canvas/text.ts), alongside a `textMeasurer` generalizing
  `flagMeasurer`. Both canvases now truncate with the same function.
- The renderer's inline `16` cull margin becomes `CULL_MARGIN_PX` in
  [canvas/theme.ts](../src/lib/canvas/theme.ts), raised to 96. §3.7.

**Deliberately not changed.** `SceneDoc.version` is still `2` — §3.1. `rectOps.bounds` is still
the bare rectangle even though the tab is drawn outside it — §3.7. `anchorAt` and `handles` do
not know about the tab: a connection still attaches to the block's real perimeter, and the
resize handles are still on the rect. Only `hitTest` grew.

**Verification surface.** 261 → 290 assertions across the six dev suites, plus one changed
expectation in `verify/production.mjs`. Two harness helpers, `selectValue` and `enumOptions`,
because a dropdown cannot be driven by `editValue`.

---

## 2. Decisions that came from the user

- **Three label modes, not a boolean.** Asked for by name: `inset`, `tabbed_left`,
  `tabbed_right`.
- **The tab sits outside the block**, as a folder tab above the top edge, rather than as a badge
  inside the corner. Chosen over two alternatives that would both have stayed inside `bounds`
  and cost nothing; this one is the reason §3.7 exists at all.
- **A tabbed block's body stays empty.** The subtitle moves into the tooltip rather than being
  drawn in both places.
- **The label offset is in CSS pixels**, not world units — chosen against consistency with every
  other geometric property on a shape, and correctly. §3.4.

---

## 3. Load-bearing decisions

### 3.1 Two new properties, and why the file format did not move

`subtitle` and `labelMode` were added to a kind with saved scenes already in `localStorage`.
Nothing was needed to make those load, and the reason is worth stating because it is the kind of
thing that looks like luck: `hydrateShape` skips a key the record does not have, leaving the
blank's value, and `rectOps.blank` now says `labelMode: 'inset'`. A scene saved before this
iteration therefore loads with the label centred — which is exactly what it did before. The
default is not a convenience; it is the compatibility guarantee, and
`verify/properties.mjs` asserts it by deleting the keys from a real record and loading it back.

The canonical key order does move: editable keys sort alphabetically, so `labelMode` lands
between `label` and `name`, and `subtitle` after `size`. That is three consumers at once — the
panel rows, the generated schema and the saved file — and it broke the row-order assertion in
`verify/production.mjs`, which is the one suite `npm run verify` cannot vouch for. It broke
nothing else, because a record is an unordered bag.

### 3.2 A tooltip needs a seam, not a switch

The README claims nothing outside a shape's own file switches on `kind`. Producing tooltip text
is per-kind — a block's answer depends on its `labelMode`, a wire's heading is its `name` —
so it is a new optional `ShapeOps.tooltip` returning `{ title, lines }`, and `ToolHost` never
learns what a `rect` is.

The harder half is that hovering is a pointermove feature in a file whose whole iteration 3.2
was about not doing work on pointermove. `host.pointer` is `$state.raw` compared on the
_snapped_ point precisely so that 60 moves cost 4 writes instead of 60. A tooltip that
hit-tested per move would have put that straight back.

So the move handler does no hit test and writes no signal. It stores the point in a plain field
and restarts a `setTimeout`; the hit test runs once, when the dwell expires. This is not merely
cheaper, it is the correct shape of the feature — a hover tooltip is _by definition_ about a
pointer that has stopped, so every hit test on the moves in between would have been thrown away.

One wrinkle: a tooltip already on screen must go away when the pointer really moves, and that
_is_ a signal write. It is gated on `HOVER_SLOP_PX`, because a tooltip that vanishes under a
one-pixel tremor cannot be read — reading requires holding still, and nobody holds perfectly
still. `verify/input.mjs` asserts zero mutations in the diagram pane across a 40-step sweep,
with the pointer settled first so the previous tooltip's teardown lands outside the count.

`@svgrid/grid` ships an unused `createTooltip`/`SvTooltip`. Not used: it is built around a DOM
anchor element with its own hover triggers, and the anchor here is a canvas region with a dwell
clock we own. A synthetic proxy element to anchor it to would have been more moving parts than
the component it saved.

### 3.3 The cursor was two objects pretending to be one

The old cursor drew a triangle on the timescale baseline and, separately, a rounded readout
floating seven pixels to its side. Two shapes the eye has to associate with each other, in a
panel that already has a perfectly good idiom for "a thing at an exact tick, labelled": the
event flag, a stem with a body hanging off it.

So the cursor is now that. The stem starts at the top of the body instead of at the baseline,
which is the entire visual difference and the whole of the improvement — a flag on a pole is one
object.

The consequence is a hit test. The body is now a forty-pixel affordance that looks draggable, so
it has to be draggable, and `cursorFlagBox` in [timeline/layout.ts](../src/lib/timeline/layout.ts)
exists so that the box that responds is the box that was painted — the `visibleFlags` rule,
applied to the one piece of timeline geometry that did not previously need it.

That in turn exposed something the old 6-pixel grab zone had hidden. `TimelineHost`'s cursor
drag set the tick from the raw pointer x, so grabbing anywhere but the stem snapped the cursor
to the pointer. At ±6px nobody could see it; at the right-hand end of a forty-pixel body it is a
visible jump. The drag now carries a `grabDx` fixed at press time. **A wider grab target turned
a rounding error into a bug** — the affordance did not cause it, it revealed it.

### 3.4 Why the label offset is in screen pixels

Every other geometric property on a shape is world units and integers: `position`, `size`,
`points`. `labelOffset` is CSS pixels, and that inconsistency is deliberate.

The label is drawn at a fixed 11px at every zoom. A nudge in world units would be 10px of
clearance at z=1 and 30px at z=3 — the label drifting away from the wire it annotates, exactly
as you zoom in to look at it. In screen pixels the nudge holds the relationship it was set to
hold. The property is screen-sized because the thing it moves is screen-sized. Its `doc` string
says so, since the footer is where a user would otherwise have to discover it by experiment.

The axes come from the run, not from the screen: `par` follows the run in stored point order and
`perp` is that turned 90° clockwise, so one offset means the same thing on a horizontal wire and
a vertical one. Asserting both axes separately, on a _vertical_ run, is the point of the check in
`verify/connections.mjs` — on a horizontal run `par`/`perp` degenerate into x/y and three of the
four possible wrong rotations still pass.

The cost, recorded because it will surprise someone: re-routing an `auto` connection can hand
the label to a different run, and the offset then applies to that one.

### 3.5 A dropdown, and the trap in adding one

Three display modes that have to be typed by hand, spelled exactly, are not three display modes
anyone will find. `svelte-jsoneditor` ships `renderJSONSchemaEnum` and it was simply not wired
up; it reads the enum out of the schema `jsonSchemaFor` already generates, so the options _are_
the declaration and there is no second list to fall out of step.

Two things had to be right. It reads `classSpec`, the plain non-reactive copy, and not
`shownSpec` — this runs inside the editor's synchronous render, which is iteration 4.2 §4's trap
verbatim. And it is restricted to `mode === 'edit'`: a dropdown on `kind` would look like a
choice and be refused by `applyDocument` whichever way it was moved, which is a worse lie than
the greyed text row it would replace. Both halves are asserted.

`jsonSchemaFor` is now memoized per kind behind `schemaFor`, since the value renderer asks for
the schema once per value node per render.

### 3.6 One constant, and a boundary that left the building

`MAJOR_EVERY` is counted in minor _steps_, so five dots between majors is 6, not 5. The
level-of-detail ladder is already written in terms of the constant and needed no code change.

What did change is not obvious from the diff. LOD boundaries sit at
`MIN_DOT_PX / (GRID * MAJOR_EVERY^k)`: 0.5, then 0.1, then 0.02 at the old ratio. At 6 the second
one moves to 8/96 = 0.0833 — **below `ZOOM_MIN`, and therefore unreachable.** z = 0.5 is now the
only level change a user can provoke.

`verify/grid.mjs` had an assertion probing the z = 0.1 cliff, and it failed for the honest reason
that there is no longer a cliff there. It is now a sweep asserting there is no step anywhere
between `ZOOM_MIN` and 0.5, which is the stronger claim and the one that breaks if `ZOOM_MIN` is
lowered or the ratio is put back.

The peak cost is unchanged — it is set by `MIN_DOT_PX`, not by this ratio — so the performance
work of iterations 3.1 and 3.2 stands. The measured rect counts in those comments were taken at
5 and are annotated as such rather than silently rewritten.

### 3.7 A decoration outside `bounds` is a promise about the cull margin

The tab is drawn above the block's top edge, outside `rectOps.bounds`. `bounds` is world-space
geometry and the tab is screen-sized, so it cannot be folded in without making the bounding box
depend on zoom — which would churn the world box and the camera clamp on every wheel notch.

The house answer already existed for the connection arrowhead and label plate: screen-sized
decoration is covered by the renderer's cull margin. But that margin was an inline `16` with
three comments in three files asserting it was big enough, and this iteration added two
decorations that crowd or exceed it — a 15px tab, and a label offset bounded at 64px. Three prose
claims about a literal is how the fourth one gets it wrong, so it is now `CULL_MARGIN_PX`, and
`labelOffset`'s range is checked against it in the writer rather than only in the schema.

The residue, stated rather than fixed: `zoomToFit` pads by 64 _world_ units, which at a very low
zoom is fewer CSS pixels than the tab is tall, so a tab on the topmost block could be cropped by
a fraction. At that zoom the tab is below its size gate and is not drawn.

---

## 4. What looking at it caught that the suites did not

Four things, all after `npm run check` was clean and most of the suites were green.

**4.1 `bind:this` nulls, it does not undefine.** `CanvasTooltip` measured its box in an
`$effect` guarded by `if (el === undefined) return`. Svelte sets a `bind:this` to `null` when the
element is torn down, which for a tooltip is every single time it hides. So the first dismissal
threw `Cannot read properties of null (reading 'offsetWidth')`, on every dismissal thereafter,
and **no assertion failed** — `verify/properties.mjs` printed it in its page-errors line and
reported 38 passed. Typing the binding as optional reads perfectly well and is wrong; the type
is `HTMLDivElement | null`.

This is iteration 4.2 §6's "a green `npm run verify` does not mean the page did not throw",
collected a second time, from the other direction.

**4.2 Two mutations that were the feature working.** The no-signal-per-move assertion read 2
instead of 0. Chasing it rather than loosening the bound found both were the _previous_ tooltip
being correctly torn down as the sweep began. The fix is to settle the pointer before installing
the counter — and the assertion is now an exact zero instead of a tolerance, which is the
difference between a check and a shrug.

Scoping the observer to the diagram pane was part of the same correction: over `document.body`
it also caught the status bar creating its coordinate text node, which is iteration 3.2's
business and not this one's.

**4.3 "XBN" drew as "X…" at 116%, and the obvious fix was also wrong.** Spotted in a
full-window screenshot, on a block with room to spare. The tab's width is measured in CSS
pixels, stored in world units, and projected back by `draw` — dividing by the zoom and
multiplying by it again. At zoom 1 that round trip is exact. At 1.16 it loses the last bit, so
the budget handed to `fitText` was the measured width _minus a hair_, and a label that fit
exactly was ellipsized. Which label at which zoom is decided by the font metrics: `RF` on the
block beside it was fine.

The first fix was `Math.ceil` on the tab width, to put a pixel of slack in. It made the
screenshot right and **the regression test still passed against the unfixed code** — because
the symptom is a coin toss, and the sweep happened to win it at all seven zooms it tried. Only
when the check was rewritten to assert the _headroom_ rather than the rendering did it fail
correctly, and then it showed the ceiling's worst case was 0.08px, not 1px: `ceil` gives slack
equal to the fractional part's complement, which is near zero exactly when the input is near an
integer. It had made the toss much more likely to win without making it certain.

So the round trip is gone from the decision instead of padded against. `tabRect` returns the
CSS-pixel text budget alongside the world rectangle, and `drawTab` uses it directly. The
assertion runs the real `fitText` against the real budget over 56 label/zoom pairs, and fails
if the round trip is put back.

Two lessons, and the second is the one worth keeping: **a test written from the symptom of a
floating-point bug can pass against the bug**, and a fix that makes a failure improbable looks
exactly like a fix that makes it impossible.

**4.4 A camera left where the last group put it.** Two new groups failed on their first run
because the connection under test was culled, or its flag was 24 000px off the left edge. Both
suites drive the camera through earlier gestures and neither resets it. `resetZoom` is not
enough — it restores the zoom and leaves the pan. The fix is `zoomToFit` at the head of the new
group, and it is worth knowing before writing group N+1 of any of these files.

---

## 5. Flagged for future work

- **The tooltip is not keyboard-reachable.** It is hover-only, has `pointer-events: none` and no
  focus path. Selecting a block and pressing a key should probably raise it.
- **`zoomToFit` pads in world units** and so cannot guarantee room for screen-sized decoration.
  §3.7. One line, if a cropped tab ever actually annoys anyone.
- **The trace panel has no tooltips.** `ShapeTooltip` and `CanvasTooltip` are both general; the
  signal gutter truncates long names with `fitSignalName` and is the obvious next caller.
- **The tab and the `nw` resize handle sit on top of each other** on a selected `tabbed_left`
  block. Both are still hittable — handles win, and are tested — but it is visually tight.
- **`MONO` in `timeline/renderer.ts` and `CURSOR_FONT` in its theme are now the same string.**
  They are separate decisions that happen to agree; if they stay agreed, merge them.

---

## 6. Conventions and gotchas

- **A `bind:this` is `null` when the element is gone, never `undefined`.** §4.1. Guarding for the
  wrong one type-checks, reads fine, and throws on the first teardown.
- **Anything drawn outside `bounds` must fit inside `CULL_MARGIN_PX`**, and a property that can
  push it out must be range-checked in its writer against that constant. The schema alone is not
  enough — ajv is advisory in this editor.
- **A drawn box and a clickable box must come from one function.** `visibleFlags`, and now
  `tabRect` and `cursorFlagBox`. Three instances of the same rule; assume the fourth is coming.
- **Widening a grab target can expose a latent snap.** §3.3. Anything that sets a value from a
  raw pointer coordinate needs a grab offset the moment its hit zone is bigger than the slop.
- **Do not hit-test on pointermove.** §3.2. The dwell timer is the feature, not an optimization.
- **Measure and draw text in the same coordinate space.** The tab is drawn in CSS space, not
  device space, purely so `tabRect`'s measurement and `fillText`'s output come from one font
  string. A crisp outline was the price and it was worth paying.
- **Never re-derive a screen-pixel budget from a world-unit value.** §4.3. Carry it. The round
  trip through world units is exact at zoom 1 and loses a bit everywhere else, which makes the
  bug invisible in exactly the configuration you will test it in.
- **A regression test for a floating-point bug must be run against the bug.** §4.3. Reverting
  the fix and watching the check fail is the only thing that separates a test from a
  decoration, and here the first one passed both ways.
- **An enum property is now a `<select>`, so `editValue` cannot drive it.** Use `selectValue`.
  This is the second helper, not a smarter first one, on purpose: a helper that sniffed the DOM
  would pass just as happily against a dropdown that had silently reverted to a text box.
- **Reset the camera at the head of a new verify group.** §4.4. `zoomToFit`, not `resetZoom`.
- **Adding an `edit` property reorders the document** and will fail
  `verify/production.mjs`, which `npm run verify` does not run.

---

## 7. How iteration 5 was verified

`npm run check` clean — 479 files, 0 errors, 0 warnings. `npm run verify` 290 assertions across
six suites, all passing: grid 63, input 20, properties 44, connections 96, docking 18, trace 49.
`npm run build` then `verify/production.mjs` against the preview server: 15 passing.
`npx prettier --check src verify README.md history` clean.

Worth recording: **no suite printed a page error this time.** Four of six did in iteration 4.2,
and the habit of reading that line is what caught §4.1 here.

New assertions, and what each is there to stop:

| Assertion                                                           | The regression it catches                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| a file written before these keys existed still loads                | §3.1 — the default being dropped, which is silent                  |
| the saved block record's key array                                  | canonical order reverting to declaration order                     |
| the panel's row order against the production bundle                 | the same, where `npm run verify` cannot see                        |
| clicking a block's label tab selects the block                      | `tabRect` and the drawn tab drifting apart                         |
| a label that fits is never ellipsized, over 56 label/zoom pairs     | §4.3 — the text budget re-derived through world units              |
| and the same spot above an `inset` block selects nothing            | the tab hit box applied in the wrong mode — an invisible dead zone |
| sweeping 40 moves mutates the diagram pane zero times               | §3.2 — the dwell replaced by a hit test per move                   |
| nothing appears while the dwell is still running                    | the delay being dropped, so crossing the canvas raises tooltips    |
| an inset block does not repeat the subtitle already on it           | the `labelMode` branch in `rectOps.tooltip` being flattened        |
| a tabbed block shows the subtitle above the description             | the other half of the same branch                                  |
| pressing dismisses it, and a drag never raises one                  | a tooltip stranded over a gesture                                  |
| hovering a wire names it and describes it                           | the whole of the connection tooltip                                |
| `par` moves along the run and `perp` across it, on a _vertical_ run | a transposed sign or swapped pair — invisible on a horizontal run  |
| an offset past the cull margin is refused                           | §3.7 — a label that vanishes at the viewport edge                  |
| pressing the cursor's flag body does not move the cursor            | §3.3 — the `grabDx` being dropped                                  |
| and dragging it then does                                           | the same, over-corrected into an unresponsive flag                 |
| the flag flips left at the right edge and stays on screen           | the readout disappearing at the end of a trace                     |
| exactly five minor dots between two majors, counted in pixels       | §3.6, without phrasing the check in terms of the constant          |
| and majors 96px apart at z=1                                        | `GRID` being changed instead of `MAJOR_EVERY`                      |
| no step anywhere between `ZOOM_MIN` and z=0.5                       | a second LOD boundary being brought back into reach                |
| an editable enum is a dropdown with exactly its declared values     | §3.5                                                               |
| and a read-only one is not                                          | a dropdown that looks like a choice and is always refused          |

The two to keep are the first and the sixth. The first is the only assertion standing between
this iteration and every scene anyone has already saved, and it fails silently — a block with no
label mode still renders. The sixth is the only thing holding the tooltip to a dwell; a naive
rewrite of it would look correct, pass every other check on this list, and quietly undo
iteration 3.2.
