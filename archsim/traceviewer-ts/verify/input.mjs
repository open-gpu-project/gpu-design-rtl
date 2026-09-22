import { DEV_URL, diagramCanvas, drawBlock, emptySpot, open, suite } from './harness.mjs';

/*
  Input-path checks for iteration 3.2.

  Report 2 established that the canvas is BLOCKED, not busy: 6 280ms of a 20s recording sits in
  `Composite` while script, layout, style and paint together are 140ms, and the main thread idles
  at 3-13%. So none of these three defects was ever about CPU. They are about how often the
  document gets dirtied, because the DOM's layer rasterization is queued into the same GPU process
  the canvas is waiting on -- 20.3Mdev-px of it per frame, for 3.78Mdev-px of actual change.

  Kept separate from `grid.mjs` deliberately. That file is a pure-function suite with no
  compositor, no mouse and no timing in it; this one drives a real pointer and has to wait on
  frames, so mixing them would make the fast deterministic checks pay for the slow ones.
*/

const t = suite('input');
const { browser, page, errors } = await open(DEV_URL);

/*
  STEP 4 -- Safari's pinch goes through the rAF accumulator.

  `onGestureChange` used to call `zoomAt` and `onApplied()` synchronously, per event. Safari is
  the only engine that fires these at all, and `#suppressPinchUntil` routes it away from the
  coalesced ctrl+wheel path, so it was the only engine taking the uncoalesced one.

  The decisive assertion is `midZooms`: how many camera updates happened DURING the event burst,
  before any animation frame ran. It was one per event; it must now be zero. The zoom arithmetic
  is checked alongside it because folding a multiplicative factor into an additive accumulator via
  `-log` is the kind of change that can coalesce correctly and still zoom to the wrong place.

  `gesturechange` is synthesized with only a `scale`: `#gestureScreen` falls back to the viewport
  centre when an event carries no `clientX`, which makes the anchor deterministic.
*/
const gesture = await page.evaluate(async () => {
  const r = window.__session.renderer;
  const v = window.__view;
  const canvas = v.canvas;

  let draws = 0;
  let zooms = 0;
  const origDraw = r.draw.bind(r);
  const origZoom = v.zoomAt.bind(v);
  // Own properties shadowing the prototype methods, so `delete` restores them cleanly.
  r.draw = () => {
    draws++;
    origDraw();
  };
  v.zoomAt = (a, f) => {
    zooms++;
    origZoom(a, f);
  };

  const fire = (type, scale) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperty(e, 'scale', { value: scale });
    canvas.dispatchEvent(e);
  };

  try {
    const z0 = v.z;
    fire('gesturestart', 1);
    // A real pinch reports `scale` cumulatively from gesture start, so the per-event factor is
    // the ratio of consecutive scales and the net factor over the burst is the last scale: 1.20.
    for (let i = 1; i <= 20; i++) fire('gesturechange', 1 + i * 0.01);
    const midZooms = zooms;
    const midDraws = draws;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    fire('gestureend', 1);
    return { midZooms, midDraws, zooms, draws, z0, z1: v.z, want: z0 * 1.2 };
  } finally {
    delete r.draw;
    delete v.zoomAt;
  }
});

t.ok(
  '20 gesturechange events apply no camera update synchronously',
  gesture.midZooms === 0,
  `zoomAt calls during the burst: ${gesture.midZooms}, draws: ${gesture.midDraws}`,
);
t.ok(
  '20 gesturechange events coalesce into exactly one camera update',
  gesture.zooms === 1,
  `zoomAt calls: ${gesture.zooms}`,
);
t.ok(
  '20 gesturechange events coalesce into at most one draw',
  gesture.draws <= 1,
  `draws: ${gesture.draws}`,
);
t.ok(
  'the accumulated pinch lands on the product of its factors',
  Math.abs(gesture.z1 - gesture.want) < 1e-9,
  `z ${gesture.z0} -> ${gesture.z1}, wanted ${gesture.want}`,
);

/*
  STEP 5a -- the pointer readout is sampled at snap granularity.

  `ToolHost.pointer` is `$state.raw`, which compares by identity, and it was assigned a fresh
  object on every `pointermove` -- so the status bar re-rendered 60 times a second and report 1
  measured 48 full-document layouts per 60 moves over the canvas against 0 for 60 moves outside
  it. The readout only shows the SNAPPED point, which changes once per GRID world pixels.

  Counted by identity rather than by layouts: 64 CSS px at z = 1 crosses four 16px snap cells, so
  a correct implementation writes about five times in 32 moves and the old one wrote 32 times.
*/
const box = await diagramCanvas(page).boundingBox();
await page.mouse.move(box.x + 180, box.y + 180);
await page.waitForTimeout(150);
await page.evaluate(() => {
  window.__pSeen = [];
  window.__pLast = null;
});
for (let i = 0; i < 32; i++) {
  await page.mouse.move(box.x + 180 + i * 2, box.y + 180);
  await page.evaluate(() => {
    const p = window.__host.pointer;
    if (p !== window.__pLast) {
      window.__pLast = p;
      window.__pSeen.push(p === null ? null : [p.x, p.y]);
    }
  });
}
const seen = await page.evaluate(() => window.__pSeen);
const shape = await page.evaluate(() =>
  window.__host.pointer === null ? null : Object.keys(window.__host.pointer).sort(),
);

t.ok(
  '32 pointer moves across 4 snap cells write the readout far fewer than 32 times',
  seen.length > 0 && seen.length <= 8,
  `${seen.length} writes for 32 moves: ${JSON.stringify(seen)}`,
);
t.ok(
  'every recorded write is a distinct snapped point',
  new Set(seen.map((s) => String(s))).size === seen.length,
  JSON.stringify(seen),
);
t.ok(
  'the field narrowed to the snapped point: no stale `world` left behind',
  shape !== null && shape.join(',') === 'x,y',
  `keys: ${JSON.stringify(shape)}`,
);

/*
  STEP 5b -- a re-run with nothing selected is a no-op.

  `push(doc, reset)` skips its text-equality guard whenever `reset` is true, and the no-sole-
  selection branch passed `reset: true` unconditionally -- so every re-run with nothing selected
  dropped the caret and called `editor.set({ json: {} })`, reminting the whole tree for `{} -> {}`
  at +12/-15 top-level mutations a time. The effect re-runs on `gestureVersion`, which every
  pointer-up bumps, so a second click on empty space is enough to trigger it.

  Both halves matter: the first deselect must still rebuild (it is a real transition), and only
  the repeat must be silent. An implementation that simply stopped resetting would pass the second
  assertion and fail the first.
*/
await drawBlock(page, 140, 130, 280, 230);
// Back to the select tool: `drawBlock` leaves the rectangle tool active, and a bare click with
// that tool draws nothing AND deselects nothing, so the deselect below would never happen.
await page.keyboard.press('Digit1');
await page.waitForTimeout(150);
const spot = emptySpot(box);
await page.evaluate(() => {
  window.__mut = 0;
  const el = document.querySelector('[data-panel-id="properties"]');
  window.__mo = new MutationObserver((recs) => {
    window.__mut += recs.length;
  });
  window.__mo.observe(el, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
});

await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(600);
const firstDeselect = await page.evaluate(() => {
  const n = window.__mut;
  window.__mut = 0;
  return { n, sel: window.__scene.selection.size };
});

await page.mouse.click(spot.x + 8, spot.y + 8);
await page.waitForTimeout(600);
const repeat = await page.evaluate(() => ({
  n: window.__mut,
  sel: window.__scene.selection.size,
  gv: window.__host.gestureVersion,
}));

t.ok(
  'the first deselect does rebuild the panel',
  firstDeselect.sel === 0 && firstDeselect.n > 0,
  JSON.stringify(firstDeselect),
);
t.ok(
  'a second click on empty space remints nothing',
  repeat.sel === 0 && repeat.n === 0,
  JSON.stringify(repeat),
);

await page.evaluate(() => window.__mo.disconnect());

const code = t.report(errors);
await browser.close();
process.exit(code);
