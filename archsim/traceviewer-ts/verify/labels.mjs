import { DEV_URL, installProbes, open, suite } from './harness.mjs';

/*
  How a block's inset label and subtitle behave as the block gets smaller on screen
  (iteration 5).

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

  Iteration 6 added two more things to this file, and they share the machinery. Subtitles grew
  from one line to `n`, so the `hasSubtitle` boolean below became a line COUNT -- every number in
  this block is the number the boolean produced, which is what makes the whole first part the
  regression net for that change. And `text.ts` grew a width cache, which is the half of the
  Safari fix that scales with shape count, so the last part counts
  `measureText` calls the way `grid.mjs` counts `rect`.
*/

const t = suite('labels');
const { browser, page, errors } = await open(DEV_URL);
await installProbes(page);

/* ------------------------------------------------------ the height budget, as pure ---- */

const ramp = await page.evaluate(() => {
  const f = window.__insetType;
  const sizes = [];
  // 0.05 steps, not 1: the budget is continuous and its thresholds do not land on integers.
  for (let h = 100; h <= 4000; h++) sizes.push({ h: h / 20, ty: f(h / 20, 1) });
  return {
    big: f(200, 1),
    atOldGate: f(44, 1),
    // Where the pair now reaches full size. The old rule needed 44 for anything at all.
    atFull: f(31, 1),
    // Room for a label and not for a subtitle; and room for neither.
    labelOnly: f(24, 1),
    tiny: f(12, 1),
    noSubtitle: f(200, 0),
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

/* ------------------------------------------- subtitles of several lines, as pure ---- */

/*
  The property editor has always accepted a newline in a subtitle and the file
  format has always round-tripped it; canvas 2D draws one as a space, so what the user typed was
  silently collapsed into one over-long run.

  The whole of the first part of this file is the regression net for the generalisation, because
  every number in it is the number the `hasSubtitle` boolean produced. These assertions add what
  the boolean could not express.
*/

{
  /*
    The one- and zero-line answers, against literals captured from the build BEFORE the change.

    Pinned as a table rather than derived, which is the point: a formula that agrees with itself
    proves nothing, and these are the numbers every existing diagram was drawn with.
  */
  const BASELINE = [
    [200, { label: 13, subtitle: 10, gap: 14, pad: 6 }, { label: 13, subtitle: 0, gap: 0, pad: 6 }],
    [44, { label: 13, subtitle: 10, gap: 14, pad: 6 }, { label: 13, subtitle: 0, gap: 0, pad: 6 }],
    [31, { label: 13, subtitle: 10, gap: 14, pad: 6 }, { label: 13, subtitle: 0, gap: 0, pad: 6 }],
    [
      28.9,
      { label: 13, subtitle: 8.010526315789473, gap: 13.144526315789474, pad: 6 },
      { label: 13, subtitle: 0, gap: 0, pad: 6 },
    ],
    [28.88, { label: 13, subtitle: 0, gap: 0, pad: 6 }, { label: 13, subtitle: 0, gap: 0, pad: 6 }],
    [24, { label: 13, subtitle: 0, gap: 0, pad: 6 }, { label: 13, subtitle: 0, gap: 0, pad: 6 }],
    [
      16,
      { label: 10.526315789473685, subtitle: 0, gap: 0, pad: 6 },
      { label: 10.526315789473685, subtitle: 0, gap: 0, pad: 6 },
    ],
    [13.6, { label: 8, subtitle: 0, gap: 0, pad: 6 }, { label: 8, subtitle: 0, gap: 0, pad: 6 }],
    [13.5, null, null],
    [12, null, null],
  ];

  const got = await page.evaluate(
    (table) =>
      table.map(([h]) => {
        const one = window.__insetType(h, 1);
        const none = window.__insetType(h, 0);
        const strip = (ty) =>
          ty === null ? null : { label: ty.label, subtitle: ty.subtitle, gap: ty.gap, pad: ty.pad };
        return [h, strip(one), strip(none)];
      }),
    BASELINE,
  );
  t.ok(
    'one subtitle line is numerically what the boolean produced, and none is what false produced',
    JSON.stringify(got) === JSON.stringify(BASELINE),
    JSON.stringify(got),
  );
}

{
  const multi = await page.evaluate(() => {
    const f = window.__insetType;
    const INK_H = 0.95;
    const LEAD = 2.94;
    const MARGIN = 3;
    const FLOOR = 8;
    const LABEL = 13;

    const overflow = [];
    const shrinking = [];
    const closedForm = [];
    const capped = [];
    let monotone = true;
    let prevLines = -1;

    for (let i = 60; i <= 4000; i++) {
      const h = i / 20;
      for (const req of [0, 1, 2, 3, 4]) {
        const ty = f(h, req);
        if (ty === null) continue;
        if (ty.lines > req) capped.push({ h, req, lines: ty.lines });
        // The budget, generalised: `n` line-heights and `n` leads under a full-size label.
        const span = INK_H * ty.label + ty.lines * (INK_H * ty.subtitle + LEAD);
        if (h - span < 2 * MARGIN - 1e-9) overflow.push({ h, req, slack: h - span });
        // Brute force against the closed form, which is the only way to check a rearrangement.
        let want = 0;
        for (let n = 1; n <= req; n++) {
          const per = (h - 2 * MARGIN - INK_H * LABEL - n * LEAD) / (n * INK_H);
          if (per >= FLOOR - 1e-12) want = n;
        }
        if (want !== ty.lines) closedForm.push({ h, req, want, got: ty.lines });
      }
      const two = f(h, 2);
      const one = f(h, 1);
      if (two !== null && one !== null && two.subtitle > one.subtitle + 1e-9) {
        shrinking.push({ h, one: one.subtitle, two: two.subtitle });
      }
      // Lines offered can only grow with the block, for the same reason the label can only grow:
      // text that vanishes halfway through a zoom is the defect this file was opened for.
      const four = f(h, 4);
      const lines = four === null ? 0 : four.lines;
      if (lines + 1e-9 < prevLines) monotone = false;
      prevLines = lines;
    }
    return { overflow, shrinking, closedForm, capped, monotone };
  });

  t.ok(
    'a second line is paid for out of the same budget, never at the first line size',
    multi.shrinking.length === 0,
    JSON.stringify(multi.shrinking.slice(0, 3)),
  );
  t.ok(
    'the stack never overflows the block, at any line count',
    multi.overflow.length === 0,
    JSON.stringify(multi.overflow.slice(0, 3)),
  );
  /*
    The largest PREFIX that fits, and the assertion that the closed form is that prefix. Under an
    all-or-nothing rule, adding a second line would blank the subtitle entirely on a block that
    had been showing one -- a regression bought by a feature, which is the thing to not do.
  */
  t.ok(
    'the largest prefix that fits is what is offered, and a loop agrees with the closed form',
    multi.closedForm.length === 0,
    JSON.stringify(multi.closedForm.slice(0, 3)),
  );
  t.ok(
    'never more lines than were typed',
    multi.capped.length === 0,
    JSON.stringify(multi.capped.slice(0, 3)),
  );
  t.ok('and more height never means fewer lines', multi.monotone);
}

{
  /*
    The baseline quantisation, and it is worth its own block.

    The one-line code placed the pair at `cy - half` and `cy + half` for
    `half = Math.floor(gap * dpr / 2)` -- a symmetric floor of the MAGNITUDE. `Math.trunc` of the
    signed offset is that; `Math.round` is not, and is off by one device pixel wherever
    `gap * dpr` is odd, which is every size the label has been shrunk to. So this is checked at a
    height whose `gap` is deliberately not a round number.
  */
  const b = await page.evaluate(() => {
    const f = window.__insetType;
    const bl = window.__insetBaselines;
    const out = {};
    for (const dpr of [1, 2]) {
      // 28.9 gives subtitle 8.0105..., so `gap` is 13.1445... and `gap * dpr` is odd-ish at both.
      for (const h of [200, 28.9]) {
        const ty = f(h, 1);
        const half = Math.floor((ty.gap * dpr) / 2);
        out[`${h}@${dpr}`] = { got: bl(ty, 1, dpr), want: [-half, half] };
      }
      const none = f(200, 0);
      out[`none@${dpr}`] = { got: bl(none, 0, dpr), want: [0] };
    }
    const four = f(200, 4);
    const many = bl(four, four.lines, 2);
    const mids = [];
    for (let i = 0; i + 1 < many.length; i++) mids.push((many[i] + many[i + 1]) / 2);
    return {
      out,
      many,
      lines: four.lines,
      increasing: mids.every((m, i) => i === 0 || m > mids[i - 1]),
      // Centred on the baseline set, to within the truncation of one device pixel.
      centred: Math.abs(many[0] + many[many.length - 1]) <= 1,
    };
  });

  const pairsMatch = Object.entries(b.out).every(
    ([, v]) => JSON.stringify(v.got) === JSON.stringify(v.want),
  );
  t.ok(
    'one subtitle line lands on exactly the two baselines the old code drew',
    pairsMatch,
    JSON.stringify(b.out),
  );
  t.ok(
    'a four-line block stays centred, with plate boundaries that cannot invert',
    b.lines >= 2 && b.increasing && b.centred,
    JSON.stringify({ lines: b.lines, many: b.many, centred: b.centred }),
  );
}

{
  const shared = await page.evaluate(() => {
    const FAMILY = 'ui-sans-serif, system-ui, sans-serif';
    const g = document.createElement('canvas').getContext('2d');
    const one = window.__insetFit;
    const many = window.__insetFitLines;

    // One shared size, chosen by the WIDEST line: lines at different sizes read as ragged.
    const widest = one(g, 'WWWWWWWWWW', 26, 16, 90);
    const pair = many(g, ['A', 'WWWWWWWWWW'], 26, 16, 90);

    // And one line through the many-line fitter is the one-line fitter, across the same sweep
    // the width block above uses -- so `fitInsetLine` really is a wrapper and not a second rule.
    const drift = [];
    for (const text of ['XU0', 'FETCH', 'REGFILE', 'XBN_ARB', 'DISPATCH', 'L2 CACHE']) {
      for (let maxW = 2; maxW <= 200; maxW += 1) {
        const a = one(g, text, 26, 16, maxW);
        const c = many(g, [text], 26, 16, maxW);
        if (a.px !== c.px || a.text !== (c.lines[0] ?? '')) drift.push({ text, maxW, a, c });
      }
    }

    /*
      Cost, not just output. Three lines must cost no more `ctx.font` assignments than one, because
      the whole reason they share a size is that one binary search answers for all of them -- three
      independent searches would have tripled the probe count and made a multi-line subtitle a
      per-frame regression in exactly the zoom band the width cache exists for.
    */
    const count = (fn) => {
      window.__textCache.clear();
      const { font, measureText } = window.__count(['font', 'measureText'], fn).counts;
      return { fonts: font, measures: measureText };
    };
    const cost = {
      // A width the text does not fit at, so the binary search really runs.
      oneLine: count(() => many(g, ['WWWWWWWWWW'], 26, 16, 70)),
      threeLines: count(() => many(g, ['WWWWWWWWWW', 'WWWWWWWWW', 'WWWWWWWW'], 26, 16, 70)),
    };

    return { widest, pair, drift, cost };
  });

  t.ok(
    'every subtitle line shares one size, chosen by fitting the widest',
    shared.pair.px === shared.widest.px,
    JSON.stringify({ pair: shared.pair, widest: shared.widest }),
  );
  t.ok(
    'and one line through the many-line fitter is exactly the one-line fitter',
    shared.drift.length === 0,
    JSON.stringify(shared.drift.slice(0, 2)),
  );
  t.ok(
    'fitting three lines costs no more font changes than fitting one',
    shared.cost.threeLines.fonts === shared.cost.oneLine.fonts,
    JSON.stringify(shared.cost),
  );
  /*
    And the measures grow with the LINES, not with lines times probes. Three lines at five probes
    each would be fifteen; three lines sharing one search is three per probe at worst, and the
    cache collapses the repeats within a search.
  */
  t.ok(
    'and its measurements grow with the lines, not with lines times probes',
    shared.cost.threeLines.measures <= 3 * shared.cost.oneLine.measures,
    JSON.stringify(shared.cost),
  );
}

{
  const split = await page.evaluate(() => {
    const f = window.__subtitleLines;
    return {
      empty: f(''),
      one: f('a'),
      two: f('a\nb'),
      crlf: f('a\r\nb'),
      interior: f('a\n\nb'),
      trailing: f('a\n'),
      leading: f('\na'),
      both: f('\n\na\n\n'),
      cr: f('a\rb'),
    };
  });
  const want = {
    empty: [],
    one: ['a'],
    two: ['a', 'b'],
    crlf: ['a', 'b'],
    // Interior blanks are a layout the user typed, and dropping one would renumber the lines.
    interior: ['a', '', 'b'],
    // A stray Enter at either end is a typo, and must not reserve a line of the block's height.
    trailing: ['a'],
    leading: ['a'],
    both: ['a'],
    // Not a separator: nothing produces classic-Mac endings, and a lone `\r` could be typed.
    cr: ['a\rb'],
  };
  t.ok(
    'a subtitle splits on newlines, trimmed at the ends and preserved in the middle',
    JSON.stringify(split) === JSON.stringify(want),
    JSON.stringify(split),
  );
}

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
    const ty = window.__insetType(boxH / v.dpr, 0);
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

/* ------------------------------------------- several subtitle lines, as pixels ---- */

/*
  Correct arithmetic wired into nothing at all would pass every assertion in the pure block
  above, which is the reason this file has a pixel part -- and the reason multi-line subtitles
  needed one too.

  Three blocks of one height class, differing only in what their subtitle says. `ink` reads the
  lit text pixels inside each, so "the second line is actually drawn" and "the short block still
  draws the first line" are measurements rather than inferences.
*/
{
  const SPECS = [
    // Room for the label and three subtitle lines over.
    { name: 'tall_none', h: 120, subtitle: '' },
    { name: 'tall_one', h: 120, subtitle: 'first line' },
    { name: 'tall_two', h: 120, subtitle: 'first line\nsecond line' },
    // Room for the label and EXACTLY one subtitle line. The regression case.
    { name: 'short_one', h: 31, subtitle: 'first line' },
    { name: 'short_two', h: 31, subtitle: 'first line\nsecond line' },
  ];

  await page.evaluate((specs) => {
    const sc = window.__scene;
    sc.commit('scene', () => {
      sc.shapes = specs.map((sp, i) => ({
        kind: 'rect',
        name: sp.name,
        label: 'BLOCK',
        subtitle: sp.subtitle,
        labelMode: 'inset',
        description: '',
        x: 24 + (i % 3) * 220,
        y: 24 + Math.floor(i / 3) * 170,
        w: 190,
        h: sp.h,
      }));
    });
    sc.setSelection(new Set());
    const v = window.__view;
    v.z = 1;
    v.camX = 0;
    v.camY = 0;
    v.clampCamera();
    window.__session.renderer.requestFrame();
  }, SPECS);
  await page.waitForTimeout(500);

  const px = {};
  for (const sp of SPECS) px[sp.name] = await ink(sp.name);

  t.ok(
    'every block in the multi-line scene is where the check thinks it is',
    SPECS.every((sp) => px[sp.name].onScreen),
    JSON.stringify(px),
  );

  t.ok(
    'a second subtitle line is actually drawn, and inks more of a tall block than one line does',
    px.tall_two.n > px.tall_one.n && px.tall_one.n > px.tall_none.n,
    JSON.stringify({ none: px.tall_none.n, one: px.tall_one.n, two: px.tall_two.n }),
  );

  /*
    THE regression this whole design decision is about.

    Under an all-or-nothing rule, a block with room for exactly one subtitle line would show
    nothing at all the moment a second line was typed -- a feature that blanks text the user
    could already see. Within 12% of the one-line block, not equal to it, because the two draw
    the same two lines at the same sizes and antialiasing over a different string is the only
    difference between them.
  */
  t.ok(
    'a block with room for only one line still draws one, rather than none',
    px.short_two.n > 0 && Math.abs(px.short_two.n - px.short_one.n) < 0.12 * px.short_one.n,
    JSON.stringify({ one: px.short_one.n, two: px.short_two.n }),
  );

  /*
    And the stack stays inside the block. `ink` excludes a 2px border, and `insetType` reserves
    3px of margin each side, so the ink must clear neither -- this is the assertion that would
    catch a generalised budget that spends height it does not have.
  */
  t.ok(
    'and the lines never collide with each other or with the outline',
    px.tall_two.h > px.tall_one.h && px.tall_two.h < 120 - 2 * 3,
    JSON.stringify({ oneH: px.tall_one.h, twoH: px.tall_two.h }),
  );
}

/* ---------------------------------------------- what a frame costs to measure ---- */

/*
  The half of the Safari fix that scales with SHAPE COUNT -- an axis the grid measurement never
  varied, and the one the user's report added (iteration 6).

  `text.ts` had no cache of any kind. `drawInsetLabel` reaches `measureText` through
  `fitFontPx`'s binary search, and that takes its one-probe fast path only while the label fits
  at the ceiling; for typical block widths it stops doing so around z = 0.48, and below about
  0.46 the fit bottoms out and falls through to `fitText`'s own probes. So a box went from about
  one measurement per frame to ten or sixteen, at integer sizes that change every frame during a
  pinch -- two to three hundred shaping calls a frame at twenty boxes.

  Counted the way `grid.mjs` counts `rect`: a counter on the prototype, never a frame time.
*/
{
  const cost = await page.evaluate(() => {
    const count = (fn) => window.__count(['measureText'], fn).counts.measureText;

    const FAMILY = 'ui-sans-serif, system-ui, sans-serif';
    const g = document.createElement('canvas').getContext('2d');
    const fit = window.__insetFit;

    window.__textCache.clear();
    const firstFit = count(() => fit(g, 'REGFILE', 26, 16, 80));
    const repeatFit = count(() => fit(g, 'REGFILE', 26, 16, 80));

    // Two sizes of one string must not collide: the size is inside the cache key. Through the
    // cache, both ways round, so a key that dropped the size would hand back the first width.
    window.__textCache.clear();
    const width = window.__textCache.width;
    const sizes = count(() => {
      width(g, `16px ${FAMILY}`, 'REGFILE');
      width(g, `26px ${FAMILY}`, 'REGFILE');
    });
    const small = width(g, `16px ${FAMILY}`, 'REGFILE');
    const big = width(g, `26px ${FAMILY}`, 'REGFILE');

    // The cap is a leak guard: the key space only grows unboundedly through editing.
    window.__textCache.clear();
    for (let i = 0; i < 5200; i++) fit(g, `name_${i}`, 26, 16, 80);
    const bounded = window.__textCache.size();

    return { firstFit, repeatFit, sizes, small, big, bounded };
  });

  t.ok(
    'measuring one string twice costs one measureText, not two',
    cost.firstFit > 0 && cost.repeatFit === 0,
    JSON.stringify({ first: cost.firstFit, repeat: cost.repeatFit }),
  );
  t.ok(
    'two sizes of one string do not collide',
    cost.sizes === 2 && cost.small > 0 && cost.big > cost.small,
    JSON.stringify({ measured: cost.sizes, small: cost.small, big: cost.big }),
  );
  t.ok('and the cache is bounded', cost.bounded <= 4096, String(cost.bounded));
}

{
  /*
    A whole FRAME of 24 boxes, at a zoom inside the 50-70% band, which is the shape of the user's
    report: >20 shapes, and slow only there.

    The second frame at the same zoom must measure NOTHING. That is the fix, stated as a
    measurement -- before the cache, every box re-ran its binary search on every frame because
    nothing survived between them.
  */
  const frames = await page.evaluate(() => {
    const sc = window.__scene;
    sc.commit('scene', () => {
      sc.shapes = Array.from({ length: 24 }, (_, i) => ({
        kind: 'rect',
        name: `perf_${i}`,
        label: `BLOCK_${i}`,
        subtitle: 'first line\nsecond line',
        labelMode: 'inset',
        description: '',
        x: 40 + (i % 6) * 150,
        y: 40 + Math.floor(i / 6) * 120,
        w: 128,
        h: 96,
      }));
    });
    sc.setSelection(new Set());
    const v = window.__view;
    v.zoomTo(0.61, v.viewportCenter);

    const r = window.__session.renderer;
    const frame = () => window.__count(['measureText'], () => r.draw()).counts.measureText;
    window.__textCache.clear();
    const cold = frame();
    const warm = frame();
    const again = frame();
    // One integer device size away, so a handful of lines re-measure and no more.
    v.zoomTo(0.63, v.viewportCenter);
    const nudged = frame();
    return { cold, warm, again, nudged, boxes: sc.shapes.length };
  });

  t.ok('the perf scene really is 24 boxes', frames.boxes === 24, String(frames.boxes));
  t.ok(
    'a cold frame of 24 two-line boxes measures at most twice per line drawn',
    frames.cold > 0 && frames.cold <= 24 * 3 * 2,
    JSON.stringify(frames),
  );
  t.ok(
    'and a repeat frame at the same zoom measures nothing at all',
    frames.warm === 0 && frames.again === 0,
    JSON.stringify(frames),
  );
  t.ok(
    'a zoom that crosses one device size re-measures per line, not per line per probe',
    frames.nudged <= 24 * 3 * 2,
    JSON.stringify(frames),
  );
}

const code = t.report(errors);
await browser.close();
process.exit(code);
