import { createHash } from 'node:crypto';

import { DEV_URL, diagramCanvas, open, suite } from './harness.mjs';

/*
  Dot-grid checks for iteration 3.2.

  Two properties, and neither is measurable in the obvious way.

  PIXEL IDENTITY. The grid is being rewritten for speed, so the whole justification is that the
  output does not change. That diff must not be taken off the live canvas: it is created
  `{ desynchronized: true }`, and low-latency canvases have a history of handing back unflushed or
  front-buffer content. So every comparison here renders through `window.__grid.draw` into a
  canvas this script owns, which makes it a pure-function test with no compositor in the loop.

  The comparison also happens IN THE PAGE. A 3092x1222 bitmap is 15MB of RGBA; handing three of
  them back through `evaluate` serializes each as a JSON array of 15 million numbers and kills the
  node process outright. Only the verdicts cross the bridge.

  OP COUNTS. Frame *times* cannot be asserted: Safari rasterizes the display list in its GPU
  process, `performance.now()` around `draw()` reads 0-1ms at 20fps, and Playwright's WebKit
  understates the real magnitude by roughly 3.5x because it has no GPU-process canvas. What IS
  deterministic is how many primitives a frame emits, which is the quantity the fix exists to hold
  down. So counts are asserted and times are never mentioned.

  Geometry is report 2's: 3092x1222 device pixels at dpr 2, a 1546x611 CSS canvas maximized on the
  large monitor. Keeping it means the numbers here are directly comparable to the numbers in
  history/safari-performance-report-2.md.
*/

const t = suite('grid');
const { browser, page, errors } = await open(DEV_URL);

const DEV_W = 3092;
const DEV_H = 1222;
const DPR = 2;
// Fractional, and not a whole number of grid steps: `x0` and `y0` are what the rounding acts on,
// and a camera on an exact multiple would hide every off-by-one this file exists to catch.
const CAM_X = 137.37;
const CAM_Y = 91.13;

const MODES = ['batch', 'row-fill', 'fill-rect', 'strips'];

/**
 * Render the grid once per mode into this script's own canvas; diff each against the first mode
 * given, which is the control.
 *
 * Counters are installed on the prototype and zeroed AFTER the background fill, so the background
 * never lands in the numbers.
 */
const renderModes = (z, modes = MODES, h = DEV_H, tiers = 'both') =>
  page.evaluate(
    ({ z, modes, w, h, dpr, camX, camY, tiers }) => {
      const g = window.__grid;
      const bg = [0x0f, 0x11, 0x15];
      const P = CanvasRenderingContext2D.prototype;
      const orig = { rect: P.rect, fillRect: P.fillRect, fill: P.fill, drawImage: P.drawImage };
      const n = { rect: 0, fillRect: 0, fill: 0, drawImage: 0 };
      for (const k of Object.keys(orig)) {
        P[k] = function (...a) {
          n[k]++;
          return orig[k].apply(this, a);
        };
      }

      const out = { ops: {}, inked: {}, diffs: {} };
      let control = null;
      try {
        window.__gridTiers(tiers);
        for (const mode of modes) {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          // No options: a `colorSpace` or `willReadFrequently` would put this on a colour-managed
          // or CPU-backed path and stop it being a fair comparison with the live context.
          const cx = c.getContext('2d');
          cx.setTransform(1, 0, 0, 1, 0, 0);
          cx.fillStyle = g.theme.background;
          cx.fillRect(0, 0, w, h);

          window.__gridMode(mode);
          for (const k of Object.keys(n)) n[k] = 0;
          g.draw(cx, camX, camY, z, dpr, g.theme);

          const px = cx.getImageData(0, 0, w, h).data;
          out.ops[mode] = { ...n };

          let ink = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i] !== bg[0] || px[i + 1] !== bg[1] || px[i + 2] !== bg[2]) ink++;
          }
          out.inked[mode] = ink;

          if (control === null) {
            control = px;
          } else {
            let maxDelta = 0;
            let pixels = 0;
            for (let i = 0; i < px.length; i += 4) {
              const d = Math.max(
                Math.abs(px[i] - control[i]),
                Math.abs(px[i + 1] - control[i + 1]),
                Math.abs(px[i + 2] - control[i + 2]),
              );
              if (d > 0) pixels++;
              if (d > maxDelta) maxDelta = d;
            }
            out.diffs[mode] = { maxDelta, pixels };
          }
        }
      } finally {
        for (const k of Object.keys(orig)) P[k] = orig[k];
        window.__gridMode('batch');
        window.__gridTiers('both');
      }
      return out;
    },
    { z, modes, w: DEV_W, h, dpr: DPR, camX: CAM_X, camY: CAM_Y, tiers },
  );

/*
  The zoom set, and why each one is here.

  0.5001 is the cliff: `level` has just stepped, the minor tier is at its densest, and
  `minorAlpha` is 0.000267 -- which rounds to a paint alpha of 0, so the minor tier writes no
  pixels and this zoom ISOLATES THE MAJOR TIER. 0.512 does not do that and is often mistaken for
  it: there `minorAlpha` is 0.032, a paint alpha of 8, and both tiers land in the one bitmap. Both
  are kept, for opposite reasons.

  0.875 is where `clampNum` starts returning literally 1, so at and above it the minor tier is a
  straight opaque draw with no blend path at all.
*/
const ZOOMS = [
  { z: 0.4999, tol: 0 }, // L1, one increment below the cliff
  { z: 0.5001, tol: 0 }, // L0, and the minor tier writes nothing -- the major tier alone
  { z: 0.512, tol: 1 }, // three clicks of zoom-out from 100%; minor tier at paint alpha 8
  { z: 0.55, tol: 1 },
  { z: 0.875, tol: 0 }, // `clampNum` returns literally 1 at and above here: no blend path
  { z: 1, tol: 0 },
  { z: 4, tol: 0 },
  { z: 16, tol: 0 },
];

for (const { z, tol } of ZOOMS) {
  const r = await renderModes(z);
  const ops = r.ops.batch;

  t.ok(`z=${z} the control mode draws something`, r.inked.batch > 0, `inked=${r.inked.batch}`);

  /*
    Variants A (`row-fill`) and B (`fill-rect`) are the two-line candidates measured by hand in
    real Safari. They emit the same rects in the same order at the same `globalAlpha`, and dots
    provably never overlap, so each pixel is blended exactly once in every mode -- they must be
    BYTE-identical, not merely close. A variant that renders differently is not a measurement of
    anything, so this runs before the manual sweep rather than after it.
  */
  for (const mode of ['row-fill', 'fill-rect']) {
    const d = r.diffs[mode];
    t.ok(
      `z=${z} ${mode} is byte-identical to batch`,
      d.maxDelta === 0 && d.pixels === 0,
      `maxDelta=${d.maxDelta} differing=${d.pixels} inked=${r.inked[mode]}`,
    );
  }

  /*
    `strips` is held to the weaker claim, and only where the weaker claim is actually needed.

    Exact wherever the minor tier is opaque (`minorAlpha === 1`, so z >= 0.875), wherever it is
    invisible (z = 0.5001), and wherever a tier falls below the dot-count floor and takes the
    direct path anyway. One LSB per channel is allowed only in the blend band, where `globalAlpha`
    quantizes twice and a solid fill and a textured blit are different shader programs.
  */
  const ds = r.diffs.strips;
  t.ok(
    `z=${z} strips is within ${tol} LSB of batch`,
    ds.maxDelta <= tol,
    `maxDelta=${ds.maxDelta} differing=${ds.pixels} of ${(DEV_W * DEV_H) / 1e6}Mpx` +
      ` inked=${r.inked.strips} vs ${r.inked.batch}`,
  );

  // The rect count is the quantity the whole iteration exists to reduce, so record it either way.
  t.ok(
    `z=${z} the direct modes agree on dot count`,
    ops.rect === r.ops['fill-rect'].fillRect && ops.rect === r.ops['row-fill'].rect && ops.rect > 0,
    `dots=${ops.rect} -> strips: ${r.ops.strips.rect} rects + ${r.ops.strips.drawImage} blits` +
      ` = ${r.ops.strips.rect + r.ops.strips.drawImage} ops` +
      ` (${(ops.rect / Math.max(1, r.ops.strips.rect + r.ops.strips.drawImage)).toFixed(1)}x fewer)`,
  );
}

/*
  The cliff, and whether it is still one.

  Report 2's headline is that one increment of zoom across `z = 0.5` multiplies the per-frame
  primitive count by ~24x while the picture stays byte-identical. The direct path must still show
  that -- it is the defect -- and `strips` must not: making the cost FLAT across the boundary is
  the goal, not making the peak smaller. Report 2 section 3 found cost that persists for up to a
  second after a heavy run, which is why a merely-smaller peak is not good enough.
*/
const cliff = async (mode) => {
  const lo = (await renderModes(0.4999, [mode])).ops[mode];
  const hi = (await renderModes(0.5001, [mode])).ops[mode];
  const total = (o) => o.rect + o.fillRect + o.drawImage;
  return { lo: total(lo), hi: total(hi), ratio: total(hi) / total(lo) };
};

const cBatch = await cliff('batch');
t.ok(
  'the direct path still steps ~24x across z=0.5 (the defect, unchanged)',
  cBatch.ratio > 10,
  `${cBatch.lo} -> ${cBatch.hi} ops, ${cBatch.ratio.toFixed(1)}x`,
);

/*
  The step shrinks to its square root, and that is the most that can be claimed.

  Crossing the boundary divides `stepDev` by MAJOR_EVERY, so `cols` and `rows` each multiply by 5.
  The direct path costs `cols * rows` and therefore steps by 25x. Strips cost `~2*cols + rows`,
  where both terms scale by 5 -- so strips step by ~5x, not by nothing. O(perimeter) buys the
  square root of the cliff, not its removal, and an earlier draft of this file asserting "< 3x"
  was simply wrong about the arithmetic.

  What makes that acceptable is the absolute magnitude rather than the ratio: the jump goes from
  +14 276 primitives to +369, and BOTH ends land far below report 1's 4 000-5 000 knee, where
  every canvas size it measured held 60fps. A 5x step between two cheap frames is not a cliff.
*/
const cStrips = await cliff('strips');
t.ok(
  'strips reduces the z=0.5 step from ~25x to ~5x, its square root',
  cStrips.ratio < 6,
  `${cStrips.lo} -> ${cStrips.hi} ops, ${cStrips.ratio.toFixed(1)}x` +
    ` (was ${cBatch.ratio.toFixed(1)}x); absolute jump ${cStrips.hi - cStrips.lo}` +
    ` vs ${cBatch.hi - cBatch.lo}`,
);

t.ok(
  'strips holds the worst zoom under a tenth of the direct path',
  cStrips.hi * 10 < cBatch.hi,
  `z=0.5001: ${cStrips.hi} ops vs ${cBatch.hi}` +
    ` (${(cBatch.hi / cStrips.hi).toFixed(1)}x fewer)`,
);

t.ok(
  'strips keeps the worst zoom well under report 1 knee of 4000-5000 dots',
  cStrips.hi < 1000,
  `${cStrips.hi} ops at z=0.5001`,
);

/*
  The same boundary at z = 0.1, where `level` goes 1 -> 2 and the 8-CSS-px spacing returns.
  Iteration 3.1 section 7.5 flagged it as unmeasured; it is the same cliff and the same fix.
*/
const lo1 = (await renderModes(0.099, ['batch', 'strips'])).ops;
const hi1 = (await renderModes(0.101, ['batch', 'strips'])).ops;
const tot = (o) => o.rect + o.fillRect + o.drawImage;
t.ok(
  'the z=0.1 boundary behaves the same way',
  tot(hi1.strips) / tot(lo1.strips) < 6 &&
    tot(hi1.strips) < 1000 &&
    tot(hi1.batch) / tot(lo1.batch) > 10,
  `batch ${tot(lo1.batch)} -> ${tot(hi1.batch)}` +
    `; strips ${tot(lo1.strips)} -> ${tot(hi1.strips)}`,
);

/*
  FLATNESS, which is the property the fix is actually buying.

  A strip is built per row KIND, not per row, so making the canvas twice as tall must not change
  how many rects a frame emits -- only how many blits. The direct path doubles. That is O(area)
  becoming O(perimeter), stated as something a script can assert.
*/
const tall = await renderModes(0.512, ['batch', 'strips'], DEV_H * 2);
const short = await renderModes(0.512, ['batch', 'strips'], DEV_H);
t.ok(
  'doubling canvas height does not change how many rects strips emit',
  tall.ops.strips.rect === short.ops.strips.rect,
  `${short.ops.strips.rect} -> ${tall.ops.strips.rect} rects,` +
    ` blits ${short.ops.strips.drawImage} -> ${tall.ops.strips.drawImage}`,
);
t.ok(
  'doubling canvas height does double the direct path (the defect it replaces)',
  tall.ops.batch.rect > short.ops.batch.rect * 1.9,
  `${short.ops.batch.rect} -> ${tall.ops.batch.rect} rects`,
);

/*
  CACHE HITS. The key carries `camX` but deliberately not `camY`, so a purely vertical pan must
  reuse both strips and emit no rects at all. During a pinch it misses on every frame, because
  `zoomTo` rewrites `z` AND `camX` -- that is expected, and the win there is the op count above,
  not reuse.
*/
const reuse = await page.evaluate(
  ({ w, h, dpr, camX, camY }) => {
    const g = window.__grid;
    const grid = new g.DotGrid();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    const P = CanvasRenderingContext2D.prototype;
    const orig = { rect: P.rect, drawImage: P.drawImage };
    const n = { rect: 0, drawImage: 0 };
    for (const k of Object.keys(orig)) {
      P[k] = function (...a) {
        n[k]++;
        return orig[k].apply(this, a);
      };
    }
    const pass = (cX, cY) => {
      for (const k of Object.keys(n)) n[k] = 0;
      grid.draw(cx, cX, cY, 0.512, dpr, g.theme);
      return { ...n };
    };
    try {
      window.__gridMode('strips');
      const cold = pass(camX, camY);
      const sameCam = pass(camX, camY);
      const vertical = pass(camX, camY + 37.5);
      const horizontal = pass(camX + 37.5, camY);
      return { cold, sameCam, vertical, horizontal };
    } finally {
      for (const k of Object.keys(orig)) P[k] = orig[k];
      window.__gridMode('batch');
    }
  },
  { w: DEV_W, h: DEV_H, dpr: DPR, camX: CAM_X, camY: CAM_Y },
);
t.ok(
  'a cold frame builds the strips',
  reuse.cold.rect > 0 && reuse.cold.drawImage > 0,
  JSON.stringify(reuse.cold),
);
t.ok(
  'redrawing the same camera rebuilds nothing: zero rects, both tiers reused',
  reuse.sameCam.rect === 0 && reuse.sameCam.drawImage > 0,
  JSON.stringify(reuse.sameCam),
);
t.ok(
  'a vertical-only pan rebuilds nothing: the key omits camY',
  reuse.vertical.rect === 0 && reuse.vertical.drawImage > 0,
  JSON.stringify(reuse.vertical),
);
t.ok(
  'a horizontal pan does rebuild: the key carries camX, not x0',
  reuse.horizontal.rect > 0,
  JSON.stringify(reuse.horizontal),
);

/*
  THE REPORTED BAND, SPLIT BY TIER.

  The symptom as described from the machine that has it: stuttering from roughly 40% to 60% zoom,
  crossing at 50% exactly, "when the canvas rendered the most number of highlighted (major) grid
  points". That last clause is a real observation and it is also a trap, because the two tiers are
  locked together -- `level` drops by one at z = 0.5, so `minorStep` goes 80 -> 16 and `majorStep`
  goes 400 -> 80 at the same instant. The major tier is 200 CSS px apart below the boundary and
  40 CSS px apart above it, the closest it ever gets, so "densest highlighted dots" and "the minor
  tier just multiplied by 25" name the same frame.

  What separates them is that just above the boundary the minor tier is INVISIBLE -- `minorAlpha`
  is 0.000267, a paint alpha of 0 -- so the frame draws only the major dots while emitting the
  minor tier's rects anyway. If cost tracked visible output, that frame would be cheap. This block
  measures the split so the hypothesis is a number rather than an impression.
*/
const BAND = [0.4, 0.45, 0.49, 0.4999, 0.5001, 0.51, 0.55, 0.6];
const band = [];
for (const z of BAND) {
  const only = {};
  for (const tiers of ['minor', 'major']) {
    const r = await renderModes(z, ['batch', 'strips'], DEV_H, tiers);
    only[tiers] = {
      rects: r.ops.batch.rect,
      inked: r.inked.batch,
      stripOps: r.ops.strips.rect + r.ops.strips.drawImage,
    };
  }
  band.push({ z, ...only });
}

console.log('\n  reported stutter band, per tier (3092x1222 @ dpr 2):');
console.log(
  '    zoom    minor rects  minor inked   major rects  major inked    minor share   strips ops',
);
for (const b of band) {
  const share = (100 * b.minor.rects) / (b.minor.rects + b.major.rects);
  console.log(
    `    ${String(b.z).padEnd(7)} ${String(b.minor.rects).padStart(11)}` +
      ` ${String(b.minor.inked).padStart(12)} ${String(b.major.rects).padStart(13)}` +
      ` ${String(b.major.inked).padStart(12)} ${(share.toFixed(1) + '%').padStart(14)}` +
      ` ${String(b.minor.stripOps + b.major.stripOps).padStart(12)}`,
  );
}

const cliffRow = band.find((b) => b.z === 0.5001);
t.ok(
  'just above z=0.5 the minor tier emits most of the frame and paints NOTHING',
  cliffRow.minor.inked === 0 &&
    cliffRow.minor.rects > 10 * cliffRow.major.rects &&
    cliffRow.major.inked > 0,
  `minor ${cliffRow.minor.rects} rects -> ${cliffRow.minor.inked} px;` +
    ` major ${cliffRow.major.rects} rects -> ${cliffRow.major.inked} px`,
);

t.ok(
  'so the visible dots are not the cost: they are under 5% of the primitives',
  (100 * cliffRow.major.rects) / (cliffRow.minor.rects + cliffRow.major.rects) < 5,
  `major share ${((100 * cliffRow.major.rects) / (cliffRow.minor.rects + cliffRow.major.rects)).toFixed(1)}%`,
);

/*
  The major tier peaks in on-screen density exactly at the boundary and thins out on both sides,
  which is what makes the reported band sit where it does. Worth asserting so a future reader does
  not have to re-derive it from the LoD ladder.
*/
const majorPeak = band.reduce((a, b) => (b.major.rects > a.major.rects ? b : a));
t.ok(
  'the major tier is at its densest immediately above z=0.5, as reported',
  majorPeak.z === 0.5001,
  `peak at z=${majorPeak.z} with ${majorPeak.major.rects} major dots;` +
    ` z=0.4999 has ${band.find((b) => b.z === 0.4999).major.rects},` +
    ` z=0.6 has ${band.find((b) => b.z === 0.6).major.rects}`,
);

t.ok(
  'strips cuts every zoom in the reported band by at least 5x',
  band.every((b) => b.minor.rects + b.major.rects >= 5 * (b.minor.stripOps + b.major.stripOps)),
  band
    .map(
      (b) =>
        `${b.z}:${((b.minor.rects + b.major.rects) / (b.minor.stripOps + b.major.stripOps)).toFixed(1)}x`,
    )
    .join(' '),
);

/*
  Step 2: the grid bounds itself by the bitmap, not by `cssW * dpr`.

  Structurally guaranteed now that `drawDotGrid` has no `cssW` parameter to disagree with, so what
  is worth checking is the consequence -- that the final device column is reachable at all. A
  bound computed from an unrounded `cssW * dpr` stops short of it for half of all fractional pane
  widths, which is how the rightmost partial column came to be under-drawn.
*/
const edge = await page.evaluate(
  ({ dpr, camX, camY }) => {
    const g = window.__grid;
    const lastColumnInk = (w) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = 64;
      const cx = c.getContext('2d');
      cx.fillStyle = g.theme.background;
      cx.fillRect(0, 0, w, 64);
      g.draw(cx, camX, camY, 1, dpr, g.theme);
      const d = cx.getImageData(w - 1, 0, 1, 64).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== 0x0f || d[i + 1] !== 0x11 || d[i + 2] !== 0x15) ink++;
      }
      return ink;
    };
    // Sweep a full minor step of widths; a bound that ignored the bitmap could not track this.
    const widths = [];
    for (let w = 600; w < 632; w++) widths.push({ w, ink: lastColumnInk(w) });
    return widths;
  },
  { dpr: DPR, camX: CAM_X, camY: CAM_Y },
);
t.ok(
  'the last device column is reachable: some bitmap width puts ink in it',
  edge.some((e) => e.ink > 0),
  `widths with ink in the final column: ${edge
    .filter((e) => e.ink > 0)
    .map((e) => e.w)
    .join(',')}`,
);

/*
  And the same thing end to end, through the real compositor.

  Everything above renders into canvases this script owns, which is what makes it trustworthy --
  but it also means none of it has touched the live `{ desynchronized: true, alpha: false }`
  context, the background fill, or the transform handoff between them. A screenshot goes through
  the compositor and comes back as pixels node can hash, so the four modes can be compared where
  they actually run.

  This is also the only check that exercises a FRACTIONAL CSS width, which is the whole point of
  deriving the loop bound from `canvas.width`: the default dock layout sizes the pane by
  fractional splits, so `cssW * dpr` is not an integer and `syncCanvasSize` rounds it. Where it
  rounds UP, the old CSS-space background fill left the final device column only partly covered --
  and with `alpha: false` and no clear, that column would keep a fraction of the previous frame's
  dot colour every frame. A smear like that shows up here and nowhere else in this file.
*/
const canvas = diagramCanvas(page);
const liveShot = async (mode, z) => {
  await page.evaluate(
    ({ mode, z }) => {
      window.__gridMode(mode);
      window.__view.zoomTo(z, window.__view.viewportCenter);
      window.__session.renderer.requestFrame();
    },
    { mode, z },
  );
  await page.waitForTimeout(350);
  return createHash('sha256')
    .update(await canvas.screenshot())
    .digest('hex')
    .slice(0, 16);
};

for (const z of [0.5001, 0.512, 0.875, 1]) {
  const shots = {};
  for (const mode of MODES) shots[mode] = await liveShot(mode, z);
  const agreed = new Set(Object.values(shots));
  t.ok(
    `z=${z} all four modes are identical on the live canvas`,
    agreed.size === 1,
    Object.entries(shots)
      .map(([m, h]) => `${m}=${h}`)
      .join(' '),
  );
}
await page.evaluate(() => window.__gridMode('row-fill'));

const geom = await page.evaluate(() => ({
  css: [window.__view.cssW, window.__view.cssH],
  bitmap: [window.__view.canvas.width, window.__view.canvas.height],
  dpr: window.__view.dpr,
}));
t.ok(
  'and it did that at a fractional CSS width, where the bitmap has to be rounded',
  !Number.isInteger(geom.css[0] * geom.dpr) || !Number.isInteger(geom.css[1] * geom.dpr),
  `css=${geom.css} x dpr ${geom.dpr} -> bitmap ${geom.bitmap}`,
);

const code = t.report(errors);
await browser.close();
process.exit(code);
