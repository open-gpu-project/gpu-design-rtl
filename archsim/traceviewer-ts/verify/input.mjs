import {
  button,
  DEV_URL,
  diagramCanvas,
  drawBlock,
  emptySpot,
  installProbes,
  open,
  row,
  suite,
  traceCanvas,
} from './harness.mjs';

/*
  Input-path checks.

  The Safari measurement (iteration 3) established that the canvas is BLOCKED, not busy: 6 280ms of
  a 20s recording sits in `Composite` while script, layout, style and paint together are 140ms, and
  the main thread idles at 3-13%. So none of these defects was ever about CPU. They are about how
  often the document gets dirtied, because the DOM's layer rasterization is queued into the same GPU
  process the canvas is waiting on -- 20.3Mdev-px of it per frame, for 3.78Mdev-px of actual change.

  Kept separate from `grid.mjs` deliberately. That file is a pure-function suite with no
  compositor, no mouse and no timing in it; this one drives a real pointer and has to wait on
  frames, so mixing them would make the fast deterministic checks pay for the slow ones.
*/

const t = suite('input');
const { browser, page, errors } = await open(DEV_URL);
await installProbes(page);

/*
  Safari's pinch goes through the rAF accumulator.

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
  The pointer readout is sampled at snap granularity.

  `ToolHost.pointer` is `$state.raw`, which compares by identity, and it was assigned a fresh
  object on every `pointermove` -- so the status bar re-rendered 60 times a second, and the
  measurement found 48 full-document layouts per 60 moves over the canvas against 0 for 60 moves
  outside it. The readout only shows the SNAPPED point, which changes once per GRID world pixels.

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
  A re-run with nothing selected is a no-op.

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
await page.evaluate(() =>
  window.__watch('[data-panel-id="properties"]', {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  }),
);

await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(600);
const firstDeselect = await page.evaluate(() => ({
  n: window.__mutations(true),
  sel: window.__scene.selection.size,
}));

await page.mouse.click(spot.x + 8, spot.y + 8);
await page.waitForTimeout(600);
const repeat = await page.evaluate(() => ({
  n: window.__mutations(),
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

await page.evaluate(() => window.__unwatch());

/*
  The hover tooltip and the label tab's hit box (iteration 5).

  Both belong here rather than in `properties.mjs`: they are pointer behaviour, and the tooltip
  in particular has a performance contract as strict as anything else in this file. It must not
  write a signal per pointermove -- the whole reason it is on a dwell timer and not on the move
  itself -- so the mutation counter is the assertion that matters most, and it is the one that
  fails if someone "simplifies" the timer away into a hit test per move.
*/
const tipBox = await diagramCanvas(page).boundingBox();
await page.evaluate(() => {
  const sc = window.__scene;
  const mk = (name, labelMode, x) => ({
    kind: 'rect',
    name,
    label: name.toUpperCase(),
    subtitle: 'the second line\nand a third',
    labelMode,
    description: 'What this block is for.',
    x,
    y: 64,
    w: 160,
    h: 96,
  });
  sc.commit('scene', () => {
    sc.shapes = [mk('inset_one', 'inset', 32), mk('tabbed_one', 'tabbed_left', 256)];
  });
  sc.setSelection(new Set());
  window.__view.resetZoom();
});
await page.waitForTimeout(500);

/** Screen point for a world point, in page coordinates. */
const atWorld = async (wx, wy) => {
  const p = await page.evaluate(
    ({ wx, wy }) => {
      const v = window.__view;
      return { x: (wx - v.camX) * v.z, y: (wy - v.camY) * v.z };
    },
    { wx, wy },
  );
  return { x: tipBox.x + p.x, y: tipBox.y + p.y };
};

const tipText = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="canvas-tooltip"]');
    return el === null ? null : el.innerText.replace(/\s+/g, ' ').trim();
  });

/** The tooltip's lines as separate paragraphs, which `tipText` flattens away. */
const tipLines = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="canvas-tooltip"] .line')].map(
      (el) => el.textContent,
    ),
  );

const insetCentre = await atWorld(112, 112);
await page.mouse.move(insetCentre.x - 40, insetCentre.y - 30);
await page.mouse.move(insetCentre.x, insetCentre.y);
await page.waitForTimeout(200);
const early = await tipText();
await page.waitForTimeout(600);
const shown = await tipText();

t.ok('nothing appears while the dwell is still running', early === null, String(early));
t.ok(
  'holding still over a block raises its description',
  shown !== null && shown.includes('What this block is for.'),
  String(shown),
);
t.ok(
  'and an inset block does not repeat the subtitle already drawn on it',
  shown !== null && !shown.includes('the second line'),
  String(shown),
);

/*
  The counter is reinstalled for this measurement, and scoped to the diagram pane rather than to
  `document.body`.

  Not to be lenient -- the opposite. Over the whole body this reads 2 rather than 0, and both
  are the status bar's coordinate readout creating its text node on the way in, which is the
  pointer readout's business and not this one's. Scoping it to the pane the tooltip actually
  lives in turns "about 2, which is small" into an exact zero, and an exact zero is an assertion
  that cannot quietly absorb a regression.
*/
const settle = await atWorld(48, 176);
await page.mouse.move(settle.x, settle.y);
await page.waitForTimeout(250);
await page.evaluate(() =>
  window.__watch('[data-panel-id="diagram"]', { subtree: true, childList: true, attributes: true }),
);
// Started from where the pointer already is, so the teardown of the previous tooltip -- which
// is a mutation, and a wanted one -- lands before the counter rather than inside it.
const sweepTo = await atWorld(600, 176);
await page.mouse.move(sweepTo.x, sweepTo.y, { steps: 40 });
await page.waitForTimeout(120);
const sweepMut = await page.evaluate(() => window.__unwatch());
t.ok(
  'sweeping the pointer across the canvas mutates the pane not at all: the dwell is the cost',
  sweepMut === 0,
  `${sweepMut} mutations over 40 moves`,
);
t.ok('and the tooltip is gone once the pointer has left the block', (await tipText()) === null);

const tabbedCentre = await atWorld(336, 112);
await page.mouse.move(tabbedCentre.x - 30, tabbedCentre.y - 20);
await page.mouse.move(tabbedCentre.x, tabbedCentre.y);
await page.waitForTimeout(800);
const tabbedTip = await tipText();
t.ok(
  'a tabbed block puts the subtitle in the tooltip, where it is the only place it appears',
  tabbedTip !== null &&
    tabbedTip.includes('the second line') &&
    tabbedTip.indexOf('the second line') < tabbedTip.indexOf('What this block is for.'),
  String(tabbedTip),
);
/*
  A subtitle may hold several lines, and `ShapeTooltip.lines` is rendered as
  `<p>` elements -- so a newline left inside one would collapse to a space in HTML and the two
  lines would run together. Split at the source instead, one paragraph per line.
*/
{
  const lines = await tipLines();
  t.ok(
    'and a two-line subtitle becomes two paragraphs rather than one run',
    JSON.stringify(lines) ===
      JSON.stringify(['the second line', 'and a third', 'What this block is for.']),
    JSON.stringify(lines),
  );
  t.ok(
    'with no newline left inside any of them',
    lines.every((l) => !l.includes('\n')),
    JSON.stringify(lines),
  );

  /*
    Two IDENTICAL lines, which is the `{#each}` key.

    `CanvasTooltip` used to key on the line's own text, and a subtitle split on newlines makes a
    duplicate trivially reachable -- `"AW\nAW"` names the same channel on both ends of a bus,
    which is a thing a person would write. Svelte throws on a duplicate key, so this asserts on
    the page-error list rather than on the DOM: the paragraphs appearing at all is the evidence.
  */
  const before = errors.length;
  await page.evaluate(() => {
    const sc = window.__scene;
    const s = sc.shapes.find((x) => x.name === 'tabbed_one');
    sc.replaceShape(s, { ...s, subtitle: 'AW\nAW' }, 'dup');
  });
  await page.mouse.move(tabbedCentre.x - 30, tabbedCentre.y - 20);
  await page.waitForTimeout(200);
  await page.mouse.move(tabbedCentre.x, tabbedCentre.y);
  await page.waitForTimeout(800);
  const dup = await tipLines();
  t.ok(
    'two identical subtitle lines do not crash the tooltip',
    JSON.stringify(dup) === JSON.stringify(['AW', 'AW', 'What this block is for.']) &&
      errors.length === before,
    `${JSON.stringify(dup)} errors +${errors.length - before}`,
  );
}

// Press and drag: a tooltip must not survive into a gesture.
await page.mouse.down();
await page.mouse.move(tabbedCentre.x + 40, tabbedCentre.y + 20, { steps: 5 });
const duringDrag = await tipText();
await page.mouse.up();
await page.waitForTimeout(700);
t.ok('pressing dismisses it, and a drag never raises one', duringDrag === null, String(duringDrag));
await page.evaluate(() => window.__scene.undo());
await page.waitForTimeout(300);

/*
  The tab's hit box. Two halves, and the second is the point: the tab is clickable because it is
  DRAWN there, not because a strip above every block swallows clicks.
*/
await page.evaluate(() => window.__scene.setSelection(new Set()));
await page.waitForTimeout(250);
const tabPt = await page.evaluate(() => {
  const v = window.__view;
  const sc = window.__scene;
  const s = sc.shapes.find((x) => x.name === 'tabbed_one');
  // Just above the block's top-left corner, where `tabbed_left` puts the tab.
  return { x: (s.x + 24 - v.camX) * v.z, y: (s.y - v.camY) * v.z - 7 };
});
await page.mouse.click(tipBox.x + tabPt.x, tipBox.y + tabPt.y);
await page.waitForTimeout(350);
const viaTab = await page.evaluate(() => [...window.__scene.selection]);
t.ok(
  'clicking a block’s label tab selects the block',
  viaTab.includes('tabbed_one'),
  JSON.stringify(viaTab),
);

await page.evaluate(() => window.__scene.setSelection(new Set()));
await page.waitForTimeout(250);
const abovePt = await page.evaluate(() => {
  const v = window.__view;
  const s = window.__scene.shapes.find((x) => x.name === 'inset_one');
  return { x: (s.x + 80 - v.camX) * v.z, y: (s.y - v.camY) * v.z - 7 };
});
await page.mouse.click(tipBox.x + abovePt.x, tipBox.y + abovePt.y);
await page.waitForTimeout(350);
const aboveInset = await page.evaluate(() => [...window.__scene.selection]);
t.ok(
  'and the same spot above an inset block selects nothing: no invisible strip',
  aboveInset.length === 0,
  JSON.stringify(aboveInset),
);

/*
  A tab whose label fits must not be ellipsized -- AT A FRACTIONAL ZOOM, which is the only place
  it ever was.

  The width is measured in CSS pixels, stored in world units and projected back, and at zoom 1
  that round trip is exact. At 1.16 it is not, and the budget `fitText` was handed came out a
  hair under the width it had just been computed from, so "XBN" drew as "X…". Nothing in the
  type system, the schema or a zoom-1 screenshot can see that.
*/
const drawnTabs = await page.evaluate(async () => {
  const sc = window.__scene;
  sc.commit('tabs', () => {
    sc.shapes = sc.shapes.map((s) =>
      s.kind === 'rect' ? { ...s, label: 'XBN', labelMode: 'tabbed_left' } : s,
    );
  });
  sc.clearSelection();
  window.__view.zoomTo(1.16, { x: 200, y: 200 });

  const proto = CanvasRenderingContext2D.prototype;
  const original = proto.fillText;
  const seen = [];
  proto.fillText = function (text, x, y, ...rest) {
    seen.push(text);
    return original.call(this, text, x, y, ...rest);
  };
  try {
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    window.__session.renderer.requestFrame();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  } finally {
    proto.fillText = original;
  }
  return { seen, z: window.__view.z };
});
t.ok(
  'a tab label that fits is drawn whole, at a zoom where the round trip is not exact',
  drawnTabs.seen.includes('XBN') && !drawnTabs.seen.some((x) => x.startsWith('X…')),
  `z=${drawnTabs.z} drew ${JSON.stringify(drawnTabs.seen)}`,
);

/*
  And the same thing swept, as the contract rather than as one rendering.

  The check above is a coin toss: whether the lost bit lands above or below the boundary depends
  on the label, the zoom and the font metrics, and the first version of this sweep won that toss
  at every zoom it tried and passed against the unfixed code. What is deterministic is the
  budget `tabRect` hands out -- run the real `fitText` against it, at zooms whose reciprocals do
  not divide evenly, and a label that fits must come back whole.
*/
const budgets = await page.evaluate(async () => {
  const heading = await import('/src/lib/scene/shapes/heading.ts');
  const text = await import('/src/lib/canvas/text.ts');
  const ctx = window.__view.ctx;
  const measure = heading.tabMeasurer(ctx);
  const bad = [];
  for (const label of ['XBN', 'RF', 'XU_0', 'W', 'decode', 'primary_bus', 'mm', 'iiii']) {
    for (const z of [0.73, 1, 1.16, 1.37, 2.5, 3.01, 7.9]) {
      // Wide enough that the block-width clamp never binds, so this measures the budget and
      // not a deliberate truncation.
      const s = {
        kind: 'rect',
        name: 'probe',
        label,
        subtitle: '',
        labelMode: 'tabbed_left',
        description: '',
      };
      // The body rectangle is a parameter since iteration 6: a FIFO's drawn box is derived
      // from its cell count rather than stored, so `tabRect` cannot read it off the shape.
      const box = heading.tabRect(s, { x: 0, y: 0, w: 4000, h: 100 }, 1 / z, measure);
      if (box === null) continue;
      ctx.font = (await import('/src/lib/canvas/theme.ts')).TAB_FONT;
      const drawn = text.fitText(ctx, label, box.textW);
      if (drawn !== label) bad.push(`${label} @ z=${z} -> ${drawn}`);
    }
  }
  return bad;
});
t.ok(
  'and a label that fits is never ellipsized, at any zoom',
  budgets.length === 0,
  budgets.length === 0 ? '56 label/zoom pairs' : budgets.slice(0, 4).join(', '),
);

/*
  The chrome tooltip (iteration 5).

  These exist because the toolbar had NO assertion of any kind before them. Not the tooltips;
  not even that clicking a tool button does anything -- every suite in this repo reaches the
  tools by digit key or through `window.__host`, so `onclick={() => host.setTool(tool.id)}`
  could have been deleted and `npm run verify` would have stayed green. That gap is the whole
  reason "hovering a tool shows its name and shortcut" could be reported as working, and be
  wrong: what was checked was the `title` ATTRIBUTE, which is not the feature.

  It could not have been checked. A native tooltip is drawn by AppKit's `NSToolTipManager` from
  real window-server mouse events inside an `NSTrackingArea`; `Input.dispatchMouseEvent` -- all
  `page.mouse.move` can send -- never raises one, no CDP domain reports tooltip text, and a page
  screenshot is a renderer surface that cannot contain OS chrome. Measured, not assumed: posting
  a genuine `CGEventMouseMoved` was also tried and the page received zero events. So `title` was
  a permanent exemption from this project's rule that every behaviour has an assertion, and the
  tooltip became the app's own so that the rule could apply to it.

  Here rather than in a suite of its own for the reason given at the top of the iteration-5
  section: this is pointer behaviour, and the dwell is the same 450ms `HOVER_DELAY_MS` the
  canvas tooltip uses.
*/

const DWELL_MS = 450;

const chromeTip = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="chrome-tooltip"]');
    return el === null ? null : el.textContent.trim();
  });

const toolBtn = (label) => button(page, label);

/** Rest the pointer on a control and let the dwell run out. */
async function dwellOn(label) {
  const box = await toolBtn(label).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(DWELL_MS + 250);
}

// Off the toolbar entirely, so each group starts with nothing showing.
async function leaveToolbar() {
  const box = await diagramCanvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 40, { steps: 6 });
  await page.waitForTimeout(200);
}

await leaveToolbar();

{
  const box = await toolBtn('Rectangle').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(DWELL_MS - 250);
  const early = await chromeTip();
  await page.waitForTimeout(400);
  const late = await chromeTip();

  // A tooltip wired straight to `pointerenter` flashes a box under the pointer during every
  // sweep across the tool group -- the defect the canvas tooltip's dwell already exists to stop.
  t.ok('nothing appears while the toolbar dwell is still running', early === null, `got ${early}`);
  // Exact, not `includes`: the parenthesised form is the requirement, and a looser match would
  // absorb both `Rectangle2` and a silently dropped shortcut.
  t.ok(
    'holding still over a tool names it and gives its key',
    late === 'Rectangle (3)',
    `got ${late}`,
  );
}

/*
  Every tool, read back through the registry rather than hard-coded.

  This is the assertion that keeps "registering a tool is the only step" honest: a lookup table
  in `Toolbar.svelte` keyed by tool id would pass every other check here and silently give the
  next tool registered no tooltip at all.
*/
{
  const expected = await page.evaluate(() =>
    window.__host.tools.map((d) => [d.label, window.__toolTipText(d)]),
  );
  const got = [];
  for (const [label] of expected) {
    await leaveToolbar();
    await dwellOn(label);
    got.push([label, await chromeTip()]);
  }
  const same = JSON.stringify(got) === JSON.stringify(expected);
  t.ok(
    'every registered tool raises the tooltip its declaration asks for',
    same,
    JSON.stringify(got),
  );
  /*
    The digits are the point of this one, not the count. They are assigned by toolbar POSITION,
    so a kind registered ahead of an existing tool silently renumbers it -- and the shortcut the
    user learned, and the literal `Digit4` other suites press, both move. `Queue (FIFO) (5)`
    appearing at the end is the evidence that iteration 6 appended rather than inserted.
  */
  t.ok(
    'and each of them carries the digit its position assigns, existing tools unmoved',
    JSON.stringify(expected.map((e) => e[1])) ===
      JSON.stringify([
        'Pointer (1)',
        'Select (2)',
        'Rectangle (3)',
        'Connection (4)',
        'Queue (FIFO) (5)',
        'Fabric (6)',
      ]),
    JSON.stringify(expected.map((e) => e[1])),
  );
}

/*
  The clusters, read off the rendered toolbar.

  Pointing at things and drawing things are different questions, and the rule between them is
  the answer. Asserted structurally rather than by counting pixels, because the thing that can
  regress is a tool declaring the wrong `group` -- which puts it on the wrong side of a rule
  that is still, pixel for pixel, exactly where it was.
*/
{
  const bar = await page.evaluate(() => {
    const root = document.querySelector('[data-panel-id="diagram"] button[aria-label="Pointer"]')
      ?.parentElement?.parentElement;
    if (root == null) return null;
    return [...root.children].map((el) => {
      const labels = [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
      return labels.length > 0 ? labels : 'rule';
    });
  });
  t.ok(
    'the selection tools and the shape tools are separate clusters, with a rule between',
    JSON.stringify(bar?.slice(0, 3)) ===
      JSON.stringify([
        ['Pointer', 'Select'],
        'rule',
        ['Rectangle', 'Connection', 'Queue (FIFO)', 'Fabric'],
      ]),
    JSON.stringify(bar),
  );
  /*
    The three zones, read back by role and label rather than by position in the DOM.

    Everything done on the canvas sits in the centred Tools zone -- the tool clusters, then
    the arrange commands and Delete, after every tool so the digits still read left to right.
    The document commands, file and history, sit in their own zone on the left. A button added
    inside a tool cluster would sit between two digits the registry assigns by ORDER, which is
    a shortcut the user has learned and a literal `Digit4` several suites press.
  */
  const zones = await page.evaluate(() => {
    const bar = document.querySelector(
      '[data-panel-id="diagram"] [role="group"][aria-label="Tools"]',
    )?.parentElement;
    if (bar == null) return null;
    const read = (label) => {
      const zone = bar.querySelector(`:scope > [role="group"][aria-label="${label}"]`);
      if (zone === null) return null;
      const r = zone.getBoundingClientRect();
      return {
        children: [...zone.children].map((el) => {
          const labels = [...el.querySelectorAll('button')].map((b) =>
            b.getAttribute('aria-label'),
          );
          return labels.length > 0 ? labels : 'rule';
        }),
        left: r.left,
        mid: r.left + r.width / 2,
      };
    };
    const r = bar.getBoundingClientRect();
    return {
      order: [...bar.children].map((el) => el.getAttribute('aria-label')),
      tools: read('Tools'),
      document: read('Document'),
      barLeft: r.left,
      barMid: r.left + r.width / 2,
    };
  });
  t.ok(
    'the bar is three zones, Document, Tools and View, in that order',
    JSON.stringify(zones?.order) === JSON.stringify(['Document', 'Tools', 'View']),
    JSON.stringify(zones?.order),
  );
  t.ok(
    'the Tools zone holds the tool clusters, then arrange and Delete after a rule',
    JSON.stringify(zones?.tools?.children) ===
      JSON.stringify([
        ['Pointer', 'Select'],
        'rule',
        ['Rectangle', 'Connection', 'Queue (FIFO)', 'Fabric'],
        'rule',
        ['Bring to front', 'Bring forward', 'Send backward', 'Send to back', 'Delete'],
      ]),
    JSON.stringify(zones?.tools?.children),
  );
  t.ok(
    'the Document zone holds the file commands, then undo and redo after a rule',
    JSON.stringify(zones?.document?.children) ===
      JSON.stringify([['Open diagram', 'Save diagram'], 'rule', ['Undo', 'Redo']]),
    JSON.stringify(zones?.document?.children),
  );
  t.ok(
    'the Tools zone is centred on the bar, and Document hugs its left edge',
    zones !== null &&
      Math.abs(zones.tools.mid - zones.barMid) <= 1 &&
      Math.abs(zones.document.left - zones.barLeft) <= 1,
    JSON.stringify({
      toolsMid: zones?.tools?.mid,
      barMid: zones?.barMid,
      docLeft: zones?.document?.left,
      barLeft: zones?.barLeft,
    }),
  );
}

// The conditional in `toolTipText`, which the toolbar cannot exercise: every registered tool is
// inside the nine the registry hands a digit to, so only a pure call can prove that a tenth
// one would read `Pan` and not `Pan ()`.
t.ok(
  'a tool with no shortcut gets its label alone, not empty parentheses',
  // `icon` is a component now and `toolTipText` ignores it; `null` keeps this from being the
  // one place in the repo where an icon is still written down as a string.
  (await page.evaluate(() => window.__toolTipText({ id: 'x', label: 'Pan', icon: null }))) ===
    'Pan',
);

/*
  The shortcut formatter, as a pure call.

  Every hint in the app is written in canonical order already, so no rendered string can prove
  that an out-of-order one sorts -- and `⌘⇧Z` is the kind of wrong that looks right until it is
  sitting next to a system menu that got it the other way round.
*/
{
  const got = await page.evaluate(() => {
    const k = window.__keys;
    return [
      k('shift', 'cmd', 'z'),
      k('cmd', 'shift', 'z'),
      k('del'),
      k('cmd', ']'),
      k('3'),
      k('ctrl', 'opt', 'shift', 'cmd', 'k'),
    ];
  });
  t.ok(
    'shortcuts render as Mac symbols, in Apple order however they were written',
    JSON.stringify(got) === JSON.stringify(['⇧⌘Z', '⇧⌘Z', '⌫', '⌘]', '3', '^⌥⇧⌘K']),
    JSON.stringify(got),
  );

  await leaveToolbar();
  await dwellOn('Delete');
  // Live, not just the formatter: the button is where a `Del` left behind by a partial
  // conversion would actually be seen.
  t.ok(
    'and the toolbar shows them, rather than spelling the modifiers out',
    (await chromeTip()) === 'Delete (⌫)',
    String(await chromeTip()),
  );
}

/*
  The file commands' tooltips.

  Not covered by the "every registered tool" sweep above, because these two are not tools -- they
  are the only buttons on the bar whose shortcut is bound at window level rather than in
  `ToolHost`, so the tooltip is the only place a user finds out they exist.
*/
{
  for (const [label, want] of [
    ['Open diagram', 'Open diagram (⌘O)'],
    ['Save diagram', 'Save diagram (⌘S)'],
  ]) {
    await leaveToolbar();
    await dwellOn(label);
    const got = await chromeTip();
    t.ok(`${label} names itself and gives its key`, got === want, `got ${got}`);
  }
}

{
  await leaveToolbar();
  await dwellOn('Rectangle');
  // To a divider, not to another button: this has to distinguish "dismissed" from
  // "replaced". Derived from the two buttons either side of it rather than by offset, so it
  // stays on the rule when the toolbar grows a cluster.
  const sel = await toolBtn('Select').boundingBox();
  const bar = await toolBtn('Rectangle').boundingBox();
  await page.mouse.move((sel.x + sel.width + bar.x) / 2, bar.y + bar.height / 2, { steps: 5 });
  await page.waitForTimeout(250);
  t.ok('the tooltip is gone once the pointer has left the tool', (await chromeTip()) === null);
}

{
  await leaveToolbar();
  await dwellOn('Rectangle');
  const box = await toolBtn('Connection').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await page.waitForTimeout(150);
  const mid = await chromeTip();
  await page.waitForTimeout(DWELL_MS + 250);
  const then = await chromeTip();
  // A timer left armed across buttons machine-guns a tooltip at every button the pointer
  // crosses on its way somewhere else.
  t.ok(
    'sliding onto the next tool re-runs the dwell rather than swapping text',
    mid === null,
    `got ${mid}`,
  );
  t.ok('and the next tool does get its own tooltip', then === 'Connection (4)', `got ${then}`);
}

/*
  Clicking. Two regressions in one gesture, and the second is the one that matters most: this is
  the first assertion in this repo that a toolbar button click does anything at all.
*/
{
  await leaveToolbar();
  await page.evaluate(() => window.__host.setTool('pointer'));
  await dwellOn('Rectangle');
  await toolBtn('Rectangle').click();
  await page.waitForTimeout(250);
  t.ok(
    'pressing a tool dismisses its tooltip, which would otherwise sit over the gesture',
    (await chromeTip()) === null,
  );
  t.ok(
    'and the click still selects the tool -- nothing else in verify/ checks the toolbar works',
    (await page.evaluate(() => window.__host.activeToolId)) === 'rect',
  );
}

{
  // Mirrors `a tooltip must not survive into a gesture` above: a drag that starts on a button
  // and ends on the canvas must not leave a box behind.
  await leaveToolbar();
  const box = await toolBtn('Select').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.down();
  const canvas = await diagramCanvas(page).boundingBox();
  await page.mouse.move(canvas.x + 200, canvas.y + 200, { steps: 8 });
  await page.waitForTimeout(DWELL_MS + 250);
  const during = await chromeTip();
  await page.mouse.up();
  await page.waitForTimeout(150);
  t.ok(
    'a drag that starts on a tool button never raises a tooltip',
    during === null,
    `got ${during}`,
  );
}

/*
  Keyboard focus, which is the half a `pointerenter`-only tooltip loses -- and with it the only
  place the shortcut is written down in the UI. No dwell on purpose: a dwell models an undecided
  pointer and means nothing for a deliberate Tab.
*/
{
  await leaveToolbar();
  await page.evaluate(() => {
    const b = document.querySelector('[data-panel-id="diagram"] button[aria-label="Connection"]');
    b.focus({ focusVisible: true });
  });
  await page.waitForTimeout(120);
  const onFocus = await chromeTip();
  const described = await page.evaluate(() => {
    const b = document.querySelector('[data-panel-id="diagram"] button[aria-label="Connection"]');
    const id = b.getAttribute('aria-describedby');
    return id === null ? null : document.getElementById(id)?.textContent.trim();
  });
  t.ok(
    'keyboard focus raises the tooltip at once, with no dwell',
    onFocus === 'Connection (4)',
    `got ${onFocus}`,
  );
  // The tooltip is the button's DESCRIPTION: `aria-label` already names it, and what the
  // tooltip adds is the key. Without this a screen reader never learns the shortcut exists.
  t.ok(
    'and the focused button points aria-describedby at it',
    described === 'Connection (4)',
    `got ${described}`,
  );

  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(150);
  t.ok('blurring dismisses it and takes the description with it', (await chromeTip()) === null);
  t.ok(
    'and leaves no dangling aria-describedby',
    (await page.evaluate(
      () => document.querySelectorAll('[data-panel-id="diagram"] [aria-describedby]').length,
    )) === 0,
  );
}

/*
  One layer, outside every pane.

  A tooltip rendered next to the control it describes paints UNDERNEATH the canvas: `.stage` is
  `contain: strict`, which makes it a stacking context, and it is a LATER sibling of the toolbar
  inside `DiagramView`, so the two paint at the same level in tree order and the stage wins.
  Measured -- a fixed box appended to a tool button is not the top element at its own
  coordinates, and the same box at `<main>` is. `closest('[data-panel-id]')` is what catches
  someone moving it back inside a pane; the viewport test is what catches the five nested
  `overflow: hidden` boxes shearing it, which is the defect `app.css` documents for the JSON
  editor's popup.
*/
{
  await leaveToolbar();
  await dwellOn('Zoom to fit'); // `ml-auto`, so it sits flush against the pane's right edge
  const geom = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chrome-tooltip"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      inPane: el.closest('[data-panel-id]') !== null,
      fixed: getComputedStyle(el).position === 'fixed',
      inside:
        r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      count: document.querySelectorAll('[data-testid="chrome-tooltip"]').length,
    };
  });
  t.ok(
    'the tooltip layer lives outside every dock pane, or it paints under the canvas',
    geom?.inPane === false,
  );
  t.ok('it is fixed, so no pane can clip it', geom?.fixed === true);
  t.ok(
    'and the rightmost control keeps its tooltip fully on screen',
    geom?.inside === true,
    JSON.stringify(geom),
  );
  t.ok('exactly one tooltip exists at a time', geom?.count === 1, `got ${geom?.count}`);
}

/*
  The dwell has to be the whole cost. `$state` written per pointermove would put a full document
  invalidation on every move across the toolbar -- the class of defect iteration 3 spent a
  pass removing, and the reason `ToolHost` keeps `#hoverAt` as a plain field.
*/
{
  const first = await toolBtn('Pointer').boundingBox();
  const last = await toolBtn('Connection').boundingBox();
  /*
    Already on the toolbar before the observer is installed, and deliberately so. Arriving from
    the canvas blanks the status bar's live readout -- a real mutation, in a sibling of the
    toolbar -- and counting it here would make this assertion about `StatusBar` instead. 150ms
    is comfortably inside the dwell, so nothing is showing yet either.
  */
  await page.mouse.move(first.x, first.y + first.height / 2, { steps: 4 });
  await page.waitForTimeout(150);
  await page.evaluate(() =>
    window.__watch(document.body, { attributes: true, childList: true, subtree: true }),
  );
  // Fast enough that no dwell completes: this measures the cost of moving, not of showing.
  await page.mouse.move(last.x + last.width, last.y + last.height / 2, { steps: 40 });
  await page.waitForTimeout(120);
  const sweep = await page.evaluate(() => window.__unwatch());
  t.ok(
    'sweeping the toolbar mutates the document not at all: the dwell is the cost',
    sweep === 0,
    `got ${sweep}`,
  );
}

/*
  A tooltip whose text is derived must track its source while it is on screen.

  This one was a real defect, not a hypothetical. `Undo` reads `scene.history.undoLabel`, and an
  attachment re-runs when its EXPRESSION's dependencies change -- so passing the interpolated
  string tore the attachment down on every commit, and its teardown dismissed the visible
  tooltip. It never came back either, because `pointerenter` does not fire again for a pointer
  that never left: the tooltip vanished for good at the exact moment its text became worth
  reading. The fix is that `tip()` takes a thunk and the LAYER does the reactive read.
*/
{
  await leaveToolbar();
  await page.evaluate(() => window.__host.setTool('pointer'));
  await dwellOn('Undo');
  const before = await chromeTip();
  // Commit through the keyboard, so the pointer never moves off the button.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  const after = await chromeTip();
  t.ok(
    'a derived tooltip survives its own text changing under a motionless pointer',
    after !== null,
    `${before} -> ${after}`,
  );
  // Relationally, not against a literal: this suite has committed a great deal by now, and
  // pinning the label would make the assertion about the history stack rather than the tooltip.
  t.ok(
    'and it re-reads the new label rather than going stale',
    before !== after && /^Undo.* \(⌘Z\)$/.test(String(after)),
    `${before} -> ${after}`,
  );
}

/*
  A greyed-out control is exactly when you most want to know what it is, and a disabled button
  is the case an event-listener tooltip could plausibly lose -- Chromium suppresses `click` and
  the mouse-button events on one, though not `pointerenter`. Locked in because the native
  `title` this replaced did show on a disabled button.
*/
{
  await leaveToolbar();
  await page.evaluate(() => window.__scene.clearSelection());
  await page.waitForTimeout(150);
  const off = await page.evaluate(
    () =>
      document.querySelector('[data-panel-id="diagram"] button[aria-label="Bring to front"]')
        .disabled,
  );
  await dwellOn('Bring to front');
  t.ok(
    'a disabled control still says what it is',
    off === true && (await chromeTip()) === 'Bring to front (⌘])',
    `disabled=${off}`,
  );
}

/*
  Escape dismisses it where the pointer has not moved. WCAG 1.4.13 calls this "dismissible", and
  it is the half of that criterion a `pointer-events: none` tooltip can actually meet. The
  second assertion is the one that matters: Escape also cancels the current gesture and then
  clears the selection, and a tooltip that swallowed the key would break both.
*/
{
  await leaveToolbar();
  // The select tool first: Escape resets a non-select tool BEFORE it touches the selection, so
  // without this the assertion below would be measuring which tool the previous group left on.
  await page.evaluate(() => {
    window.__host.setTool('pointer');
    window.__host.selectAll();
  });
  await dwellOn('Delete');
  const before = await chromeTip();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  t.ok(
    'Escape dismisses the tooltip without moving the pointer',
    before !== null && (await chromeTip()) === null,
    `showed ${before}`,
  );
  t.ok(
    'and Escape still reaches the canvas, which clears the selection',
    (await page.evaluate(() => window.__scene.selection.size)) === 0,
  );
}

// Two tooltips would stack on any platform where the native one does render, and a `title` is
// an assertion-proof attribute -- which is how this shipped broken in the first place.
t.ok(
  'no control in the diagram pane carries a native title any more',
  (await page.evaluate(
    () => document.querySelectorAll('[data-panel-id="diagram"] [title]').length,
  )) === 0,
);

/*
  Both delete keys.

  The tooltip names `⌫`, because that is the key a Mac keyboard prints and the one everybody
  has; a full-size keyboard's forward-delete sends `Delete` instead. `#globalKey` has always
  taken both, and now that only one of them is advertised, this is what keeps the other alive.
*/
{
  const before = await page.evaluate(() => window.__scene.shapes.length);
  const gone = [];
  for (const key of ['Backspace', 'Delete']) {
    await page.evaluate(() => {
      window.__host.setTool('pointer');
      window.__host.selectAll();
    });
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    gone.push(await page.evaluate(() => window.__scene.shapes.length));
    await page.evaluate(() => window.__host.undo());
    await page.waitForTimeout(150);
  }
  t.ok(
    'Backspace and Delete both take the selection out of the scene',
    before > 0 && gone[0] === 0 && gone[1] === 0,
    `${before} -> ${JSON.stringify(gone)}`,
  );
  // Undo after each, so the suite leaves the scene as it found it -- and so a key that deleted
  // more than it was asked to would show up here rather than in whatever runs next.
  t.ok(
    'and undo puts it back, both times',
    (await page.evaluate(() => window.__scene.shapes.length)) === before,
  );
}

await leaveToolbar();

/*
  The ⇧ hold (iteration 7).

  Holding Shift in any tool switches to the Select tool for as long as it is held; letting go
  goes back to the tool it came from. It is a state machine over key and pointer events, so every
  check here drives real keys and a real pointer through the window listeners -- a check that
  called `setTool` would skip exactly the part that can break.

  The camera is pinned at the origin at 100%, so a world point is its own canvas coordinate and
  every position below reads as the geometry it names.
*/
{
  const box = await diagramCanvas(page).boundingBox();
  const block = (name, x, y) => ({
    kind: 'rect',
    name,
    label: name,
    subtitle: '',
    labelMode: 'inset',
    description: '',
    position: [x, y],
    size: [160, 96],
    interfaces: 0,
  });
  await page.evaluate(
    (list) => {
      const sc = window.__scene;
      sc.commit('seed', () => {
        sc.shapes = window.__doc.deserializeScene({ version: 2, shapes: list });
        sc.setSelection(new Set());
      });
      window.__host.setTool('pointer');
      window.__view.z = 1;
      window.__view.camX = 0;
      window.__view.camY = 0;
    },
    [block('hold_a', 64, 64), block('hold_b', 320, 64)],
  );
  await page.waitForTimeout(200);

  const st = () =>
    page.evaluate(() => ({
      tool: window.__host.activeToolId,
      cursor: document.querySelector('[data-panel-id="diagram"] canvas').style.cursor,
      pressed: document
        .querySelector('[data-panel-id="diagram"] button[aria-label="Select"]')
        .getAttribute('aria-pressed'),
    }));
  const sel = () => page.evaluate(() => [...window.__scene.selection].sort());
  const cam = () => page.evaluate(() => [window.__view.camX, window.__view.camY]);
  const at = (x, y, steps = 1) => page.mouse.move(box.x + x, box.y + y, { steps });
  // Re-pinned before every step that aims at a block, so a step that pans by mistake fails on
  // its own rather than moving every block out from under the steps after it.
  const pin = () =>
    page.evaluate(() => {
      window.__view.z = 1;
      window.__view.camX = 0;
      window.__view.camY = 0;
    });

  await at(700, 300);
  await page.keyboard.down('Shift');
  const held = await st();
  await page.keyboard.up('Shift');
  const released = await st();
  t.ok(
    'holding ⇧ in the pointer tool switches to Select: pressed in the toolbar, crosshair cursor',
    held.tool === 'select' && held.pressed === 'true' && held.cursor === 'crosshair',
    JSON.stringify(held),
  );
  t.ok(
    'and letting go goes back to the pointer tool and its grab cursor',
    released.tool === 'pointer' && released.pressed === 'false' && released.cursor === 'grab',
    JSON.stringify(released),
  );

  await page.keyboard.press('Digit3');
  await page.keyboard.down('Shift');
  const fromRect = await st();
  await page.keyboard.up('Shift');
  const backToRect = await st();
  t.ok(
    'from the rectangle tool too, and letting go goes back to rectangle, not to the pointer',
    fromRect.tool === 'select' && backToRect.tool === 'rect',
    `${fromRect.tool} -> ${backToRect.tool}`,
  );
  await page.keyboard.press('Digit1');

  const cam0 = await cam();
  await at(40, 40);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await at(520, 200, 8);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  t.ok(
    'a ⇧-drag on empty canvas sweeps a band instead of panning',
    JSON.stringify(await sel()) === JSON.stringify(['hold_a', 'hold_b']) &&
      JSON.stringify(await cam()) === JSON.stringify(cam0),
    `${JSON.stringify(await sel())} cam ${JSON.stringify(cam0)} -> ${JSON.stringify(await cam())}`,
  );

  // A move under way when Shift goes down finishes as a move; the hold waits for mouse-up.
  await pin();
  await page.evaluate(() => window.__scene.setSelection(new Set()));
  await at(140, 110);
  await page.mouse.down();
  await at(180, 130, 5);
  await page.keyboard.down('Shift');
  await at(220, 150, 5);
  const midMove = await st();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const atUp = await st();
  const label = await page.evaluate(() => window.__scene.history.undoLabel);
  await page.keyboard.up('Shift');
  const afterMove = await st();
  t.ok(
    '⇧ pressed during a move keeps it a move, in the pointer tool',
    midMove.tool === 'pointer' && label === 'move',
    `${midMove.tool}, committed as ${label}`,
  );
  t.ok(
    'and the Select tool takes over at mouse-up while ⇧ is still down, until it comes up',
    atUp.tool === 'select' && afterMove.tool === 'pointer',
    `${atUp.tool} -> ${afterMove.tool}`,
  );
  // Only a move is put back. Undoing unconditionally would take out the seed itself whenever the
  // press missed the block, and every check after this one would then fail for that reason.
  if (label === 'move') await page.evaluate(() => window.__host.undo());

  // A click-click connection is one gesture from the first click to the second.
  await pin();
  const shapesBefore = await page.evaluate(() => window.__scene.shapes.length);
  await page.keyboard.press('Digit4');
  await at(220, 112, 5);
  await page.waitForTimeout(60);
  await page.mouse.click(box.x + 224, box.y + 112);
  await at(280, 300, 5);
  const pending = await page.evaluate(() => window.__host.tool.pendingFrom);
  await page.keyboard.down('Shift');
  const pendingHeld = await st();
  const stillPending = await page.evaluate(() => window.__host.tool.pendingFrom);
  await page.keyboard.press('Escape');
  const afterEsc = await st();
  await page.keyboard.up('Shift');
  const afterConn = await st();
  const shapesAfter = await page.evaluate(() => window.__scene.shapes.length);
  t.ok(
    'with a connection pending, ⇧ leaves it pending in the connect tool',
    pending === 'hold_a' && stillPending === 'hold_a' && pendingHeld.tool === 'connect',
    `${pending} / ${stillPending} in ${pendingHeld.tool}`,
  );
  t.ok(
    'and Escape cancels the connection, after which the held ⇧ takes effect',
    afterEsc.tool === 'select' && afterConn.tool === 'connect' && shapesAfter === shapesBefore,
    `${afterEsc.tool} -> ${afterConn.tool}, ${shapesBefore} -> ${shapesAfter} shapes`,
  );
  await page.keyboard.press('Digit1');

  await page.keyboard.down('Shift');
  await button(page, 'Rectangle').click();
  await page.keyboard.up('Shift');
  const stuck = await st();
  t.ok(
    'a tool picked from the toolbar during the hold is kept when ⇧ comes up',
    stuck.tool === 'rect' && stuck.pressed === 'false',
    stuck.tool,
  );
  // Off the button, and out of it: a focused button would take the Space pressed below.
  await page.evaluate(() => document.activeElement?.blur());
  await leaveToolbar();
  await page.keyboard.press('Digit1');

  await page.keyboard.down('Shift');
  const beforeBlur = await st();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const afterBlur = await st();
  await page.keyboard.up('Shift');
  t.ok(
    'losing the window ends the hold, since the ⇧ keyup will go to some other app',
    beforeBlur.tool === 'select' && afterBlur.tool === 'pointer',
    `${beforeBlur.tool} -> ${afterBlur.tool}`,
  );

  await traceCanvas(page).click({ position: { x: 200, y: 80 } });
  await page.waitForTimeout(150);
  const owner = await page.evaluate(() => window.__session.keyboardOwner);
  await pin();
  await page.keyboard.down('Shift');
  const traceHeld = await st();
  await page.evaluate(() => window.__scene.setSelection(new Set()));
  await at(40, 40);
  await page.mouse.down();
  const onPress = await st();
  await at(520, 200, 8);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  const traceBand = await sel();
  const afterTrace = await st();
  t.ok(
    'while the trace owns the keyboard, ⇧ on its own leaves the tool alone',
    owner === 'trace' && traceHeld.tool === 'pointer',
    `${owner}: ${traceHeld.tool}`,
  );
  t.ok(
    'but a ⇧-press on the canvas still sweeps a band, and letting go still ends the hold',
    onPress.tool === 'select' &&
      JSON.stringify(traceBand) === JSON.stringify(['hold_a', 'hold_b']) &&
      afterTrace.tool === 'pointer',
    `${onPress.tool}, ${JSON.stringify(traceBand)}, then ${afterTrace.tool}`,
  );

  await page.evaluate(() => window.__scene.selectOnly('hold_a'));
  await page.waitForTimeout(400);
  // A short timeout and a caught miss, so a Properties panel showing something else fails this
  // check rather than killing the suite, and every suite chained after it, with a TimeoutError.
  await row(page, 'label')
    .locator('.jse-value')
    .first()
    .dblclick({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(150);
  const editing = await page.evaluate(() => {
    const el = document.activeElement;
    return el?.isContentEditable === true || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA';
  });
  await page.keyboard.down('Shift');
  const caretHeld = await st();
  await page.keyboard.up('Shift');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  t.ok(
    'nor does ⇧ in a Properties text caret, where it is how text gets selected',
    editing && caretHeld.tool === 'pointer',
    `editing=${editing}, ${caretHeld.tool}`,
  );
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.__session.focusPanel('diagram');
    window.__scene.setSelection(new Set());
  });
  await at(700, 300);

  await page.keyboard.down('Meta');
  await page.keyboard.down('Shift');
  const chord = await st();
  await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');
  t.ok(
    '⌘ then ⇧ is the start of a chord, and leaves the tool alone',
    chord.tool === 'pointer',
    chord.tool,
  );

  await page.evaluate(() => window.__host.setHint('probe'));
  await page.keyboard.down('Shift');
  const tapHint = await page.evaluate(() => window.__host.hint);
  await page.keyboard.up('Shift');
  const hintAfter = await page.evaluate(() => window.__host.hint);
  t.ok(
    'a ⇧ tap puts back the hint that was showing, rather than the tool writing its own',
    tapHint !== 'probe' && hintAfter === 'probe',
    `${tapHint} -> ${hintAfter}`,
  );

  await page.keyboard.down('Space');
  await page.keyboard.down('Shift');
  const spaceShift = await st();
  await page.keyboard.up('Shift');
  await page.keyboard.up('Space');
  t.ok(
    'with Space held the hold still switches tool, but keeps the grab cursor: the next press pans',
    spaceShift.tool === 'select' && spaceShift.cursor === 'grab',
    JSON.stringify(spaceShift),
  );

  // hold_b spans 320..480 x 64..160, so its south-east handle is at (480, 160).
  await pin();
  await page.evaluate(() => window.__scene.selectOnly('hold_b'));
  await page.waitForTimeout(100);
  await at(480, 160, 3);
  await page.mouse.down();
  await at(520, 170, 4);
  await page.keyboard.down('Shift');
  await at(560, 180, 4);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  const sq = await page.evaluate(() => {
    const s = window.__scene.shapes.find((x) => x.name === 'hold_b');
    return s === undefined ? null : [s.w, s.h];
  });
  t.ok(
    '⇧ pressed once a corner drag is under way is still the square constraint',
    sq !== null && sq[0] === sq[1] && sq[0] > 160,
    JSON.stringify(sq),
  );
}

const code = t.report(errors);
await browser.close();
process.exit(code);
