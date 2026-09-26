import { DEV_URL, diagramCanvas, dragOn, installProbes, open, row, suite } from './harness.mjs';

/*
  The object tree (iteration 7).

  A read-only tree of every object, under a root row for the diagram, sitting above Properties.
  Three things can go wrong with it, and each group below is aimed at one:

  - It can disagree with the document. The rows are compared against `__outline`, the same pure
    functions the pane renders from, and those are fed malformed documents directly -- a cycle,
    a dangling parent -- that the scene would never let a check commit.
  - It can fight the canvas. A click in the tree selects, and a selection on the canvas opens
    the tree to show it; each direction has a way to go wrong that the other hides, so both are
    driven for real.
  - It can cost the canvas. A drag previews a new `shapes` array on every pointermove, and a tree
    that re-rendered for each of them would put DOM work back on the path iteration 3 cleared.
*/

const t = suite('objects');
const { browser, page, errors } = await open(DEV_URL);
await installProbes(page);

const PANE = '[data-panel-id="objects"]';

const fabric = (name, x, y, w, h, interfaces) => ({
  kind: 'fabric',
  name,
  label: name,
  subtitle: '',
  labelMode: 'inset',
  description: '',
  position: [x, y],
  size: [w, h],
  interfaces,
});
const block = (name, x, y, w = 160, h = 96, label = name) => ({
  kind: 'rect',
  name,
  label,
  subtitle: '',
  labelMode: 'inset',
  description: '',
  position: [x, y],
  size: [w, h],
  interfaces: 0,
});

/** Load a document straight in, with nothing selected, as one commit. */
async function seed(shapes) {
  await page.evaluate((list) => {
    const sc = window.__scene;
    sc.commit('seed', () => {
      sc.shapes = window.__doc.deserializeScene({ version: 2, shapes: list });
      sc.setSelection(new Set());
    });
  }, shapes);
  await page.waitForTimeout(250);
}

/** The rows as rendered: key, level, and the ARIA state a screen reader would hear. */
const rendered = () =>
  page.evaluate(
    (pane) =>
      [...document.querySelectorAll(`${pane} [role="treeitem"]`)].map((e) => ({
        key: e.dataset.key,
        level: Number(e.getAttribute('aria-level')),
        expanded: e.getAttribute('aria-expanded'),
        selected: e.getAttribute('aria-selected'),
      })),
    PANE,
  );
const keys = async () => (await rendered()).map((r) => r.key);
const rowFor = (name) => page.locator(`${PANE} [role="treeitem"][data-name="${name}"]`);
const rootRow = () => page.locator(`${PANE} [role="treeitem"][data-key="diagram"]`);
const selection = () => page.evaluate(() => [...window.__scene.selection].sort());
const focused = () => page.evaluate(() => document.activeElement?.dataset?.key ?? null);
const camera = () =>
  page.evaluate(() => ({ x: window.__view.camX, y: window.__view.camY, z: window.__view.z }));
const setCamera = (x, y, z) =>
  page.evaluate(
    ([cx, cy, cz]) => {
      window.__view.z = cz;
      window.__view.camX = cx;
      window.__view.camY = cy;
    },
    [x, y, z],
  );
const press = async (key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
};
/** Toggle a parent open or shut by its twisty, which never selects. */
const twisty = async (name) => {
  await rowFor(name).locator('.tree-twisty').click();
  await page.waitForTimeout(150);
};

await seed([
  block('alu', 64, 64, 160, 96, 'ALU'),
  block('far', 3000, 2000),
  fabric('noc', 320, 64, 256, 160, 2),
]);

/* ------------------------------------------------------------------------- layout ---- */
{
  const g = await page.evaluate(() => {
    const r = (id) => document.querySelector(`[data-panel-id="${id}"]`).getBoundingClientRect();
    const [d, o, p] = ['diagram', 'objects', 'properties'].map(r);
    return {
      d: { left: d.left, width: d.width },
      o: { left: o.left, width: o.width, bottom: o.bottom },
      p: { left: p.left, width: p.width, top: p.top, right: p.right },
    };
  });
  t.ok(
    'Objects sits above Properties, on the same left edge and at the same width',
    Math.abs(g.o.left - g.p.left) <= 1 &&
      Math.abs(g.o.width - g.p.width) <= 1 &&
      g.o.bottom <= g.p.top,
    JSON.stringify(g),
  );
  // The diagram keeps its share, which is what keeps every canvas-coordinate check valid.
  const share = g.d.width / (g.p.right - g.d.left);
  t.ok(
    'and the diagram keeps its 0.72 share of the width',
    Math.abs(share - 0.72) < 0.02,
    share.toFixed(3),
  );
}

/* ---------------------------------------------------------------------- structure ---- */
{
  const want = await page.evaluate(() => {
    const { outlineOf, outlineRows } = window.__outline;
    const s = window.__session;
    const roots = s.diagrams.map((d) => ({
      id: d.id,
      title: d.title,
      nodes: outlineOf(d.scene.shapes),
    }));
    return outlineRows(roots, s.objectTreeOpen).map((r) => ({ key: r.key, level: r.level }));
  });
  const got = (await rendered()).map((r) => ({ key: r.key, level: r.level }));
  t.ok(
    'the rendered rows are exactly the ones the outline model gives',
    JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got),
  );
  t.ok(
    'topmost first, under the diagram root: the last shape painted is the first row',
    JSON.stringify(await keys()) ===
      JSON.stringify(['diagram', 'diagram:noc', 'diagram:far', 'diagram:alu']),
    JSON.stringify(await keys()),
  );
  const noc = (await rendered()).find((r) => r.key === 'diagram:noc');
  t.ok('a parent starts collapsed', noc?.expanded === 'false', JSON.stringify(noc));

  await twisty('noc');
  const open = await rendered();
  const ifs = open.filter((r) => r.key.startsWith('diagram:noc.'));
  t.ok(
    "opened, a fabric's interfaces sit under it at level 3",
    ifs.length === 2 && ifs.every((r) => r.level === 3),
    JSON.stringify(ifs),
  );
  t.ok(
    'and the twisty opens it without selecting anything',
    (await selection()).length === 0,
    JSON.stringify(await selection()),
  );
  await twisty('noc');

  // ⌘] with the tree focused: the arrange chords act on the diagram the tree shows.
  await rowFor('alu').click();
  await page.waitForTimeout(150);
  await press('Meta+BracketRight');
  t.ok(
    '⌘] pressed in the tree brings the block to front, and the tree follows the new order',
    JSON.stringify(await keys()) ===
      JSON.stringify(['diagram', 'diagram:alu', 'diagram:noc', 'diagram:far']),
    JSON.stringify(await keys()),
  );
  await press('Meta+z');
}

/* ------------------------------------------------------------------ the pure model ---- */
{
  const r = await page.evaluate(() => {
    const { outlineOf, outlineRows } = window.__outline;
    const nif = (name, parent) => ({ kind: 'nif', name, label: '', parent });
    const rect = (name) => ({ kind: 'rect', name, label: name });
    const flat = (nodes) => nodes.flatMap((n) => [n.name, ...flat(n.children)]);
    const once = (shapes) => {
      const names = flat(outlineOf(shapes));
      return names.length === shapes.length && new Set(names).size === shapes.length;
    };

    const shapes = window.__scene.shapes;
    const roots = (list) => [{ id: 'diagram', title: 'Diagram', nodes: outlineOf(list) }];
    const open = new Set(['diagram', 'diagram:noc']);
    const prev = outlineRows(roots(shapes), open);
    const moved = shapes.map((s) => (s.kind === 'rect' ? { ...s, x: s.x + 16 } : s));
    const renamed = shapes.map((s) => (s.name === 'far' ? { ...s, name: 'distant' } : s));
    const relabelled = shapes.map((s) => (s.name === 'far' ? { ...s, label: 'FAR' } : s));
    const restacked = [...shapes].reverse();

    return {
      cycle: once([nif('a', 'b'), nif('b', 'a'), rect('r')]),
      missing: once([nif('n', 'ghost'), rect('r')]),
      empty: once([nif('n', ''), rect('r')]),
      self: once([nif('n', 'n')]),
      topMissing: outlineOf([nif('n', 'ghost')]).map((n) => n.name),
      moved: outlineRows(roots(moved), open, prev) === prev,
      renamed: outlineRows(roots(renamed), open, prev) !== prev,
      relabelled: outlineRows(roots(relabelled), open, prev) !== prev,
      restacked: outlineRows(roots(restacked), open, prev) !== prev,
    };
  });
  t.ok(
    'a parent cycle, a missing parent, an empty one or itself: every shape still appears once',
    r.cycle && r.missing && r.empty && r.self,
    JSON.stringify(r),
  );
  t.ok(
    'and a shape whose parent is missing sits at the top level',
    JSON.stringify(r.topMissing) === JSON.stringify(['n']),
  );
  t.ok(
    'a translated scene gives back the previous rows by reference, so a drag re-renders nothing',
    r.moved,
  );
  t.ok(
    'while a rename, a label change or a restack each give new rows',
    r.renamed && r.relabelled && r.restacked,
    JSON.stringify(r),
  );
}

/* ------------------------------------------------------------------ tree to canvas ---- */
{
  await page.evaluate(() => {
    const s = window.__session;
    s.selectSignal(s.trace.rows[0]);
  });
  await page.waitForTimeout(150);
  const signalBefore = await page.evaluate(() => window.__session.trace.selectedSignal);
  await setCamera(0, 0, 1);
  await rowFor('alu').click();
  await page.waitForTimeout(400);
  const nameShown = await row(page, 'name').locator('.jse-value').first().textContent();
  t.ok(
    'clicking a row selects the object, and Properties shows it',
    JSON.stringify(await selection()) === JSON.stringify(['alu']) && nameShown?.trim() === 'alu',
    `${JSON.stringify(await selection())}, name ${nameShown}`,
  );
  t.ok(
    'and, selection being global, it clears the trace selection',
    signalBefore !== null &&
      (await page.evaluate(() => window.__session.trace.selectedSignal)) === null,
    String(signalBefore),
  );

  await rowFor('noc').click({ modifiers: ['Meta'] });
  await page.waitForTimeout(120);
  const added = await selection();
  await rowFor('noc').click({ modifiers: ['Meta'] });
  await page.waitForTimeout(120);
  t.ok(
    '⌘-click on a row toggles it in, and then out',
    JSON.stringify(added) === JSON.stringify(['alu', 'noc']) &&
      JSON.stringify(await selection()) === JSON.stringify(['alu']),
    `${JSON.stringify(added)} then ${JSON.stringify(await selection())}`,
  );

  const still = await camera();
  await rowFor('alu').click();
  await page.waitForTimeout(150);
  t.ok(
    'an object already in view leaves the camera exactly where it was',
    JSON.stringify(await camera()) === JSON.stringify(still),
    `${JSON.stringify(still)} -> ${JSON.stringify(await camera())}`,
  );

  await setCamera(0, 0, 1.25);
  await rowFor('far').click();
  await page.waitForTimeout(150);
  const off = await page.evaluate(() => {
    const v = window.__view;
    const s = window.__scene.shapes.find((o) => o.name === 'far');
    const c = v.toScreen({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
    return { z: v.z, dx: c.x - v.cssW / 2, dy: c.y - v.cssH / 2 };
  });
  t.ok(
    'an object off screen is brought to the centre, with the zoom unchanged',
    off.z === 1.25 && Math.abs(off.dx) < 1 && Math.abs(off.dy) < 1,
    JSON.stringify(off),
  );
}

/* ------------------------------------------------------------------ canvas to tree ---- */
{
  await setCamera(0, 0, 1);
  await page.evaluate(() => window.__host.setTool('pointer'));
  await page.evaluate(() => window.__scene.setSelection(new Set()));
  await page.waitForTimeout(150);
  const box = await diagramCanvas(page).boundingBox();
  const pin = await page.evaluate(() => {
    const s = window.__scene.shapes.find((o) => o.kind === 'nif');
    return { name: s.name, x: s.x + s.w / 2, y: s.y + s.h / 2 };
  });
  const collapsed = (await rendered()).find((r) => r.key === 'diagram:noc')?.expanded;
  await page.mouse.move(box.x + pin.x, box.y + pin.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await rendered();
  const pinRow = after.find((r) => r.key === `diagram:${pin.name}`);
  const inView = await page.evaluate((name) => {
    const el = document.querySelector(`[data-panel-id="objects"] [data-name="${name}"]`);
    const sc = document.querySelector('[data-panel-id="objects"] [role="tree"]');
    if (el === null || sc === null) return false;
    const a = el.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    return a.top >= b.top && a.bottom <= b.bottom;
  }, pin.name);
  t.ok(
    'clicking an interface on the canvas opens its fabric in the tree and highlights the row',
    collapsed === 'false' &&
      after.find((r) => r.key === 'diagram:noc')?.expanded === 'true' &&
      pinRow?.selected === 'true',
    JSON.stringify(pinRow),
  );
  t.ok('and the row is scrolled into view', inView);

  await twisty('noc');
  await dragOn(page, box, { x: 800, y: 420 }, { x: 740, y: 380 });
  t.ok(
    'collapsing it again, then panning, does not open it back up',
    (await rendered()).find((r) => r.key === 'diagram:noc')?.expanded === 'false',
  );

  // Live, not at mouse-up: the rows read the selection, not the gesture's end.
  await page.keyboard.press('Digit2');
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 260, { steps: 8 });
  const mid = await rendered();
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Digit1');
  t.ok(
    'a band highlights the rows it catches while it is still being swept',
    mid.find((r) => r.key === 'diagram:alu')?.selected === 'true' &&
      mid.find((r) => r.key === 'diagram:noc')?.selected === 'true' &&
      mid.find((r) => r.key === 'diagram:far')?.selected === 'false',
    JSON.stringify(mid),
  );
}

/* ------------------------------------------------------------------------ keyboard ---- */
{
  await setCamera(0, 0, 1);
  await rowFor('far').click();
  await page.waitForTimeout(150);
  await press('ArrowDown');
  const down = [await selection(), await focused()];
  await press('ArrowUp');
  await press('ArrowUp');
  const up = [await selection(), await focused()];
  t.ok(
    '↓ and ↑ move to the next and previous row, selecting it',
    JSON.stringify(down) === JSON.stringify([['alu'], 'diagram:alu']) &&
      JSON.stringify(up) === JSON.stringify([['noc'], 'diagram:noc']),
    `${JSON.stringify(down)} ${JSON.stringify(up)}`,
  );

  await press('ArrowRight');
  const opened = (await rendered()).find((r) => r.key === 'diagram:noc')?.expanded;
  await press('ArrowRight');
  const child = [await selection(), await focused()];
  await press('ArrowLeft');
  const parent = [await selection(), await focused()];
  await press('ArrowLeft');
  const shut = (await rendered()).find((r) => r.key === 'diagram:noc')?.expanded;
  t.ok(
    '→ opens a parent and then steps into its first child; ← steps back out and then closes it',
    opened === 'true' &&
      child[1] === 'diagram:noc.if_2' &&
      JSON.stringify(parent) === JSON.stringify([['noc'], 'diagram:noc']) &&
      shut === 'false',
    JSON.stringify({ opened, child, parent, shut }),
  );

  await press('Home');
  const home = [await selection(), await focused()];
  await press('End');
  const end = [await selection(), await focused()];
  t.ok(
    'Home goes to the root row, which takes focus but selects nothing; End to the last row',
    JSON.stringify(home) === JSON.stringify([['noc'], 'diagram']) &&
      JSON.stringify(end) === JSON.stringify([['alu'], 'diagram:alu']),
    `${JSON.stringify(home)} ${JSON.stringify(end)}`,
  );
  // Focusing a row must not scroll anything but the tree's own box. The dock's wrappers are
  // `overflow: hidden`, so a scroll there has no scrollbar to undo it with.
  const scrolled = await page.evaluate(() =>
    [...document.querySelectorAll('[class*="sv-dock"], .panel-host')]
      .filter((e) => e.scrollTop !== 0 || e.scrollLeft !== 0)
      .map((e) => e.className),
  );
  t.ok(
    'and no dock box or panel host has been scrolled by it',
    scrolled.length === 0,
    JSON.stringify(scrolled),
  );

  await press('Digit3');
  const tool = await page.evaluate(() => window.__host.activeToolId);
  await press('Digit1');
  t.ok('digits pressed in the tree still switch tools', tool === 'rect', tool);

  const count = await page.evaluate(() => window.__scene.shapes.length);
  await press('Backspace');
  const gone = await page.evaluate(() => window.__scene.shapes.some((s) => s.name === 'alu'));
  await press('Meta+z');
  const back = await page.evaluate(() => window.__scene.shapes.some((s) => s.name === 'alu'));
  t.ok(
    '⌫ in the tree deletes the selected object, and ⌘Z brings it back',
    !gone && back && (await page.evaluate(() => window.__scene.shapes.length)) === count,
    `gone=${!gone} back=${back}`,
  );

  await twisty('noc');
  await rowFor('noc.if_1').click();
  await page.waitForTimeout(150);
  const label = await page.evaluate(() => window.__scene.history.undoLabel);
  await press('Backspace');
  t.ok(
    '⌫ on an interface, which cannot be deleted on its own, records no history entry',
    (await page.evaluate(() => window.__scene.shapes.length)) === count &&
      (await page.evaluate(() => window.__scene.history.undoLabel)) === label,
    String(label),
  );
  await twisty('noc');
}

/* ---------------------------------------------------- a selection made mid-gesture ---- */
/*
  A pending connection is one gesture from the first click to the second, and the property panel
  defers its push while one is in flight. A selection made from the tree in that window has to
  reach Properties once the gesture ends -- including when it ends from the keyboard, which bumps
  no pointer event. Before `#noteGestureEnd`, Escape left the panel empty until the next drag.
*/
{
  await setCamera(0, 0, 1);
  await page.evaluate(() => window.__scene.setSelection(new Set()));
  const box = await diagramCanvas(page).boundingBox();
  await page.keyboard.press('Digit4');
  await page.mouse.move(box.x + 220, box.y + 112, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.click(box.x + 224, box.y + 112);
  await page.mouse.move(box.x + 280, box.y + 300, { steps: 5 });
  const pending = await page.evaluate(() => window.__host.tool.pendingFrom ?? null);
  await rowFor('far').click();
  await page.waitForTimeout(300);
  await press('Escape');
  await page.waitForTimeout(300);
  const shown =
    (await row(page, 'name').count()) > 0
      ? (await row(page, 'name').locator('.jse-value').first().textContent())?.trim()
      : null;
  t.ok(
    'a tree selection made during a pending connection reaches Properties when Escape ends it',
    pending === 'alu' && shown === 'far',
    `pending ${pending}, Properties shows ${shown}`,
  );
  await page.keyboard.press('Digit1');
}

/* ------------------------------------------------------------------ stale readouts ---- */
{
  // A curved link with a waypoint on it, and that waypoint selected in the pointer tool.
  await seed([fabric('A', 80, 60, 320, 56, 1), fabric('B', 80, 400, 320, 56, 1)]);
  await page.evaluate(() => {
    const sc = window.__scene;
    const pins = sc.shapes.filter((s) => s.kind === 'nif');
    pins.forEach((pin, i) => {
      const cur = sc.shapes.find((x) => x.name === pin.name);
      sc.replaceShape(
        cur,
        { ...cur, side: i === 0 ? 's' : 'n', modport: i === 0 ? 'master' : 'slave' },
        'pins',
      );
    });
  });
  await page.waitForTimeout(200);
  await setCamera(0, 0, 1);
  const box = await diagramCanvas(page).boundingBox();
  const pins = await page.evaluate(() =>
    window.__scene.shapes
      .filter((s) => s.kind === 'nif')
      .map((s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 })),
  );
  const click = async (p) => {
    await page.mouse.move(box.x + p.x, box.y + p.y, { steps: 4 });
    await page.waitForTimeout(60);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(160);
  };
  await page.keyboard.press('Digit4');
  await click(pins[0]);
  await click(pins[1]);
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(200);
  const wire = await page.evaluate(
    () => window.__scene.shapes.find((s) => s.kind === 'conn')?.name,
  );
  await page.evaluate((n) => window.__scene.selectOnly(n), wire);
  await page.waitForTimeout(200);
  const badge = await page.evaluate(
    (n) => window.__handles(n).find((h) => h.role === 'action')?.pos ?? null,
    wire,
  );
  if (badge !== null) await click(badge);
  const readout = () =>
    page.locator('[data-panel-id="diagram"] .text-\\[var\\(--color-accent\\)\\]').allTextContents();
  const before = await readout();
  await rowFor('A').click();
  await page.waitForTimeout(200);
  const after = await readout();
  t.ok(
    'selecting another object from the tree drops the waypoint readout from the status bar',
    before.some((x) => /waypoint 1 \/ 1/.test(x)) && !after.some((x) => /waypoint/.test(x)),
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
}

/* ------------------------------------------------------------------ scrolling, cost ---- */
{
  const many = Array.from({ length: 40 }, (_, i) =>
    block(`b${String(i).padStart(2, '0')}`, 64 + (i % 8) * 192, 64 + Math.floor(i / 8) * 128),
  );
  await seed(many);
  await setCamera(0, 0, 1);
  await rowFor('b39').click();
  await page.waitForTimeout(150);
  await press('End');
  const s = await page.evaluate(() => {
    const sc = document.querySelector('[data-panel-id="objects"] [role="tree"]');
    const host = document.querySelector('[data-panel-id="objects"]');
    const content = host.closest('.sv-dock__content');
    const last = sc.querySelector('[role="treeitem"]:last-child').getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    return {
      overflows: sc.scrollHeight > sc.clientHeight,
      scrolled: sc.scrollTop > 0,
      lastInView: last.bottom <= box.bottom + 0.5,
      host: host.scrollTop,
      content: content?.scrollTop ?? 0,
    };
  });
  t.ok(
    'forty objects overflow the tree, which scrolls its own box to the last row',
    s.overflows && s.scrolled && s.lastInView,
    JSON.stringify(s),
  );
  t.ok(
    'while the pane around it does not scroll at all',
    s.host === 0 && s.content === 0,
    JSON.stringify(s),
  );

  // A drag previews a new `shapes` array on every pointermove; the tree must not notice.
  // The camera first: the click on `b39` above revealed it, which panned `b00` off screen.
  await setCamera(0, 0, 1);
  await page.evaluate(() => window.__scene.selectOnly('b00'));
  await page.waitForTimeout(250);
  const box = await diagramCanvas(page).boundingBox();
  await page.evaluate(
    (pane) =>
      window.__watch(pane, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      }),
    PANE,
  );
  await page.mouse.move(box.x + 140, box.y + 110);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const mutations = await page.evaluate(() => window.__unwatch());
  const moved = await page.evaluate(() => window.__scene.history.undoLabel);
  t.ok(
    'a 20-step drag on the canvas makes no DOM mutation at all in the Objects pane',
    mutations === 0 && moved === 'move',
    `${mutations} mutations, committed as ${moved}`,
  );
}

/* ------------------------------------------------------------------------ hygiene ---- */
{
  const found = await page.evaluate((pane) => {
    const el = document.querySelector(pane);
    return ['[title]', '.grip', '.footer', '[data-path]'].filter(
      (q) => el.querySelector(q) !== null,
    );
  }, PANE);
  t.ok(
    'the pane carries no native title and none of the class names other checks select',
    found.length === 0,
    JSON.stringify(found),
  );
}

/* ------------------------------------------------------------------------ remount ---- */
/*
  Last, because it floats a pane. The open set lives on the session rather than in the view,
  so a remount -- which floating is -- keeps whatever the user had opened.
*/
{
  await seed([block('alu', 64, 64), fabric('noc', 320, 64, 256, 160, 2)]);
  await twisty('noc');
  const before = (await rendered()).find((r) => r.key === 'diagram:noc')?.expanded;
  await page
    .locator('.sv-dock__leaf', { has: page.locator('text=Objects') })
    .last()
    .hover();
  await page.locator('[aria-label="Float Objects"]').click();
  await page.waitForTimeout(700);
  const floated = await page.locator(`.sv-dockmgr__window ${PANE}`).count();
  const after = (await rendered()).find((r) => r.key === 'diagram:noc')?.expanded;
  t.ok(
    'floating the Objects pane remounts it with its rows still open',
    before === 'true' && floated === 1 && after === 'true',
    `${before} -> floated ${floated} -> ${after}`,
  );
}

t.ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const code = t.report(errors);
await browser.close();
process.exit(code);
