# Iteration 3.2 — the measurement session

Protocol and results sheet for the one thing only real Safari can answer. Follows
[iter-3-1-render-performance.md](./iter-3-1-render-performance.md) §4.1 and
[safari-performance-report-2.md](./safari-performance-report-2.md) §6.2; it gets folded into the
iteration document once the numbers exist.

**Why by hand.** The defect is out of process. `Composite` is 6 280 ms of a 20 s recording while
script, layout, style and paint together are 140 ms, and the main thread sits at 3–13 %. So
`performance.now()` around `draw()` reads 0–1 ms at 20 fps, and Playwright's WebKit understates the
magnitude by ~3.5× because it has no GPU-process canvas. Primitive counts are assertable in CI;
frame times are not.

---

## 1. What is already settled without a browser

`node verify/grid.mjs`, at report 2's geometry — 3092×1222 device px, dpr 2, camera 137.37 / 91.13.
52 assertions.

|          z | direct path (dots) | `strips` (rects + blits) |                               fewer ops |
| ---------: | -----------------: | -----------------------: | --------------------------------------: |
|     0.4999 |                585 |        94 + 15 = **109** |                                    5.4× |
| **0.5001** |         **14 861** |       386 + 92 = **478** |                               **31.1×** |
|      0.512 |             14 175 |       378 + 90 = **468** |                                   30.3× |
|       0.55 |             12 320 |       352 + 84 = **436** |                                   28.3× |
|      0.875 |              4 884 |       222 + 52 = **274** |                                   17.8× |
|          1 |              3 686 |       194 + 45 = **239** |                                   15.4× |
|          4 |                240 |         53 + 10 = **63** |                                    3.8× |
|         16 |                 18 |          18 + 0 = **18** | 1.0× — below the row floor, direct path |

### The defect, in two numbers

At `z = 0.5001` the canvas has **14 625 inked pixels — exactly 585 major dots at 5×5 device px**.
So the minor tier's 14 276 rects produce **zero output pixels**, and the frame costs 25.4× what the
frame one increment below it cost, to draw a picture that is byte-identical to it.

That also makes `z = 0.5001` the right zoom for a pixel diff, because it isolates the major tier:
`minorAlpha` is 0.000267, which rounds to a paint alpha of 0. `z = 0.512` is often mistaken for
this and does not do it — there `minorAlpha` is 0.032, a paint alpha of 8.

### What the strip cache does and does not buy

- **Pixel-identical**, and asserted that way round: byte-exact at every zoom where the minor tier
  is opaque (`z ≥ 0.875`), invisible (`z = 0.5001`), or below the row floor; ≤ 1 LSB per channel
  allowed only in the blend band. Measured: **0 differing pixels of 3.78 M at every zoom above**,
  so the 1-LSB allowance is currently unused.
- **Flat in canvas area.** Doubling the canvas height leaves the rect count at 378 and doubles only
  the blits (90 → 178). The direct path doubles: 14 175 → 28 161.
- **The LoD step shrinks to its square root, not to nothing.** Crossing `z = 0.5` divides `stepDev`
  by 5, so `cols` and `rows` each multiply by 5: the direct path steps 25×, strips step ~5×
  (109 → 478). What makes that fine is the absolute size — the jump is **+369 primitives instead
  of +14 276**, and both ends sit far below report 1's 4 000–5 000 knee, where every canvas size it
  measured held 60 fps. A 5× step between two cheap frames is not a cliff.
- **`z = 0.1` behaves identically** (iteration 3.1 §7.5 flagged it as unmeasured): direct
  585 → 14 400, strips 107 → 474.
- **Cache hits are real but not what the gesture uses.** The key carries `camX` and deliberately
  omits `camY`, so a repeat draw or a vertical-only pan rebuilds nothing — 0 rects, blits only.
  A pinch misses every frame, because `zoomTo` rewrites `z` _and_ `camX`. The win during a gesture
  is the op count above, not reuse.

All four `GridMode`s are pixel-identical, so **switching modes mid-session changes cost and nothing
else.** That is what makes one sitting enough.

### Also already fixed and checked (`verify/input.mjs`, 9 assertions)

|                                                                    | before | after     |
| ------------------------------------------------------------------ | ------ | --------- |
| Camera updates applied synchronously during a 20-event pinch burst | 20     | **0**     |
| Coalesced camera updates / draws for those 20 events               | 20 / — | **1 / 1** |
| Status-bar writes for 32 pointer moves across 4 snap cells         | 32     | **4**     |
| Properties-panel mutations on a repeat deselect                    | 18     | **0**     |

The accumulated pinch also lands on the product of its per-event factors, which is the thing that
could have broken silently: folding a multiplicative factor into `#zoomExp` as `-log(factor)` has
to telescope back through `exp(-Σ)` exactly.

---

## 1a. The reported symptom, and the experiment it calls for

From the machine that has it: **stuttering from roughly 40 % to 60 %, crossing at 50 % exactly,
"when the canvas rendered the most number of highlighted (major) grid points".**

That last clause is a real observation and it is also a trap. `level` drops by one at `z = 0.5`, so
`minorStep` goes 80 → 16 and `majorStep` goes 400 → 80 **at the same instant**. Both tiers reach
their densest on-screen spacing in the same frame, so "densest highlighted dots" and "the minor
tier just multiplied by 25" name the same moment, and no amount of looking can separate them.

Per tier, at 3092×1222 and dpr 2 (`verify/grid.mjs` prints this table):

|       zoom | minor rects | minor pixels | major rects | major pixels | major CSS spacing | minor share |
| ---------: | ----------: | -----------: | ----------: | -----------: | ----------------: | ----------: |
|       0.40 |         891 |        8 019 |          40 |          980 |            160 px |      95.7 % |
|       0.45 |         707 |        6 363 |          24 |          600 |            180 px |      96.7 % |
|       0.49 |         576 |        5 184 |          24 |          600 |            196 px |      96.0 % |
|     0.4999 |         561 |        5 049 |      **24** |          600 |            200 px |      95.9 % |
| **0.5001** |  **14 276** |        **0** |     **585** |       14 625 |         **40 px** |  **96.1 %** |
|       0.51 |      13 680 |      122 895 |         570 |       14 250 |             41 px |      96.0 % |
|       0.55 |      11 830 |      106 470 |         490 |       12 075 |             44 px |      96.0 % |
|       0.60 |       9 920 |       89 280 |         384 |        9 600 |             48 px |      96.3 % |

Two things fall out of it.

**The observation is exactly right about where.** The major tier really is at its densest
immediately above `z = 0.5` — 40 CSS px apart, the closest it ever gets at any zoom — and it
thins out on both sides. The count of _visible_ dots jumps **24 → 585**, a 24× step in precisely
what can be seen, which is why the visual correlation is so convincing.

**But the visible dots are 3.9 % of the primitives.** At `z = 0.5001` the minor tier emits 14 276
rects at a paint alpha of **zero** and produces **no output pixels at all** — measured, not
inferred: the frame's 14 625 inked pixels are exactly `585 × 25`, the major dots alone. So the
stuttering frame draws 585 visible dots and pays for 14 861 primitives. If cost tracked visible
output, that frame would be free. This is the strongest evidence in either report that cost tracks
**primitive count**, and it is why the fix targets the tier that cannot be seen.

### The two-run experiment that settles it

Now switchable at runtime, orthogonal to `__gridMode`:

```js
__gridTiers('major'); // only the highlighted dots -- 585 rects, 100% of the visible output
__gridTiers('minor'); // only the invisible tier   -- 14 276 rects, 0% of the visible output
__gridTiers('both'); // back to normal
```

Pinch across 50 % in each, in `batch` mode:

- **`major` smooth, `minor` stuttering** → cost is primitive count, the culprit is the tier that
  paints nothing, and `strips` is aimed correctly. This is what every number above predicts.
- **`major` also stuttering** → 585 rects cannot cost 300 ms, so cost is not primitive count and
  something outside this model is wrong. Say so before anything else gets built on top of it; the
  iteration would need rethinking rather than tuning.
- **`minor` smooth** → the same conclusion, reached from the other side.

This discriminates better than iteration 3.1 §4.1's experiment, because it varies the quantity
under suspicion by 24× while holding the implementation fixed, instead of varying the
implementation and hoping the quantity follows.

### The 40–50 % half needs its own explanation

Below the boundary the whole grid is **585–931 primitives**, and report 2 measured frames at that
count at **1.6–4.0 ms** — smooth. Primitive count alone does not predict stutter at 40–50 %. So if
it is genuinely felt there, the candidate is report 2 §3's unexplained residual: after a run of
heavy L0 frames, L1 frames were measured at 86–131 ms and did not recover within the recording.
Pinching back and forth across 50 % would re-trigger that continuously, which fits a band
straddling the boundary rather than sitting above it.

That moves report 2 §6.3's persistence run from optional to worth doing, and it has to happen
**before** `strips` becomes the default, because the experiment needs the peak that `strips`
removes. Two minutes: hold `z = 0.53` for ~3 s of continuous pinching, drop to `z = 0.45`, hold,
and watch the first ten frames. Compare against arriving at `z = 0.45` gently from within L1.

If §3 is real it also constrains the fix: a change that merely _reduces_ the peak would still leave
a tail, and only a flat cost removes it. Which is the property `strips` was built for.

---

## 2. Setup

1. `npm run dev`, and open `http://localhost:5183` in Safari.
2. **Screenshots instrument OFF** in Web Inspector → Timelines. Script / Layout & Rendering / CPU
   only. It captures a full-page image per frame and puts a ~42 ms floor on every frame
   (report 2 §2.1) — frame durations are unusable with it on.
3. Clean profile, extensions disabled, Inspector **closed** while recording.
4. **Maximized on the large monitor.** The cliff height scales with canvas area; a laptop-sized
   window is below the knee and does not contain the bug (report 1 §D0).

The mode switch is deliberately not DEV-gated, so the same sweep can be run against
`npm run build && npm run preview` on :4183 if there is any doubt the dev server changes the
result. It should not — script time is 0.7 % of the frame.

---

## 3. The recorder

Paste once per mode. It counts primitives per frame, which is the quantity the fix holds down, and
rAF-to-rAF intervals, which is what actually gets felt.

```js
(() => {
  const P = CanvasRenderingContext2D.prototype;
  const keys = ['rect', 'fillRect', 'fill', 'drawImage'];
  const orig = {};
  const n = {};
  for (const k of keys) {
    orig[k] = P[k];
    n[k] = 0;
    P[k] = function (...a) {
      n[k]++;
      return orig[k].apply(this, a);
    };
  }
  const rows = [];
  let last = 0;
  let stop = false;
  (function loop(ts) {
    const v = window.__view ?? null;
    if (last !== 0) {
      rows.push({ ms: +(ts - last).toFixed(1), ...n, z: v ? +v.z.toFixed(4) : null });
    }
    last = ts;
    for (const k of keys) n[k] = 0;
    if (!stop) requestAnimationFrame(loop);
  })(performance.now());
  window.__sweep = () => {
    stop = true;
    for (const k of keys) P[k] = orig[k];
    const busy = rows.filter((r) => r.rect + r.fillRect + r.drawImage > 0);
    const d = busy.map((r) => r.ms).sort((a, b) => a - b);
    const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
    const ops = busy.map((r) => r.rect + r.fillRect + r.drawImage).sort((a, b) => a - b);
    const v = window.__view ?? null;
    console.table(busy);
    console.log({
      mode: window.__gridMode(),
      frames: busy.length,
      p50: q(0.5),
      p90: q(0.9),
      p95: q(0.95),
      max: d.at(-1),
      opsMed: ops[ops.length >> 1],
      opsMax: ops.at(-1),
      css: v ? [v.cssW, v.cssH] : null,
      dpr: v ? v.dpr : null,
      bitmap: v?.canvas ? [v.canvas.width, v.canvas.height] : null,
    });
    return busy;
  };
  console.log(`recording in mode "${window.__gridMode()}" — pinch, then call __sweep()`);
})();
```

## 4. The sweep

Identical for every mode, or the numbers are not comparable:

1. **Pinch slowly 40 % → 70 % → 40 %.** This is the `z = 0.5` boundary, and slowly matters — the
   symptom is the transition, not a resting zoom. Take ~3 s each way.
2. **Pinch slowly 8 % → 12 % → 8 %.** The `level` 1→2 boundary at `z = 0.1`, same cliff.
3. `__sweep()`, keep the console output, then switch mode and repeat.

`__gridMode('strips')` sets and repaints; `__gridMode()` reads.

| Mode     | Call                      | What it tests                                                                                                     |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| baseline | `__gridMode('batch')`     | the shipped code. **The control.**                                                                                |
| A        | `__gridMode('row-fill')`  | one path per row. Each fill's bounding box collapses from ~8.7 Mpx to `devW × size` ≈ 13 kpx. Iteration 3.1 §4.1. |
| B        | `__gridMode('fill-rect')` | no path at all, one `fillRect()` per dot. Separates path tessellation from per-rect cost.                         |
| C        | `__gridMode('strips')`    | the strip cache. 31× fewer primitives; the numbers in §1.                                                         |

And orthogonally, per §1a — these two are the decisive pair:

| Tiers      | Call                   | Primitives at z = 0.5001 | Visible output |
| ---------- | ---------------------- | -----------------------: | -------------- |
| both       | `__gridTiers('both')`  |                   14 861 | everything     |
| major only | `__gridTiers('major')` |                  **585** | **all of it**  |
| minor only | `__gridTiers('minor')` |               **14 276** | **none of it** |

**A and B are still worth measuring even though C is built and passing.** If either restores
smoothness on its own then the cost is the path, the fix is two lines, and C's ~440 lines can be
deleted rather than shipped. That is a real outcome and it costs one extra sweep each. Report 2 §5
item 2 is also explicit that a _negative_ result for A no longer proves anything on its own, which
is exactly why B is on the list.

---

## 5. Results

Fill in. `opsMed`/`opsMax` must match §1 for the mode, and A and B must match `batch` exactly — a
difference there means the sweep was not the same shape and the times are not comparable.

### z ≈ 0.5 boundary, 40 % → 70 % → 40 %

| mode        | frames | p50 ms | p90 ms | p95 ms | max ms | opsMed | opsMax |
| ----------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: |
| `batch`     |        |        |        |        |        |        |        |
| `row-fill`  |        |        |        |        |        |        |        |
| `fill-rect` |        |        |        |        |        |        |        |
| `strips`    |        |        |        |        |        |        |        |

### Tier isolation, 40 % → 60 % → 40 %, `batch` mode (§1a)

| tiers   | frames | p50 ms | p90 ms | p95 ms | max ms | opsMed | opsMax |
| ------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: |
| `major` |        |        |        |        |        |        |        |
| `minor` |        |        |        |        |        |        |        |

### z ≈ 0.1 boundary, 8 % → 12 % → 8 %

| mode        | frames | p50 ms | p90 ms | p95 ms | max ms | opsMed | opsMax |
| ----------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: |
| `batch`     |        |        |        |        |        |        |        |
| `row-fill`  |        |        |        |        |        |        |        |
| `fill-rect` |        |        |        |        |        |        |        |
| `strips`    |        |        |        |        |        |        |        |

`cssW × cssH`: ______ `dpr`: ____ `bitmap`: ______

### How to read it

- **A or B lands near 16.7 ms p90 across the boundary** → that mode is the whole fix. Land it,
  delete the other three, and the strip cache never ships.
- **A helps and B does not** → the cost is the path's bounding box.
- **B helps and A does not** → the cost is path tessellation, not the rects.
- **Only C helps** → the cost is per-rect, which is what report 2's arithmetic already predicts
  (`14 668 × 21 µs = 308 ms` against a 330 ms observed peak). Make `strips` the default.
- **C does not help either** → the one thing no measurement in either report bounds is Safari's
  cost _per `drawImage` call_. Iteration 3.1 §4.2 justified the blits with a fill-rate argument,
  but report 1 §2 had already ruled fill rate out as the mechanism, so that justification never
  held. If 92 blits turn out to cost what 14 861 rects did, the documented fallback is the
  **column-strip transpose**: the construction is symmetric (for a fixed column the hole test
  degenerates to `mod(j, skip) === 0`) and it trades the counts the other way — ~152 rects and
  ~193 blits instead of 386 and 92.

### The one number to watch

`strips` should make the 40–70 % sweep look like today's **below**-0.5 frames, which report 2
measured at **1.6–4.0 ms composite, median 3.4 ms at ~900 rects**. 478 primitives is half that
count. If the sweep lands there, it is done.

Note that 3.4 ms at ~900 rects is also the reason not to trust the naive 21 µs/rect slope at the
low end: that figure is a regression over the whole range including the 330 ms frames, and applying
it to 478 ops predicts ~10 ms, which report 2's own L1 measurements contradict.

### While the peak still exists

Optional, and unreproducible once `strips` becomes the default — report 2 §6.3's persistence run.
Two arrivals at `z = 0.45`: once by pinching gently within L1, once after holding `z = 0.53` for
~3 s. If the second starts at 100 ms+ and decays over ~0.5–1 s, report 2 §3's residual is real.

---

## 6. Not measured here, and why

- **`MIN_DOT_PX`, the LoD ladder, the minor-tier fade.** The fade is the tempting lever and is not
  one: at `z = 0.5001` the tier costs 14 276 rects at `alpha = 0.0003` for provably zero pixels,
  but the zero-output band is `z < 0.5057` — about 1 % of one zoom step — and by `z = 0.79` the
  tier is 77 % opaque and still ~5 900 rects.
- **Context attributes** (`desynchronized`, `alpha`) and **bitmap size**. Report 1 isolated all
  three with controlled A/Bs.
- **Script time anywhere.** 66 ms of JS in 20 s.
- **The zoom-% readout's width.** Report 2 §4.1: it is already `min-w-14 tabular-nums`, so the
  whole-document layout is not caused by its width and narrowing it would not remove it.

## 7. Known and pre-existing, so a tester does not misattribute it

**The major→minor LoD handoff pops.** At `z = 0.51` the 80-world-unit dots are major (size 5,
`#404859`); at `z = 0.49` the same dots are minor (size 3, `#272c36`, alpha 1). Iteration 3.1 §4.7's
continuity argument covers only the minor tier's own fade, not the handoff. Visible in exactly the
band these sweeps cross, unrelated to any of the four modes, and out of scope.
