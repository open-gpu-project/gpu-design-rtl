import {
  DEV_URL,
  diagramCanvas,
  dragOn,
  drawBlock,
  editValue,
  installProbes,
  open,
  row,
  suite,
} from './harness.mjs';

/*
  Autogrouping (iteration 7).

  The hierarchy is derived from where things are and never stored, so every group below seeds a
  scene, lets the commit path work out the parents, and then asks two questions: did the pure
  model get the parents right, and does everything that reads it -- the seat pass, a drag, a
  restack, delete and the clipboard, the Properties row, the canvas highlight, the band --
  behave as that model says. The geometric ones are driven with the real pointer.

  Every scene fits the diagram canvas at zoom 1 with the camera at the origin, so a world point
  is a canvas point. `fitsCanvas` checks that before anything relies on it.
*/

const t = suite('groups');
const { browser, page, errors } = await open(DEV_URL);
await installProbes(page);

const rect = (name, x, y, w, h, interfaces = 0) => ({
  kind: 'rect',
  name,
  label: name,
  subtitle: '',
  labelMode: 'inset',
  description: '',
  position: [x, y],
  size: [w, h],
  interfaces,
});
const fabric = (name, x, y, w, h, interfaces) => ({
  ...rect(name, x, y, w, h, interfaces),
  kind: 'fabric',
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

/**
 * Load a document, with nothing selected, the pointer tool, and z = 1 at 0,0.
 *
 * Two commits when there are wires: a wire may name an interface, and interfaces do not exist
 * until a commit has minted them from their owner's count, so the loader would refuse that end.
 * The wires go in on top of the first commit's own dump.
 */
async function seed(shapes) {
  await page.evaluate((list) => {
    const sc = window.__scene;
    const wires = list.filter((s) => s.kind === 'conn');
    sc.commit('seed', () => {
      sc.shapes = window.__doc.deserializeScene({
        version: 2,
        shapes: list.filter((s) => s.kind !== 'conn'),
      });
      sc.setSelection(new Set());
    });
    if (wires.length > 0) {
      sc.commit('seed', () => {
        const doc = window.__dump();
        sc.shapes = window.__doc.deserializeScene({ ...doc, shapes: [...doc.shapes, ...wires] });
      });
    }
    window.__host.setTool('pointer');
    window.__view.z = 1;
    window.__view.camX = 0;
    window.__view.camY = 0;
  }, shapes);
  await page.waitForTimeout(250);
}

const names = () => page.evaluate(() => window.__scene.shapes.map((s) => s.name));
/** Every shape's parent, by name. Reads nothing -- `{}` -- on a build without the hook. */
const parents = () =>
  page.evaluate(() => {
    const h = window.__hierarchy?.hierarchyOf(window.__scene.shapes);
    if (h === undefined) return {};
    return Object.fromEntries(window.__scene.shapes.map((s) => [s.name, h.parentOf(s.name)]));
  });
const shape = (name) =>
  page.evaluate((n) => window.__scene.shapes.find((s) => s.name === n) ?? null, name);
const selection = () => page.evaluate(() => [...window.__scene.selection].sort());
const undoLabel = () => page.evaluate(() => window.__scene.history.undoLabel);
const undo = async () => {
  await page.evaluate(() => window.__host.undo());
  await page.waitForTimeout(150);
};
const select = async (list) => {
  await page.evaluate((l) => window.__scene.setSelection(new Set(l)), list);
  await page.waitForTimeout(150);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shifted = (pts, d) => pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));

// Said out loud, because a missing hook makes `parents()` read nothing and every check that
// expects a top-level null would otherwise pass against it.
t.ok(
  'the hierarchy hook is there',
  await page.evaluate(() => typeof window.__hierarchy?.hierarchyOf === 'function'),
);

// The gestures below reach x = 800 and the highlight probes y = 464, at zoom 1. The scenes that
// run further right are only ever read through the hierarchy, never pointed at.
const box = await diagramCanvas(page).boundingBox();
t.ok(
  'the canvas is big enough for every gesture here at zoom 1',
  box.width >= 816 && box.height >= 470,
  JSON.stringify(box),
);

/* ------------------------------------------------------------------------ parents ---- */
{
  await seed([
    rect('outer', 0, 0, 400, 288),
    rect('a', 32, 32, 96, 64),
    rect('b', 0, 0, 96, 64),
    rect('c', 352, 240, 96, 96),
    fabric('F', 480, 0, 320, 288, 0),
    rect('d', 512, 96, 96, 64),
    {
      ...rect('q', 480, 320, 320, 96),
      kind: 'fifo',
      orientation: 'horizontal',
      cells: -1,
      spacing: 16,
    },
    rect('e', 512, 336, 32, 32),
  ]);
  const p = await parents();
  t.ok(
    'a block inside a block is its child, and touching the border from inside counts',
    p.a === 'outer' && p.b === 'outer' && p.outer === null,
    JSON.stringify(p),
  );
  t.ok('a block only partly inside is not', p.c === null, JSON.stringify(p));
  const inside = await page.evaluate(() => {
    const b = (n) => {
      const s = window.__scene.shapes.find((o) => o.name === n);
      return window.__ops(s.kind).bounds(s);
    };
    const within = (o, i) =>
      i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
    return { d: within(b('F'), b('d')), e: within(b('q'), b('e')) };
  });
  t.ok(
    'a fabric and a FIFO never adopt what lies inside them',
    inside.d && inside.e && p.d === null && p.e === null,
    JSON.stringify({ inside, p }),
  );

  await seed([
    rect('r1', 0, 0, 320, 224),
    rect('r2', 0, 0, 320, 224),
    rect('r3', 0, 0, 320, 224),
    rect('s', 64, 64, 64, 64),
    rect('ga', 400, 0, 192, 128),
    rect('gb', 496, 0, 192, 128),
    rect('t', 512, 32, 64, 64),
  ]);
  const chain = await parents();
  t.ok(
    'identical rectangles chain upward from the lowest, and what is inside them goes to the deepest',
    chain.r1 === null && chain.r2 === 'r1' && chain.r3 === 'r2' && chain.s === 'r3',
    JSON.stringify(chain),
  );
  const acyclic = await page.evaluate(() => {
    const h = window.__hierarchy?.hierarchyOf(window.__scene.shapes);
    return (
      h !== undefined && window.__scene.shapes.every((s) => !h.ancestors(s.name).includes(s.name))
    );
  });
  t.ok('and no shape is its own ancestor', acyclic);

  await seed([
    rect('gb', 496, 0, 192, 128),
    rect('ga', 400, 0, 192, 128),
    rect('t', 512, 32, 64, 64),
  ]);
  const flipped = await parents();
  t.ok(
    'between two equal, overlapping candidates the name decides, whichever is higher',
    chain.t === 'ga' && flipped.t === 'ga',
    `${chain.t} then ${flipped.t}`,
  );

  await seed([
    rect('P', 0, 0, 640, 384),
    rect('A', 32, 32, 96, 64),
    rect('Q', 192, 32, 416, 320),
    rect('C', 224, 96, 96, 64),
    rect('R', 672, 0, 320, 256),
    fabric('F', 704, 64, 256, 128, 3),
    rect('S', 704, 208, 64, 32),
    wire('sib', ['A', 'e'], ['Q', 'w']),
    wire('gc', ['A', 's'], ['C', 's']),
    wire('own', ['Q', 'n'], ['C', 'n']),
    wire('ports', ['F.if_1', 'n'], ['F.if_2', 'n']),
    wire('cross', ['F.if_3', 'n'], ['S', 'e']),
  ]);
  const w = await parents();
  // The two ports face up, so the route between them runs above the fabric, outside its box.
  const above = await page.evaluate(() => {
    const sc = window.__scene;
    const link = sc.shapes.find((s) => s.name === 'ports');
    const f = sc.shapes.find((s) => s.name === 'F');
    return link !== undefined && f !== undefined && window.__ops('conn').bounds(link).y < f.y;
  });
  t.ok(
    "a wire's parent is the innermost block both ends lie in: siblings, and a child to a grandchild",
    w.sib === 'P' && w.gc === 'P',
    JSON.stringify(w),
  );
  t.ok(
    'a wire from a block to something inside it belongs to that block',
    w.own === 'Q',
    JSON.stringify(w),
  );
  t.ok(
    'a wire between two ports of a fabric belongs to the fabric, which adopts nothing, wherever its route runs',
    w.ports === 'F' && w.F === 'R' && w['F.if_1'] === 'F' && above,
    `${JSON.stringify(w)}, route above the fabric: ${above}`,
  );
  t.ok(
    "while a wire from a fabric's port to a block beside it goes to the block around both",
    w.S === 'R' && w.cross === 'R',
    JSON.stringify(w),
  );
}

/* ------------------------------------------------------------------------ seating ---- */
{
  await seed([
    rect('inner', 32, 32, 96, 64),
    fabric('fab', 480, 32, 320, 160, 2),
    rect('outer', 0, 0, 400, 288),
    rect('G', 460, 0, 400, 300),
  ]);
  t.ok(
    'a commit seats the array in pre-order: each child above its parent, interfaces right after their owner',
    same(await names(), ['outer', 'inner', 'G', 'fab', 'fab.if_1', 'fab.if_2']),
    JSON.stringify(await names()),
  );
  const fixed = await page.evaluate(() => {
    const sc = window.__scene;
    return {
      seat: window.__hierarchy?.seatByHierarchy(sc.shapes) === sc.shapes,
      reroute: window.__resolve.rerouteAll(sc.shapes) === sc.shapes,
    };
  });
  t.ok(
    'and the committed array is a fixed point of both the seat pass and the reroute',
    fixed.seat && fixed.reroute,
    JSON.stringify(fixed),
  );
  const noop = await page.evaluate(() => {
    const sc = window.__scene;
    const arr = sc.shapes;
    sc.commit('noop-probe', () => {
      sc.shapes = arr;
    });
    return { kept: sc.shapes === arr, label: sc.history.undoLabel };
  });
  t.ok(
    'a commit that changes nothing records no entry',
    noop.kept && noop.label !== 'noop-probe',
    JSON.stringify(noop),
  );

  await seed([rect('x1', 64, 64, 96, 64), rect('x2', 224, 64, 96, 64)]);
  await drawBlock(page, 32, 32, 368, 192);
  await page.evaluate(() => window.__host.setTool('pointer'));
  const after = await names();
  const drawn = after.find((n) => n !== 'x1' && n !== 'x2');
  const p = await parents();
  await undo();
  t.ok(
    'drawing a block around two others seats them above it and makes them its children, in one entry',
    same(after, [drawn, 'x1', 'x2']) &&
      p.x1 === drawn &&
      p.x2 === drawn &&
      same(await names(), ['x1', 'x2']),
    `${JSON.stringify(after)} ${JSON.stringify(p)} -> undo ${JSON.stringify(await names())}`,
  );
}

/* -------------------------------------------------------------- dragging a parent ---- */
{
  await seed([
    rect('P', 64, 64, 480, 320, 1),
    rect('C', 224, 192, 128, 96),
    rect('O', 704, 224, 128, 96),
    wire('wi', ['P.if_1', 'n'], ['C', 'n']),
    wire('wo', ['C', 'e'], ['O', 'w']),
  ]);
  // Hand-drawn: the route the router gave it, pinned, so only a rigid move keeps its shape.
  await page.evaluate(() => {
    const sc = window.__scene;
    const cur = sc.shapes.find((s) => s.name === 'wi');
    sc.replaceShape(cur, { ...cur, routing: 'manual' }, 'pin');
  });
  await page.waitForTimeout(150);
  const before = {
    wi: (await shape('wi')).points,
    wo: (await shape('wo')).points,
    C: await shape('C'),
    label: await undoLabel(),
  };
  const d = { x: 64, y: 32 };

  await page.mouse.move(box.x + 96, box.y + 352);
  await page.mouse.down();
  await page.mouse.move(box.x + 96 + d.x, box.y + 352 + d.y, { steps: 10 });
  await page.waitForTimeout(120);
  const mid = { wi: (await shape('wi')).points, C: await shape('C') };
  await page.mouse.up();
  await page.waitForTimeout(250);
  const end = {
    wi: (await shape('wi')).points,
    wo: (await shape('wo')).points,
    C: await shape('C'),
    label: await undoLabel(),
  };

  t.ok(
    'dragging a block moves what lies inside it, mid-drag and on release',
    mid.C.x === before.C.x + d.x && end.C.x === before.C.x + d.x && end.C.y === before.C.y + d.y,
    JSON.stringify({ before: [before.C.x, before.C.y], mid: mid.C.x, end: [end.C.x, end.C.y] }),
  );
  t.ok(
    'a hand-drawn wire inside the group travels rigidly, mid-drag and on release',
    before.wi.length >= 2 &&
      same(mid.wi, shifted(before.wi, d)) &&
      same(end.wi, shifted(before.wi, d)),
    JSON.stringify({ before: before.wi, end: end.wi }),
  );
  t.ok(
    'a wire leaving the group reroutes: its outside end stays, its inside end moves',
    same(end.wo.at(-1), before.wo.at(-1)) && same(end.wo[0], shifted([before.wo[0]], d)[0]),
    JSON.stringify({ before: before.wo, end: end.wo }),
  );
  await undo();
  t.ok(
    'as one undo entry',
    end.label === 'move' &&
      same((await shape('C')).x, before.C.x) &&
      same((await shape('wi')).points, before.wi) &&
      (await undoLabel()) === before.label,
    `${end.label}, then ${await undoLabel()}`,
  );
}

/* --------------------------------------------------------------- dragging a child ---- */
{
  const scene = [
    rect('G', 16, 16, 720, 448),
    rect('P', 48, 48, 448, 400),
    rect('A', 80, 96, 96, 64),
    rect('B', 272, 96, 96, 64),
    rect('S1', 80, 224, 384, 192),
    wire('ab', ['A', 'e'], ['B', 'w']),
  ];
  await seed(scene);
  const p0 = await parents();
  t.ok(
    'the child scene nests as drawn',
    p0.P === 'G' && p0.A === 'P' && p0.B === 'P' && p0.S1 === 'P' && p0.ab === 'P',
    JSON.stringify(p0),
  );

  await dragOn(page, box, { x: 128, y: 128 }, { x: 128 + 480, y: 128 }, { steps: 12 });
  const intoG = await parents();
  await undo();
  t.ok(
    'dragged out of its parent into the grandparent, a block is re-parented there, and its wire follows',
    intoG.A === 'G' && intoG.ab === 'G',
    JSON.stringify(intoG),
  );

  await dragOn(page, box, { x: 128, y: 128 }, { x: 128 + 672, y: 128 }, { steps: 12 });
  const out = await parents();
  await undo();
  t.ok(
    'dragged out of every block, it is top level, and so is its wire',
    out.A === null && out.ab === null,
    JSON.stringify(out),
  );

  await dragOn(page, box, { x: 320, y: 128 }, { x: 320, y: 128 + 160 }, { steps: 12 });
  const intoSibling = await parents();
  await undo();
  t.ok(
    'dropped into a sibling, it nests there',
    intoSibling.B === 'S1' && intoSibling.ab === 'P',
    JSON.stringify(intoSibling),
  );
}

/* ---------------------------------------------------------------------- highlight ---- */
/*
  Classified by colour, on the top edge of each block: the ancestor outline is emerald, and none
  of blue (a plain outline), amber (selected) or the dark body passes the test.
*/
{
  await seed([rect('G', 16, 16, 720, 448), rect('P', 48, 48, 448, 400), rect('C', 96, 96, 96, 64)]);
  const lit = (list) =>
    page.evaluate((ns) => {
      const v = window.__view;
      const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
      const out = {};
      for (const n of ns) {
        const s = window.__scene.shapes.find((o) => o.name === n);
        const b = window.__ops(s.kind).bounds(s);
        const p = v.toScreen({ x: b.x + b.w / 2, y: b.y });
        let hit = false;
        for (let dy = -3; dy <= 3 && !hit; dy++) {
          const d = g.getImageData(
            Math.round(p.x * v.dpr),
            Math.round(p.y * v.dpr) + dy,
            1,
            1,
          ).data;
          hit = d[1] > 120 && d[0] < 100 && d[1] - d[2] > 20;
        }
        out[n] = hit;
      }
      return out;
    }, list);

  await select(['C']);
  const on = await lit(['G', 'P', 'C']);
  await select([]);
  const off = await lit(['G', 'P', 'C']);
  t.ok(
    'selecting a block outlines every block it lies in, and deselecting clears them',
    on.G && on.P && !on.C && !off.G && !off.P,
    JSON.stringify({ on, off }),
  );

  await select(['C']);
  await page.mouse.move(box.x + 144, box.y + 128);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 128, { steps: 4 });
  await page.waitForTimeout(120);
  const inside = await lit(['G', 'P']);
  await page.mouse.move(box.x + 144 + 400, box.y + 128, { steps: 10 });
  await page.waitForTimeout(120);
  const outOfP = await lit(['G', 'P']);
  await page.mouse.up();
  await page.waitForTimeout(200);
  if ((await undoLabel()) === 'move') await undo();
  t.ok(
    'and the outline follows a drag live: dragged out of its parent, only the grandparent stays lit',
    inside.G && inside.P && outOfP.G && !outOfP.P,
    JSON.stringify({ inside, outOfP }),
  );
}

/* ------------------------------------------------------------------------ restack ---- */
{
  const scene = [
    rect('P', 64, 64, 480, 320),
    rect('A', 96, 96, 96, 64),
    rect('B', 224, 96, 96, 64),
    rect('Q', 640, 64, 160, 96),
  ];
  await seed(scene);
  await select(['A']);
  await page.evaluate(() => window.__host.bringToFront());
  const front = await names();
  await seed(scene);
  await select(['B']);
  await page.evaluate(() => window.__host.sendToBack());
  const back = await names();
  await seed(scene);
  await select(['P']);
  await page.evaluate(() => window.__host.bringToFront());
  const parent = await names();
  t.ok(
    'a child brought to front stays inside its parent’s block, above its siblings',
    same(front, ['P', 'B', 'A', 'Q']),
    JSON.stringify(front),
  );
  t.ok(
    'a child sent to back stays above its parent',
    same(back, ['P', 'B', 'A', 'Q']),
    JSON.stringify(back),
  );
  t.ok(
    'a parent brought to front carries its whole subtree with it',
    same(parent, ['Q', 'P', 'A', 'B']),
    JSON.stringify(parent),
  );

  await seed([fabric('F', 64, 64, 320, 96, 2), rect('X', 480, 64, 96, 64)]);
  const seated = await names();
  await select(['X']);
  await page.evaluate(() => window.__host.sendBackward());
  const stepped = await names();
  const label = await undoLabel();
  await undo();
  t.ok(
    'sending a block backward past a fabric with ports moves it past the fabric, as one entry',
    same(seated, ['F', 'F.if_1', 'F.if_2', 'X']) &&
      same(stepped, ['X', 'F', 'F.if_1', 'F.if_2']) &&
      label === 'send backward' &&
      same(await names(), seated),
    `${JSON.stringify(seated)} -> ${JSON.stringify(stepped)} (${label})`,
  );
}

/* ------------------------------------------------------- delete, cut, copy, paste ---- */
const groupScene = [
  rect('P', 64, 64, 480, 320, 2),
  rect('A', 96, 160, 96, 64),
  rect('B', 320, 160, 160, 96, 1),
  wire('ab', ['A', 'e'], ['B', 'w']),
  rect('O', 704, 160, 96, 64),
  wire('bo', ['B.if_1', 'n'], ['O', 'n']),
];
const GROUP = ['A', 'B', 'B.if_1', 'P', 'P.if_1', 'P.if_2', 'ab'];
{
  await seed(groupScene);
  const original = await names();
  await select(['P']);
  await page.evaluate(() => window.__host.deleteSelection());
  const deleted = await names();
  await undo();
  t.ok(
    'deleting a parent deletes its group: its interfaces, its children and theirs, the wires inside',
    same(deleted, ['O']) && same(await names(), original),
    `${JSON.stringify(original)} -> ${JSON.stringify(deleted)}`,
  );

  await select(['P']);
  await page.evaluate(() => window.__host.cutSelection());
  const cut = await names();
  await page.evaluate(() => window.__host.paste());
  await page.waitForTimeout(150);
  const pasted = (await names()).filter((n) => !cut.includes(n)).sort();
  const pastedWire = await shape('ab');
  await undo();
  await undo();
  t.ok(
    'cut then paste brings the whole group back under its own names, wire still attached',
    same(cut, ['O']) && same(pasted, GROUP) && pastedWire?.from === 'A' && pastedWire?.to === 'B',
    `${JSON.stringify(cut)} + ${JSON.stringify(pasted)}`,
  );
  t.ok(
    'and two undos restore the exact order',
    same(await names(), original),
    JSON.stringify(await names()),
  );

  await page.evaluate(() => {
    const sc = window.__scene;
    const cur = sc.shapes.find((s) => s.name === 'P.if_1');
    sc.replaceShape(cur, { ...cur, label: 'bus', modport: 'slave' }, 'label');
  });
  await select(['P']);
  await page.evaluate(() => {
    window.__host.copySelection();
    window.__host.paste();
  });
  await page.waitForTimeout(150);
  const copy = await page.evaluate((before) => {
    const all = window.__scene.shapes;
    const fresh = all.filter((s) => !before.includes(s.name));
    const top = fresh.find((s) => s.kind === 'rect' && s.interfaces === 2);
    const link = fresh.find((s) => s.kind === 'conn');
    const pins = fresh.filter((s) => s.kind === 'nif' && s.parent === top?.name);
    return {
      count: fresh.length,
      link:
        link === undefined
          ? null
          : [link.from, link.to].map((n) => fresh.some((s) => s.name === n)),
      bus: pins.some((p) => p.label === 'bus' && p.modport === 'slave'),
    };
  }, original);
  await undo();
  await undo();
  t.ok(
    'copying a parent copies its group, with the interfaces as they were and the inner wire rejoined',
    copy.count === GROUP.length && same(copy.link, [true, true]) && copy.bus,
    JSON.stringify(copy),
  );

  // A fabric adopts nothing, but the routing between its own ports is still its own.
  await seed([fabric('N', 64, 64, 320, 96, 2), wire('mesh', ['N.if_1', 'n'], ['N.if_2', 'n'])]);
  const lone = await names();
  await select(['N']);
  await page.evaluate(() => {
    window.__host.copySelection();
    window.__host.paste();
  });
  await page.waitForTimeout(150);
  const fab = await page.evaluate((before) => {
    const fresh = window.__scene.shapes.filter((s) => !before.includes(s.name));
    const top = fresh.find((s) => s.kind === 'fabric');
    const link = fresh.find((s) => s.kind === 'conn');
    const ports = fresh
      .filter((s) => s.kind === 'nif' && s.parent === top?.name)
      .map((s) => s.name);
    return {
      count: fresh.length,
      ends: link === undefined ? null : [link.from, link.to].every((n) => ports.includes(n)),
    };
  }, lone);
  await undo();
  t.ok(
    'copying a fabric alone brings the wire between its own ports, joined to the copied ports',
    fab.count === 4 && fab.ends === true && same(await names(), lone),
    JSON.stringify(fab),
  );
}

/* ----------------------------------------------------------------- movesWith ---- */
{
  await seed(groupScene);
  const moves = await page.evaluate(() =>
    [...window.__resolve.movesWith(window.__scene.shapes, new Set(['P']))].sort(),
  );
  t.ok(
    "a parent's move set is its group, minus the interfaces its owners' reroutes will place",
    same(moves, ['A', 'B', 'P', 'ab']),
    JSON.stringify(moves),
  );
}

/* --------------------------------------------------------------------- properties ---- */
{
  await seed(groupScene);
  await select(['A']);
  await page.waitForTimeout(250);
  const shown = (await row(page, 'parent').locator('.jse-value').first().textContent())?.trim();
  const readonly = await page.locator('[data-path="%2Fparent"].archsim-readonly').count();
  await select(['O']);
  await page.waitForTimeout(250);
  const top = (await row(page, 'parent').locator('.jse-value').first().textContent())?.trim();
  t.ok(
    'Properties shows each object’s parent, read-only, and nothing at the top level',
    shown === 'P' && readonly === 1 && top === '',
    JSON.stringify({ shown, readonly, top }),
  );

  await select(['A']);
  await page.waitForTimeout(250);
  const aBefore = await shape('A');
  await editValue(page, 'parent', 'O');
  const alert =
    (await page.locator('.alert').count()) > 0 ? await page.locator('.alert').innerText() : '';
  t.ok(
    'and an edit to it is refused as computed',
    /computed/i.test(alert) && same(await shape('A'), aBefore) && (await parents()).A === 'P',
    alert.replace(/\s+/g, ' ').slice(0, 100),
  );

  const dumped = await page.evaluate(() =>
    window
      .__dump()
      .shapes.filter((r) => r.kind !== 'nif' && 'parent' in r)
      .map((r) => r.name),
  );
  t.ok('it is not written to the file', dumped.length === 0, JSON.stringify(dumped));

  // A position typed into the panel is a move, and carries the group as a drag would.
  await page.evaluate(() => {
    const sc = window.__scene;
    const cur = sc.shapes.find((s) => s.name === 'ab');
    sc.replaceShape(cur, { ...cur, routing: 'manual' }, 'pin');
  });
  const before = { A: await shape('A'), ab: (await shape('ab')).points, label: await undoLabel() };
  await select(['P']);
  await page.waitForTimeout(250);
  await editValue(page, 'position%2F0', '128');
  const after = { P: await shape('P'), A: await shape('A'), ab: (await shape('ab')).points };
  const label = await undoLabel();
  await undo();
  t.ok(
    'typing a parent’s position carries its children and its inner wire, as one entry',
    after.P.x === 128 &&
      after.A.x === before.A.x + 64 &&
      same(after.ab, shifted(before.ab, { x: 64, y: 0 })) &&
      (await shape('A')).x === before.A.x &&
      (await undoLabel()) === before.label,
    `${JSON.stringify({ P: after.P.x, A: after.A.x })} (${label})`,
  );
}

/* ---------------------------------------------------- bands and clicks inside a group ---- */
/*
  In the pointer tool a press inside a group lands on the block around it, so a plain drag moves
  the group. Holding Shift makes the same press the start of a band, which takes what it wholly
  covers -- the children, and never the block the band crosses.
*/
{
  await seed(groupScene);
  const pBefore = await shape('P');
  const labelBefore = await undoLabel();
  await page.mouse.move(box.x + 80, box.y + 360);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 140, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
  t.ok(
    'a ⇧-drag starting inside a group bands: it takes the children and leaves the group where it is',
    same(await selection(), ['A', 'B', 'B.if_1', 'ab']) &&
      same(await shape('P'), pBefore) &&
      (await undoLabel()) === labelBefore,
    JSON.stringify(await selection()),
  );

  await select([]);
  await dragOn(page, box, { x: 80, y: 360 }, { x: 112, y: 392 });
  const moved = { P: await shape('P'), A: await shape('A'), label: await undoLabel() };
  await undo();
  t.ok(
    'while a plain drag from the same spot moves the group',
    moved.label === 'move' && moved.P.x === pBefore.x + 32 && moved.A.x === 96 + 32,
    JSON.stringify({ P: moved.P.x, A: moved.A.x, label: moved.label }),
  );

  await page.keyboard.press('Digit2');
  await select([]);
  const click = async (x, y) => {
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
    return selection();
  };
  const onGroup = await click(80, 360);
  const onChild = await click(144, 192);
  await page.keyboard.press('Digit1');
  t.ok(
    'a click in the Select tool picks the group on its empty interior, and the child on the child',
    same(onGroup, ['P']) && same(onChild, ['A']),
    `${JSON.stringify(onGroup)} then ${JSON.stringify(onChild)}`,
  );
}

t.ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const code = t.report(errors);
await browser.close();
process.exit(code);
