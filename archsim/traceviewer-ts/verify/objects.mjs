import { DEV_URL, diagramCanvas, dragOn, installProbes, open, row, suite } from './harness.mjs';

/*
  The object tree (iteration 7).

  A read-only tree of every object, with wires that lie side by side folded under one row, under a
  root row for the diagram, docked left of the canvas. Three things can go wrong with it, and each
  group below is aimed at one:

  - It can disagree with the document. The rows are compared against `__outline`, the same pure
    functions the pane renders from, and those are fed malformed documents directly -- a cycle,
    a dangling parent -- that the scene would never let a check commit. The nesting is the
    hierarchy's, so the same functions are also fed blocks inside blocks, and runs of wires.
  - It can fight the canvas. A click in the tree selects, and a selection on the canvas opens
    the tree to show it; each direction has a way to go wrong that the other hides, so both are
    driven for real.
  - It can cost the canvas. A drag previews a new `shapes` array on every pointermove, and a tree
    that re-rendered for each of them would put DOM work back on the path iteration 3 cleared.
    Only a drag that carries something across a block's border may change a row.
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
const wire = (name, [from, fromAnchor], [to, toAnchor]) => ({
  kind: 'conn',
  name,
  label: '',
  description: '',
  labelOffset: [0, 0],
  routing: 'auto',
  path: 'ortho',
  points: [
    [0, 0],
    [0, 16],
  ],
  source: [from, fromAnchor],
  target: [to, toAnchor],
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
const keyed = (key) => page.locator(`${PANE} [role="treeitem"][data-key="${key}"]`);
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
    const r = (id) => {
      const b = document.querySelector(`[data-panel-id="${id}"]`).getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width };
    };
    return { o: r('objects'), d: r('diagram'), p: r('properties'), t: r('trace') };
  });
  t.ok(
    'Objects sits left of the canvas and level with it, with Properties on the right',
    g.o.right <= g.d.left &&
      g.d.right <= g.p.left &&
      Math.abs(g.o.top - g.d.top) <= 1 &&
      Math.abs(g.p.top - g.d.top) <= 1,
    JSON.stringify(g),
  );
  t.ok(
    'and above the trace, which runs under all three',
    g.o.bottom <= g.t.top &&
      g.d.bottom <= g.t.top &&
      Math.abs(g.t.left - g.o.left) <= 1 &&
      Math.abs(g.t.right - g.p.right) <= 1,
    JSON.stringify(g),
  );
  // The canvas keeps a fixed share, which is what every canvas-coordinate check is written for.
  const share = g.d.width / (g.p.right - g.o.left);
  t.ok('and the canvas has 0.6 of the width', Math.abs(share - 0.6) < 0.02, share.toFixed(3));
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

  // What a row says: its kind's glyph -- the one on the tool that draws it -- then the label.
  const faces = await page.evaluate((pane) => {
    const glyph = (svg) =>
      svg === null
        ? null
        : [...svg.classList]
            .filter((c) => c.startsWith('lucide-') && c !== 'lucide-icon')
            .sort()
            .join(' ');
    const tool = (label) => glyph(document.querySelector(`button[aria-label="${label}"] svg`));
    const face = (name) => {
      const el = document.querySelector(`${pane} [data-name="${name}"]`);
      const label = el?.querySelector('.tree-label') ?? null;
      const dim = el?.querySelector('.tree-name') ?? null;
      return {
        icons: el?.querySelectorAll('svg.lucide').length ?? 0,
        glyph: glyph(el?.querySelector('.tree-icon svg') ?? null),
        label: label?.textContent ?? null,
        name: dim?.textContent ?? null,
        dimmer:
          label !== null &&
          dim !== null &&
          getComputedStyle(label).color !== getComputedStyle(dim).color,
        first: label !== null && dim !== null && (label.compareDocumentPosition(dim) & 4) !== 0,
      };
    };
    return {
      rectTool: tool('Rectangle'),
      fabricTool: tool('Fabric'),
      alu: face('alu'),
      far: face('far'),
      noc: face('noc'),
      pin: face('noc.if_1'),
    };
  }, PANE);
  t.ok(
    "each row shows its kind's glyph, the same one as on the tool that draws that kind",
    faces.rectTool !== null &&
      faces.alu.glyph === faces.rectTool &&
      faces.far.glyph === faces.rectTool &&
      faces.noc.glyph === faces.fabricTool &&
      faces.pin.glyph !== null &&
      faces.pin.glyph !== faces.noc.glyph &&
      faces.pin.glyph !== faces.rectTool,
    JSON.stringify(faces),
  );
  t.ok(
    'the label leads, and the name follows it greyed out, only when the two differ',
    faces.alu.label === 'ALU' &&
      faces.alu.name === 'alu' &&
      faces.alu.dimmer &&
      faces.alu.first &&
      faces.far.label === 'far' &&
      faces.far.name === null,
    JSON.stringify({ alu: faces.alu, far: faces.far }),
  );
  t.ok(
    'an unlabelled object leads with its name instead',
    faces.pin.label === 'noc.if_1' && faces.pin.name === null,
    JSON.stringify(faces.pin),
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
    const { outlineOf, outlineRows, pathTo } = window.__outline;
    const nif = (name, parent) => ({ kind: 'nif', name, label: '', parent });
    const rect = (name) => ({ kind: 'rect', name, label: name });
    const box = (name, x) => ({ kind: 'rect', name, label: '', x, y: 40, w: 100, h: 80 });
    const conn = (name, from, to) => ({ kind: 'conn', name, label: '', from, to });
    const flat = (nodes) =>
      nodes.flatMap((n) => (n.type === 'wires' ? flat(n.children) : [n.name, ...flat(n.children)]));
    // A folded row as ['wires', [...]], a parent as [name, [...]], a leaf as its name.
    const tree = (nodes) =>
      nodes.map((n) =>
        n.type === 'wires'
          ? ['wires', tree(n.children)]
          : n.children.length > 0
            ? [n.name, tree(n.children)]
            : n.name,
      );
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

    // Two wires inside `outer`, two side by side at the top level, and one with an object on
    // either side of it. Bottom first, as a scene is.
    const wired = [
      { kind: 'rect', name: 'outer', label: '', x: 0, y: 0, w: 400, h: 300 },
      box('a', 40),
      box('b', 240),
      box('c', 600),
      box('d', 800),
      conn('in1', 'a', 'b'),
      conn('in2', 'b', 'a'),
      conn('x1', 'b', 'c'),
      conn('x2', 'c', 'd'),
      box('e', 1000),
      conn('x3', 'd', 'e'),
    ];
    const wiredRoot = { id: 'diagram', title: 'Diagram', nodes: outlineOf(wired) };
    const wiredOpen = new Set(['diagram', 'diagram:outer', 'diagram/wires:in1']);
    const wiredRows = (list) =>
      outlineRows([{ id: 'diagram', title: 'Diagram', nodes: outlineOf(list) }], wiredOpen);
    const drawnOn = wiredRows([...wired, conn('in3', 'a', 'b')]);

    return {
      cycle: once([nif('a', 'b'), nif('b', 'a'), rect('r')]),
      missing: once([nif('n', 'ghost'), rect('r')]),
      empty: once([nif('n', ''), rect('r')]),
      self: once([nif('n', 'n')]),
      topMissing: outlineOf([nif('n', 'ghost')]).map((n) => n.name),
      // Ownership is one level deep: an owner that is itself owned does not count.
      ownedByOwned: outlineOf([nif('a', 'b'), nif('b', 'c'), rect('c')]).map((n) => [
        n.name,
        n.children.map((c) => c.name),
      ]),
      nested: outlineOf([
        { kind: 'rect', name: 'outer', label: '', x: 0, y: 0, w: 400, h: 300 },
        { kind: 'rect', name: 'inner', label: '', x: 40, y: 40, w: 100, h: 80 },
      ]).map((n) => [n.name, n.children.map((c) => c.name)]),
      wiredOnce: once(wired),
      wired: tree(wiredRoot.nodes),
      wiredRows: wiredRows(wired).map((r) => [r.key, r.level, r.role, r.name, r.count]),
      drawnOn: drawnOn.filter((r) => r.role === 'wires').map((r) => [r.key, r.expanded, r.count]),
      paths: [
        pathTo(wiredRoot, 'in2'),
        pathTo(wiredRoot, 'b'),
        pathTo(wiredRoot, 'x3'),
        pathTo(wiredRoot, 'ghost'),
      ],
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
    'an interface claiming an owner that is itself owned sits at the top level',
    JSON.stringify(r.ownedByOwned) ===
      JSON.stringify([
        ['c', ['b']],
        ['a', []],
      ]),
    JSON.stringify(r.ownedByOwned),
  );
  t.ok(
    'a block inside a block nests under it',
    JSON.stringify(r.nested) === JSON.stringify([['outer', ['inner']]]),
    JSON.stringify(r.nested),
  );
  t.ok(
    'wires side by side fold under one row, in their places; a wire between two objects does not',
    r.wiredOnce &&
      JSON.stringify(r.wired) ===
        JSON.stringify([
          'x3',
          'e',
          ['wires', ['x2', 'x1']],
          'd',
          'c',
          ['outer', [['wires', ['in2', 'in1']], 'b', 'a']],
        ]),
    JSON.stringify(r.wired),
  );
  t.ok(
    'a folded row is keyed by its bottom-most wire, carries the count, and opens like a parent',
    JSON.stringify(r.wiredRows) ===
      JSON.stringify([
        ['diagram', 1, 'diagram', null, 0],
        ['diagram:x3', 2, 'object', 'x3', 0],
        ['diagram:e', 2, 'object', 'e', 0],
        ['diagram/wires:x1', 2, 'wires', null, 2],
        ['diagram:d', 2, 'object', 'd', 0],
        ['diagram:c', 2, 'object', 'c', 0],
        ['diagram:outer', 2, 'object', 'outer', 0],
        ['diagram/wires:in1', 3, 'wires', null, 2],
        ['diagram:in2', 4, 'object', 'in2', 0],
        ['diagram:in1', 4, 'object', 'in1', 0],
        ['diagram:b', 3, 'object', 'b', 0],
        ['diagram:a', 3, 'object', 'a', 0],
      ]),
    JSON.stringify(r.wiredRows),
  );
  t.ok(
    'so drawing another wire on top of an open run keeps it open, one wire longer',
    JSON.stringify(r.drawnOn) ===
      JSON.stringify([
        ['diagram/wires:x1', false, 2],
        ['diagram/wires:in1', true, 3],
      ]),
    JSON.stringify(r.drawnOn),
  );
  t.ok(
    'pathTo gives every row that must open to show an object, a folded one included',
    JSON.stringify(r.paths) ===
      JSON.stringify([
        ['diagram', 'diagram:outer', 'diagram/wires:in1'],
        ['diagram', 'diagram:outer'],
        ['diagram'],
        null,
      ]),
    JSON.stringify(r.paths),
  );
  t.ok(
    'a translated scene gives back the previous rows by reference, so a drag that crosses no border re-renders nothing',
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

  // Live, not at mouse-up: the rows read the selection, not the gesture's end. The camera first,
  // because the pan above moved it and a band takes only what it wholly covers.
  await setCamera(0, 0, 1);
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

/* ------------------------------------------------------------------------ nesting ---- */
/*
  The rows nest by the hierarchy: a block under the block it lies in, an interface under its
  owner, a wire under the block both its ends lie in. Driven with the real pointer, because the
  two ways it can go wrong
  are both gestures -- a drag inside a group that re-renders the tree, and a drag that re-parents
  the selection without the tree following it there.
*/
{
  await seed([
    block('cluster', 64, 64, 480, 320),
    block('alu', 96, 128, 160, 96),
    fabric('noc', 304, 128, 224, 160, 2),
    {
      kind: 'conn',
      name: 'link',
      label: '',
      description: '',
      labelOffset: [0, 0],
      routing: 'auto',
      path: 'ortho',
      points: [
        [256, 176],
        [304, 176],
      ],
      source: ['alu', 'e'],
      target: ['noc', 'w'],
    },
    block('pen', 608, 64, 288, 256),
  ]);
  await setCamera(0, 0, 1);
  await page.evaluate(() => window.__host.setTool('pointer'));
  await page.evaluate(() => {
    window.__session.objectTreeOpen = new Set(['diagram']);
  });
  await page.waitForTimeout(150);
  const box = await diagramCanvas(page).boundingBox();
  const levels = async () => (await rendered()).map((r) => [r.key, r.level]);

  await twisty('cluster');
  await twisty('noc');
  const want = await page.evaluate(() => {
    const { outlineOf, outlineRows } = window.__outline;
    const s = window.__session;
    const roots = s.diagrams.map((d) => ({
      id: d.id,
      title: d.title,
      nodes: outlineOf(d.scene.shapes),
    }));
    return outlineRows(roots, s.objectTreeOpen).map((r) => [r.key, r.level]);
  });
  const got = await levels();
  t.ok(
    'nested, the rendered rows are still exactly the ones the outline model gives',
    JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got),
  );
  t.ok(
    'a block lists what lies inside it, topmost first: the wire, the fabric with its interfaces, then alu',
    JSON.stringify(got) ===
      JSON.stringify([
        ['diagram', 1],
        ['diagram:pen', 2],
        ['diagram:cluster', 2],
        ['diagram:link', 3],
        ['diagram:noc', 3],
        ['diagram:noc.if_2', 4],
        ['diagram:noc.if_1', 4],
        ['diagram:alu', 3],
      ]),
    JSON.stringify(got),
  );
  await twisty('noc');
  await twisty('cluster');

  await page.evaluate(() => window.__scene.selectOnly('link'));
  await page.waitForTimeout(250);
  const wired = await rendered();
  t.ok(
    'selecting a wire inside a closed group opens the group, with the wire row selected',
    wired.find((r) => r.key === 'diagram:cluster')?.expanded === 'true' &&
      wired.find((r) => r.key === 'diagram:link')?.selected === 'true',
    JSON.stringify(wired),
  );
  await page.evaluate(() => window.__scene.setSelection(new Set()));
  await twisty('cluster');

  // Canvas to tree: the ancestors that open are the enclosing blocks.
  await page.mouse.move(box.x + 176, box.y + 176);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  const opened = await rendered();
  t.ok(
    'clicking a block inside a group on the canvas opens the group and highlights the row',
    opened.find((r) => r.key === 'diagram:cluster')?.expanded === 'true' &&
      opened.find((r) => r.key === 'diagram:alu')?.selected === 'true',
    JSON.stringify(opened),
  );

  // Dragging the group: its children and its wire travel with it, and no row changes.
  await page.evaluate(() => window.__scene.selectOnly('cluster'));
  await page.waitForTimeout(250);
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
  await page.mouse.move(box.x + 100, box.y + 350);
  await page.mouse.down();
  await page.mouse.move(box.x + 132, box.y + 382, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const mutations = await page.evaluate(() => window.__unwatch());
  const dragged = await page.evaluate(() => ({
    label: window.__scene.history.undoLabel,
    alu: window.__scene.shapes.find((s) => s.name === 'alu')?.x,
  }));
  t.ok(
    'a 20-step drag of a group moves what it contains and makes no DOM mutation in the pane',
    mutations === 0 && dragged.label === 'move' && dragged.alu === 128,
    `${mutations} mutations, ${JSON.stringify(dragged)}`,
  );
  if (dragged.label === 'move') await press('Meta+z');

  // An already-selected block dragged into a closed group: the Set does not change, the
  // block's ancestors do, and the tree has to follow it in.
  await page.evaluate(() => window.__scene.selectOnly('alu'));
  await page.waitForTimeout(250);
  const penBefore = (await rendered()).find((r) => r.key === 'diagram:pen')?.expanded ?? null;
  await dragOn(page, box, { x: 176, y: 176 }, { x: 720, y: 176 }, { steps: 12, settle: 300 });
  const moved = await rendered();
  const penAt = moved.findIndex((r) => r.key === 'diagram:pen');
  t.ok(
    'dragging the selected block into a closed group opens it, with the row there and selected',
    penBefore === null &&
      moved[penAt]?.expanded === 'true' &&
      moved[penAt + 1]?.key === 'diagram:alu' &&
      moved[penAt + 1]?.level === 3 &&
      moved[penAt + 1]?.selected === 'true',
    JSON.stringify(moved),
  );
  if ((await page.evaluate(() => window.__scene.history.undoLabel)) === 'move') {
    await press('Meta+z');
  }

  // Deleting a group from the tree takes everything under it, and undo puts it all back.
  await rowFor('cluster').click();
  await page.waitForTimeout(150);
  if ((await rendered()).find((r) => r.key === 'diagram:cluster')?.expanded !== 'true') {
    await twisty('cluster');
  }
  const rowsBefore = await keys();
  const orderBefore = await page.evaluate(() => window.__scene.shapes.map((s) => s.name));
  await press('Backspace');
  const rowsGone = await keys();
  const left = await page.evaluate(() => window.__scene.shapes.map((s) => s.name));
  await press('Meta+z');
  const rowsBack = await keys();
  const orderBack = await page.evaluate(() => window.__scene.shapes.map((s) => s.name));
  t.ok(
    '⌫ on a group in the tree deletes it with everything inside it, and ⌘Z restores the same rows',
    JSON.stringify(rowsGone) === JSON.stringify(['diagram', 'diagram:pen']) &&
      JSON.stringify(left) === JSON.stringify(['pen']) &&
      JSON.stringify(rowsBack) === JSON.stringify(rowsBefore) &&
      JSON.stringify(orderBack) === JSON.stringify(orderBefore),
    `${JSON.stringify(rowsGone)} / ${JSON.stringify(left)} -> ${JSON.stringify(rowsBack)}`,
  );
}

/* ------------------------------------------------------------------- folded wires ---- */
/*
  Wires side by side in one parent's list share a row. It is a container, like the diagram's root
  row: a click opens it, the keyboard focuses it, and neither selects the wires inside.
*/
{
  await seed([
    block('a', 64, 64),
    block('b', 384, 64),
    block('c', 64, 320),
    wire('ab', ['a', 'e'], ['b', 'w']),
    wire('ba', ['b', 's'], ['a', 's']),
    block('d', 384, 320),
    wire('cd', ['c', 'e'], ['d', 'w']),
  ]);
  await setCamera(0, 0, 1);
  await page.evaluate(() => {
    window.__session.objectTreeOpen = new Set(['diagram']);
  });
  await page.waitForTimeout(150);
  const FOLD = 'diagram/wires:ab';

  const want = await page.evaluate(() => {
    const { outlineOf, outlineRows } = window.__outline;
    const s = window.__session;
    const roots = s.diagrams.map((d) => ({
      id: d.id,
      title: d.title,
      nodes: outlineOf(d.scene.shapes),
    }));
    return outlineRows(roots, s.objectTreeOpen).map((r) => r.key);
  });
  t.ok(
    'the two wires side by side share a row, and the one between two blocks keeps its own',
    JSON.stringify(await keys()) === JSON.stringify(want) &&
      JSON.stringify(want) ===
        JSON.stringify([
          'diagram',
          'diagram:cd',
          'diagram:d',
          FOLD,
          'diagram:c',
          'diagram:b',
          'diagram:a',
        ]),
    JSON.stringify(await keys()),
  );

  const face = await page.evaluate(
    ([pane, key]) => {
      const glyph = (svg) =>
        svg === null
          ? null
          : [...svg.classList]
              .filter((c) => c.startsWith('lucide-') && c !== 'lucide-icon')
              .sort()
              .join(' ');
      const el = document.querySelector(`${pane} [data-key="${key}"]`);
      const one = document.querySelector(`${pane} [data-name="cd"]`);
      return {
        tool: glyph(document.querySelector('button[aria-label="Connection"] svg')),
        glyph: glyph(el?.querySelector('.tree-icon svg') ?? null),
        wire: glyph(one?.querySelector('.tree-icon svg') ?? null),
        label: el?.querySelector('.tree-label')?.textContent ?? null,
        count: el?.querySelector('.tree-kind')?.textContent ?? null,
        expanded: el?.getAttribute('aria-expanded') ?? null,
        selectable: el?.hasAttribute('aria-selected') ?? null,
      };
    },
    [PANE, FOLD],
  );
  t.ok(
    'the folded row shows the wire glyph, "wires" and how many, and is closed and not selectable',
    face.tool !== null &&
      face.glyph === face.tool &&
      face.wire === face.tool &&
      face.label === 'wires' &&
      face.count === '2' &&
      face.expanded === 'false' &&
      face.selectable === false,
    JSON.stringify(face),
  );

  await keyed(FOLD).click();
  await page.waitForTimeout(150);
  const opened = await rendered();
  const at = opened.findIndex((r) => r.key === FOLD);
  const inside = opened.slice(at + 1, at + 3).map((r) => [r.key, r.level]);
  const picked = await selection();
  await keyed(FOLD).click();
  await page.waitForTimeout(150);
  t.ok(
    'a click opens it onto its wires, topmost first, selecting nothing, and a second closes it',
    opened[at]?.expanded === 'true' &&
      JSON.stringify(inside) ===
        JSON.stringify([
          ['diagram:ba', 3],
          ['diagram:ab', 3],
        ]) &&
      picked.length === 0 &&
      (await rendered()).find((r) => r.key === FOLD)?.expanded === 'false',
    JSON.stringify({ inside, picked }),
  );

  await page.evaluate(() => window.__scene.selectOnly('ab'));
  await page.waitForTimeout(250);
  const followed = await rendered();
  t.ok(
    'selecting a folded wire on the canvas opens its row, with the wire row selected',
    followed.find((r) => r.key === FOLD)?.expanded === 'true' &&
      followed.find((r) => r.key === 'diagram:ab')?.selected === 'true',
    JSON.stringify(followed),
  );

  await rowFor('d').click();
  await page.waitForTimeout(150);
  await press('ArrowDown');
  const onFold = [await selection(), await focused()];
  await press('ArrowLeft');
  const shut = (await rendered()).find((r) => r.key === FOLD)?.expanded;
  await press('ArrowRight');
  await press('ArrowRight');
  const stepped = [await selection(), await focused()];
  t.ok(
    '↓ onto a folded row focuses it and keeps the selection; ← closes it, → opens it and steps in',
    JSON.stringify(onFold) === JSON.stringify([['d'], FOLD]) &&
      shut === 'false' &&
      JSON.stringify(stepped) === JSON.stringify([['ba'], 'diagram:ba']),
    JSON.stringify({ onFold, shut, stepped }),
  );
  await page.evaluate(() => window.__scene.setSelection(new Set()));
  await page.waitForTimeout(150);
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
