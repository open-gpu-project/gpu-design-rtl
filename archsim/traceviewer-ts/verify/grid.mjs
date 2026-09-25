import { createHash } from 'node:crypto';

import { DEV_URL, diagramCanvas, installProbes, open, suite } from './harness.mjs';

/*
  Dot-grid checks.

  The grid is drawn as cached row strips (`canvas/grid-renderer.ts`), and two properties of that
  matter. Neither is measurable in the obvious way.

  PIXEL IDENTITY. Strips are a faster way to draw the same dots, so the claim is that the output
  is what drawing each dot as its own rect would give. That is checked against a REFERENCE
  renderer defined in this file: the per-dot loop, with the same level-of-detail math and the
  constants imported from the app's own pure modules. The diff must not be taken off the live
  canvas: it is created `{ desynchronized: true }`, and low-latency canvases have a history of
  handing back unflushed or front-buffer content. So every comparison renders through
  `window.__grid.draw` into a canvas this script owns, which makes it a pure-function test with no
  compositor in the loop.

  The comparison also happens IN THE PAGE. A 3092x1222 bitmap is 15MB of RGBA; handing it back
  through `evaluate` serializes it as a JSON array of 15 million numbers and kills the node
  process outright. Only the verdicts cross the bridge.

  OP COUNTS. Frame *times* cannot be asserted: Safari rasterizes the display list in its GPU
  process, `performance.now()` around `draw()` reads 0-1ms at 20fps, and Playwright's WebKit has
  no GPU-process canvas at all. What IS deterministic is how many primitives a frame emits, which
  is the quantity strips exist to hold down. So counts are asserted and times are never
  mentioned.

  Geometry is a 1546x611 CSS canvas at dpr 2 -- 3092x1222 device pixels, the diagram pane
  maximized on a large monitor, where the problem was measured (iteration 3).
*/

const t = suite('grid');
const { browser, page, errors } = await open(DEV_URL);
await installProbes(page);

const DEV_W = 3092;
const DEV_H = 1222;
const DPR = 2;
// Fractional, and not a whole number of grid steps: `x0` and `y0` are what the rounding acts on,
// and a camera on an exact multiple would hide every off-by-one this file exists to catch.
const CAM_X = 137.37;
const CAM_Y = 91.13;

/*
  The reference, installed once. One `rect()` per dot in a single batched path, which is right by
  construction; the strips are what needs vouching for, since they are only pixel-identical
  through an argument about clipping, premultiplication and `globalAlpha`.

  The constants are imported by URL, which is safe for these two modules and would not be for
  most: neither imports anything at runtime, so a second module instance after a hot reload is
  indistinguishable from the first. The LoD math is copied rather than imported on purpose --
  it is part of what is being checked.
*/
await page.evaluate(async () => {
  const { GRID, MAJOR_EVERY } = await import('/src/lib/grid.ts');
  const { MIN_DOT_PX } = await import('/src/lib/canvas/theme.ts');
  const mod = (n, m) => ((n % m) + m) % m;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const dots = (ctx, camX, camY, step, skipEvery, z, dpr, size) => {
    const devW = ctx.canvas.width;
    const devH = ctx.canvas.height;
    const stepDev = step * z * dpr;
    if (!Number.isFinite(stepDev) || stepDev < 2) return;
    const half = Math.floor(size / 2);
    const i0 = Math.ceil(camX / step);
    const j0 = Math.ceil(camY / step);
    const x0 = (i0 * step - camX) * z * dpr;
    const y0 = (j0 * step - camY) * z * dpr;
    ctx.beginPath();
    let j = j0;
    for (let y = y0; y < devH; y += stepDev, j++) {
      const majorRow = skipEvery > 0 && mod(j, skipEvery) === 0;
      const py = Math.round(y) - half;
      let i = i0;
      for (let x = x0; x < devW; x += stepDev, i++) {
        if (majorRow && mod(i, skipEvery) === 0) continue;
        ctx.rect(Math.round(x) - half, py, size, size);
      }
    }
    ctx.fill();
  };

  window.__refGrid = (ctx, camX, camY, z, dpr, theme) => {
    const level = Math.max(0, Math.ceil(Math.log(MIN_DOT_PX / (GRID * z)) / Math.log(MAJOR_EVERY)));
    const minorStep = GRID * MAJOR_EVERY ** level;
    const majorStep = minorStep * MAJOR_EVERY;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const minorAlpha = clamp((minorStep * z - MIN_DOT_PX) / 6, 0, 1);
    if (minorAlpha > 0) {
      ctx.globalAlpha = minorAlpha;
      ctx.fillStyle = theme.gridDotMinor;
      dots(ctx, camX, camY, minorStep, MAJOR_EVERY, z, dpr, Math.max(1, Math.round(1.5 * dpr)));
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = theme.gridDotMajor;
    dots(ctx, camX, camY, majorStep, 0, z, dpr, Math.max(2, Math.round(2.5 * dpr)));
  };
});

/**
 * Render the reference and the grid into this script's own canvases and diff them.
 *
 * Counted around the grid's draw only, so neither the background fill nor the reference lands in
 * the numbers.
 */
const render = (z, { w = DEV_W, h = DEV_H, dpr = DPR, camX = CAM_X, camY = CAM_Y } = {}) =>
  page.evaluate(
    ({ z, w, h, dpr, camX, camY }) => {
      const g = window.__grid;
      const bg = [0x0f, 0x11, 0x15];
      const surface = () => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        // No options: a `colorSpace` or `willReadFrequently` would put this on a colour-managed
        // or CPU-backed path and stop it being a fair comparison with the live context.
        const cx = c.getContext('2d');
        cx.setTransform(1, 0, 0, 1, 0, 0);
        cx.fillStyle = g.theme.background;
        cx.fillRect(0, 0, w, h);
        return cx;
      };
      const inked = (px) => {
        let ink = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] !== bg[0] || px[i + 1] !== bg[1] || px[i + 2] !== bg[2]) ink++;
        }
        return ink;
      };

      const rc = surface();
      window.__refGrid(rc, camX, camY, z, dpr, g.theme);
      const ref = rc.getImageData(0, 0, w, h).data;

      const gc = surface();
      const n = window.__count(['rect', 'fillRect', 'drawImage'], () =>
        g.draw(gc, camX, camY, z, dpr, g.theme),
      ).counts;
      const px = gc.getImageData(0, 0, w, h).data;

      let maxDelta = 0;
      let pixels = 0;
      for (let i = 0; i < px.length; i += 4) {
        const d = Math.max(
          Math.abs(px[i] - ref[i]),
          Math.abs(px[i + 1] - ref[i + 1]),
          Math.abs(px[i + 2] - ref[i + 2]),
        );
        if (d > 0) pixels++;
        if (d > maxDelta) maxDelta = d;
      }
      return { ops: n.rect + n.fillRect + n.drawImage, n, refInk: inked(ref), maxDelta, pixels };
    },
    { z, w, h, dpr, camX, camY },
  );

/*
  The zoom set, and why each one is here.

  0.5001 is where the grid is most expensive to draw a dot at a time: `level` has just stepped,
  the minor tier is at its densest, and `minorAlpha` is 0.000267 -- which rounds to a paint alpha
  of 0, so the minor tier writes no pixels and this zoom ISOLATES THE MAJOR TIER. 0.512 does not do
  that and is often mistaken for it: there `minorAlpha` is 0.032, a paint alpha of 8, and both
  tiers land in the one bitmap. Both are kept, for opposite reasons.

  One LSB per channel is allowed only in the blend band, where `globalAlpha` quantizes twice and a
  solid fill and a textured blit are different shader programs. 0.875 is where `clampNum` starts
  returning literally 1, so at and above it the minor tier is a straight opaque draw with no blend
  path at all, and the claim is exact.
*/
const ZOOMS = [
  { z: 0.4999, tol: 0 }, // one increment below the level change
  { z: 0.5001, tol: 0 }, // the minor tier writes nothing -- the major tier alone
  { z: 0.512, tol: 1 }, // three clicks of zoom-out from 100%; minor tier at paint alpha 8
  { z: 0.55, tol: 1 },
  { z: 0.875, tol: 0 }, // `clampNum` returns literally 1 at and above here: no blend path
  { z: 1, tol: 0 },
  { z: 4, tol: 0 },
  { z: 16, tol: 0 },
];

const exact = (label, r, tol) =>
  t.ok(
    `${label} is within ${tol} LSB of the per-dot reference`,
    r.refInk > 0 && r.maxDelta <= tol,
    `maxDelta=${r.maxDelta} differing=${r.pixels} inked=${r.refInk} ops=${r.ops}`,
  );

for (const { z, tol } of ZOOMS) exact(`z=${z}`, await render(z), tol);

/*
  A canvas only a few rows tall. Strips are built per row KIND, so a grid with one or two rows is
  the case where building them is the whole cost -- and the exactness argument must not quietly
  depend on there being many rows to amortize over. The camera is chosen so a row lands inside
  the 64 device pixels, or the comparison would be two empty bitmaps agreeing.
*/
exact('a 64px-tall canvas at z=4', await render(4, { h: 64 }), 0);
exact('a 64px-tall canvas at z=16', await render(16, { h: 64, camY: 95.37 }), 0);

/*
  Other device pixel ratios. Dot size and `stepDev` both scale with dpr, and at 1.5 the minor dot
  is `round(2.25) = 2` pixels -- an even size, where `half` has to be `floor` or every dot lands on
  a half-pixel and blurs.
*/
for (const dpr of [1.5, 1]) {
  exact(`dpr ${dpr} at z=0.512`, await render(0.512, { dpr }), 1);
  exact(`dpr ${dpr} at z=1`, await render(1, { dpr }), 0);
}

/*
  A WARM cache draws what a cold one would, along a path through every input the key carries.

  The per-zoom checks above each start from a fresh grid, so a key that omits something would
  sail through all of them: every one is a cold build. This walks ONE grid through a sequence of
  cameras and compares each frame with a fresh grid's. The step that pans by exactly one minor
  step is the case that motivates keying on `camX` rather than `x0` -- `x0` comes back
  bit-identical while the major holes move to different columns.
*/
const warm = await page.evaluate(
  ({ w, h, dpr, camX, camY }) => {
    const g = window.__grid;
    const path = [
      { camX, camY, z: 1, dpr, w },
      { camX: camX + 16, camY, z: 1, dpr, w }, // exactly one minor step: x0 is unchanged
      { camX: camX + 16, camY: camY + 37.5, z: 1, dpr, w }, // vertical only: a hit
      { camX: camX + 53.25, camY: camY + 37.5, z: 1, dpr, w },
      { camX: camX + 53.25, camY: camY + 37.5, z: 0.512, dpr, w },
      { camX: camX + 53.25, camY: camY + 37.5, z: 0.512, dpr: 1.5, w },
      { camX: camX + 53.25, camY: camY + 37.5, z: 0.512, dpr: 1.5, w: w - 7 },
      { camX, camY, z: 1, dpr, w },
    ];
    const draw = (grid, s) => {
      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = h;
      const cx = c.getContext('2d');
      cx.fillStyle = g.theme.background;
      cx.fillRect(0, 0, s.w, h);
      grid.draw(cx, s.camX, s.camY, s.z, s.dpr, g.theme);
      return cx.getImageData(0, 0, s.w, h).data;
    };
    const held = new g.DotGrid();
    return path.map((s, k) => {
      const a = draw(held, s);
      const b = draw(new g.DotGrid(), s);
      let differing = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
      return { step: k, differing };
    });
  },
  { w: DEV_W, h: DEV_H, dpr: DPR, camX: CAM_X, camY: CAM_Y },
);
t.ok(
  'a warm strip cache draws exactly what a cold one does, across pan, zoom, dpr and width',
  warm.every((s) => s.differing === 0),
  warm.map((s) => `${s.step}:${s.differing}`).join(' '),
);

/*
  CACHE HITS. The key carries `camX` but deliberately not `camY`, so a purely vertical pan must
  reuse both strips and emit no rects at all. During a pinch it misses on every frame, because
  `zoomTo` rewrites `z` AND `camX` -- that is expected, and the win there is the op count below,
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
    const pass = (cX, cY) =>
      window.__count(['rect', 'drawImage'], () => grid.draw(cx, cX, cY, 0.512, dpr, g.theme))
        .counts;
    return {
      cold: pass(camX, camY),
      sameCam: pass(camX, camY),
      vertical: pass(camX, camY + 37.5),
      horizontal: pass(camX + 37.5, camY),
    };
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
  FLATNESS, which is the property strips exist for.

  A strip is built per row KIND, not per row, so making the canvas twice as tall must not change
  how many rects a frame emits -- only how many blits. That is O(area) becoming O(perimeter),
  stated as something a script can assert.
*/
const tall = await render(0.512, { h: DEV_H * 2 });
const short = await render(0.512);
t.ok(
  'doubling canvas height does not change how many rects the grid emits',
  tall.n.rect === short.n.rect,
  `${short.n.rect} -> ${tall.n.rect} rects, blits ${short.n.drawImage} -> ${tall.n.drawImage}`,
);

/*
  The op budget at the worst zoom. Drawn a dot at a time, z = 0.5001 is 14 668 rects at this
  geometry, and Safari's composite degraded past roughly 4 000-5 000 primitives (iteration 3).
*/
const worst = await render(0.5001);
t.ok(
  'the worst zoom stays well under the primitive count where Safari degrades',
  worst.ops < 1000,
  `${worst.ops} ops at z=0.5001 (${JSON.stringify(worst.n)})`,
);

/*
  No step in the level-of-detail band below z = 0.5.

  Boundaries sit at MIN_DOT_PX / (GRID * MAJOR_EVERY^k): z = 0.5, then 8/96 = 0.0833, which is
  below ZOOM_MIN = 0.1 and so unreachable -- leaving z = 0.5 as the only level change a user can
  provoke. This breaks if ZOOM_MIN is lowered or MAJOR_EVERY is reduced, either of which would
  quietly bring a second level change into reach.
*/
const lodBand = [0.1, 0.13, 0.17, 0.22, 0.29, 0.37, 0.45, 0.4999];
const lodSweep = [];
for (const z of lodBand) lodSweep.push({ z, ops: (await render(z)).ops });
const lodSteps = lodSweep.slice(1).map((s, i) => s.ops / Math.max(1, lodSweep[i].ops));
t.ok(
  'z=0.5 is the only level change in reach: the band below it has no step in it',
  lodSteps.every((r) => r < 2),
  `worst adjacent step ${Math.max(...lodSteps).toFixed(2)}x across ` +
    lodSweep.map((s) => `${s.z}:${s.ops}`).join(' '),
);

/*
  The grid bounds itself by the bitmap, not by `cssW * dpr`.

  Structurally guaranteed, since `DotGrid.draw` has no `cssW` parameter to disagree with, so what
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
  And the cache end to end, through the real compositor.

  Everything above renders into canvases this script owns, which is what makes it trustworthy --
  but it also means none of it has touched the live `{ desynchronized: true, alpha: false }`
  context, the background fill, or the transform handoff between them. A screenshot goes through
  the compositor and comes back as pixels node can hash.

  The claim is path independence: arriving at a camera from a neighbouring one, with the strips
  warm from there, must look exactly like arriving at it cold. The neighbour is one minor step
  to the left, the pan that leaves `x0` bit-identical.

  This is also the only check that exercises a FRACTIONAL CSS width, which is the whole point of
  deriving the loop bound from `canvas.width`: the default dock layout sizes the pane by
  fractional splits, so `cssW * dpr` is not an integer and `syncCanvasSize` rounds it. Where it
  rounds UP, a CSS-space background fill would leave the final device column only partly covered
  -- and with `alpha: false` and no clear, that column would keep a fraction of the previous
  frame's dot colour every frame. A smear like that shows up here and nowhere else in this file.
*/
const canvas = diagramCanvas(page);
const liveShot = async (cam, { cold }) => {
  await page.evaluate(
    ({ cam, cold }) => {
      const v = window.__view;
      v.z = cam.z;
      v.camX = cam.camX;
      v.camY = cam.camY;
      // Drops the strips and nothing else; the next frame rebuilds them.
      if (cold) window.__session.renderer.dispose();
      window.__session.renderer.requestFrame();
    },
    { cam, cold },
  );
  await page.waitForTimeout(350);
  return createHash('sha256')
    .update(await canvas.screenshot())
    .digest('hex')
    .slice(0, 16);
};

for (const z of [0.512, 1]) {
  const at = { z, camX: 40.37, camY: 20.13 };
  const coldShot = await liveShot(at, { cold: true });
  const nearShot = await liveShot({ ...at, camX: at.camX - 16 }, { cold: true });
  const warmShot = await liveShot(at, { cold: false });
  t.ok(
    `z=${z} the live canvas is the same whether the strips arrive warm or cold`,
    coldShot === warmShot && nearShot !== coldShot,
    `cold=${coldShot} warm=${warmShot} neighbour=${nearShot}`,
  );
}

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

/*
  THE DOT HIERARCHY.

  Counted off the pixels rather than read off the constant, which is the only version of this
  check worth having: `MAJOR_EVERY` is simultaneously the highlight interval and the
  level-of-detail ratio, and an expression that got one of those right while getting the other
  wrong would still satisfy any assertion phrased in terms of the constant itself.

  Dots are two device pixels wide at dpr 1, so inked columns are grouped into runs before being
  counted -- counting columns gives ten and the answer is five.
*/
const hierarchy = await page.evaluate(() => {
  const g = window.__grid;
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 64;
  const cx = c.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = g.theme.background;
  cx.fillRect(0, 0, c.width, c.height);
  // dpr 1 and z 1, so one world unit is one pixel and the spacing is GRID exactly.
  g.draw(cx, 0, 0, 1, 1, g.theme);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  const at = (x, y) => {
    const i = (y * c.width + x) * 4;
    return `${d[i]},${d[i + 1]},${d[i + 2]}`;
  };
  const bg = at(3, 40);

  // The row holding the most ink is a dot row; dots are a couple of pixels tall.
  let best = { y: 0, cols: [] };
  for (let y = 0; y < 40; y++) {
    const cols = [];
    for (let x = 0; x < c.width; x++) if (at(x, y) !== bg) cols.push({ x, c: at(x, y) });
    if (cols.length > best.cols.length) best = { y, cols };
  }

  // Group adjacent inked columns into one dot, and call it major if any column is major-coloured.
  const hex = (s) =>
    s
      .replace('#', '')
      .match(/../g)
      .map((h) => parseInt(h, 16))
      .join(',');
  const majorRGB = hex(g.theme.gridDotMajor);
  const dots = [];
  for (const col of best.cols) {
    const last = dots[dots.length - 1];
    if (last !== undefined && col.x <= last.x1 + 1) {
      last.x1 = col.x;
      last.major = last.major || col.c === majorRGB;
    } else {
      dots.push({ x0: col.x, x1: col.x, major: col.c === majorRGB });
    }
  }

  const majorAt = dots.map((dot, i) => (dot.major ? i : -1)).filter((i) => i >= 0);
  const gaps = majorAt.slice(1).map((i, k) => i - majorAt[k] - 1);
  const spacing = majorAt.slice(1).map((i, k) => dots[i].x0 - dots[majorAt[k]].x0);
  return {
    dots: dots.length,
    majors: majorAt.length,
    gaps: [...new Set(gaps)],
    spacing: [...new Set(spacing)],
  };
});

t.ok(
  'exactly five minor dots sit between two major ones',
  hierarchy.majors >= 4 && hierarchy.gaps.length === 1 && hierarchy.gaps[0] === 5,
  `gaps ${JSON.stringify(hierarchy.gaps)} across ${hierarchy.majors} majors of ${hierarchy.dots} dots`,
);
/*
  Within a pixel, and that pixel is real: a major dot inks three columns to a minor's two, and
  the one at x = 0 is clipped by the left edge, so its leading column sits where its centre
  would be. The claim is the spacing, not the rasterization.
*/
t.ok(
  'and they are 6 steps of the unchanged 16-unit grid apart, so the snap step did not move',
  hierarchy.spacing.length > 0 && hierarchy.spacing.every((d) => Math.abs(d - 96) <= 1),
  `majors every ${JSON.stringify(hierarchy.spacing)}px at z=1 — want 96 = 16 x 6`,
);

const code = t.report(errors);
await browser.close();
process.exit(code);
