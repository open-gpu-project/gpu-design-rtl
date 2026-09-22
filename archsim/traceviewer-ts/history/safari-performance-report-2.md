# Safari performance report 2 — the level-of-detail transition

Analysis of `localhost-recording-2.json` (Safari Web Inspector export, 20.00 s, 4 538 records,
161 frames), plus static review of the tree at `d5990b2`. Follow-up to
[safari-performance-report-1.md](./safari-performance-report-1.md) and
[iter-3-1-render-performance.md](./iter-3-1-render-performance.md).

**Read this first:** the build in this recording does **not** contain any of iteration 3.1's
planned work — see [§0](#0-the-recording-is-of-the-pre-fix-build). Nothing here contradicts that;
everything here is about the same `batchDots` defect, but the recording finally shows it directly
and pins down the specific zoom band the user is reporting.

**Headline:** the reported symptom — _"when zooming between LoDs there is a lot of lag"_ — is
[**D7: crossing a level-of-detail boundary is a step discontinuity in cost, and the step lands
exactly where the new tier is invisible**](#d7--root-cause-the-lod-boundary-is-a-cost-cliff--confirmed).
One increment of zoom across `z = 0.5` takes the grid from **608 rects/frame to 14 668
rects/frame — 24×** — and the 14 060 new rects are drawn at `globalAlpha = 0.0003`. One click of
the zoom-out button across the same boundary swings the count **15.7×**.

The second finding is about _where_ that cost is paid:
[**the page's main thread is idle while it happens**](#1-all-the-wall-clock-is-in-composite-and-the-main-thread-is-idle).
6 280 ms of the 20 s recording is inside `Composite`; everything else — script, layout, style,
paint — totals **140 ms (0.7 %)**. Main-thread CPU is **3–13 %** through the worst of it. The work
is out of the web-content process, which is why report 1's `Renderer.draw` reading of 0 ms was
not just an underestimate but measuring the wrong process.

---

## 0. The recording is of the pre-fix build

| Check                                                                                                     | Result                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [grid-renderer.ts](../src/lib/canvas/grid-renderer.ts) — `batchDots` mtime                                | 2026-09-20 02:25, unchanged since `801640b`                                                     |
| [wheel.ts](../src/lib/canvas/wheel.ts) — `onGestureChange` still calls `zoomAt` + `onApplied()` per event | unchanged                                                                                       |
| `git status` on the tree the recording was taken against                                                  | only `README.md` modified; nothing under `src/`                                                 |
| Shipped bundle `dist/assets/index-CP7qwUsN.js` (built 2026-09-21 00:56)                                   | contains exactly one `ctx.rect(Math.round(...))` per-dot loop; `createPattern` 0, `drawImage` 0 |

So iteration 3.1 §4.1–§4.6 are all still open, and this recording measures the same code report 1
measured. The recording is still worth having: report 1 was taken below the dot-count knee and
[said so](./safari-performance-report-1.md); this one was taken right through it, in real Safari,
on a large window.

---

## D7 — ROOT CAUSE: the LoD boundary is a cost cliff — **confirmed**

The level ladder in [drawDotGrid](../src/lib/canvas/grid-renderer.ts) is

```
level     = max(0, ceil(log(MIN_DOT_PX / (GRID·z)) / log(MAJOR_EVERY)))     // 8, 16, 5
minorStep = GRID · MAJOR_EVERY^level
minorAlpha = clamp((minorStep·z − MIN_DOT_PX) / 6, 0, 1)
```

`level` steps at `z = 0.5` and `z = 0.1`. `minorStep` therefore steps by **5×** — so the minor
tier's dot count steps by **25×** — while `minorAlpha` restarts from **0**. The fade that makes
the transition _look_ continuous is what makes the cost _maximally_ discontinuous: the tier
switches on at its densest and least visible.

### Exact rect counts, from running the real `batchDots` loops

Canvas 1546×611 CSS, dpr 2 (bitmap 3092×1222) — the geometry in this recording.

|          z | zoom% |   L | minorStep | spacing (CSS px) | minorAlpha | **rects/frame** |
| ---------: | ----: | --: | --------: | ---------------: | ---------: | --------------: |
|     0.4900 |  49.0 |  L1 |        80 |            39.20 |      1.000 |             624 |
|     0.4999 | 50.0− |  L1 |        80 |            39.99 |      1.000 |             608 |
| **0.5000** |  50.0 |  L0 |        16 |             8.00 |  **0.000** |         **608** |
| **0.5001** | 50.0+ |  L0 |        16 |             8.00 | **0.0003** |      **14 668** |
|     0.5100 |  51.0 |  L0 |        16 |             8.16 |      0.027 |          14 175 |
|     0.5300 |  53.0 |  L0 |        16 |             8.48 |      0.080 |          13 104 |
|     0.6100 |  61.0 |  L0 |        16 |             9.76 |      0.293 |           9 796 |
|     0.7900 |  79.0 |  L0 |        16 |            12.64 |      0.773 |           5 856 |
|     0.8750 |  87.5 |  L0 |        16 |            14.00 |      1.000 |           4 730 |
|     0.9800 |  98.0 |  L0 |        16 |            15.68 |      1.000 |           3 861 |
|     1.2000 | 120.0 |  L0 |        16 |            19.20 |      1.000 |           2 560 |

The same cliff exists at the `level` 1→2 boundary: `z = 0.0990` → 624 rects, `z = 0.1010` →
**14 516**.

### The zoom button walks straight off it

`zoomByStep` uses factors of 1.25 from 1.0, so the ladder straddles the boundary:

| `z` (1.25ⁿ) | zoom% |  L  | rects/frame |
| ----------: | ----: | :-: | ----------: |
|      1.0000 |   100 | L0  |       3 686 |
|      0.8000 |    80 | L0  |       5 687 |
|      0.6400 |    64 | L0  |       8 909 |
|  **0.5120** |  51.2 | L0  |  **13 986** |
|  **0.4096** |  41.0 | L1  |     **893** |
|      0.3277 |  32.8 | L1  |       1 416 |

**One click between 51.2 % and 41.0 % changes the per-frame rect count by 15.7×.** A trackpad
pinch sweeps continuously across it, which is what the user did — six times.

### What that cost is, measured

Attributing each `Composite` record to the zoom at the rAF that started it (see
[§2.3](#23-the-canvas-in-each-screenshot-is-one-frame-behind-the-toolbar) for why the naive
attribution is wrong by one frame):

| tier                  | frames | median rects | median `Composite` |      range |
| --------------------- | -----: | -----------: | -----------------: | ---------: |
| **L1** (below z = .5) |     23 |          893 |         **3.4 ms** | 1.6–131 ms |
| **L0** (above z = .5) |     35 |        8 468 |       **162.3 ms** | 1.5–330 ms |

Composite time against rect count over all 58 non-trivial frames: **r = 0.675**, slope
**14 µs/rect**, intercept 34 ms. Over the whole gesture, 279 702 rects cost 5 904 ms of composite
— **21 µs per rect**.

The transition itself, frame by frame, at the first crossing (gesture #0):

```
k=24  z≈0.469  L1     697 rects    Composite    2.3 ms
k=25  z≈0.482  L1     640 rects    Composite   63.5 ms   <- crossing starts inside this frame
k=26  z≈0.511  L0  13 986 rects    Composite   72.8 ms
k=27  z≈0.555  L0  12 006 rects    Composite  213.0 ms
k=28  z≈0.642  L0   8 850 rects    Composite   85.5 ms
k=29  z≈0.656  L0   8 526 rects    Composite  110.0 ms
```

### Why this matches the report exactly

- Below `z = 0.5` the grid is ~900 rects and composite is **1.6–4.0 ms**. Smooth.
- Above `z = 0.5` it is 9 000–14 700 rects and composite is **73–330 ms**. 3–5 fps.
- The worst band is `z ∈ (0.50, 0.55)` — the first 10 % of one zoom step above the boundary —
  where the tier costs the most and is between 0.03 % and 13 % opaque.

---

## 1. All the wall-clock is in `Composite`, and the main thread is idle

Every timed record in the export, summed:

| record kind                     |    n |  total ms | mean ms |    max ms |
| ------------------------------- | ---: | --------: | ------: | --------: |
| **`Composite`**                 |  161 | **6 280** |    39.0 | **329.9** |
| `Layout`                        |  232 |      60.5 |    0.26 |       1.9 |
| all script records              |  915 |      65.9 |    0.07 |       2.5 |
| all `Paint` records             | 2400 |       9.9 |   0.004 |      0.11 |
| `Recalculate Styles`            |  233 |       3.0 |   0.013 |      0.07 |
| **everything except composite** |    — |  **≈140** |       — |         — |

140 ms of 19 966 ms is **0.7 %**. And during the worst stretch the web-content process is barely
running:

| window                 | `Composite` per frame | Main-thread CPU |
| ---------------------- | --------------------: | --------------: |
| t = 4–14 s (the pinch) |             86–330 ms |      **3–13 %** |
| t = 15–17 s (idle)     |            0.0–0.1 ms |         25–34 % |

The idle tail burns _more_ CPU than the janking gesture does — that's the screenshots instrument.
A page doing 300 ms of its own work per 350 ms frame would peg the main thread; this one is at 5 %.
**The page is blocked, not busy.** The rasterization of the canvas display list, and of the DOM
layers, happens in Safari's GPU process; `Composite` is where the page waits for it.

The JS sampler agrees: **25 samples in 20 s** (the main thread is almost never in JS), and **10 of
the 25 are inside `Renderer.draw`** — 6 of those in `batchDots`, at `rect` or `fill`:

```
fill  <- batchDots <- drawDotGrid <- draw <- #tick
rect  <- batchDots <- drawDotGrid <- draw <- #tick     (x3)
```

### The frame loop, and why it runs at 4 fps

52 rAF callbacks were requested and 52 fired, in 20 s. Request → fire latency: **p50 166 ms,
p90 362 ms, max 435 ms**. The cycle, from the raw records:

```
t=8.8911  gesturechange                  (60 Hz, 0.03–0.13 ms each)
t=8.8912  rAF 1085 requested
t=8.8917  Recalculate Styles + Invalidate Layout + Layout(0,0,2132,1089)   0.33 ms
t=8.8920  rAF 1085 fired                                                   0.93 ms  <- draw()
t=8.8932  Composite                                                      329.93 ms  <- blocked
   ...    23 more gesturechange events land inside the composite, each doing a layout
t=9.2231  (composite ends)
t=9.2758  rAF 1086 fired                                                   0.74 ms
t=9.2768  Composite                                                      299.18 ms
```

The next rAF cannot fire until the composite completes, so the effective canvas frame rate during
the pinch is **52 draws / ~12 s ≈ 4.3 fps**, and 346 input events collapse into 52 rendered
frames. `Renderer.requestFrame`'s rAF coalescing is working exactly as designed — report 1's
D2 does **not** produce one draw per gesture event. What D2 produces is one camera update, one
effect flush and one full-document layout per event; see [§4.1](#41-d1d2-346-events-232-full-document-layouts--confirmed-cheap-in-cpu-not-in-invalidation).

---

## 2. Caveats: what in this recording is trustworthy

### 2.1 The screenshots instrument is on again

161 screenshots for 161 frames, 1:1. The **idle** frame floor is 41.4–48 ms with `Composite` at
0.05 ms, so the instrument costs ~42 ms of frame time. **Frame durations
(min 41.4, p50 48.9, p90 293.7, max 1825 ms) are inflated; do not use them as a baseline.**

### 2.2 `Composite` durations, however, do look clean

All 161 `Composite` records end within **0.002 ms of a screenshot timestamp** — the inspector
closes the record when it captures. That raises the question of whether capture cost is inside the
record. It is not: in the 90 idle frames a screenshot is still captured and `Composite` reads
**0.05 ms**. So the capture is timestamped at composite end and paid afterwards.

**Conclusion: use the `Composite` durations and the L0/L1 ratio. Ignore the frame durations.**

### 2.3 The canvas in each screenshot is one frame behind the toolbar

Screenshot _k_ shows the toolbar's zoom readout from composite-**end** but the canvas from
composite-**start** — one frame of divergence, which at 200–300 ms per frame is 5–15 % of zoom.
Verified two independent ways:

- **Grid period by autocorrelation.** Screenshot k=53 reads "119 %" but its grid period measures
  17 px, which is 105 % (16.80 px), the previous reading. k=54 reads "120 %" and measures 19 px =
  119 %.
- **Visual.** k=29 reads 65 % and shows the dense L0 texture; k=30 reads **42 %** and still shows
  the dense L0 texture; k=31 reads 40 % and the fine tier is gone. Same at k=56 (61 %) → k=57
  (42 %, still dense).

This matters because the naive mapping makes several 200 ms frames look like they happened at
~900 rects, which is how you end up concluding that rect count doesn't matter. Every number in
[D7](#d7--root-cause-the-lod-boundary-is-a-cost-cliff--confirmed) uses zoom interpolated to the
composite's **start**.

---

## 3. The residual: cost persists after a heavy run — **mechanism unresolved**

After the correction in §2.3, rect count explains the bulk of the variance but not all of it. The
same ~900-rect L1 frame costs 2.5 ms in one place and 86–131 ms in another. The pattern is
persistence:

| L0 excursion before it           | following L1 frames (rects ≈ 900–1 300) | recovery                    |
| -------------------------------- | --------------------------------------- | --------------------------- |
| **1 frame** (k=11, 12 006 rects) | 4.0, 3.4, 2.6, 1.6, 2.5, 2.0 … ms       | immediate                   |
| **5 frames** (k=26–30)           | 13.6, 85.9, 108.1, 96.4 ms → then 2.8   | ~4 frames / **0.67 s**      |
| **~20 frames** (k=37–57)         | 119.2, 120.2, 131.3, 115.7 ms           | never, within the recording |

All four of those expensive frames were checked visually and do show the sparse L1 grid, so this
is not another off-by-one. The shape — cost that builds with the length of the heavy run and
decays over a few hundred ms — is what a draining queue or a rendering-mode flip with hysteresis
looks like. Two candidates, neither observable from the page:

- **A backlog in the GPU process.** Fitting a single drain rate does not work: the cumulative
  ratio walks from 6.3 to 21 µs/rect across the recording rather than holding constant.
- **WebKit demoting the canvas off the accelerated path** after a run of over-complex frames, and
  taking some hundreds of ms to promote it back.

Do not build anything on either. It is called out because it is the one thing in this recording
that rect count does not explain, and because it predicts that a fix which merely _reduces_ the
peak may still leave a tail — which is a reason to make the grid's cost flat rather than smaller.
[§6.3](#63-the-experiment-that-would-settle-3) says how to test it.

---

## 4. Confirmed, unfixed, and now competing for the same bottleneck

Report 1's secondary defects are all still present. The new thing worth saying is that they are no
longer merely wasteful: they queue DOM rasterization into **the same GPU process the canvas is
waiting on**.

### 4.1 D1/D2: 346 events, 232 full-document layouts — **confirmed, cheap in CPU, not in invalidation**

346 `gesturechange` events (60 Hz instantaneous), each: `zoomAt` → `onApplied()` → Svelte flush →
`Recalculate Styles` → `Invalidate Layout` → **`Layout (0, 0, 2132, 1089)`**. 232 of those
layouts, 0.26 ms median, 60 ms total. Cheap on the clock. But each one dirties the document, and
the document is what gets re-rasterized in §4.2.

The zoom readout at [Toolbar.svelte:148-153](../src/components/Toolbar.svelte#L148-L153) already
has `min-w-14 tabular-nums`, so the text change is width-neutral — yet the layout WebKit runs is
still whole-document. Report 1's D1 recommendation ("stop the `%` readout driving a document
layout") does not follow from a width change; the layout is being forced by something else and
narrowing the readout will not remove it. Iteration 3.1 §4.5 was already right to leave the
readout alone.

### 4.2 D3: two panels, zero visual change, ~7 Mdev-px re-rasterized per frame — **confirmed with pixel evidence**

All 161 screenshots were decoded and fixed regions hashed per frame:

| region               | **distinct visual states in 20 s** | `Paint` records |
| -------------------- | ---------------------------------: | --------------: |
| **Properties panel** |                              **1** |       **1 764** |
| **Trace panel**      |                              **1** |         **490** |
| Status bar           |                                  3 |               — |
| Toolbar              |                                 51 |               — |
| Diagram canvas       |                                 53 |              52 |

The Properties panel did not change a single pixel in the entire recording and was painted 1 764
times. The Trace panel did not change a single pixel and its tiled layer was repainted 490 times.

Every composited frame carries the identical invalidation set — 48 paints, byte-identical between
a 2.3 ms composite and a 291 ms one:

| layer                                       | per frame | device px at dpr 2 | pixels that changed |
| ------------------------------------------- | --------: | -----------------: | ------------------- |
| root layer, 2132×1089 CSS                   |         1 |       **9.29 Mpx** | toolbar text only   |
| trace panel tiles, 8×(512×369) + 2×(84×369) |        10 |       **6.29 Mpx** | **none**            |
| diagram canvas, 1546×611                    |         1 |           3.78 Mpx | all of it           |
| properties panel, 580×428                   |        36 |           0.99 Mpx | **none**            |
| **total**                                   |           |       **20.3 Mpx** | 3.78 Mpx (19 %)     |

The 36 properties paints are individual element repaints — origins stepping by 16 px in y and by
16/32 px in x, matching the JSON tree's row height and indent levels, exactly as report 1 saw.
They are **not** the properties effect re-running: its dependencies are `scene.shapes`,
`scene.selection`, `trace.selectedEvent` and the two `gestureVersion` counters
([PropertiesView.svelte:251-259](../src/views/PropertiesView.svelte#L251-L259)), and a trackpad
pinch changes none of them (`ToolHost.isGesturing()` is pointer-drag state
([host.svelte.ts:100](../src/lib/tools/host.svelte.ts#L100)), and `gestureVersion` is only bumped
on pointer gestures). So report 1's D3 stands with its mechanism still unexplained — the
invalidation is real, region-specific and produces zero pixels.

`Paint` record durations are 0.004 ms mean, which is display-list recording; the 20.3 Mpx is
rasterized later, in the GPU process, inside the same `Composite` the canvas is waiting on.

### 4.3 D4 and D5 unchanged

Nothing in this recording speaks to either. D4 ([PropertiesView.svelte:224-230](../src/views/PropertiesView.svelte#L224-L230))
never fires here because a block stays selected throughout. D5's Ajv memo is working (3
`api-script-evaluated` records, 1.9 ms total).

---

## 5. What this changes about iteration 3.1

Iteration 3.1's diagnosis and plan survive. Five things need adjusting.

| #   | Iteration 3.1 said                                                                                              | Correction from this recording                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §5.1: "the worst case is `z` just above 0.5"                                                                    | **Right, and now exact.** The worst case is `z = 0.5 + ε`: 14 668 rects versus 608 one increment below. §8's "measure at `z = 0.512`" is within 5 % of the peak and is a fine benchmark point — but the _symptom_ is a transition, so it has to be measured as a **sweep across 0.5**, not at a point.                                                      |
| 2   | §4.1: the discriminating experiment is to move `fill()` inside the row loop (H1 per-subpath vs H2 bounding-box) | Still a valid experiment, but there is now a **third hypothesis**: the cost is the display list crossing to the GPU process, one item per `ctx.rect()`. H3 predicts the same null result as H1, so a negative result no longer proves H1 — it proves "not H2". Both remaining branches point at §4.2.                                                       |
| 3   | §4.7: "the minor-tier fade is not a lever"                                                                      | **Confirmed, and the reasoning is now stronger, not weaker.** At `z = 0.5001` the tier costs 14 060 rects at `alpha = 0.0003` — 0.01 LSB, provably zero output pixels. But the zero-output band is `z < 0.5057`, ~1 % of one zoom step, and by `z = 0.79` the tier is 77 % opaque and still 5 856 rects. A cutoff cannot fix this. Do not chase it.         |
| 4   | §9: `verify/perf-webkit.mjs` in Playwright's WebKit as the fps check                                            | Playwright's WebKit reproduces the **direction** (report 1: 60 fps → 20.6 fps) but understates the magnitude by roughly **3.5×** — 5.4 µs/dot there against 19 µs/rect here at a comparable dot count — because it does not have Safari's GPU-process canvas. Keep it as a **regression gate on rect counts**; do not treat its frame times as predictions. |
| 5   | §4.4 / report 1 D2: "each raw event triggers a whole grid rebuild"                                              | **Not true.** `Renderer.requestFrame` coalesces to one draw per rAF: 346 events → 52 draws. D2's real cost is 346 camera updates, 232 full-document layouts and 346 page-wide invalidations — not 346 grid rebuilds. Still worth fixing, but it is not a multiplier on D0.                                                                                  |

And one addition: **§4.2's strip-and-blit is the right shape of fix, and this recording says so
quantitatively.** Rows to blit at the zooms that matter:

|      z | rects today | strip blits (minor rows + major rows) |
| -----: | ----------: | ------------------------------------: |
| 0.5001 |      14 668 |                                **93** |
| 0.5120 |      13 986 |                                **90** |
| 0.6400 |       8 909 |                                **72** |
| 1.0000 |       3 686 |                                **47** |
| 0.4096 |         893 |                                **23** |
| 0.1010 |      14 516 |                                **92** |

The count is bounded by `devH / (MIN_DOT_PX · dpr)` at every zoom — which is what turns the cliff
into a step of ~70 blits instead of ~14 000 rects, and is the property §3's unexplained residual
argues for: not a smaller peak, a flat one.

---

## 6. How to measure this properly

### 6.1 Turn the screenshots instrument off

Script / Layout & Rendering / CPU only. Then `Composite` is the number to watch, and the frame
durations become usable too.

### 6.2 Measure the sweep, not a point

The defect is a transition. In-page recorder that needs no inspector — it reports rect count
directly, which is the quantity to hold down:

```js
let rects = 0;
const R = CanvasRenderingContext2D.prototype.rect;
CanvasRenderingContext2D.prototype.rect = function (...a) {
  rects++;
  return R.apply(this, a);
};
const t = [],
  n = [];
(function loop(ts) {
  t.push(ts);
  n.push(rects);
  rects = 0;
  requestAnimationFrame(loop);
})();
// pinch slowly from 40% to 70% and back, then:
const d = t.slice(1).map((x, i) => x - t[i]);
console.table(
  d.map((ms, i) => ({ ms: Math.round(ms), rects: n[i + 1] })).filter((r) => r.rects > 0),
);
console.log({ cssW: __view.cssW, cssH: __view.cssH, dpr: __view.dpr, z: __view.z });
```

Report `cssW × cssH`, `dpr` and `z` beside every number, and take it **maximized on the large
monitor** — the cliff height scales with canvas area.

### 6.3 The experiment that would settle §3

Two runs, same target `z = 0.45` (L1, ~900 rects), reached differently:

1. From `z = 0.45` already — pinch gently within L1 only. Expect ~2–4 ms composite.
2. After holding `z = 0.53` for ~3 s of continuous pinching, then dropping to `z = 0.45` and
   holding. Measure the first 10 frames after the drop.

If run 2's L1 frames start at 100+ ms and decay over ~0.5–1 s, the persistence in §3 is real and
reproducible, and it means the fix has to hold the peak down — a fix that merely halves it will
still trigger the tail. If run 2 matches run 1, §3 was an artifact of this recording and can be
dropped.

### 6.4 Already ruled out — do not spend time here

- **Bitmap size / fill rate**, `desynchronized`, `alpha` — report 1 isolated these; unchanged.
- **The `minorAlpha` cutoff** — §5 item 3.
- **The zoom-% readout's width** — §4.1; it is already `min-w-14 tabular-nums`.
- **Script time anywhere.** 66 ms of JS in 20 s. There is nothing to win in the main thread.

---

## 7. Suggested order of work for iteration 3.2

1. **Iteration 3.1 §4.3** — derive `devW`/`devH` from `ctx.canvas.width/height`. Existing bug,
   precondition for the rest, unchanged.
2. **Iteration 3.1 §4.1 then §4.2** — the strip cache. This is D0 and D7; they are the same
   defect, and §4.2 is what flattens the LoD cliff. Every one of §8's rules still applies; note
   §5 item 2 above before reading the §4.1 experiment as decisive.
3. **Verify across the boundary**, per §6.2 — a sweep through `z = 0.5` and through `z = 0.1`,
   in real Safari, maximized, screenshots instrument off. Assert on **rect count per frame**
   (deterministic) and print composite/frame times (machine-dependent).
4. **D3 / §4.2 of this report** — 20.3 Mdev-px of layer re-rasterization per frame for 3.78 Mdev-px
   of change. This was "waste, mechanism unexplained" in report 1; it is now waste that contends
   for the process the canvas is blocked on, so it is worth more than iteration 3.1 gave it.
   Iteration 3.1 §4.5 and §4.6 remove two things that dirty the document; re-measure the panel
   and tile paint counts afterwards and record what is left.
5. **Iteration 3.1 §4.4** — fold `onGestureChange` into the accumulator. Still correct, still
   small; re-scoped by §5 item 5 from "multiplies D0" to "346 camera updates and 232 document
   layouts that should be 52 and 52".
6. **Run §6.3** and record the answer either way.

Nothing here justifies touching the LoD ladder, the fade, `MIN_DOT_PX`, the context attributes, or
the timeline renderer.

---

## Appendix — methodology

- The export was parsed with Python. All 161 embedded screenshots were base64-decoded with
  Pillow/numpy (installed into a throwaway venv at `/tmp/perfvenv`), fixed regions hashed per
  frame to count visual changes, and the canvas region autocorrelated column-wise to recover the
  rendered grid period independently of the toolbar readout.
- The zoom trajectory was read off the toolbar in all 161 screenshots (montage of the readout
  crop), then linearly interpolated over screenshot timestamps and evaluated at each `Composite`'s
  start time — see [§2.3](#23-the-canvas-in-each-screenshot-is-one-frame-behind-the-toolbar).
- Rect counts are not analytic estimates. `batchDots`' two nested loops, `mod`, the `skipEvery`
  test and the `stepDev < 2` bail were transcribed to Python and **run** at each zoom, with
  `devW/devH = 3092/1222` and a fractional camera, so the counts include the truncation and the
  holes-for-majors behaviour of the real code.
- **No browser was run for this report and no application source was modified.** The out-of-process
  finding in [§1](#1-all-the-wall-clock-is-in-composite-and-the-main-thread-is-idle) is not
  reproducible in Playwright's WebKit, which is the only browser available here, and iteration 1
  §6.2 already established that synthetic gesture events cannot settle real-hardware questions.
  §6 is written so the remaining measurements happen in real Safari, where the defect lives.
