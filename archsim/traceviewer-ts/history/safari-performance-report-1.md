# Safari performance report — traceviewer-ts

Analysis of `localhost-recording.json` (Safari Web Inspector timeline export, 9.76 s, 2517 records),
plus static review of `archsim/traceviewer-ts` and instrumented re-measurement in WebKit 26.6 and Chromium.

**Headline:** the reported symptom — _"the larger the canvas, the laggier"_ — is caused by
[**D0: the dot grid is re-emitted from scratch every frame and its cost scales with canvas area**](#d0--root-cause-the-dot-grid-is-oarea-per-frame--confirmed).
At a laptop-sized canvas it is free; at a large-monitor canvas it drops the app to ~20 fps on its own.
This is measured and isolated, not inferred.

Separately, **the numbers inside the supplied recording are not trustworthy** — see
[§1](#1-caveat-the-recording-is-partly-measuring-the-profiler). Do not use them as a baseline.

---

## D0 — ROOT CAUSE: the dot grid is O(area) per frame — **confirmed**

[`drawDotGrid` / `batchDots`](../src/lib/canvas/grid-renderer.ts#L16-L53) builds one
path containing **one `ctx.rect()` per visible dot** and fills it, every frame, for both the minor and
major tier. The number of dots is:

```
dots ≈ (cssW × cssH) / (GRID × z)²        GRID = 16
```

Note what is _not_ in that formula: `dpr`. `stepDev = step · z · dpr` and the loop bounds are
`devW = cssW · dpr`, so the `dpr` cancels. **Dot count depends only on the CSS size of the canvas and the
zoom level.** At `z ≥ 1` the level-of-detail branch never engages (`level = 0`), so 100 % zoom is the
worst case — and it is the default.

### Measured: fps vs. canvas size (WebKit 26.6, dpr 2, sustained pan)

| Viewport                    | Canvas CSS | Bitmap              | Dots/frame | `Renderer.draw` | **fps**  |
| --------------------------- | ---------- | ------------------- | ---------- | --------------- | -------- |
| 1280×800                    | 917×419    | 1833×837 (6.1 MB)   | 1 638      | 0 ms            | **60.0** |
| 1512×982                    | 1084×539   | 2168×1077 (9.3 MB)  | 2 410      | 0 ms            | **60.0** |
| 1787×1183 _(the recording)_ | 1282×671   | 2564×1343 (13.8 MB) | 3 555      | 0 ms            | **60.0** |
| 2056×1329                   | 1475×768   | 2951×1536 (18.1 MB) | 4 654      | 1 ms            | **54.6** |
| 2560×1440                   | 1838×841   | 3677×1682 (24.7 MB) | 6 348      | 1 ms            | **36.3** |
| 3008×1692                   | 2161×1007  | 4322×2015 (34.8 MB) | 8 932      | 1 ms            | **20.6** |

The knee is around **4 000–5 000 dots**. Below it, 60 fps; above it, fps falls roughly linearly with dot
count.

### Isolation: it is the dots, not the pixels

Two controlled A/Bs separate "big bitmap" from "many dots":

**Same bitmap (34.8 MB), different dot counts — vary zoom:**

|       | Bitmap              | Dots/frame | fps      |
| ----- | ------------------- | ---------- | -------- |
| z = 1 | 4322×2015 (34.8 MB) | 8 513      | **20.7** |
| z = 8 | 4322×2015 (34.8 MB) | 133        | **60.0** |

**Same dot count (~8 500), different bitmap — vary dpr:**

|         | Bitmap              | Dots/frame | fps      |
| ------- | ------------------- | ---------- | -------- |
| dpr 1   | 2161×1007 (8.7 MB)  | 8 513      | **21.0** |
| dpr 1.5 | 3242×1513 (19.6 MB) | 8 530      | **21.0** |
| dpr 2   | 4322×2015 (34.8 MB) | 8 513      | **20.7** |

64× fewer dots at an unchanged bitmap restores full frame rate. 4× fewer pixels at an unchanged dot count
changes nothing. **The cost is the dot geometry, full stop.**

I also A/B'd the 2D context attributes at every size — `desynchronized: true/false` × `alpha: true/false`
([view.svelte.ts:34](../src/lib/canvas/view.svelte.ts#L34)) — and the differences were
inside noise (e.g. at 5K-scaled: 20.4 / 20.7 / 20.4 / 19.3 fps). The context flags are **not** implicated;
don't spend time there.

### Why `Renderer.draw` looks innocent

`Renderer.draw` measures **0–1 ms even at 20 fps**. That is not exoneration: 2D canvas commands are
queued, and the rasterization of a single path holding ~8 500 sub-rectangles happens after `draw()`
returns, outside any JS timing. Any profiling that only looks at script time — including the supplied
Safari profile — will miss this entirely. That is very likely why nothing in the recording points at the
grid.

### Why this matches the report exactly

- Laptop-sized canvas → ~1 600–3 500 dots → 60 fps. Fine.
- Large monitor, maximized → ~8 500+ dots → ~20 fps. Visibly laggy, and it gets worse the bigger the
  window, exactly as described.
- The supplied recording was taken at 1787×1183 (canvas 1282×671, ~3 555 dots) — _below_ the knee. **The
  recording does not contain this bug.** It was captured at a window size where the grid is still free,
  which is part of why the profile is so hard to read.

Fix direction (for the downstream agent, not done here): render one grid period into an offscreen canvas
and repeat it with `createPattern` + a single `fillRect`, or put the grid in a CSS
`radial-gradient` layer behind the canvas and move it with `background-position`. Either makes the grid
O(1) per frame. The existing comment at
[grid-renderer.ts:9-14](../src/lib/canvas/grid-renderer.ts#L9-L14) already notes that
batching beat per-dot `arc()`+`fill()` by ~10×; the next step is to stop re-emitting the geometry at all.

---

## 1. Caveat: the recording is partly measuring the profiler

The export has `timeline-record-type-screenshots` enabled. That instrument captures a full-page image
every frame and dominates the frame statistics.

| Observation                                                    | Value                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Screenshots vs. rendering frames                               | 115 vs. 114 — **1:1**, median offset from frame end **1.4 ms**            |
| Fully idle window 8.60–9.76 s (0 input, 0 rAF, 0 timers, 0 JS) | still **12 frames, 12 paints** in 1.16 s                                  |
| Geometry of those idle paints                                  | a 4×3 grid of 512×512 / 512×159 / 251×512 tiles = whole-page tile capture |
| Main-thread CPU across the whole recording                     | **0–35 %**, peak 35 %                                                     |
| Paints attributable to the tile grid                           | 84 of 1082 (7.8 %)                                                        |

An idle page with nothing scheduled should produce **zero** frames; this one produced 12 and repainted the
whole page as tiles. And an app janking at 11 fps from its own work would peg the main thread near 100 %;
this one never passed 35 %.

**So `min frame 35.2 ms`, `p50 41.5 ms`, `114/114 frames > 16.7 ms`, `effective 11.7 fps` are artifacts of
the capture, not measurements of the app.** Re-measure per [§4](#4-how-to-get-a-clean-measurement) before
using any number as a baseline or a success criterion.

---

## 2. What the recording _does_ show reliably

Event counts, paint invalidation regions, layout counts and JS stacks are unaffected by screenshot
overhead. They expose real waste — though, per D0, none of it is the main event.

### 2.1 Three quarters of all painting produces no visible change

| Region                                       | Paints  | Share      |
| -------------------------------------------- | ------- | ---------- |
| **Properties panel** (499 px wide, x = 1288) | **815** | **75.3 %** |
| Full-page tiles (screenshot instrument)      | 84      | 7.8 %      |
| Trace panel (1785×329)                       | 82      | 7.6 %      |
| Full page (1787×1183)                        | 36      | 3.3 %      |
| Diagram canvas (1282×673)                    | 24      | 2.2 %      |

I decoded all 115 embedded screenshots (pure-stdlib PNG decoder — Pillow/numpy unavailable here) and
hashed fixed regions per frame to count how often each area _actually changed_:

| Region           | Distinct visual states in 9.76 s | Paints |
| ---------------- | -------------------------------- | ------ |
| Properties panel | **2**                            | 815    |
| Trace panel      | **1**                            | 82     |
| Status bar       | **1**                            | —      |
| Diagram canvas   | 36                               | 24     |

The Properties panel changed **exactly once** in the entire recording (when the new block became
selected) and was repainted 815 times. The Trace panel never changed and was repainted 82 times.

### 2.2 One pinch event → ~40 panel repaints

A single 152.3 ms frame at t = 5.97, driven by one `gesturechange`:

```
5.9702  EVENT gesturechange
5.9709  paint at(1,167)    1282x673     <- the canvas; legitimate
5.9709  paint at(1287,377) 499x490      <- Properties panel
5.9709  paint at(1288,414) 499x490          x4
5.9709  paint at(1290,432) 499x490          x2
5.9709  paint at(1290,480) / (1306,480) / (1322,480) / (1409,481)
 ...    (~40 total; y steps by 16 px = one JSON tree row each)
5.9709  paint at(1,944)    1785x329     <- Trace panel
5.9709  paint at(0,90)     1787x1183    <- whole page
```

The 16 px stride and the x offsets (1290 / 1306 / 1322 / 1338 / 1380 / 1409) match the JSON tree's row
height and indent levels: every row of the property editor repaints per pinch event, showing unchanged
content.

### 2.3 Stack evidence

60 JS stacks in `recording.samples[0].stackTraces`, max depth **229**. Frames by origin: svelte runtime
1207, **svelte-jsoneditor 856**, index-client 354, app code ~60. The deepest is a synchronous re-creation
of the whole editor, re-entered from inside an effect flush:

```
run_micro_tasks → flush → #process → flush_queued_effects → update_effect
  → $effect       (PropertiesView.svelte)
  → push          (PropertiesView.svelte)
  → set           (svelte-jsoneditor)
  → flushSync     (svelte runtime)            <-- re-enters the scheduler mid-flush
    → JSONEditorRoot → TreeMode → JSONNode → JSONKey → ...
    → create_effect / create_item / cloneNode  <-- built from scratch, not updated
```

---

## 3. Secondary defects

Real waste, worth fixing, but **not** the cause of the size-dependent lag.

### D1 — Every pointermove and every zoom event forces a document layout — **confirmed**

Two readouts re-render on raw input events:

- [Toolbar.svelte:153](../src/components/Toolbar.svelte#L153) — `{Math.round(view.z * 100)}%`, changes on every zoom event.
- [StatusBar.svelte:41](../src/components/StatusBar.svelte#L41) — pointer x/y; `host.pointer` is written unconditionally at [host.svelte.ts:156](../src/lib/tools/host.svelte.ts#L156).

Controlled A/B in Chromium (CDP `Performance.getMetrics`):

| Scenario                                                 | Layouts |
| -------------------------------------------------------- | ------- |
| 60 mouse moves **over** canvas (status bar updates)      | **48**  |
| 60 mouse moves **outside** canvas (control)              | **0**   |
| 30 wheel-pan events (canvas redraws, no text change)     | **1**   |
| 30 ctrl+wheel zoom events (canvas redraws + zoom % text) | **30**  |
| 30 ctrl+wheel zoom events, **zoom-% element hidden**     | **0**   |

The last two rows isolate it exactly: the canvas redraw costs zero layouts; the `%` readout costs one full
document layout per event. Cheap in absolute terms (5–11 ms per 30–60 events) but it is what dirties the
document on every single input event.

### D2 — Safari-only: `onGestureChange` bypasses the rAF accumulator — **confirmed by code**

[wheel.ts:149-159](../src/lib/canvas/wheel.ts#L149-L159) applies the camera change and
calls `onApplied()` **synchronously, per event**, while every other input path accumulates into one rAF
([wheel.ts:171-189](../src/lib/canvas/wheel.ts#L171-L189)). The class docstring
([wheel.ts:74-77](../src/lib/canvas/wheel.ts#L74-L77)) says the accumulator exists
precisely to stop this:

> _"Accumulates wheel input and applies it once per animation frame. A 120 Hz trackpad otherwise drives
> 120 separate camera updates and repaints in a second."_

Safari is the only engine that takes this path — it alone fires `gesturestart`/`gesturechange`/`gestureend`,
and `#suppressPinchUntil` ([146](../src/lib/canvas/wheel.ts#L146),
[153](../src/lib/canvas/wheel.ts#L153),
[163](../src/lib/canvas/wheel.ts#L163)) deliberately routes Safari _away_ from the
coalesced ctrl+wheel path. So on Safari a pinch runs the camera update and D1's layout at raw trackpad
rate; on Chromium the same gesture is coalesced to one per frame.

This compounds D0 badly: at a large canvas each of those uncoalesced events triggers a full ~8 500-dot
grid rebuild.

### D3 — Properties panel repaints on nearly every input event while visually static — **waste confirmed, escalation path unexplained**

Quantified in §2.1/§2.2. What is confirmed: the invalidation is real and region-specific (not the
screenshot tiles, which have distinct 512×512 geometry). What is **not** established is why WebKit
escalates a status-bar/toolbar text change into a repaint of every JSON tree row — I could not reproduce
that escalation in Playwright's WebKit. Treat the waste as confirmed and the mechanism as open.

### D4 — `push(doc, reset=true)` skips its own idempotence guard — **confirmed**

[PropertiesView.svelte:224-230](../src/views/PropertiesView.svelte#L224-L230):

```ts
function push(doc: unknown, reset: boolean): void {
  const text = JSON.stringify(doc);
  if (!reset && text === pushed) return; // guard skipped whenever reset === true
  pushed = text;
  if (reset)
    editor?.set({ json: doc }); // "mints a new instance and resets both"
  else editor?.update({ json: doc });
}
```

The `s === null` branch at
[PropertiesView.svelte:294-302](../src/views/PropertiesView.svelte#L294-L302) always
passes `reset: true`, so every run of that effect with nothing selected performs a full `editor.set()` —
rebuilding the whole tree even when the document is identical (`{}` → `{}`). Measured in Chromium via
MutationObserver: each deselect replaces all rows (`+12 / −15` top-level mutations), each reselect
`+11 / −12`. The Safari stack in §2.3 shows this happening synchronously inside the effect flush via
`flushSync`, which re-enters Svelte's scheduler — a latent correctness hazard as much as a perf one.

Panel DOM is small today (144 elements, 12 rows), so the absolute cost is low, but it scales with property
count.

### D5 — One-time Ajv compile, ~25 ms — **confirmed, and NOT a steady-state cost**

14 of the 60 Safari stacks sit inside `createAjvValidator` → Ajv codegen. That looks alarming, but
[validate.ts:12-21](../src/lib/props/validate.ts#L12-L21) memoizes per `ps.kind` in a
module-level `Map`, so it runs once per page load per shape kind. Chromium: first block `ScriptDuration`
33 ms vs. 7–8 ms for the second and third → ~25 ms one-time hitch. **The memo is working; don't touch it.**

### D6 — Safari content-blocker extension — **present, negligible**

`safari-extension://8537D35D-.../extended-css.js` runs `applyRules → selectElementsByAst`. Footprint is
tiny: 1 of 60 stacks; all 7 `MutationObserver` callbacks in the recording are 0.0–0.1 ms. Noted only so it
isn't rediscovered and over-weighted.

---

## 4. How to get a clean measurement

1. **Turn off the Screenshots instrument** in Web Inspector's Timelines tab. Record Script / Layout &
   Rendering / CPU only.
2. **Don't rely on script-time profiling for D0.** Canvas rasterization happens after `draw()` returns.
   Use frame pacing (below) or Web Inspector's Layers/rendering view.
3. **Measure at the size where it hurts** — maximized on the large monitor — and report
   `view.cssW × view.cssH` and `view.z` alongside every number, since dot count follows from those.
4. Test in a clean Safari profile with extensions disabled and the Inspector **closed** (having it open
   changes what you're measuring).
5. Context flags (`desynchronized`, `alpha`) are already ruled out — skip them.

In-page pacing recorder that needs no Inspector:

```js
const t = [];
(function loop(ts) {
  t.push(ts);
  requestAnimationFrame(loop);
})();
// interact, then:
const d = t
  .slice(1)
  .map((x, i) => x - t[i])
  .sort((a, b) => a - b);
console.log({
  fps: (t.length - 1) / ((t.at(-1) - t[0]) / 1000),
  p50: d[d.length >> 1],
  p95: d[Math.floor(d.length * 0.95)],
  max: d.at(-1),
  dots: (__view.cssW * __view.cssH) / (16 * __view.z) ** 2,
});
```

---

## 5. Suggested order of work

1. **D0** — make the dot grid O(1) per frame (offscreen tile + `createPattern`, or a CSS gradient layer).
   This is the user-visible bug and the only one whose cost grows with window size. Everything else is
   rounding error next to it.
2. **D2** — route `onGestureChange` through the existing accumulator. One-line-ish, Safari-specific, and
   it multiplies D0 today.
3. **D1** — stop letting the zoom `%` and pointer x/y readouts drive a document layout at input frequency.
4. **D4** — honour the `pushed` comparison on the `reset` path, or skip `set()` when the document is
   already `{}`.
5. **D3** — re-check after 1–4; much of the 815 wasted paints should disappear once the document stops
   being dirtied every event.

Do not spend time on **D5** (already memoized), **D6** (negligible), or canvas context attributes (ruled
out).

---

## Appendix — methodology

- Profile parsed with Python; the 115 embedded screenshots were base64-decoded with a pure-stdlib PNG
  decoder (zlib + manual unfiltering) and fixed regions hashed per frame to count visual changes.
- **WebKit 26.6** via Playwright (headed and headless), dpr 1 / 1.5 / 2, viewports 1280×800 → 3008×1692,
  with `gesturestart`/`gesturechange`/`gestureend` synthesized to exercise the Safari-only path.
  `Renderer.draw` and `CanvasRenderingContext2D.prototype.rect` patched in-page to count draws and dots;
  frame pacing from a free-running rAF loop.
- **Chromium** via Playwright (`channel: msedge`) with CDP `Performance.getMetrics`
  (`LayoutCount`/`RecalcStyleCount`/`LayoutDuration`/`ScriptDuration`), CDP `Profiler` for self-time, and a
  `MutationObserver` on `[data-panel-id="properties"]` for DOM churn.
- All probes ran against the already-running dev server on `:5183` and were deleted afterwards. **No
  application source was modified.** Playwright's WebKit browser was installed into
  `~/Library/Caches/ms-playwright/` (`npx playwright install webkit`).
