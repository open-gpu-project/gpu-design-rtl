import { DEV_URL, open, suite } from './harness.mjs';

/**
 * Browser checks for the trace panel.
 *
 * Everything here runs at deviceScaleFactor 2 for the reason the other suites do: the bugs this
 * project actually ships are the ones invisible at dpr 1. The frozen gutter in particular can
 * only be shown to work by reading pixels -- a clipped element still reports its full rect.
 */
const s = suite('trace panel');
const { browser, page, errors } = await open(DEV_URL);

const canvas = page.locator('[data-panel-id="trace"] canvas');
const diagramCanvas = page.locator('[data-panel-id="diagram"] canvas');

const tl = () =>
  page.evaluate(() => {
    const v = window.__timeline;
    return {
      alive: v.ctx !== null,
      w: v.canvas?.width ?? 0,
      h: v.canvas?.height ?? 0,
      want: [Math.round(v.cssW * v.dpr), Math.round(v.cssH * v.dpr)],
      dpr: v.dpr,
      camT: v.camT,
      zT: v.zT,
      scrollY: v.scrollY,
      gutterW: v.gutterW,
      laneX: v.laneX,
      rowCount: v.rowCount,
    };
  });

const tr = () =>
  page.evaluate(() => ({
    cursorTick: window.__trace.cursorTick,
    selectedSignal: window.__trace.selectedSignal,
    rows: window.__trace.rows.length,
    lastTick: window.__trace.doc.lastTick,
    event: window.__trace.selectedEvent
      ? {
          signal: window.__trace.selectedEvent.signal,
          tick: window.__trace.selectedEvent.tick,
          n: window.__trace.selectedEvent.values.length,
        }
      : null,
  }));

/* ------------------------------------------------------------------ 1. it exists ---- */

s.ok('trace panel is in the default layout', (await canvas.count()) === 1);

const h0 = await tl();
s.ok(
  'canvas bitmap matches its box at dpr 2',
  h0.alive && h0.w === h0.want[0] && h0.h === h0.want[1] && h0.w > 0,
  `${h0.w}x${h0.h} want ${h0.want}`,
);
s.ok('dpr is 2', h0.dpr === 2, String(h0.dpr));

const t0 = await tr();
s.ok('fixture loaded with event rows', t0.rows === 9, `rows=${t0.rows}`);
s.ok('document has a length', t0.lastTick === 2400, `lastTick=${t0.lastTick}`);

/** Sample the canvas bitmap; returns "r,g,b" at a CSS-pixel coordinate. */
const pixel = (x, y) =>
  page.evaluate(
    ([x, y]) => {
      const v = window.__timeline;
      const d = v.canvas
        .getContext('2d')
        .getImageData(Math.round(x * v.dpr), Math.round(y * v.dpr), 1, 1).data;
      return `${d[0]},${d[1]},${d[2]}`;
    },
    [x, y],
  );

const distinct = await page.evaluate(() => {
  const v = window.__timeline;
  const d = v.canvas
    .getContext('2d')
    .getImageData(0, 0, v.canvas.width, Math.min(v.canvas.height, 400)).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return seen.size;
});
s.ok('canvas is actually painted', distinct > 3, `${distinct} distinct samples`);

/* ------------------------------------------------- 2. the frozen gutter is opaque ---- */

// Scroll the rows, then prove that nothing from the lane has bled under the gutter. A geometry
// assertion cannot show this: a clipped element still reports its full bounding box.
const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
await page.mouse.wheel(0, 240);
await page.waitForTimeout(250);
const scrolled = await tl();
s.ok(
  'vertical wheel scrolls rows rather than zooming',
  scrolled.scrollY > 0 && Math.abs(scrolled.zT - h0.zT) < 1e-9,
  `scrollY=${scrolled.scrollY} zT=${scrolled.zT}`,
);

// Pan so that early ticks map to x < gutterW. An unclipped renderer would draw their stems and
// flags straight into the name column; a clipped one shows nothing but gutter fill and text.
// Asserting an exact colour would be wrong -- the row stripe legitimately tints it -- so this
// looks for the one thing that could only have come from the lane: the accent blue.
await page.evaluate(() => {
  window.__timeline.camT = 400;
  window.__timeline.clampCamera();
});
await page.waitForTimeout(250);

const bleed = await page.evaluate(() => {
  const v = window.__timeline;
  const g = Math.round((v.gutterW - 4) * v.dpr);
  const d = v.canvas.getContext('2d').getImageData(0, 0, g, v.canvas.height).data;
  let bluish = 0;
  for (let i = 0; i < d.length; i += 4) {
    // #60a5fa stems and flag bodies: strongly blue-dominant. Gutter text is neutral grey.
    if (d[i + 2] > 140 && d[i + 2] - d[i] > 60) bluish++;
  }
  return { bluish, px: d.length / 4 };
});
s.ok(
  'no lane content bleeds under the frozen gutter',
  bleed.bluish === 0,
  `${bleed.bluish} blue px of ${bleed.px}`,
);

const gutterTop = await pixel(scrolled.gutterW - 6, 4);
s.ok('gutter header corner is painted', gutterTop === '22,26,34', gutterTop);

// And the lane itself does have that content, so the check above is not vacuous.
const laneHas = await page.evaluate(() => {
  const v = window.__timeline;
  const g = Math.round(v.gutterW * v.dpr);
  const d = v.canvas.getContext('2d').getImageData(g, 0, v.canvas.width - g, v.canvas.height).data;
  let bluish = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 2] > 140 && d[i + 2] - d[i] > 60) bluish++;
  }
  return bluish;
});
s.ok('the lane does draw flags (the bleed check is not vacuous)', laneHas > 100, String(laneHas));

/* ----------------------------------------------------------- 3. the tick ladder ---- */

const tiers = await page.evaluate(() => {
  const f = window.__tickTiers;
  return {
    wide: f(0.01),
    mid: f(0.35),
    close: f(8),
    veryClose: f(60),
    degenerate: f(0),
  };
});
s.ok(
  'tiers coarsen as the zoom widens',
  tiers.wide.major > tiers.mid.major && tiers.mid.major > tiers.close.major,
  `${tiers.wide.major} > ${tiers.mid.major} > ${tiers.close.major}`,
);
s.ok(
  'minor tier never subdivides below one tick',
  [tiers.wide, tiers.mid, tiers.close, tiers.veryClose, tiers.degenerate].every(
    (t) => t.minor >= 1,
  ),
  JSON.stringify(tiers),
);
s.ok(
  'medium and minor divide major exactly',
  [tiers.wide, tiers.mid, tiers.close].every(
    (t) => t.major % t.medium === 0 && t.major % t.minor === 0,
  ),
  JSON.stringify(tiers),
);
s.ok(
  'tiers are integers',
  [tiers.wide, tiers.mid, tiers.close].every(
    (t) => Number.isInteger(t.minor) && Number.isInteger(t.medium) && Number.isInteger(t.major),
  ),
  JSON.stringify(tiers),
);

/* ------------------------------------------------------------ 4. ctrl+wheel zooms ---- */

const beforeZoom = await tl();
await page.keyboard.down('Control');
await page.mouse.wheel(0, -240);
await page.keyboard.up('Control');
await page.waitForTimeout(250);
const afterZoom = await tl();
s.ok(
  'ctrl+wheel zooms the time axis',
  afterZoom.zT > beforeZoom.zT,
  `${beforeZoom.zT} -> ${afterZoom.zT}`,
);

const beforePan = await tl();
await page.keyboard.down('Shift');
await page.mouse.wheel(0, 200);
await page.keyboard.up('Shift');
await page.waitForTimeout(250);
const afterPan = await tl();
s.ok(
  'shift+wheel pans time',
  Math.abs(afterPan.camT - beforePan.camT) > 1e-6 && Math.abs(afterPan.zT - beforePan.zT) < 1e-9,
  `camT ${beforePan.camT} -> ${afterPan.camT}`,
);

await page.evaluate(() => {
  window.__timeline.zoomToFit();
  window.__timeline.scrollY = 0;
});
await page.waitForTimeout(200);

/* --------------------------------------------------------- 5. the cursor snaps ---- */

const b2 = await canvas.boundingBox();
await page.mouse.click(b2.x + b2.width * 0.55, b2.y + 10);
await page.waitForTimeout(200);
const afterScrub = await tr();
s.ok(
  'clicking the timescale moves the cursor',
  afterScrub.cursorTick > 0,
  String(afterScrub.cursorTick),
);
s.ok(
  'cursor snaps to an integer tick',
  Number.isInteger(afterScrub.cursorTick),
  String(afterScrub.cursorTick),
);

// Drag the handle.
await page.mouse.move(b2.x + b2.width * 0.55, b2.y + 10);
await page.mouse.down();
await page.mouse.move(b2.x + b2.width * 0.75, b2.y + 10, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(250);
const afterDrag = await tr();
s.ok(
  'dragging the handle moves the cursor',
  afterDrag.cursorTick > afterScrub.cursorTick,
  `${afterScrub.cursorTick} -> ${afterDrag.cursorTick}`,
);
s.ok(
  'dragged cursor is still an integer',
  Number.isInteger(afterDrag.cursorTick),
  String(afterDrag.cursorTick),
);

/* ---------------------------------------------------- 6. selecting rows and flags ---- */

// Click a row in the gutter.
await page.mouse.click(b2.x + 60, b2.y + 24 + 15);
await page.waitForTimeout(250);
const rowSel = await tr();
s.ok(
  'clicking the gutter selects that row',
  rowSel.selectedSignal === 0,
  String(rowSel.selectedSignal),
);

// Walk to the row's first event with Home, then step forward.
await page.keyboard.press('Home');
await page.waitForTimeout(200);
const atFirst = await tr();
s.ok(
  'Home jumps to the row’s first event',
  atFirst.event !== null && atFirst.event.signal === 0,
  JSON.stringify(atFirst.event),
);
s.ok(
  'an event under the cursor selects itself',
  atFirst.event !== null,
  JSON.stringify(atFirst.event),
);

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const stepped = await tr();
s.ok(
  'ArrowRight walks to the next event on that row',
  stepped.event !== null && stepped.cursorTick > atFirst.cursorTick,
  `${atFirst.cursorTick} -> ${stepped.cursorTick}`,
);

await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
const back = await tr();
s.ok('ArrowLeft walks back', back.cursorTick === atFirst.cursorTick, `${back.cursorTick}`);

await page.keyboard.press('End');
await page.waitForTimeout(200);
const atLast = await tr();
s.ok(
  'End jumps to the last event',
  atLast.cursorTick > stepped.cursorTick,
  String(atLast.cursorTick),
);

const everyTickIsAnEvent = await page.evaluate(() => {
  const t = window.__trace;
  const track = t.doc.tracks[t.selectedSignal];
  return Array.from(track.ticks).includes(t.cursorTick);
});
s.ok('navigation only ever lands on real events', everyTickIsAnEvent);

/* ------------------------------------------- 6b. clicking a flag, with the mouse ---- */

// The paths above drive the store directly. This one goes through hit testing, so it is what
// actually proves the clickable box lines up with the drawn one.
await page.evaluate(() => {
  window.__session.selectSignal(null);
  window.__trace.setCursor(0);
  const v = window.__timeline;
  v.scrollY = 0;
  v.zT = 14;
  v.camT = 630;
  v.clampCamera();
});
await page.waitForTimeout(250);

const flagPos = await page.evaluate(() => {
  const v = window.__timeline;
  // Row 1 is top.xu_0.primary_bus; tick 640 is the forced three-record collision.
  return { x: v.toX(640) + 8, y: v.rowY(1) + 7, stemX: v.toX(640) };
});
const b3 = await canvas.boundingBox();
await page.mouse.click(b3.x + flagPos.x, b3.y + flagPos.y);
await page.waitForTimeout(300);
const clicked = await tr();
s.ok(
  'clicking a flag body selects its row',
  clicked.selectedSignal === 1,
  String(clicked.selectedSignal),
);
s.ok(
  'clicking a flag moves the cursor onto it',
  clicked.cursorTick === 640,
  String(clicked.cursorTick),
);
s.ok(
  'clicking a merged flag selects all of its records',
  clicked.event !== null && clicked.event.n === 3,
  JSON.stringify(clicked.event),
);

// The stem is clickable too, in the lower half of the row where there is no body.
await page.evaluate(() => {
  window.__session.selectSignal(null);
  window.__trace.setCursor(0);
});
await page.waitForTimeout(200);
await page.mouse.click(b3.x + flagPos.stemX, b3.y + flagPos.y + 16);
await page.waitForTimeout(300);
const stemClicked = await tr();
s.ok(
  'clicking a stem selects the same flag',
  stemClicked.selectedSignal === 1 && stemClicked.cursorTick === 640,
  JSON.stringify(stemClicked),
);

// Clicking empty lane space clears the row selection.
await page.mouse.click(b3.x + b3.width - 30, b3.y + 24 + 4 * 30 + 24);
await page.waitForTimeout(250);

/* ------------------------------------------------- 7. merged flags and properties ---- */

await page.evaluate(() => {
  window.__session.selectSignal(1);
  window.__trace.setCursor(640);
  window.__timeline.revealTick(640);
});
await page.waitForTimeout(400);
const merged = await tr();
s.ok(
  'same-tick records merge into one selection',
  merged.event !== null && merged.event.n === 3,
  JSON.stringify(merged.event),
);

const propsDoc = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-panel-id="properties"] [data-path]')];
  return rows.map((r) => decodeURIComponent(r.getAttribute('data-path'))).slice(0, 12);
});
s.ok(
  'a merged flag shows an array in the property panel',
  propsDoc.some((p) => /^\/\d+$/.test(p) || /^\/\d+\//.test(p)),
  JSON.stringify(propsDoc),
);

const banner = await page
  .locator('[data-panel-id="properties"] .banner')
  .first()
  .innerText()
  .catch(() => '');
s.ok(
  'the property banner names the signal and tick',
  banner.includes('top.xu_0.primary_bus') && banner.includes('640') && banner.includes('read-only'),
  JSON.stringify(banner),
);

// A single event.
await page.evaluate(() => {
  window.__session.selectSignal(0);
  window.__trace.setCursor(0);
  window.__trace.nextEvent();
});
await page.waitForTimeout(400);
const singleKeys = await page.evaluate(() =>
  [...document.querySelectorAll('[data-panel-id="properties"] [data-path]')].map((r) =>
    decodeURIComponent(r.getAttribute('data-path')),
  ),
);
s.ok(
  'a single event shows its fields by name',
  ['/warp', '/pc', '/mnemonic'].every((k) => singleKeys.includes(k)),
  JSON.stringify(singleKeys),
);

const enumShown = await page.evaluate(() => {
  window.__session.selectSignal(1);
  window.__trace.setCursor(640);
  return null;
});
void enumShown;
await page.waitForTimeout(350);
const opcodeText = await page.evaluate(() => {
  const row = document.querySelector('[data-panel-id="properties"] [data-path="%2F0%2Fopcode"]');
  return row ? row.textContent : '';
});
s.ok(
  'enum fields are decoded to their names',
  /send|recv|bcast|nop|halt/.test(opcodeText),
  JSON.stringify(opcodeText),
);

/* ----------------------------------------------------- 8. the editable tick field ---- */

const field = page.locator('[data-testid="cursor-tick"]');
await field.click();
await page.keyboard.press('Meta+A');
await page.keyboard.type('1234');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const typed = await tr();
s.ok(
  'editing the tick field moves the cursor',
  typed.cursorTick === 1234,
  String(typed.cursorTick),
);

await page.evaluate(() => window.__trace.setCursor(77));
await page.waitForTimeout(250);
s.ok('the field follows the cursor', (await field.inputValue()) === '77', await field.inputValue());

await field.click();
await page.keyboard.press('Meta+A');
await page.keyboard.type('999999');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const clamped = await tr();
s.ok(
  'the field clamps to the document',
  clamped.cursorTick === clamped.lastTick,
  String(clamped.cursorTick),
);

/* ------------------------------------------------------- 9. selection is global ---- */

await page.evaluate(() => window.__session.selectSignal(2));
await page.waitForTimeout(200);

// Hand the keyboard to the diagram first. `ToolHost.acceptsKeys` gates on the panel that owns
// it, so without this the tool shortcut below is swallowed and the drag just pans -- which is
// exactly how this check failed the first time it was run.
const dbox = await diagramCanvas.boundingBox();
await page.mouse.click(dbox.x + 400, dbox.y + 300);
await page.waitForTimeout(150);

// Draw a block on the diagram, which selects it.
await page.mouse.move(dbox.x + 80, dbox.y + 80);
await page.keyboard.press('Digit3');
await page.mouse.move(dbox.x + 80, dbox.y + 80);
await page.mouse.down();
await page.mouse.move(dbox.x + 220, dbox.y + 180, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);

const afterDraw = await page.evaluate(() => ({
  shapes: window.__scene.shapes.length,
  sceneSel: window.__scene.selection.size,
  traceSel: window.__trace.selectedSignal,
}));
s.ok(
  'selecting a block clears the trace selection',
  afterDraw.shapes === 1 && afterDraw.sceneSel === 1 && afterDraw.traceSel === null,
  JSON.stringify(afterDraw),
);

await page.evaluate(() => window.__session.selectSignal(3));
await page.waitForTimeout(200);
const afterTrace = await page.evaluate(() => ({
  sceneSel: window.__scene.selection.size,
  traceSel: window.__trace.selectedSignal,
}));
s.ok(
  'selecting a trace clears the block selection',
  afterTrace.sceneSel === 0 && afterTrace.traceSel === 3,
  JSON.stringify(afterTrace),
);

// Redo restores a non-empty shape selection, which must also clear the trace one. This is the
// path a per-call-site fix would have missed: undo and redo assign `selection` directly and
// never go through a tool.
await page.evaluate(() => {
  window.__scene.undo();
});
await page.waitForTimeout(200);
await page.evaluate(() => window.__session.selectSignal(4));
await page.waitForTimeout(200);
const beforeRedo = await page.evaluate(() => ({
  sceneSel: window.__scene.selection.size,
  traceSel: window.__trace.selectedSignal,
}));
s.ok(
  'setup: trace selected, no blocks selected',
  beforeRedo.sceneSel === 0 && beforeRedo.traceSel === 4,
  JSON.stringify(beforeRedo),
);

await page.evaluate(() => {
  window.__scene.redo();
});
await page.waitForTimeout(250);
const afterRedo = await page.evaluate(() => ({
  sceneSel: window.__scene.selection.size,
  traceSel: window.__trace.selectedSignal,
}));
s.ok(
  'redo restoring a block selection clears the trace one',
  afterRedo.sceneSel === 1 && afterRedo.traceSel === null,
  JSON.stringify(afterRedo),
);

/* ------------------------------------------------------------ 10. keyboard scope ---- */

await page.locator('[data-panel-id="diagram"] canvas').click({ position: { x: 400, y: 300 } });
await page.waitForTimeout(150);
const beforeArrow = await tr();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const afterArrow = await tr();
s.ok(
  'arrow keys do nothing while the diagram owns the keyboard',
  afterArrow.cursorTick === beforeArrow.cursorTick,
  `${beforeArrow.cursorTick} -> ${afterArrow.cursorTick}`,
);

/* ------------------------------------------------ 10. the cursor flag (iteration 5) ---- */

/*
  The cursor used to be an arrow on the timescale baseline with a detached readout beside it;
  it is now a flag on the stem, in the same two parts as an event's.

  That makes the body a real affordance, so it has to be a real grab target -- and grabbing it
  must NOT move the cursor, which is the whole reason the drag carries a `grabDx`. Picking a
  press point forty pixels from the stem is deliberate: at anything inside CURSOR_HIT_PX the
  old stem-only hit test would pass this too.
*/
const cBox = await canvas.boundingBox();

// Fit first. Earlier groups leave the time axis wherever their last zoom put it, and at that
// zoom tick 600 sits 24 000 px off the left edge -- a press aimed at its flag lands outside the
// canvas and moves nothing, which reads as "the flag is not grabbable".
await page.evaluate(() => window.__timeline.zoomToFit());
await page.waitForTimeout(300);

const flagGeom = await page.evaluate(async () => {
  const mod = await import('/src/lib/timeline/layout.ts');
  const v = window.__timeline;
  window.__trace.setCursor(600);
  const box = mod.cursorFlagBox(v, 600, mod.cursorMeasurer(v.ctx));
  return { box, stemX: v.toX(600), cssW: v.cssW };
});
s.ok(
  'the flag hangs off the stem, inside the timescale strip',
  flagGeom.box.x === flagGeom.stemX && flagGeom.box.w > 20 && flagGeom.box.y + flagGeom.box.h <= 24,
  JSON.stringify(flagGeom.box),
);
s.ok('and it reads the tick it marks', flagGeom.box.label === '600', String(flagGeom.box.label));

await page.waitForTimeout(250);
const pressX = flagGeom.stemX + Math.min(40, flagGeom.box.w - 6);
await page.mouse.move(cBox.x + pressX, cBox.y + 10);
await page.mouse.down();
await page.waitForTimeout(150);
const onPress = (await tr()).cursorTick;
await page.mouse.move(cBox.x + pressX + 60, cBox.y + 10, { steps: 6 });
await page.waitForTimeout(150);
const onDrag = (await tr()).cursorTick;
await page.mouse.up();
await page.waitForTimeout(150);

s.ok(
  'pressing the flag body grabs the cursor without moving it',
  onPress === 600,
  `600 -> ${onPress} after a press ${Math.round(pressX - flagGeom.stemX)}px from the stem`,
);
s.ok(
  'and dragging it then moves the cursor, by the drag and not to the pointer',
  onDrag > onPress,
  `${onPress} -> ${onDrag}`,
);

/*
  At the right-hand edge the body would run off the lane, so it flies the other way -- the rule
  the detached readout already had, kept because a cursor whose tick vanishes at the end of the
  trace is exactly where you most want to read it.
*/
const flip = await page.evaluate(async () => {
  const mod = await import('/src/lib/timeline/layout.ts');
  const v = window.__timeline;
  const measure = mod.cursorMeasurer(v.ctx);
  const midTick = Math.round(v.toTick(v.laneX + (v.cssW - v.laneX) / 2));
  // Floor, so the stem lands at or left of the probe point. Rounding up can put the stem itself
  // past the right edge, where the renderer skips the cursor entirely and there is no flag to
  // make a claim about.
  const edgeTick = Math.floor(v.toTick(v.cssW - 4));
  const mid = mod.cursorFlagBox(v, midTick, measure);
  const edge = mod.cursorFlagBox(v, edgeTick, measure);
  return {
    midFliesRight: mid.x >= v.toX(midTick) - 0.01,
    edgeFliesLeft: edge.x + edge.w <= v.toX(edgeTick) + 0.01,
    edgeFits: edge.x + edge.w <= v.cssW,
  };
});
s.ok(
  'the flag flies right normally and flips left at the edge, staying on screen',
  flip.midFliesRight && flip.edgeFliesLeft && flip.edgeFits,
  JSON.stringify(flip),
);

/*
  ITERATION 5.3 -- this panel's controls are on the same tooltip as the diagram's.

  The trace panel has its own control strip, built from the same icon-button pattern and, until
  this iteration, the same native `title`. It is checked here rather than in `input.mjs` for the
  usual reason -- that file is scoped to the diagram pane -- but it is the SAME layer, mounted
  once at the app root, and that is what these two assertions are for. Two layers would be two
  tooltips the moment the pointer crossed panels.
*/
{
  const btn = page.locator('[data-panel-id="trace"] button[aria-label="Next event"]').first();
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(700);
  const tip = await page.evaluate(() => {
    const all = document.querySelectorAll('[data-testid="chrome-tooltip"]');
    return { n: all.length, text: all[0]?.textContent.trim() ?? null };
  });
  s.ok(
    "a trace control raises the app's tooltip, not one of its own",
    tip.n === 1 && tip.text === 'Next event on the selected trace (→)',
    JSON.stringify(tip),
  );
  // As in the diagram pane: a leftover `title` would stack a second, untestable tooltip on top.
  s.ok(
    'and no trace control carries a native title any more',
    (await page.evaluate(
      () => document.querySelectorAll('[data-panel-id="trace"] [title]').length,
    )) === 0,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 5 });
  await page.waitForTimeout(200);
}

const code = s.report(errors.filter((e) => !e.includes("reading 'id'")));
await browser.close();
process.exit(code);
