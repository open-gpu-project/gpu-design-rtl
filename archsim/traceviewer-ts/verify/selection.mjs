import {
  DEV_URL,
  diagramCanvas,
  drawBlock,
  drawConnection,
  marqueeSelect,
  open,
  suite,
} from './harness.mjs';

/*
  Marquee selection and the clipboard, for iteration 5-2.

  Two halves with different needs. The naming and fragment rules are pure functions of a
  document and a name set, so they are driven directly through `window.__fragment` and
  `window.__names` -- a real pointer would add nothing but flake. The band itself is a pointer
  gesture and has to be swept for real, because the whole point of the seam under it is that
  the shapes that light up are the ones under the rectangle that was painted.

  Every group resets the camera with `zoomToFit`, not `resetZoom`: the latter restores the zoom
  and leaves the pan wherever the previous group's gestures put it, which culled the shapes
  under test twice while this file was being written.
*/

const t = suite('selection');
const { browser, page, errors } = await open(DEV_URL);

const fit = () => page.evaluate(() => window.__host.zoomToFit());
const names = () => page.evaluate(() => window.__scene.shapes.map((s) => s.name));
const selection = () => page.evaluate(() => [...window.__scene.selection].sort());
const kinds = () => page.evaluate(() => window.__scene.shapes.map((s) => s.kind));
/**
 * A band in canvas CSS pixels around the rect at each of `indices`, padded by 8 screen px.
 *
 * Computed from the live camera rather than from the coordinates the blocks were drawn at:
 * every group starts with `zoomToFit`, which moves both the pan and the zoom, so a hard-coded
 * band lands somewhere else entirely by the time it is swept.
 */
const bandOver = (indices) =>
  page.evaluate((idx) => {
    const v = window.__view;
    const rects = window.__scene.shapes.filter((s) => s.kind === 'rect');
    const picked = idx.map((i) => rects[i]);
    const pad = 8 / v.z;
    const x0 = Math.min(...picked.map((s) => s.x)) - pad;
    const y0 = Math.min(...picked.map((s) => s.y)) - pad;
    const x1 = Math.max(...picked.map((s) => s.x + s.w)) + pad;
    const y1 = Math.max(...picked.map((s) => s.y + s.h)) + pad;
    const p = (wx, wy) => [(wx - v.camX) * v.z, (wy - v.camY) * v.z];
    return [...p(x0, y0), ...p(x1, y1)];
  }, indices);

const conns = () =>
  page.evaluate(() =>
    window.__scene.shapes
      .filter((s) => s.kind === 'conn')
      .map((s) => ({ name: s.name, from: s.from, to: s.to })),
  );

/* ----------------------------------------------------------------------------- N: names ---- */
/*
  The naming rule, as a pure function. `block0, block2, block4, block6` copied onto themselves
  must come back as `block1, block3, block5, block7` -- the whole of the user-facing rule, as
  one exact check rather than four separate ones that could each pass for the wrong reason.

  The `block999` case is the one that killed the obvious implementation. Searching for the
  lowest free number for the prefix, rather than from the copied number upward, pastes a copy
  of `block999` into a scene holding `block0` as `block1`: free, lowest, and a different block
  as far as anyone reading the diagram is concerned.
*/
const mint = (desired, taken) =>
  page.evaluate(([d, tk]) => window.__names.nextFreeIndexedName(d, new Set(tk)), [desired, taken]);

const series = await page.evaluate(() => {
  const live = ['block0', 'block2', 'block4', 'block6'];
  const taken = new Set([...live, ...live]);
  return live.map((n) => {
    const got = window.__names.nextFreeIndexedName(n, taken);
    taken.add(got);
    return got;
  });
});
t.ok(
  'a copied series fills its own gaps: block0,2,4,6 -> block1,3,5,7',
  JSON.stringify(series) === JSON.stringify(['block1', 'block3', 'block5', 'block7']),
  JSON.stringify(series),
);

t.ok(
  'a copy stays near its original rather than falling to the bottom of the range',
  (await mint('block999', ['block0', 'block999'])) === 'block1000',
  await mint('block999', ['block0', 'block999']),
);
t.ok(
  'the number never goes backwards, so block1 copies to block2 and not block0',
  (await mint('block1', ['block1'])) === 'block2',
  await mint('block1', ['block1']),
);
t.ok(
  'zero padding is preserved, since it is how the series was written',
  (await mint('block007', ['block007'])) === 'block008',
  await mint('block007', ['block007']),
);
t.ok(
  'a name with no trailing digits still falls back to the _N form',
  (await mint('alu', ['alu'])) === 'alu_2',
  await mint('alu', ['alu']),
);
t.ok(
  'a free name is returned untouched, so a paste into a fresh document keeps its names',
  (await mint('block3', ['block1'])) === 'block3',
  await mint('block3', ['block1']),
);
t.ok(
  'a digit run too long to count in does not hang, it falls back',
  (await mint('block99999999999999999999', ['block99999999999999999999'])) ===
    'block99999999999999999999_2',
  await mint('block99999999999999999999', ['block99999999999999999999']),
);

/* ------------------------------------------------------------------------- F: fragments ---- */
/*
  `readFragment` against hand-built documents, where the scene cannot get in the way.

  The capture case is the one to keep. Minting only against the LIVE names lets a copy of
  `block0` take the name `block1` -- which is another, still-unrenamed shape in the same
  fragment -- and the rename sweep for `block1` then rewrites the endpoint the first sweep just
  wrote. Both ends land on one block. `pruneOrphans` cannot catch it, because that block does
  exist, so the scene ends up holding a connection `connOps.normalize` says cannot exist.
*/
const capture = await page.evaluate(() => {
  const doc = {
    version: 2,
    shapes: [
      {
        kind: 'rect',
        name: 'block0',
        label: '',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        position: [0, 0],
        size: [64, 48],
      },
      {
        kind: 'rect',
        name: 'block1',
        label: '',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        position: [160, 0],
        size: [64, 48],
      },
      {
        kind: 'conn',
        name: 'conn0',
        label: '',
        description: '',
        labelOffset: [0, 0],
        routing: 'auto',
        points: [
          [64, 24],
          [160, 24],
        ],
        source: ['block0', 'e'],
        target: ['block1', 'w'],
      },
    ],
  };
  const out = window.__fragment.readFragment(doc, new Set(['block0']));
  return out.map((s) =>
    s.kind === 'conn' ? { n: s.name, from: s.from, to: s.to } : { n: s.name },
  );
});
t.ok(
  'a minted name never lands on a fragment name that has not been renamed yet',
  capture.length === 3 &&
    capture[2].from !== capture[2].to &&
    capture[2].from === 'block2' &&
    capture[2].to === 'block1',
  JSON.stringify(capture),
);

const freeDoc = await page.evaluate(() => {
  const doc = {
    version: 2,
    shapes: [
      {
        kind: 'rect',
        name: 'alpha',
        label: '',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        position: [0, 0],
        size: [64, 48],
      },
      {
        kind: 'rect',
        name: 'beta',
        label: '',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        position: [160, 0],
        size: [64, 48],
      },
    ],
  };
  return window.__fragment.readFragment(doc, new Set(['zeta'])).map((s) => s.name);
});
t.ok(
  'a fragment sharing no names with the scene keeps every one of them',
  JSON.stringify(freeDoc) === JSON.stringify(['alpha', 'beta']),
  JSON.stringify(freeDoc),
);

/*
  Dependency order is established by `copyFragment`, not repaired by `readFragment`, because
  reordering raw records would mean knowing which keys of a bag hold names -- exactly the
  kind-specific knowledge the `renameRef` route exists to avoid.

  So the guarantee under test is that a copy taken from an inverted z-order still emits its
  blocks first. `bringToFront` on a block puts it after the wires, and `deserializeScene` is
  single-pass: a wire whose endpoint has not been built yet loses its `source`/`target` write
  and is then dropped as degenerate, with nothing raised anywhere.
*/
const ordered = await page.evaluate(() => {
  const rect = (name, x) => ({
    kind: 'rect',
    name,
    label: '',
    subtitle: '',
    labelMode: 'inset',
    description: '',
    position: [x, 0],
    size: [64, 48],
  });
  const conn = {
    kind: 'conn',
    name: 'c0',
    label: '',
    description: '',
    labelOffset: [0, 0],
    routing: 'auto',
    points: [
      [64, 24],
      [160, 24],
    ],
    source: ['a', 'e'],
    target: ['b', 'w'],
  };
  // Load it in the good order, then re-copy from a deliberately inverted array.
  const loaded = window.__fragment.readFragment(
    { version: 2, shapes: [rect('a', 0), rect('b', 160), conn] },
    new Set(),
  );
  const inverted = [...loaded].reverse();
  const doc = window.__fragment.copyFragment(inverted, new Set(inverted.map((x) => x.name)));
  const kinds = doc === null ? [] : doc.shapes.map((x) => x.kind);
  const back = doc === null ? [] : window.__fragment.readFragment(doc, new Set());
  return { loaded: loaded.length, kinds, back: back.map((x) => x.kind) };
});
t.ok(
  'a copy taken from an inverted z-order still emits its blocks before its wires',
  ordered.loaded === 3 &&
    ordered.kinds.indexOf('conn') === ordered.kinds.length - 1 &&
    ordered.back.filter((k) => k === 'conn').length === 1,
  JSON.stringify(ordered),
);

/* --------------------------------------------------------------------------- B: the band ---- */
/*
  The real pointer. Three blocks in a row, so a band can take a strict subset and the answer
  cannot be produced by a bug that simply selects everything.
*/
await fit();
await drawBlock(page, 120, 120, 200, 180);
await drawBlock(page, 260, 120, 340, 180);
await drawBlock(page, 400, 120, 480, 180);
await fit();

await marqueeSelect(page, ...(await bandOver([0, 1])));
t.ok(
  'a band takes exactly the shapes under it, and not the one beyond',
  (await selection()).length === 2,
  JSON.stringify(await selection()),
);

const before = await selection();
await marqueeSelect(page, ...(await bandOver([2])), { shift: true });
const after = await selection();
t.ok(
  'shift-dragging adds to the selection instead of replacing it',
  after.length === 3 && before.every((n) => after.includes(n)),
  `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
);

await page.evaluate(() => window.__scene.setSelection(new Set()));
const box = await diagramCanvas(page).boundingBox();
const [cx, cy] = await bandOver([0]);
await page.keyboard.press('Digit2');
await page.mouse.move(box.x + cx, box.y + cy);
await page.mouse.down();
await page.mouse.move(box.x + cx + 1, box.y + cy);
await page.mouse.up();
await page.waitForTimeout(200);
t.ok(
  'a press that never travels is a click, not a one-pixel band',
  (await selection()).length === 0,
  JSON.stringify(await selection()),
);

await marqueeSelect(page, ...(await bandOver([0, 1])));
const kept = await selection();
const [ex, ey, ex2, ey2] = await bandOver([0, 1, 2]);
await page.keyboard.press('Digit2');
await page.mouse.move(box.x + ex, box.y + ey);
await page.mouse.down();
await page.mouse.move(box.x + ex2, box.y + ey2, { steps: 6 });
await page.keyboard.press('Escape');
await page.mouse.up();
await page.waitForTimeout(200);
t.ok(
  'Escape mid-band puts the selection back the way it was found',
  kept.length === 2 && JSON.stringify(await selection()) === JSON.stringify(kept),
  `${JSON.stringify(kept)} -> ${JSON.stringify(await selection())}`,
);

/* ------------------------------------------------------------- W: the band and the wire ---- */
/*
  The `intersects` seam. A connection's bounds is the box around its whole route, so for an
  L-shaped wire that box covers a large region the wire does not occupy. A band dropped in the
  empty corner must not select it; a band across the run must.
*/
await page.evaluate(() => {
  window.__scene.commit('reset', () => {
    window.__scene.shapes = [];
    window.__scene.setSelection(new Set());
  });
});
await fit();
await drawBlock(page, 120, 120, 200, 180);
await drawBlock(page, 400, 300, 480, 360);
await drawConnection(page, 200, 150, 400, 330);
await page.keyboard.press('Digit1');
await fit();

const wireBox = await page.evaluate(() => {
  const conn = window.__scene.shapes.find((s) => s.kind === 'conn');
  return conn === undefined ? null : { pts: conn.points.map((p) => [p.x, p.y]) };
});
t.ok('an L-shaped wire exists to test against', wireBox !== null, JSON.stringify(wireBox));

const cornerHit = await page.evaluate(() => {
  const conn = window.__scene.shapes.find((s) => s.kind === 'conn');
  const xs = conn.points.map((p) => p.x);
  const ys = conn.points.map((p) => p.y);
  // The bbox corner farthest from the elbow: inside `bounds`, nowhere near any run.
  const probe = { x: Math.min(...xs) + 2, y: Math.max(...ys) - 2 };
  const band = { x: probe.x - 6, y: probe.y - 6, w: 12, h: 12 };
  const inBounds =
    band.x < Math.max(...xs) &&
    band.x + band.w > Math.min(...xs) &&
    band.y < Math.max(...ys) &&
    band.y + band.h > Math.min(...ys);
  const caught = window.__bounds
    .shapesInRect(window.__scene.shapes, band)
    .some((s) => s.kind === 'conn');
  return { inBounds, caught };
});
t.ok(
  'a band inside the wire bbox but off every run does not select the wire',
  cornerHit.inBounds === true && cornerHit.caught === false,
  JSON.stringify(cornerHit),
);

const runHit = await page.evaluate(() => {
  const conn = window.__scene.shapes.find((s) => s.kind === 'conn');
  const a = conn.points[0];
  const b = conn.points[1];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const band = { x: mid.x - 4, y: mid.y - 4, w: 8, h: 8 };
  return window.__bounds.shapesInRect(window.__scene.shapes, band).some((s) => s.kind === 'conn');
});
t.ok('a band across an actual run does select the wire', runHit === true, String(runHit));

/* ------------------------------------------------------------------------ G: group move ---- */
/*
  Group move already worked before this iteration; it simply had no assertion. Dragging one
  member of a multi-selection must move every member by the same vector.
*/
await fit();
await page.evaluate(() => {
  const sc = window.__scene;
  sc.setSelection(new Set(sc.shapes.filter((s) => s.kind === 'rect').map((s) => s.name)));
});
const posBefore = await page.evaluate(() =>
  window.__scene.shapes.filter((s) => s.kind === 'rect').map((s) => [s.name, s.x, s.y]),
);
const gbox = await diagramCanvas(page).boundingBox();
const grab = await page.evaluate(() => {
  const s = window.__scene.shapes.find((o) => o.kind === 'rect');
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
});
const toScreen = await page.evaluate(
  ([wx, wy]) => {
    const v = window.__view;
    return [(wx - v.camX) * v.z, (wy - v.camY) * v.z];
  },
  [grab.x, grab.y],
);
await page.keyboard.press('Digit1');
await page.mouse.move(gbox.x + toScreen[0], gbox.y + toScreen[1]);
await page.mouse.down();
await page.mouse.move(gbox.x + toScreen[0] + 64, gbox.y + toScreen[1] + 32, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const posAfter = await page.evaluate(() =>
  window.__scene.shapes.filter((s) => s.kind === 'rect').map((s) => [s.name, s.x, s.y]),
);
const deltas = posBefore.map((p, i) => [posAfter[i][1] - p[1], posAfter[i][2] - p[2]]);
t.ok(
  'dragging one member of a multi-selection moves every member by one vector',
  deltas.length > 1 &&
    deltas.every((d) => d[0] === deltas[0][0] && d[1] === deltas[0][1]) &&
    (deltas[0][0] !== 0 || deltas[0][1] !== 0),
  JSON.stringify(deltas),
);

/* ------------------------------------------------------------------------- C: clipboard ---- */
/*
  Copy and paste over a real scene. The wire is the point: a pasted connection must join the
  COPIES, because one that quietly re-attached to the originals looks right on screen until
  you move something.
*/
await page.evaluate(() => {
  window.__scene.commit('reset', () => {
    window.__scene.shapes = [];
    window.__scene.setSelection(new Set());
  });
});
await fit();
await drawBlock(page, 120, 120, 200, 180);
await drawBlock(page, 400, 120, 480, 180);
await drawConnection(page, 200, 150, 400, 150);
await page.keyboard.press('Digit1');
await fit();

const baseNames = await names();
t.ok(
  'the scene under test is two blocks and a wire',
  (await kinds()).filter((k) => k === 'rect').length === 2 &&
    (await kinds()).filter((k) => k === 'conn').length === 1,
  JSON.stringify(await kinds()),
);

await page.evaluate(() => {
  const sc = window.__scene;
  sc.setSelection(new Set(sc.shapes.map((s) => s.name)));
  window.__host.copySelection();
  window.__host.paste();
});
await page.waitForTimeout(250);

const afterPaste = await conns();
t.ok(
  'pasting a wired pair yields a second wired pair',
  (await kinds()).filter((k) => k === 'rect').length === 4 && afterPaste.length === 2,
  JSON.stringify(await names()),
);
t.ok(
  'and the pasted wire joins the copies, not the originals',
  afterPaste.length === 2 &&
    !baseNames.includes(afterPaste[1].from) &&
    !baseNames.includes(afterPaste[1].to),
  JSON.stringify(afterPaste),
);

const undoOnce = await page.evaluate(() => {
  window.__host.undo();
  return window.__scene.shapes.map((s) => s.name);
});
t.ok(
  'a paste is one history entry, and undo removes exactly what it added',
  JSON.stringify(undoOnce) === JSON.stringify(baseNames),
  `${JSON.stringify(baseNames)} -> ${JSON.stringify(undoOnce)}`,
);
await page.evaluate(() => window.__host.redo());

/*
  Half a wire. Copying one block of a connected pair must paste the block alone -- a wire with
  one end left behind is not something the fragment can put back.
*/
const halfPaste = await page.evaluate(() => {
  const sc = window.__scene;
  const before = sc.shapes.filter((s) => s.kind === 'conn').length;
  sc.setSelection(new Set([sc.shapes.find((s) => s.kind === 'rect').name]));
  window.__host.copySelection();
  window.__host.paste();
  return { before, after: sc.shapes.filter((s) => s.kind === 'conn').length };
});
t.ok(
  'copying one end of a wire pastes the block and no wire',
  halfPaste.after === halfPaste.before,
  JSON.stringify(halfPaste),
);

/*
  Cut is one entry, and it restores the original names on the way back: the cut names are no
  longer live, so the fragment keeps them rather than minting copies.

  The label is read immediately after the cut. Reading it after the paste would only ever see
  `paste`, which is an assertion that cannot fail.
*/
const cutBack = await page.evaluate(() => {
  const sc = window.__scene;
  const was = sc.shapes.map((s) => s.name).sort();
  sc.setSelection(new Set(sc.shapes.map((s) => s.name)));
  window.__host.cutSelection();
  const label = sc.history.undoLabel;
  const emptied = sc.shapes.length;
  window.__host.paste();
  return { was, label, emptied, back: sc.shapes.map((s) => s.name).sort() };
});
t.ok(
  'cut empties the scene as one entry labelled `cut`',
  cutBack.emptied === 0 && cutBack.label === 'cut',
  JSON.stringify(cutBack),
);
t.ok(
  'and pasting it back restores the very same names, not copies of them',
  JSON.stringify(cutBack.back) === JSON.stringify(cutBack.was),
  `${JSON.stringify(cutBack.was)} -> ${JSON.stringify(cutBack.back)}`,
);

/*
  A manual route must arrive congruent to the one it was copied from: every point shifted by
  the same vector. This is what fails first if the paste offset is ever snapped per shape
  instead of once for the whole fragment -- a sheared fragment pulls a manual route off its own
  endpoints, and `patchStart`/`patchEnd` then drag the end runs to compensate.

  On a scene of its own, because the earlier groups leave several connections behind and
  "the last one" would not reliably be the copy of the one under test.
*/
await page.evaluate(() => {
  window.__scene.commit('reset', () => {
    window.__scene.shapes = [];
    window.__scene.setSelection(new Set());
  });
});
await fit();
await drawBlock(page, 120, 120, 200, 180);
await drawBlock(page, 400, 300, 480, 360);
await drawConnection(page, 200, 150, 400, 330);
await page.keyboard.press('Digit1');
await fit();

const congruent = await page.evaluate(() => {
  const sc = window.__scene;
  const src = sc.shapes.find((s) => s.kind === 'conn');
  if (src === undefined) return { skipped: true };
  sc.commit('manual', () => {
    sc.shapes = sc.shapes.map((s) => (s === src ? { ...s, routing: 'manual' } : s));
  });
  const pts = sc.shapes.find((s) => s.kind === 'conn').points.map((p) => [p.x, p.y]);

  sc.setSelection(new Set(sc.shapes.map((s) => s.name)));
  window.__host.copySelection();
  window.__host.paste();

  const all = sc.shapes.filter((s) => s.kind === 'conn');
  if (all.length !== 2) return { count: all.length };
  const made = all[1];
  if (made.points.length !== pts.length) return { lengths: [made.points.length, pts.length] };
  const ds = made.points.map((p, i) => [p.x - pts[i][0], p.y - pts[i][1]]);
  return {
    routing: made.routing,
    uniform: ds.every((d) => d[0] === ds[0][0] && d[1] === ds[0][1]),
    moved: ds[0][0] !== 0 || ds[0][1] !== 0,
  };
});
t.ok(
  'a pasted manual route arrives congruent to the one it was copied from',
  congruent.routing === 'manual' && congruent.uniform === true && congruent.moved === true,
  JSON.stringify(congruent),
);

/*
  Paste mints names inside `nextName`'s namespace now, so the two must not be able to agree on
  one. `nextName` rescans the live names on every call, which is what keeps this true -- an
  "optimisation" that trusted its counter instead would break it silently.
*/
const clash = await page.evaluate(() => {
  const sc = window.__scene;
  const pasted = sc.shapes.map((s) => s.name);
  return { pasted, next: sc.nextName('block') };
});
t.ok(
  'a freshly minted name never collides with one a paste already took',
  !clash.pasted.includes(clash.next),
  JSON.stringify(clash),
);

const code = t.report(errors);
await browser.close();
process.exit(code);
