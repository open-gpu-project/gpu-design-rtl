import { DEV_URL, diagramCanvas, installProbes, open, suite, toCanvas } from './harness.mjs';

/*
  Alignment snapping (iteration 7.2).

  A block, FIFO or fabric being moved, resized or drawn lines up with the placed shapes that share
  its parent: edges with edges, medians with medians. The grid wins -- alignment only ever picks
  among positions the grid-only gesture could have produced -- so at ALIGN_SNAP_PX = 10 it moves a
  landing only while 10 CSS px is more than half a grid step, below z = 1.25. Most of the gestures
  here therefore run at z = 0.5, where the reach is 20 world units against the grid's 8, and every
  one is built so that the grid alone lands 16 units from the alignment. One runs at z = 1 and one
  at z = 2, either side of that line.

  The camera sits at the origin, so a world point is (world * z) canvas pixels. Every raw distance
  below leaves at least 6 world units to both the grid's rounding boundary and the snap reach, so a
  pointer rounded to a whole CSS pixel still lands the same way.
*/

const t = suite('align');
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
 * Load a document with nothing selected, the pointer tool, and the camera at 0,0 at zoom `z`.
 * Wires go in by a second commit, on top of the first one's dump, as `groups.mjs` does.
 */
async function seed(shapes, z = 0.5) {
  await page.evaluate(
    ([list, zoom]) => {
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
      window.__view.z = zoom;
      window.__view.camX = 0;
      window.__view.camY = 0;
    },
    [shapes, z],
  );
  await page.waitForTimeout(250);
}

const box = await diagramCanvas(page).boundingBox();
const shape = (name) =>
  page.evaluate((n) => {
    const s = window.__scene.shapes.find((o) => o.name === n);
    return s === undefined ? null : window.__ops(s.kind).bounds(s);
  }, name);
const last = () =>
  page.evaluate(() => {
    const s = window.__scene.shapes.at(-1);
    return { kind: s.kind, ...window.__ops(s.kind).bounds(s) };
  });
const parentOf = (name) =>
  page.evaluate((n) => window.__hierarchy.hierarchyOf(window.__scene.shapes).parentOf(n), name);
const undoLabel = () => page.evaluate(() => window.__scene.history.undoLabel);
const select = async (list) => {
  await page.evaluate((l) => window.__scene.setSelection(new Set(l)), list);
  await page.waitForTimeout(120);
};
const at = async (x, y) => {
  const p = await toCanvas(page, x, y);
  return { x: box.x + p.x, y: box.y + p.y };
};
async function press(x, y) {
  const p = await at(x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
}
async function moveTo(x, y) {
  const p = await at(x, y);
  await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.waitForTimeout(150);
}
async function release() {
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Whether a guide is drawn through world point (x, y): a rose pixel within 3 device pixels of it,
 * looking across the line. `axis` is the guide's: `y` for a horizontal line at that y.
 *
 * Rose is (251, 113, 133). The test excludes amber (a selected outline, g 191), blue (a plain one,
 * r 96), the grid's greys and the dark background.
 */
const guideThrough = (x, y, axis) =>
  page.evaluate(
    ([wx, wy, ax]) => {
      const v = window.__view;
      const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
      const p = v.toScreen({ x: wx, y: wy });
      const cx = Math.round(p.x * v.dpr);
      const cy = Math.round(p.y * v.dpr);
      for (let k = -3; k <= 3; k++) {
        const d =
          ax === 'y'
            ? g.getImageData(cx, cy + k, 1, 1).data
            : g.getImageData(cx + k, cy, 1, 1).data;
        if (d[0] > 200 && d[1] > 80 && d[1] < 150 && d[2] > 100 && d[2] < 170) return true;
      }
      return false;
    },
    [x, y, axis],
  );

/**
 * Down a vertical guide at world x, from y0 to y1: how many device rows there are, and in how many
 * the line is rose. Looks only at the line's own two device columns, so a ghost outline stroked
 * over the same pixels reads as a gap.
 */
const guideDown = (x, y0, y1) =>
  page.evaluate(
    ([wx, a, b]) => {
      const v = window.__view;
      const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
      const top = v.toScreen({ x: wx, y: a });
      const bottom = v.toScreen({ x: wx, y: b });
      const cx = Math.round(top.x * v.dpr);
      let rows = 0;
      let rose = 0;
      for (let y = Math.round(top.y * v.dpr); y <= Math.round(bottom.y * v.dpr); y++) {
        rows++;
        const d = g.getImageData(cx - 1, y, 2, 1).data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 200 && d[i + 1] > 80 && d[i + 1] < 150 && d[i + 2] > 100 && d[i + 2] < 170) {
            rose++;
            break;
          }
        }
      }
      return { rows, rose };
    },
    [x, y0, y1],
  );

t.ok('the alignment hook is there', await page.evaluate(() => typeof window.__align === 'object'));
t.ok(
  'the canvas is big enough for every gesture here',
  box.width >= 400 && box.height >= 300,
  JSON.stringify(box),
);

/* -------------------------------------------------------------------- the index ---- */
{
  await seed([
    rect('A', 64, 64, 96, 64),
    rect('B', 64, 192, 160, 64),
    rect('G', 400, 64, 400, 320, 2),
    rect('C', 432, 96, 64, 64),
    rect('D', 560, 96, 96, 64),
    wire('w', ['A', 's'], ['B', 'n']),
  ]);
  const model = await page.evaluate(() => {
    const al = window.__align;
    if (al === undefined) return null;
    const shapes = window.__scene.shapes;
    const idx = al.alignIndex(shapes, new Set());
    const keys = (m) => [...m.keys()].sort((a, b) => a - b);
    const root = idx.targetsOf(null);
    const g = idx.targetsOf('G');
    return {
      kinds: shapes.map((s) => s.kind).sort(),
      rootEdges: keys(root.x.edge),
      rootMids: keys(root.x.mid),
      rootYEdges: keys(root.y.edge),
      span64: root.x.edge.get(64) ?? null,
      gEdges: keys(g.x.edge),
      gMids: keys(g.x.mid),
      inG: idx.parentFor({ x: 440, y: 180, w: 16, h: 16 }, shapes.length),
      outside: idx.parentFor({ x: 240, y: 300, w: 16, h: 16 }, shapes.length),
      skipped: keys(al.alignIndex(shapes, new Set(['A'])).targetsOf(null).x.edge),
    };
  });
  t.ok(
    'the seed has its wire, and G its two interfaces',
    model !== null &&
      model.kinds.filter((k) => k === 'conn').length === 1 &&
      model.kinds.filter((k) => k === 'nif').length === 2,
    JSON.stringify(model?.kinds),
  );
  t.ok(
    'two siblings sharing a left edge give one stop, spanning both',
    model !== null && JSON.stringify(model.span64) === JSON.stringify({ from: 64, to: 256 }),
    JSON.stringify(model?.span64),
  );
  t.ok(
    "the top level's targets are its placed shapes' edges only: no wire, no interface, no child",
    model !== null && JSON.stringify(model.rootEdges) === JSON.stringify([64, 160, 224, 400, 800]),
    JSON.stringify(model?.rootEdges),
  );
  t.ok(
    'medians are kept apart from edges',
    model !== null && JSON.stringify(model.rootMids) === JSON.stringify([112, 144, 600]),
    JSON.stringify(model?.rootMids),
  );
  t.ok(
    "a block's targets are its children's, and not its own",
    model !== null &&
      JSON.stringify(model.gEdges) === JSON.stringify([432, 496, 560, 656]) &&
      JSON.stringify(model.gMids) === JSON.stringify([464, 608]),
    JSON.stringify({ edges: model?.gEdges, mids: model?.gMids }),
  );
  t.ok(
    'a skipped shape is no target, and a coordinate it shared survives through the other',
    model !== null && JSON.stringify(model.skipped) === JSON.stringify([64, 224, 400, 800]),
    JSON.stringify(model?.skipped),
  );
  t.ok(
    'parentFor answers for bounds that are not in the scene',
    model?.inG === 'G' && model?.outside === null,
    JSON.stringify({ inG: model?.inG, outside: model?.outside }),
  );

  const pure = await page.evaluate(() => {
    const al = window.__align;
    if (al === undefined) return null;
    const idx = al.alignIndex(window.__scene.shapes, new Set());
    return {
      free: al.featuresOf({ x: 0, y: 0, w: 32, h: 16 }, 'x', null),
      pinnedLow: al.featuresOf({ x: 0, y: 0, w: 32, h: 16 }, 'x', 0),
      flipped: al.featuresOf({ x: 0, y: 0, w: 32, h: 16 }, 'x', 32),
      point: al.featuresOf({ x: 8, y: 0, w: 0, h: 16 }, 'x', null),
      tight: al.magnet(5, 8, (g) => g !== 0),
      tightAny: al.magnet(5, 8, () => true),
      reach: al.magnet(5, 20, (g) => g === 16),
      beyond: al.magnet(5, 20, (g) => g === -16),
      tie: al.magnet(8, 8, () => true),
      guides: al.guidesFor(
        idx.targetsOf(null),
        { x: 64, y: 320, w: 32, h: 32 },
        { x: true, y: true },
      ),
    };
  });
  t.ok(
    'a free axis moves both edges and the median; a pinned one the other edge, even flipped',
    pure !== null &&
      JSON.stringify(pure.free.map((f) => [f.at, f.role])) ===
        JSON.stringify([
          [0, 'edge'],
          [16, 'mid'],
          [32, 'edge'],
        ]) &&
      JSON.stringify(pure.pinnedLow.map((f) => f.at)) === JSON.stringify([32, 16]) &&
      JSON.stringify(pure.flipped.map((f) => f.at)) === JSON.stringify([0, 16]) &&
      JSON.stringify(pure.point) === JSON.stringify([{ at: 8, role: 'edge' }]),
    JSON.stringify(pure && { free: pure.free, pinnedLow: pure.pinnedLow, flipped: pure.flipped }),
  );
  t.ok(
    'within half a grid step the magnet can only give the grid point',
    pure !== null && pure.tight === null && pure.tightAny === 0,
    JSON.stringify(pure && { tight: pure.tight, tightAny: pure.tightAny }),
  );
  t.ok(
    'beyond it, it reaches the next grid point within the tolerance and no further',
    pure !== null && pure.reach === 16 && pure.beyond === null,
    JSON.stringify(pure && { reach: pure.reach, beyond: pure.beyond }),
  );
  t.ok('a tie goes to the grid point', pure?.tie === 16, JSON.stringify(pure?.tie));
  t.ok(
    'one guide over two targets on one coordinate, reaching both and the source',
    pure !== null &&
      JSON.stringify(pure.guides) === JSON.stringify([{ axis: 'x', at: 64, from: 64, to: 352 }]),
    JSON.stringify(pure?.guides),
  );
}

/* --------------------------------------------------------------------------- move ---- */
{
  const scene = [rect('T', 64, 96, 96, 64), rect('S', 320, 256, 64, 64)];
  await seed(scene);
  // Raw -146: the grid alone gives -144, 16 short of T's top; -160 is 14 away, inside 20.
  await press(352, 288);
  await moveTo(352, 142);
  const held = await guideThrough(240, 96, 'y');
  await release();
  const s = await shape('S');
  const label = await undoLabel();
  t.ok(
    "a move lands S's top on T's top where the grid alone lands 16 away",
    s?.y === 96 && s?.x === 320 && label === 'move',
    JSON.stringify({ s, label }),
  );
  t.ok('a guide runs through the gap between them while the button is held', held);
  t.ok('and is gone once it is released', !(await guideThrough(240, 96, 'y')));

  await page.evaluate(() => window.__host.undo());
  await page.waitForTimeout(150);
  t.ok(
    'one undo puts it back exactly',
    JSON.stringify(await shape('S')) === JSON.stringify({ x: 320, y: 256, w: 64, h: 64 }),
    JSON.stringify(await shape('S')),
  );

  await press(352, 288);
  await moveTo(352, 142);
  const again = await guideThrough(240, 96, 'y');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const escaped = await guideThrough(240, 96, 'y');
  await release();
  t.ok(
    'Escape mid-drag takes the guide and the move away',
    again && !escaped && (await shape('S'))?.y === 256,
    JSON.stringify({ again, escaped, s: await shape('S') }),
  );

  // Widths 96 and 32: both medians sit on the grid. Raw -210: the grid gives -208, which puts
  // S's LEFT edge on T's median -- no match, edges only meet edges -- and -224 is 14 away.
  await seed([rect('T', 64, 96, 96, 64), rect('S', 320, 256, 32, 64)]);
  await press(336, 288);
  await moveTo(126, 288);
  await release();
  const m = await shape('S');
  t.ok(
    'medians align: S centred under T, where the grid alone put its left edge on the median',
    m?.x === 96,
    JSON.stringify(m),
  );

  // Widths 96 and 80: centring S would need x = 72, off the grid, so it is never offered. The
  // press is on a grid point, not S's centre (360), which sits half-way between two.
  await seed([rect('T', 64, 96, 96, 64), rect('S', 320, 256, 80, 64)]);
  await press(352, 288);
  await moveTo(104, 288);
  await release();
  const o = await shape('S');
  t.ok(
    'an alignment that would leave the grid is never taken',
    o !== null && o.x % 16 === 0 && o.x + o.w / 2 !== 112,
    JSON.stringify(o),
  );
}

/* -------------------------------------------------------------- siblings only ---- */
{
  // C is G's only child. G's left edge (64) and R's top (112) each sit 14 from where C's raw
  // drag puts it, within reach -- but neither is C's sibling.
  await seed([
    rect('G', 64, 64, 480, 320),
    rect('C', 192, 192, 64, 64),
    rect('R', 640, 112, 96, 64),
  ]);
  await press(224, 224);
  await moveTo(110, 130);
  await release();
  const c = await shape('C');
  t.ok(
    "a child aligns neither with its parent's edge nor with a block outside its group",
    c?.x === 80 && c?.y === 96,
    JSON.stringify(c),
  );

  // T's right edge is at 336, inside G. C's raw drag rounds to x = 320, flush with G's right
  // border; x = 336 would put C's left edge on T's right but carry it out of G.
  await seed([
    rect('G', 64, 64, 320, 256),
    rect('T', 272, 96, 64, 64),
    rect('C', 192, 224, 64, 64),
  ]);
  await press(224, 256);
  await moveTo(358, 256);
  await release();
  const inG = await shape('C');
  t.ok(
    'a snap that would carry the shape out of its group is refused',
    inG?.x === 320 && (await parentOf('C')) === 'G',
    JSON.stringify({ c: inG, parent: await parentOf('C') }),
  );
}

/* ------------------------------------------------------------------------- resize ---- */
{
  // S's east edge, raw 146: the grid gives 144, and T's right edge at 160 is 14 away.
  await seed([rect('T', 64, 96, 96, 64), rect('S', 64, 256, 64, 64)]);
  await select(['S']);
  await press(128, 288);
  await moveTo(146, 288);
  await release();
  const e = await shape('S');
  t.ok(
    'a resize puts the moving edge on a sibling edge',
    e?.x === 64 && e?.w === 96 && (await undoLabel()) === 'resize',
    JSON.stringify(e),
  );

  // T's median is at 192. With S's west edge pinned at 96, a median at 192 wants the east edge
  // at 288; raw 274 rounds to 272.
  await seed([rect('T', 160, 96, 64, 64), rect('S', 96, 256, 64, 64)]);
  await select(['S']);
  await press(160, 288);
  await moveTo(274, 288);
  await release();
  const mid = await shape('S');
  t.ok(
    'a resize centres the shape on a sibling, moving the edge twice as far',
    mid?.x === 96 && mid?.w === 192,
    JSON.stringify(mid),
  );

  // A ⇧ corner drag keeps its square: the snap is left out of it.
  await seed([rect('T', 400, 96, 64, 64), rect('S', 320, 256, 64, 64)]);
  await select(['S']);
  await press(384, 320);
  await moveTo(390, 330);
  await page.keyboard.down('Shift');
  await moveTo(386, 350);
  await release();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  const sq = await shape('S');
  t.ok('a ⇧ corner resize stays square', sq !== null && sq.w === sq.h, JSON.stringify(sq));
  await page.evaluate(() => window.__host.setTool('pointer'));
}

/* ------------------------------------------------------------------------- create ---- */
{
  // The anchor at (208, 256) lines up with nothing. Raw x 146: the grid gives 144, and T's right
  // edge at 160 is 14 away.
  await seed([rect('T', 64, 96, 96, 64)]);
  await page.evaluate(() => window.__host.setTool('rect'));
  await press(208, 256);
  await moveTo(146, 330);
  // The ghost's own left edge, x = 160 from y 256 to 336, is where the guide runs. Inset by a cell
  // either end, clear of the corners.
  const along = await guideDown(160, 272, 320);
  await release();
  const r = await last();
  t.ok(
    "drawing a block puts its moving edge on a sibling's",
    r.kind === 'rect' && r.x === 160 && r.w === 48 && r.y === 256 && r.h === 80,
    JSON.stringify(r),
  );
  t.ok(
    "the guide is drawn over the ghost, unbroken down the ghost's dashed edge",
    along.rows > 40 && along.rose === along.rows,
    JSON.stringify(along),
  );

  await seed([rect('T', 64, 96, 96, 64)]);
  await page.evaluate(() => window.__host.setTool('fifo'));
  await press(208, 256);
  await moveTo(146, 290);
  await release();
  const q = await last();
  t.ok(
    'and so does drawing a queue, checked against the queue it really makes',
    q.kind === 'fifo' && q.x === 160 && q.w === 48 && q.h === 32,
    JSON.stringify(q),
  );
  await page.evaluate(() => window.__host.setTool('pointer'));
}

/* ------------------------------------------------------------------ either side of 1.25 ---- */
{
  // z = 1: the reach is 10 against the grid's 8. S sits level with T; a 9-unit drag would round
  // to 16, but 0 is within 10 and keeps S aligned, so nothing moves and nothing is recorded.
  await seed([rect('T', 64, 96, 96, 64), rect('S', 320, 96, 64, 64)], 1);
  await press(352, 128);
  await moveTo(352, 137);
  await release();
  const s = await shape('S');
  t.ok(
    'at z = 1 a short drag from an aligned position stays aligned and records nothing',
    s?.y === 96 && (await undoLabel()) === 'seed',
    JSON.stringify({ s, label: await undoLabel() }),
  );

  // z = 2: the reach is 5, so the grid decides every landing. Raw -66 rounds to -64, though -80
  // would align S with T.
  await seed([rect('T', 32, 48, 48, 32), rect('S', 160, 128, 32, 32)], 2);
  await press(176, 144);
  await moveTo(176, 78);
  await release();
  const z2 = await shape('S');
  t.ok("at z = 2 the landing is the grid's own", z2?.y === 64, JSON.stringify(z2));

  // And a landing the grid happens to align still says so. Raw -78 rounds to -80: level with T.
  await page.evaluate(() => window.__host.undo());
  await page.waitForTimeout(150);
  await press(176, 144);
  await moveTo(176, 66);
  const shown = await guideThrough(120, 48, 'y');
  await release();
  t.ok(
    'a guide shows when plain grid snapping lines the shape up',
    shown && (await shape('S'))?.y === 48,
    JSON.stringify({ shown, s: await shape('S') }),
  );
}

t.ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const code = t.report(errors);
await browser.close();
process.exit(code);
