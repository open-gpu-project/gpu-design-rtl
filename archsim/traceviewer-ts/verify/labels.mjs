import { DEV_URL, open, suite } from './harness.mjs';

/*
  How a block's inset label and subtitle behave as the block gets smaller on screen, for
  iteration 5-4.

  Two defects this suite exists for. Type used to be a fixed 13px over a fixed 10px drawn only
  while the block was at least 44 CSS px, so zooming a diagram out blanked every block at once,
  long before the blocks themselves stopped being legible shapes -- and where it did draw, it
  rationed the height against that same 44px square, leaving a 30px block 22% inked. Type now
  spends the block's height as a budget and tracks it down to a readable floor.

  And width used to be handled by `fillText`'s fourth argument, which does not truncate and does
  not scale: it CONDENSES, squashing the glyphs horizontally and leaving their height alone. On
  a block taller than it is wide that reads as text stretched vertically.

  Three parts, deliberately. The height budget is arithmetic, so it is checked as arithmetic
  through `insetType`. The width fit needs a real font, so it is checked through `__insetFit`
  against a scratch canvas. The pixels are then checked once, at sizes either side of the
  interesting thresholds, because correct arithmetic wired into nothing at all would pass every
  assertion in the first two parts.
*/

const t = suite('labels');
const { browser, page, errors } = await open(DEV_URL);

/* ------------------------------------------------------ the height budget, as pure ---- */

const ramp = await page.evaluate(() => {
  const f = window.__insetType;
  const sizes = [];
  // 0.05 steps, not 1: the budget is continuous and its thresholds do not land on integers.
  for (let h = 100; h <= 4000; h++) sizes.push({ h: h / 20, ty: f(h / 20, true) });
  return {
    big: f(200, true),
    atOldGate: f(44, true),
    // Where the pair now reaches full size. The old rule needed 44 for anything at all.
    atFull: f(31, true),
    // Room for a label and not for a subtitle; and room for neither.
    labelOnly: f(24, true),
    tiny: f(12, true),
    noSubtitle: f(200, false),
    sizes,
  };
});

t.ok(
  'a block with height to spare gets exactly the type it always got',
  ramp.big.label === 13 &&
    ramp.big.subtitle === 10 &&
    Math.abs(ramp.big.gap - 14) < 1e-9 &&
    ramp.big.pad === 6,
  JSON.stringify(ramp.big),
);

// The headline change. 31 CSS px used to be 9.2px type with no subtitle at all; 36 used to be
// 10.6 over 8.2. Both are now the full pair, because the height is spent rather than compared
// against a reference square.
t.ok(
  'full-size type arrives at 31 CSS px, where it used to need 44',
  JSON.stringify(ramp.atFull) === JSON.stringify(ramp.big) &&
    JSON.stringify(ramp.atOldGate) === JSON.stringify(ramp.big),
  JSON.stringify({ atFull: ramp.atFull, atOldGate: ramp.atOldGate }),
);

t.ok(
  'a block with nothing to say in its subtitle is given no room for one',
  ramp.noSubtitle.subtitle === 0 && ramp.noSubtitle.label === 13,
  JSON.stringify(ramp.noSubtitle),
);

// Where the old rule drew nothing at all, twice over.
t.ok(
  'a block too short for two lines still gets one, at full size',
  ramp.labelOnly !== null && ramp.labelOnly.label === 13 && ramp.labelOnly.subtitle === 0,
  JSON.stringify(ramp.labelOnly),
);

t.ok(
  'and a block too short even for that gets none',
  ramp.tiny === null,
  JSON.stringify(ramp.tiny),
);

{
  // Every step of the sweep, so this is a statement about the function and not about the five
  // sizes someone happened to pick.
  let monotone = true;
  let capped = true;
  let vanished = false;
  let sawText = false;
  let sawNull = false;
  let prev = 0;
  for (const { ty } of ramp.sizes) {
    const label = ty === null ? 0 : ty.label;
    if (label + 1e-9 < prev) monotone = false;
    if (label > 13) capped = false;
    if (ty === null) {
      sawNull = true;
      // Growing a block can only ever add text. A null after a value means the budget has a
      // hole in it, which on screen is a block that blanks halfway through a zoom.
      if (sawText) vanished = true;
    } else sawText = true;
    prev = label;
  }
  t.ok(
    'the label never shrinks as the block grows, and never grows past full size',
    monotone && capped && !vanished && sawNull && sawText,
    JSON.stringify({ monotone, capped, vanished, sawNull, sawText }),
  );
}

{
  const firstLabel = ramp.sizes.find((r) => r.ty !== null)?.h ?? null;
  const firstSub = ramp.sizes.find((r) => r.ty !== null && r.ty.subtitle > 0)?.h ?? null;
  // The ordering the design turns on. It is no longer a matter of which font crosses a shared
  // floor first: the subtitle is paid for out of what is left after the label, so there is no
  // size at which a subtitle could appear under no label.
  t.ok(
    'shrinking a block loses the subtitle strictly before it loses the label',
    firstLabel !== null && firstSub !== null && firstSub > firstLabel,
    JSON.stringify({ firstLabel, firstSub }),
  );

  /*
    The budget balances: ink, plus the lead between the lines, plus a 3px margin on each side,
    is never more than the block. This is the assertion that would catch an over-generous ramp
    -- the failure mode of spending the height is text crossing the outline, where the failure
    mode of the old rule was text nowhere near it.
  */
  const INK_H = 0.95;
  const LEAD = 2.94;
  const MARGIN = 3;
  const over = ramp.sizes
    .filter((r) => r.ty !== null)
    .map((r) => {
      const span = INK_H * r.ty.label + (r.ty.subtitle > 0 ? INK_H * r.ty.subtitle + LEAD : 0);
      return { h: r.h, slack: r.h - span };
    })
    .filter((r) => r.slack < 2 * MARGIN - 1e-9);
  t.ok(
    'the two lines and their margins always add up to less than the block',
    over.length === 0,
    JSON.stringify(over.slice(0, 3)),
  );

  /*
    And the complaint that started this, stated exactly. A block too short for full-size type
    must be spending every pixel it has on the type: the margin, and nothing else, is what the
    type does not get. At 30 CSS px the old ramp inked 22% of the block and left 11.7px of dead
    space on each side of an 8.9px label.

    Not phrased as a fill fraction, because above 18.35 CSS px the label is pinned at its 13px
    ceiling and the leftover height is centring space rather than padding -- a 28px block is 43%
    inked and correctly so, since the alternative is type that grows past full size.
  */
  const loose = ramp.sizes
    .filter((r) => r.ty !== null && r.ty.label < 13 - 1e-9)
    .map((r) => {
      const span = INK_H * r.ty.label + (r.ty.subtitle > 0 ? INK_H * r.ty.subtitle + LEAD : 0);
      return { h: r.h, label: r.ty.label, slack: r.h - span };
    })
    .filter((r) => Math.abs(r.slack - 2 * MARGIN) > 1e-9);
  t.ok(
    'a block too short for full-size type gives the type everything but the margin',
    loose.length === 0,
    JSON.stringify(loose.slice(0, 3)),
  );

  /*
    And nothing anywhere got smaller. The old rule scaled both fonts by `min(1, h / 44)` and
    drew nothing below 8px, so it is arithmetic to compare against directly -- which is worth
    doing, because "bigger type at small sizes" is easy to buy by accident at the cost of a
    band somewhere else.
  */
  const shrunk = ramp.sizes
    .map((r) => {
      const oldLabel = Math.min(13, 13 * (r.h / 44));
      return {
        h: r.h,
        now: r.ty === null ? 0 : r.ty.label,
        before: oldLabel < 8 ? 0 : oldLabel,
      };
    })
    .filter((r) => r.now + 1e-9 < r.before);
  t.ok(
    'and no block anywhere gets less type than the rule this replaced gave it',
    shrunk.length === 0,
    JSON.stringify(shrunk.slice(0, 3)),
  );
}

/* ----------------------------------------------------------- the width fit, measured ---- */

/*
  `fitInsetLine` against a scratch canvas, which is the only way to check it: it exists to
  replace a measurement `fillText` was making internally and badly, so an assertion about it
  has to make the same measurement honestly.
*/
const fit = await page.evaluate(() => {
  const FAMILY = 'ui-sans-serif, system-ui, sans-serif';
  const g = document.createElement('canvas').getContext('2d');
  const fitLine = window.__insetFit;
  // The label vocabulary these diagrams actually use: short hardware identifiers.
  const WORDS = ['XU0', 'FETCH', 'REGFILE', 'XBN_ARB', 'DISPATCH', 'L2 CACHE'];
  const natural = (text, px) => {
    g.font = `${px}px ${FAMILY}`;
    return g.measureText(text).width;
  };

  const rows = [];
  for (const text of WORDS) {
    for (let maxW = 2; maxW <= 200; maxW += 1) {
      const r = fitLine(g, text, 26, 16, maxW);
      // Measured at the font the call LEFT BEHIND, not at one reconstructed here: the promise
      // is about the context it hands back, because that is the context that then draws.
      const drawn = r.text === '' ? 0 : g.measureText(r.text).width;
      rows.push({ text, maxW, px: r.px, out: r.text, drawn });
    }
  }
  return {
    rows,
    // Enough room at the ellipsis's own size for the ellipsis and nothing else.
    ellipsisOnly: (() => {
      g.font = `16px ${FAMILY}`;
      const w = g.measureText('…').width;
      return fitLine(g, 'DISPATCH', 26, 16, w + 0.5);
    })(),
    // Too narrow for `REGFILE` at 26, wide enough for it whole at something smaller.
    shrinkable: fitLine(g, 'REGFILE', 26, 16, natural('REGFILE', 20)),
    naturalAt20: natural('REGFILE', 20),
  };
});

{
  const over = fit.rows.filter((r) => r.drawn > r.maxW + 0.01);
  t.ok(
    'a fitted line is never wider than the budget it was given',
    over.length === 0,
    JSON.stringify({ sampled: fit.rows.length, over: over.slice(0, 3) }),
  );
}

{
  const bad = fit.rows.filter((r) => r.px < 16 || r.px > 26);
  t.ok(
    'and is never sized outside the floor and the ceiling it was given',
    bad.length === 0,
    JSON.stringify(bad.slice(0, 3)),
  );
}

{
  // Widening a block must not shrink its type. Without this the label would flicker between
  // two sizes as a block was resized across a measurement boundary.
  const bad = [];
  for (const text of new Set(fit.rows.map((r) => r.text))) {
    const run = fit.rows.filter((r) => r.text === text);
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      // Only compare sizes where both actually drew something: `px` is reported as the floor
      // when nothing fit, which is a size nobody sees.
      if (a.out !== '' && b.out !== '' && b.px < a.px) bad.push({ text, from: a, to: b });
    }
  }
  t.ok(
    'widening a block never shrinks the type in it',
    bad.length === 0,
    JSON.stringify(bad.slice(0, 3)),
  );
}

// Shrink before cut. `REG…` and `XBN_…` are the same string for two different blocks, so a
// smaller whole word carries strictly more information than a bigger stub.
t.ok(
  'a line that will not fit at full size is shrunk whole before it is ever cut',
  fit.shrinkable.text === 'REGFILE' && fit.shrinkable.px <= 20 && fit.shrinkable.px >= 16,
  JSON.stringify({ ...fit.shrinkable, budget: fit.naturalAt20 }),
);

t.ok(
  'and a line that cuts down to nothing but an ellipsis is dropped instead',
  fit.ellipsisOnly.text === '',
  JSON.stringify(fit.ellipsisOnly),
);

/* -------------------------------------------------------------- the budget, as pixels ---- */

/*
  Six blocks of one width and descending height at zoom 1, so one world unit is one CSS pixel
  and the heights below are literally the on-screen sizes the budget is reading.

  120, 44 and 31 are all full size -- 31 is the new threshold, 44 the old one. 24 has room for
  the label alone, 16 for a shrunken one, 12 for nothing. Under the old rule only the first two
  drew anything at all, and neither of those two drew a subtitle below 58.
*/
const HEIGHTS = [120, 44, 31, 24, 16, 12];

await page.evaluate((heights) => {
  const sc = window.__scene;
  sc.commit('scene', () => {
    sc.shapes = heights.map((h, i) => ({
      kind: 'rect',
      name: `h${h}`,
      label: 'BLOCK',
      subtitle: 'second line',
      labelMode: 'inset',
      description: '',
      x: 24 + (i % 3) * 200,
      y: 24 + Math.floor(i / 3) * 180,
      w: 176,
      h,
    }));
  });
  sc.setSelection(new Set());
  const v = window.__view;
  v.z = 1;
  v.camX = 0;
  v.camY = 0;
  v.clampCamera();
  window.__session.renderer.requestFrame();
}, HEIGHTS);
await page.waitForTimeout(500);

/**
 * The bounding box of the text pixels inside a block, and how many there are, excluding the
 * outline.
 *
 * Thresholded rather than matched exactly, because the glyphs are antialiased against the fill.
 * The band catches both `shapeLabel` and the quieter `shapeSubtitle` while excluding the blue
 * outline, whose red channel is far too low, and the fill, which is nearly black.
 */
const ink = (name) =>
  page.evaluate((n) => {
    const v = window.__view;
    const s = window.__scene.shapes.find((x) => x.name === n);
    const a = v.toScreen({ x: s.x, y: s.y });
    const b = v.toScreen({ x: s.x + s.w, y: s.y + s.h });
    const pad = 2;
    const x0 = Math.ceil((a.x + pad) * v.dpr);
    const y0 = Math.ceil((a.y + pad) * v.dpr);
    const x1 = Math.floor((b.x - pad) * v.dpr);
    const y1 = Math.floor((b.y - pad) * v.dpr);
    const onScreen =
      x0 >= 0 && y0 >= 0 && x1 <= v.canvas.width && y1 <= v.canvas.height && x1 > x0 && y1 > y0;
    if (!onScreen) return { n: -1, onScreen };
    const w = x1 - x0;
    const d = v.canvas.getContext('2d').getImageData(x0, y0, w, y1 - y0).data;
    let lit = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let top = Infinity;
    let bot = -Infinity;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 120 && d[i + 1] > 140 && d[i + 2] > 170) {
        const px = (i / 4) % w;
        const py = Math.floor(i / 4 / w);
        lit++;
        if (px < lo) lo = px;
        if (px > hi) hi = px;
        if (py < top) top = py;
        if (py > bot) bot = py;
      }
    }
    return { n: lit, onScreen, w: lit === 0 ? 0 : hi - lo + 1, h: lit === 0 ? 0 : bot - top + 1 };
  }, name);

const lit = {};
for (const h of HEIGHTS) lit[h] = (await ink(`h${h}`)).n;

t.ok(
  'every block is where the check thinks it is',
  Object.values(lit).every((n) => n >= 0),
  JSON.stringify(lit),
);

t.ok(
  'a block too small for readable type draws none, and one just above it draws some',
  lit[12] === 0 && lit[16] > 0,
  JSON.stringify(lit),
);

// The behaviour the iteration is for: 31, 24 and 16 CSS px used to be blank, because the old
// gate was 44 and there was nothing between "full size" and "gone".
t.ok(
  'blocks under the old gate draw text, where they used to draw nothing at all',
  lit[31] > 0 && lit[24] > 0 && lit[16] > 0,
  JSON.stringify(lit),
);

t.ok(
  'a block at the new full-size threshold draws as much as one four times its height',
  Math.abs(lit[120] - lit[31]) <= Math.max(2, lit[120] * 0.02) &&
    Math.abs(lit[120] - lit[44]) <= Math.max(2, lit[120] * 0.02),
  JSON.stringify(lit),
);

// Below the threshold the subtitle goes, then the label shrinks. Not just "some ink either
// way": an equal count would mean the budget was not being read.
t.ok(
  'and below it there is less ink the smaller the block gets',
  lit[31] > lit[24] && lit[24] > lit[16],
  JSON.stringify(lit),
);

/* ------------------------------------------------------- no condensation, as pixels ---- */

/*
  The stretch bug, at the pixels. A block far taller than it is wide, zoomed until its label no
  longer fits across it: `fillText`'s `maxWidth` used to keep the 13px em height and squeeze the
  glyph run into the width, so the same word got narrower and narrower at a constant height.
  Measured on this block before the fix, the glyphs were 81% of their natural width at z=0.75
  and 65% at z=0.50.

  Checked against a fresh measurement of the very string that was drawn, at the very size it was
  drawn at, rather than against a tolerance on the aspect ratio -- which at these ink heights is
  quantised too coarsely to separate a 19% squeeze from rounding.
*/
await page.evaluate(() => {
  const sc = window.__scene;
  sc.commit('scene', () => {
    sc.shapes = [
      {
        kind: 'rect',
        name: 'tall',
        label: 'MEMORY',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        x: 40,
        y: 40,
        w: 70,
        h: 260,
      },
    ];
  });
  sc.setSelection(new Set());
});

const ZOOMS = [1, 0.8, 0.6];
const squeeze = [];
for (const z of ZOOMS) {
  await page.evaluate((zz) => {
    const v = window.__view;
    v.z = zz;
    v.camX = 0;
    v.camY = 0;
    v.clampCamera();
    window.__session.renderer.requestFrame();
  }, z);
  await page.waitForTimeout(300);
  const box = await ink('tall');
  /*
    The size the renderer settled on, reached the way the renderer reaches it. Reconstructed
    here rather than reported by the app, and self-checking because of it: if this arithmetic
    drifted from `drawInsetLabel`'s, the predicted width would stop matching the drawn one and
    the assertion below would fail rather than quietly pass.
  */
  const predicted = await page.evaluate(() => {
    const v = window.__view;
    const s = window.__scene.shapes.find((x) => x.name === 'tall');
    const a = v.toScreen({ x: s.x, y: s.y });
    const b = v.toScreen({ x: s.x + s.w, y: s.y + s.h });
    const boxW = (b.x - a.x) * v.dpr;
    const boxH = (b.y - a.y) * v.dpr;
    const ty = window.__insetType(boxH / v.dpr, false);
    if (ty === null) return null;
    const floorPx = Math.round(8 * v.dpr);
    const ceiling = Math.max(floorPx, Math.floor(ty.label * v.dpr));
    const g = document.createElement('canvas').getContext('2d');
    const r = window.__insetFit(g, 'MEMORY', ceiling, floorPx, boxW - ty.pad * v.dpr);
    const m = g.measureText(r.text);
    return {
      px: r.px,
      text: r.text,
      // Ink extents, which is what the pixel count above is also measuring.
      inkW: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
      maxW: boxW - ty.pad * v.dpr,
    };
  });
  squeeze.push({ z, box, predicted });
}

t.ok(
  'a tall narrow block draws its label at its natural width at every zoom, never condensed',
  squeeze.every(
    (r) =>
      r.predicted !== null &&
      r.predicted.text === 'MEMORY' &&
      r.box.n > 0 &&
      Math.abs(r.box.w - r.predicted.inkW) <= 2,
  ),
  JSON.stringify(
    squeeze.map((r) => ({
      z: r.z,
      px: r.predicted?.px,
      drawn: r.box.w,
      natural: r.predicted?.inkW?.toFixed(1),
    })),
  ),
);

t.ok(
  'and it shrinks the type to do it, rather than keeping the size and losing the word',
  squeeze[0].predicted.px > squeeze[2].predicted.px &&
    squeeze.every((r) => r.predicted.inkW <= r.predicted.maxW + 0.01),
  JSON.stringify(squeeze.map((r) => ({ z: r.z, px: r.predicted.px, maxW: r.predicted.maxW }))),
);

/* --------------------------------------------------------------------------- by zoom ---- */

/*
  The height budget arrived at by zooming rather than by resizing, which is how anyone actually
  meets it. A 120px block at z=0.3 is 36 CSS px on screen and must read like a 36px block does:
  the budget keys off what is on screen, and nothing else.
*/
await page.evaluate((heights) => {
  const sc = window.__scene;
  sc.commit('scene', () => {
    sc.shapes = heights.map((h, i) => ({
      kind: 'rect',
      name: `h${h}`,
      label: 'BLOCK',
      subtitle: 'second line',
      labelMode: 'inset',
      description: '',
      x: 24 + (i % 3) * 200,
      y: 24 + Math.floor(i / 3) * 180,
      w: 176,
      h,
    }));
  });
  sc.setSelection(new Set());
  const v = window.__view;
  v.z = 1;
  v.camX = 0;
  v.camY = 0;
  v.clampCamera();
  v.zoomTo(0.3, { x: v.cssW / 2, y: v.cssH / 2 });
  window.__session.renderer.requestFrame();
}, HEIGHTS);
await page.waitForTimeout(400);
const zoomed = (await ink('h120')).n;

t.ok(
  'zooming out shrinks a block’s text with it instead of blanking the block',
  zoomed > 0 && zoomed < lit[120],
  JSON.stringify({ zoomed, atZoom1: lit[120] }),
);

const code = t.report(errors);
await browser.close();
process.exit(code);
