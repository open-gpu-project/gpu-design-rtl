# Iteration 3.1 — render performance

Status: **superseded in part by iteration 3.2.** 2026-09-21, revised 2026-09-22.

§4.2 (the strip cache), §4.3, §4.4, §4.5 and §4.6 are implemented. §4.1's experiment is built
rather than run: it is one of four runtime-switchable `GridMode`s, awaiting the real-Safari session
in [iter-3-2-measurement.md](./iter-3-2-measurement.md), which also records what §5 and §8 got
wrong. Three corrections worth reading before this document:

1. **§4.3 is only half a fix as written.** Moving the grid's bound to `canvas.width` without also
   moving `Renderer.draw`'s background fill to device space leaves the last device column
   fractionally covered — and the context is `{ alpha: false }` and never cleared, so it retains a
   fraction of the previous frame's dot colour every frame. Both halves have to move together.
2. **§4.2 overstates pixel identity.** Exact for the major tier and wherever `minorAlpha === 1`;
   one LSB per channel is the honest claim in the blend band, which is what §9 already assumed.
3. **§4.2's "the row is the unit" is a choice, not a constraint**, and its fill-rate justification
   for the blits contradicts report 1 §2, which had already ruled fill rate out as the mechanism.
   The column-strip transpose is equally exact and trades ~386 rects + 92 blits for ~152 + ~193.

And one thing §4.2 did not anticipate: the floor that keeps small grids on the direct path must be
expressed in **rows**, not dots. The major tier is always 25× sparser than the minor one, so any
dot threshold high enough to exclude a tiny high-zoom grid also leaves the major tier on the
O(area) path at every realistic window size — which defeats the point.

Read [iteration 1](./iter-1-canvas-foundation.md), [iteration 2](./iter-2-docking-and-properties.md)
and [iteration 3](./iter-3-trace-panel.md) first; their conventions still hold and are not
repeated here. This is a `.1` and not a fourth iteration because nothing is designed here: no new
panel, no new dependency, no new user-visible behaviour. It records why the canvas gets slower the
larger the window, which of the reported defects are worth fixing, and — for the one that matters
— the experiment that has to be run before any code is written.

The measurements it rests on are in
[safari-performance-report-1.md](./safari-performance-report-1.md), moved into this directory
alongside it, and followed by
[safari-performance-report-2.md](./safari-performance-report-2.md).

---

## 1. Scope

To be changed: the dot grid stops re-emitting one path node per visible dot every frame; Safari's
`gesturechange` joins the rAF accumulator every other input path already uses; the status bar's
pointer readout stops dirtying the document on every `pointermove`; and the property panel stops
reminting its whole tree whenever the effect re-runs with nothing selected.

Deliberately **not** changed: the grid's appearance, the level-of-detail ladder, the minor-tier
fade (§4.7), the 2D context attributes, the Ajv memo, and anything in the timeline stack — its
renderer draws per row and per tick, not per unit of area, so it does not have this defect.

No new dependency. The verification surface grows by two Playwright scripts, one of which needs a
downloaded browser and is therefore kept out of `npm run verify`.

## 2. Where the numbers came from

A Safari Web Inspector export (`localhost-recording.json`, 9.76 s, 2 517 records) plus instrumented
re-measurement in WebKit 26.6 and Chromium through Playwright. What each finding forces:

| Measured fact                                                                                                                                                                           | Consequence here                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 60 fps at 3 555 dots, 20.6 fps at 8 932 dots, same code and same scene                                                                                                                  | fps falls roughly linearly with dot count past a knee at 4 000–5 000. The symptom scales with canvas **area**, which is what `dots ≈ (cssW·cssH)/(GRID·z)²` says.                       |
| 64× fewer dots at an unchanged 34.8 MB bitmap restores 60 fps; 4× fewer pixels at an unchanged dot count changes nothing                                                                | It is the dot geometry, not fill rate and not the bitmap. Bitmap size, `desynchronized` and `alpha` are ruled out; do not revisit them.                                                 |
| `Renderer.draw` self-time is 0–1 ms even at 20 fps                                                                                                                                      | 2D canvas commands are queued and the path is rasterized after `draw()` returns. **Script-time profiling cannot see this defect at all**, which is why the profile never pointed at it. |
| The export has the Screenshots instrument enabled: 115 screenshots for 114 frames, 12 frames and 12 whole-page tile repaints in a fully idle 1.16 s window, main thread never past 35 % | Its `p50 41.5 ms` / `effective 11.7 fps` measure the profiler. **Not a baseline, and not a success criterion.**                                                                         |
| The recording was captured at canvas 1282×671 — about 3 555 dots                                                                                                                        | Below the knee. **The recording does not contain the bug it was captured to find.**                                                                                                     |
| 815 of 1 082 paints land in the Properties panel, which changed exactly twice in 9.76 s                                                                                                 | Real waste. §4.5 and §4.6 remove two of the things that dirty it; the escalation mechanism itself stays unexplained (§7.1).                                                             |

## 3. Decisions that came from the user

| Decision                                                     | Note                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fix D0, D2, D1 and D4** — the report's suggested order 1–4 | D3 is re-measured afterwards rather than chased, because most of it is predicted to be a consequence of D1 and D4 rather than an independent defect.                        |
| **Deterministic browser checks, plus a WebKit fps run**      | Counters and pixel diffs are what can be asserted without flaking; frame pacing is machine-dependent and is therefore printed, with only a generous floor asserted. See §9. |
| **The triage report is committed; the recording is not**     | The report is the reasoning and is worth citing. The 9.8 MB export measures the profiler (§2), so keeping it would be keeping a misleading artefact.                        |

## 4. Load-bearing decisions

### 4.1 The mechanism is not established, and settling it is the first task

Two hypotheses fit the evidence and imply different fixes:

- **H1 — per-subpath cost.** At 8 225 minor rects and ~45 ms that is ~5.5 µs per four-edge
  subpath, which is 10–30× slower than CoreGraphics should manage. Possible; the constant is
  suspicious.
- **H2 — cost proportional to (number of fills) × (path _bounding box_ area).** A path too complex
  for the accelerated path gets rasterized through a coverage buffer sized to its bounding box.
  That box is the whole canvas — 4322×2014 ≈ 8.7 Mpx, twice per frame — which lands in the observed
  range and also explains the mild superlinearity: 2.54× the dots cost at least 2.9× the time.

The discriminating experiment is two lines and carries no pixel risk: move `ctx.fill()` **inside**
the row loop of `batchDots`, so each row is its own path. Same rects, same order, same
`globalAlpha`; each fill's bounding box collapses from 8.7 Mpx to `devW × size` ≈ 13 kpx, for about
63 extra `fill()` calls. It is pixel-identical by construction because rows provably cannot overlap
(§8).

If that restores 60 fps at `z = 0.512`, **the iteration is over for D0** — no strips, no cache, no
ownership change, and the major tier is fixed for free. If it does not, H1 is proven and §4.2 is
justified by measurement rather than by assumption. The point of writing this down is that the
alternative — building the machinery first and discovering afterwards which hypothesis was true —
produces a fix nobody can explain.

### 4.2 The row is the unit, because every row is identical

If §4.1 says strips are needed: in `batchDots` a dot's x position depends only on its column index
and its y only on its row index, so **every row carries the same horizontal pattern**. The minor
tier has exactly two row kinds — ordinary, and the `mod(j, skipEvery) === 0` rows that leave holes
for the major dots to sit in.

So the grid becomes three cached one-row-tall offscreen canvases, `devW` wide, blitted once per
visible row with the three-argument `drawImage`. Building a strip costs `O(devW / stepDev)` — about
135 rects — and the blit cost is bounded by `rows × devW × size`, where `rows ≤ devH / (8·dpr)`.
That ceiling is ≈1.6 Mpx at dpr 2 **whatever the zoom**: under a fifth of the opaque background
`fillRect` the frame already pays and already absorbs at 60 fps. An O(dots) cost becomes an
O(rows × width) one with a hard upper bound.

The property being bought is **pixel identity**, not an approximation, and it is fragile in three
specific ways that §8 records as rules.

The alternatives were rejected on correctness, not on cost. `createPattern` with a tile rounded to
an integer device-pixel period cannot be right: true dot positions are
`round(x0 + (i0 + 5m + k)·stepDev)`, but a replicated tile gives `tileOrigin(m) + round(k·stepDev)`,
so the fractional part varies with the tile index and the intra-tile pattern is wrong for every
tile but one. The escape — a fractional pattern transform — resamples, producing exactly the blurry
dots the module's header comment says it exists to prevent. A CSS `radial-gradient` layer has the
same periodicity problem. A full-viewport-plus-one-period cache blitted at an integer offset is
exact but only reproduces the pattern when the camera moved a whole number of device pixels, and
`pan()` divides the screen delta by `z`, so trackpad panning produces fractional offsets
essentially always — it would rebuild everything every pan frame, and cost 39 MB on top of a
34.8 MB canvas.

### 4.3 `devW` and the bitmap width disagree today

`grid-renderer.ts` computes `devW = cssW * dpr`; `ViewController.syncCanvasSize` sets
`canvas.width = Math.round(cssW * dpr)`. `cssW` comes from a `ResizeObserver` on a pane sized by the
dock's fractional splits, so it is fractional in the **default** layout, and the loop bound uses the
unrounded value — the rightmost partial column is under-drawn. Deriving `devW`/`devH` from
`ctx.canvas.width`/`height` removes the duplicated rounding and fixes it.

This lands as its own change, before anything else. Bundled with §4.2 it would make a pixel diff
unattributable, and it is a precondition besides: `canvas.width` is an IDL `unsigned long`, so
assigning a fractional width truncates, and a strip one device column narrow leaves a one-pixel
band of bare background down the right edge.

### 4.4 One accumulator, not two input paths

`WheelController` exists to coalesce input — its docstring says so: _"A 120 Hz trackpad otherwise
drives 120 separate camera updates and repaints in a second."_ `onGestureChange` does not honour
it. It applies `zoomAt` and calls `onApplied()` synchronously, per event, and because
`#suppressPinchUntil` deliberately routes Safari away from the coalesced ctrl+wheel path, Safari is
the only engine that takes it. That is why the report reads as Safari-specific: the same pinch is
coalesced everywhere else, and here each raw event triggers a whole grid rebuild.

The fix is to fold the gesture into the accumulator that already exists rather than to add a second
one. `#apply` computes `Math.exp(-#zoomExp)`, so a gesture factor enters as
`#zoomExp -= Math.log(factor)`; `#gestureAnchor` then duplicates `#anchor` and goes away. Two
accumulators would have had to agree about anchor, ordering and clamping, and the version of this
bug that already exists is what happens when one input path is special-cased.

### 4.5 The pointer readout is sampled at snap granularity

`ToolHost.pointer` is `$state.raw` and gets a **fresh object on every `pointermove`**, written
before the pan early-return, so identity alone re-renders the status bar: 60 moves over the canvas
produce 48 document layouts, 60 moves outside produce none.

Its only reader is `StatusBar`, and it reads `.snapped` only. So the field narrows to the snapped
point and is written only when that point changes — which is at 16-world-px granularity, so most
moves become no-ops. Narrowing matters as much as de-duplicating: keeping `{ world, snapped }`
while comparing on `snapped` would leave `world` stale between snap changes, which is a trap
rather than a saving.

The zoom `%` readout needs no change. `view.z` is already written at most once per frame — `zoomTo`
early-returns on a no-op — on every path except Safari's gesture, and §4.4 closes that one.

### 4.6 `switched` belongs in all three branches

`push(doc, reset)` skips its own text-equality guard whenever `reset === true`, and the
`s === null` branch of the property effect passes `reset: true` unconditionally. Every re-run with
nothing selected therefore drops the caret and calls `editor.set({ json: {} })`, reminting the
whole tree for `{} → {}`: measured at `+12 / −15` top-level mutations per deselect, and the Safari
stack shows it re-entering Svelte's scheduler through `flushSync` mid-flush.

The other two branches already compute a `switched` flag from `shown`. This one is the only one
that does not, so it gains one — widened to catch a change in selection count, which is what keeps
the caret safe when a multi-selection shrinks and a path like `/2/...` stops resolving (iteration 2
defect 8).

Making `push`'s guard unconditional instead was rejected: `reset` also means _drop expansion state
and caret_, and that is a different question from _is the text the same_. Collapsing the two would
make the guard mean whichever of them the next caller happened to want.

### 4.7 The minor-tier fade is not a lever

At `z = 0.512` the minor tier costs about four times the `z = 1` case while `minorAlpha ≈ 0.032`,
which reads as an obvious saving: skip the tier when it is nearly invisible. It is not.

Against the background (`#0f1115` versus `#272c36`, a channel delta of 33) the tier changes zero
output pixels only while `a < 0.0151` — that is `z < 0.5057`, **about one percent of one zoom
step**. Meanwhile at `z = 0.875` the tier is fully opaque and still 29 % more expensive than the
measured 20.6-fps case. A cutoff that is perceptually free covers essentially none of the problem,
and one large enough to matter removes a real two-to-four-LSB tint — the same class of mistake as
iteration 1's bug 9, where the fade bottoming out above zero made the tier pop as it was replaced.
§4.1 or §4.2 makes the question moot.

---

## 5. Where the triage report is wrong

It is right about the cause and about the isolation. Three of its conclusions do not survive:

| #   | Claim                                                                                                               | Correction                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **"At `z ≥ 1` the level-of-detail branch never engages, so 100 % zoom is the worst case — and it is the default."** | The worst case is `z` just above 0.5, where `level` is still 0 and minor spacing is ~8.19 CSS px. At `z = 0.512` — **exactly three presses of zoom-out**, since `1/1.25³ = 0.512` — a 2161×1007 canvas holds ~31 200 minor dots against 8 225 at `z = 1`. Every number in the report under-reports by up to 4×, and every measurement here is taken at `z = 0.512`. |
| 2   | **"Render one grid period into an offscreen canvas and repeat it with `createPattern`."**                           | Not exact, for the intra-tile phase reason in §4.2 — and the drift figure implied by the report is itself 2× low: the period is 160 device px, so a 4322 px canvas holds 27 tiles, not 13.                                                                                                                                                                          |
| 3   | **"Or put the grid in a CSS `radial-gradient` layer and move it with `background-position`."**                      | Same objection as 2. Any strictly periodic representation is wrong wherever `stepDev` is not an integer, which is most zoom levels.                                                                                                                                                                                                                                 |

Its D1 finding also needs narrowing: the zoom `%` readout does cost one document layout per event
today, but only on Safari's uncoalesced gesture path (§4.4). Fixing D2 fixes that half of D1, and
the readout itself needs no change.

## 6. Order of work

1. **§4.3**, alone and first — it is an existing bug and a precondition for §4.2.
2. **§4.1**, the two-line experiment, measured at `z = 0.512` on a large canvas. Record the number
   whichever way it goes; it decides step 3.
3. **§4.2**, only if step 2 says so.
4. **§4.4** — small, Safari-specific, and it multiplies D0 today.
5. **§4.5**, then **§4.6**.
6. Re-measure D3 (§7.1) and record the result.

## 7. Flagged for future work

1. **D3 is unexplained.** Three quarters of all painting lands in the Properties panel while it is
   visually static. The invalidation is real and region-specific — it is not the screenshot
   instrument's 512×512 tiles — but why WebKit escalates a status-bar text change into a repaint of
   every JSON tree row could not be reproduced in Playwright's WebKit. Most of it should disappear
   once §4.5 and §4.6 stop dirtying the document; whatever remains needs a real Safari.
2. **`Renderer.dispose()` can fire against a live renderer.** `ViewController.detach` already
   documents that the dock may run the new component's `onMount` before the old one's cleanup. The
   stale `dispose()` cancels a pending rAF and clears `#dirty`, so a frame is lost until the next
   state change. This is why the grid's own `dispose()` must only clear its cache and never enter a
   dead state (§8) — but the underlying frame loss is untouched here.
3. **A dot whose centre falls just off the top or left edge is dropped entirely**, while one just
   off the bottom or right is drawn clipped: the loops start at `x0, y0 ≥ 0` but end at `< devW`.
   A real asymmetry, deliberately not fixed in the same change as §4.2, where it would contaminate
   the pixel diff.
4. **Still no Vitest.** Iteration 1 §6.1 and iteration 3 §7.1 stand unchanged. The grid's geometry
   — `level`, `minorStep`, `minorAlpha`, the strip's column positions — is pure and is the second
   thing after `tickTiers` that a real unit suite should cover.
5. **The same density spike recurs just above `ZOOM_MIN`**, where `level` becomes 1 and the 8-CSS-px
   spacing returns. Bounded by the same fix, but worth a measurement.

## 8. Conventions and gotchas

- **Measure at `z = 0.512`, not at `z = 1`.** See §5.1. A benchmark at 100 % zoom under-reports the
  grid's worst case by about 4×.
- **`performance.now()` around `draw()` measures nothing here.** Rasterization happens after
  `draw()` returns. Use rAF-to-rAF intervals over a sustained pan.
- **Key the grid cache on `camX`, never on `x0`.** The holed strip also depends on
  `mod(i0, MAJOR_EVERY)`, which is independent of `x0`: panning by exactly one `minorStep` leaves
  `x0` bit-identical while moving which columns are punched out. An `x0`-keyed cache would hit and
  draw the holes in the wrong places. `camX` implies both.
- **Never refactor the strip's column loop to `x0 + k * stepDev`.** The pixel coordinate is
  accumulated (`x += stepDev`) and only the index is exact; the tidy-up silently voids pixel
  identity. The file's existing comment about indices is about the major test, not about this.
- **Rows never overlap, and that is what makes one blit per row safe.** `minorAlpha > 0` requires
  `minorStep·z > 8`, hence `stepDev > 8·dpr ≥ 8`, against `size ≤ 3`; the major tier has
  `stepDev ≥ 40·dpr` against `size ≤ 5`. The `stepDev < 2` bail reads as if small `stepDev` were
  expected, and it is what a future reader will trust.
- **`canvas.width`/`height` are `unsigned long`; a fractional assignment truncates.** And assigning
  either resets all context state, so only assign on a real size change — the idiom
  `syncCanvasSize` already uses.
- **The grid's `dispose()` must only clear its cache.** It can be called against a live renderer
  (§7.2), and the next frame rebuilds anyway.
- **dpr is not only 1 or 2.** `MAX_DPR` is a `Math.min` cap, so browser zoom yields 1.25, 1.5, 1.75
  — where the dot sizes change and `cssW * dpr` is fractional for almost every integer `cssW`.

## 9. How iteration 3.1 will be verified

Two new Playwright scripts in the shape `verify/README.md` already describes, plus one thing only a
real browser on the real monitor can answer.

- `verify/grid.mjs` (new, Edge at `deviceScaleFactor` 2 **and** 1.5, with a forced fractional pane
  width) — the old `batchDots` is kept behind `import.meta.env.DEV` as a reference implementation
  so the two paths can be rendered from identical inputs and diffed with `getImageData`. Exact
  equality is asserted for the major tier and for `z ≥ 0.875`, where `minorAlpha` clamps to 1 and
  the blit is a straight opaque copy; max per-channel `|Δ| ≤ 1` for `z ∈ (0.5, 0.875)`, the only
  band where the `globalAlpha` blend path differs. Zooms covered: 0.512, 0.55, 0.9, 1, 4. It also
  patches `ctx.rect`/`fillRect`/`drawImage` to assert the per-frame rect count does not grow when
  the canvas is made twice as tall, coalesces twenty synthetic `gesturechange` events into at most
  one `draw`, counts layouts through CDP `Performance.getMetrics` for §4.5, and watches
  `[data-panel-id="properties"]` with a `MutationObserver` for §4.6. Added to `npm run verify`.
- `verify/perf-webkit.mjs` (new, `npm run verify:webkit`) — Playwright's WebKit at 3008×1692, dpr 2,
  `z = 0.512`, frame pacing from a free-running rAF loop across a scripted pan. p50, p95, fps and
  the dot count are **printed**; only a generous floor is asserted, because the number is
  machine-dependent. Kept out of `npm run verify` so the existing suites keep their property of
  needing no browser download.
- The existing `npm run verify` (97 assertions) and `npm run check`. Iteration 3 defect 2 is the
  precedent: a change to the canvas broke three unrelated suites through a `locator('canvas')`
  that was no longer unique.
- **Real Safari, by hand**, per §4 of the triage report: Screenshots instrument off, Inspector
  closed, clean profile, maximized on the large monitor, at `z = 0.512`, reporting
  `view.cssW × view.cssH` and `view.z` beside every number. Synthetic gesture events cannot settle
  real-hardware questions — iteration 1 §6.2 established that and it still holds — and this is the
  only check that speaks to the reported symptom directly.

The report this iteration is built on was produced entirely from script-time profiling and static
review, and the defect it was looking for is invisible to both: `Renderer.draw` reads 0 ms at
20 fps. **Iteration 3's conclusion needs an addition of its own: compiling is not running, running
is not looking, and looking at the script is not looking at the frame.**
