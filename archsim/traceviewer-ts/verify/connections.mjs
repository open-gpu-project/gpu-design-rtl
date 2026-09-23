import {
  DEV_URL,
  clickKey,
  diagramCanvas,
  drawBlock,
  drawConnection,
  editValue,
  open,
  row,
  suite,
} from './harness.mjs';

/*
  Connections: the router, the anchors, the store's dependency pass, the click-click tool, and
  the render invariants.

  Five groups, split by what they need rather than by what they cover. Groups R and A drive
  pure functions through `window.__route` and `window.__anchor` with no compositor and no
  pointer in the loop -- the same argument `grid.mjs` makes for the dot grid, and for the same
  reason: a router that picks a defensible-looking but wrong elbow produces a screenshot nobody
  can tell is wrong. Groups S and P drive the store and the property panel directly. Only
  group I needs a real pointer, and only group V needs a real frame.

  The single most important assertion in the file is S's "a no-op commit records nothing".
  Registering the first shape kind with dependencies turns on a pass that used to be dead, and
  the naive form of that pass allocates a new array every time -- which, since `commit` decides
  whether to record history by comparing array identity, would silently make every commit in
  the app undoable, including ones in a scene with no connections in it at all.
*/

const t = suite('connections');
const { browser, page, errors } = await open(DEV_URL);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const xy = (pts) => pts.map((p) => [p.x, p.y]);

/* ------------------------------------------------------------------ R: the router ---- */

const R = await page.evaluate(() => {
  const {
    routeConnection,
    collapseRoute,
    isRectilinear,
    moveSegment,
    patchStart,
    CorridorIndex,
    NO_CORRIDORS,
    ROUTE_MAX_SEGMENTS,
  } = window.__route;
  const A = (x, y, nx, ny) => ({ id: 'a', pos: { x, y }, normal: { x: nx, y: ny } });
  const out = {};

  // A deterministic LCG rather than Math.random, so a failure is reproducible from the seed.
  let seed = 20260922;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const NORMALS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const cell = () => Math.round((rnd() * 1000) / 16) * 16;

  let nonRect = 0;
  let overCap = 0;
  let drift = 0;
  let degenerate = 0;
  const segs = {};
  for (let i = 0; i < 200; i++) {
    const n1 = NORMALS[Math.floor(rnd() * 4)];
    const n2 = NORMALS[Math.floor(rnd() * 4)];
    const a = A(cell(), cell(), n1[0], n1[1]);
    const b = A(cell(), cell(), n2[0], n2[1]);
    const r = routeConnection(a, b, NO_CORRIDORS);
    if (!isRectilinear(r)) nonRect++;
    if (r.length - 1 > ROUTE_MAX_SEGMENTS) overCap++;
    if (r[0].x !== a.pos.x || r[0].y !== a.pos.y) drift++;
    if (r[r.length - 1].x !== b.pos.x || r[r.length - 1].y !== b.pos.y) drift++;
    // No zero-length segment and no collinear interior point survived the collapse.
    for (let k = 1; k < r.length; k++) {
      if (r[k].x === r[k - 1].x && r[k].y === r[k - 1].y) degenerate++;
    }
    for (let k = 1; k < r.length - 1; k++) {
      const p = r[k - 1],
        q = r[k],
        s = r[k + 1];
      if ((p.x === q.x && q.x === s.x) || (p.y === q.y && q.y === s.y)) degenerate++;
    }
    segs[r.length - 1] = (segs[r.length - 1] ?? 0) + 1;
  }
  out.fuzz = { nonRect, overCap, drift, degenerate, segs, cap: ROUTE_MAX_SEGMENTS };

  // Perpendicular faces, both normals satisfiable by an L: no reason to spend a third segment.
  out.lRoute = routeConnection(A(100, 100, 1, 0), A(300, 300, 0, -1), NO_CORRIDORS);

  // Facing each other but offset: no L satisfies both normals, so the Z is the correct answer.
  const z = routeConnection(A(100, 100, 1, 0), A(300, 200, -1, 0), NO_CORRIDORS);
  out.zRoute = z;
  out.zLeaves = z[1].x > z[0].x; // leaves eastward, along the source normal
  out.zArrives = z[z.length - 1].x > z[z.length - 2].x; // arrives eastward, into the target's west face

  // Bundling: the same pair, with a corridor three cells off its natural elbow.
  const near = new CorridorIndex();
  near.absorbPoints([
    { x: 160, y: -500 },
    { x: 160, y: 900 },
  ]);
  out.bundled = routeConnection(A(100, 100, 1, 0), A(300, 200, -1, 0), near);

  // ...and with one far away and out of span, which must NOT drag the route into a detour.
  const far = new CorridorIndex();
  far.absorbPoints([
    { x: 1000, y: -500 },
    { x: 1000, y: 900 },
  ]);
  out.notBundled = routeConnection(A(100, 100, 1, 0), A(300, 200, -1, 0), far);

  out.determinism = eqPts(
    routeConnection(A(48, 96, 1, 0), A(400, 320, -1, 0), near),
    routeConnection(A(48, 96, 1, 0), A(400, 320, -1, 0), near),
  );
  function eqPts(a, b) {
    return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
  }

  // A run shorter than two grid cells is a stub, not something worth bundling onto.
  const shortRun = new CorridorIndex();
  shortRun.absorbPoints([
    { x: 64, y: 0 },
    { x: 64, y: 16 },
  ]);
  const longRun = new CorridorIndex();
  longRun.absorbPoints([
    { x: 64, y: 0 },
    { x: 64, y: 160 },
    { x: 320, y: 160 },
  ]);
  out.corridorFilter = {
    shortX: shortRun.rangeX(-1000, 1000).length,
    longX: longRun.rangeX(-1000, 1000),
    longY: longRun.rangeY(-1000, 1000),
  };

  const clean = [
    { x: 0, y: 0 },
    { x: 64, y: 0 },
    { x: 64, y: 64 },
  ];
  out.collapseIdentity = collapseRoute(clean) === clean;
  out.collapseDrops = collapseRoute([
    { x: 0, y: 0 },
    { x: 32, y: 0 },
    { x: 64, y: 0 },
    { x: 64, y: 0 },
    { x: 64, y: 64 },
  ]);

  const moved = moveSegment(clean, 0, { x: 0, y: 32 });
  out.moveSeg = {
    pts: moved,
    p0Fixed: moved[0].x === 0 && moved[0].y === 0,
    rect: isRectilinear(moved),
  };
  out.moveBack = eqPts(moveSegment(moved, 1, { x: 0, y: 0 }), clean);

  const patched = patchStart(clean, { x: 0, y: 32 });
  out.patchStart = {
    pts: patched,
    rect: isRectilinear(patched),
    tailKept: patched[patched.length - 1].y === 64,
  };

  // Head to head, facing away from each other: no route satisfies both normals, but the one
  // chosen must still not cut through either block.
  const hh = routeConnection(A(100, 100, 1, 0), A(0, 300, -1, 0), NO_CORRIDORS);
  out.headToHead = { pts: hh, rect: isRectilinear(hh), segs: hh.length - 1 };
  return out;
});

t.ok(
  '200 seeded-random anchor pairs all route rectilinearly',
  R.fuzz.nonRect === 0,
  `non-rectilinear: ${R.fuzz.nonRect}`,
);
t.ok(
  'and every one of them starts and ends exactly on its anchors',
  R.fuzz.drift === 0,
  `endpoint drift: ${R.fuzz.drift}`,
);
t.ok(
  'and none carries a zero-length or collinear point through the collapse',
  R.fuzz.degenerate === 0,
  `degenerate points: ${R.fuzz.degenerate}`,
);
t.ok(
  `and none exceeds the ${R.fuzz.cap}-segment cap`,
  R.fuzz.overCap === 0,
  `segment histogram: ${JSON.stringify(R.fuzz.segs)}`,
);
t.ok(
  'two perpendicular faces spend two segments, not three',
  R.lRoute.length - 1 === 2,
  JSON.stringify(xy(R.lRoute)),
);
t.ok(
  'two facing offset anchors spend a third segment rather than arrive sideways',
  R.zRoute.length - 1 === 3,
  JSON.stringify(xy(R.zRoute)),
);
t.ok(
  'and that route leaves along the source normal and arrives into the target face',
  R.zLeaves && R.zArrives,
  `leaves=${R.zLeaves} arrives=${R.zArrives}`,
);
t.ok(
  'an elbow three cells from a corridor snaps onto it: lines bundle',
  R.bundled[1].x === 160,
  `elbow ${R.bundled[1].x}, wanted 160, unbundled would be ${R.notBundled[1].x}`,
);
t.ok(
  'a corridor far out of span does not drag the route into a detour',
  R.notBundled[1].x === R.zRoute[1].x,
  `elbow ${R.notBundled[1].x}, natural ${R.zRoute[1].x}`,
);
t.ok('routing the same input twice is element-wise identical', R.determinism);
t.ok(
  'a run under two grid cells is a stub and contributes no corridor',
  R.corridorFilter.shortX === 0,
  `got ${R.corridorFilter.shortX} corridors from a one-cell run`,
);
t.ok(
  'a long run contributes exactly its own axis',
  eq(R.corridorFilter.longX, [64]) && eq(R.corridorFilter.longY, [160]),
  `x=${JSON.stringify(R.corridorFilter.longX)} y=${JSON.stringify(R.corridorFilter.longY)}`,
);
t.ok('collapsing an already-clean route returns the same array', R.collapseIdentity);
t.ok(
  'collapsing drops the duplicate and the collinear midpoint',
  R.collapseDrops.length === 3,
  JSON.stringify(xy(R.collapseDrops)),
);
t.ok(
  'dragging the first segment inserts a joint instead of detaching the anchor',
  R.moveSeg.pts.length === 4 && R.moveSeg.p0Fixed && R.moveSeg.rect,
  JSON.stringify(xy(R.moveSeg.pts)),
);
t.ok('dragging it back reproduces the original route', R.moveBack);
t.ok(
  'patching an end slides it and re-hangs one joint, staying rectilinear',
  R.patchStart.rect && R.patchStart.tailKept,
  JSON.stringify(xy(R.patchStart.pts)),
);
t.ok(
  'anchors facing away from each other still route rectilinearly within the cap',
  R.headToHead.rect && R.headToHead.segs <= R.fuzz.cap,
  JSON.stringify(xy(R.headToHead.pts)),
);

/* ----------------------------------------------------------------- A: the anchors ---- */

await drawBlock(page, 120, 120, 280, 240);

const A = await page.evaluate(() => {
  const s = window.__scene.shapes.find((o) => o.kind === 'rect');
  const { anchorAt, resolveAnchor } = window.__anchor;
  const wpp = 1 / window.__view.z;
  const east = { x: s.x + s.w + 4 * wpp, y: s.y + s.h / 2 };
  const a = anchorAt(s, east, wpp);
  const deep = anchorAt(s, { x: s.x + s.w / 2, y: s.y + s.h / 2 }, wpp);
  // "Midpoint" means the middle of the face, measured along the face -- x for n/s, y for e/w.
  const deepMid =
    deep === null
      ? false
      : deep.id[0] === 'n' || deep.id[0] === 's'
        ? deep.pos.x === s.x + Math.round(s.w / 2)
        : deep.pos.y === s.y + Math.round(s.h / 2);
  const outside = anchorAt(s, { x: s.x + s.w + 500, y: s.y }, wpp);
  const roundTrip = a === null ? null : resolveAnchor(s, a.id);

  // Ten picks of the same point must agree, or the id is not a function of the point.
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push(anchorAt(s, { x: s.x, y: s.y }, wpp)?.id ?? null);

  // Shrink the block below the stored offset, then restore it.
  const small = { ...s, h: 32 };
  const shrunk = a === null ? null : resolveAnchor(small, a.id);
  const restored = a === null ? null : resolveAnchor(s, a.id);

  return {
    a,
    onEdge: a !== null && a.pos.x === s.x + s.w,
    snapped: a !== null && a.pos.y % 16 === 0,
    deepId: deep?.id ?? null,
    deepMid,
    outside,
    roundTrip,
    cornerStable: new Set(ids).size === 1,
    shrunkOnEdge: shrunk !== null && shrunk.pos.y >= small.y && shrunk.pos.y <= small.y + small.h,
    restoredSame: restored !== null && a !== null && restored.pos.y === a.pos.y,
    box: { x: s.x, y: s.y, w: s.w, h: s.h },
  };
});

t.ok(
  'a point just outside the east edge anchors to that edge',
  A.a !== null && /^e:\d+$/.test(A.a.id) && A.onEdge,
  `id=${A.a?.id} pos=${JSON.stringify(A.a?.pos)}`,
);
t.ok(
  'with the outward normal, which is what tells the router which way to leave',
  A.a !== null && A.a.normal.x === 1 && A.a.normal.y === 0,
  JSON.stringify(A.a?.normal),
);
t.ok('and an offset snapped to the grid, so anchors line up with each other', A.snapped);
t.ok(
  'a point deep inside the block collapses to the face midpoint rather than jittering',
  A.deepMid,
  `id=${A.deepId}`,
);
t.ok('a point well outside the block anchors to nothing', A.outside === null);
t.ok(
  'resolving an anchor id reproduces the position it was picked at',
  A.roundTrip !== null && A.a !== null && eq(A.roundTrip.pos, A.a.pos),
  `${JSON.stringify(A.roundTrip?.pos)} vs ${JSON.stringify(A.a?.pos)}`,
);
t.ok('a corner picks the same side every time', A.cornerStable);
t.ok('shrinking the block clamps the anchor onto the shorter face', A.shrunkOnEdge);
t.ok(
  'and restoring its size puts the anchor back where the user left it',
  A.restoredSame,
  'the id stores the offset as authored, not as clamped',
);

/* ------------------------------------------------- S: store, history, serialization ---- */

await drawBlock(page, 620, 380, 780, 500);
await drawConnection(page, 280, 180, 620, 440);
await page.keyboard.press('Digit1');

const S = await page.evaluate(() => {
  const sc = window.__scene;
  const conn = sc.shapes.find((s) => s.kind === 'conn');
  const before = sc.shapes;
  const undoBefore = sc.history.undoLabel;

  // The guard this whole file exists to protect: resolving dependencies must not allocate when
  // it changed nothing, or `commit`'s identity test records an entry for doing nothing.
  sc.commit('noop', () => {});
  const noopKeptIdentity = sc.shapes === before;
  const noopRecorded = sc.history.undoLabel !== undoBefore;
  const connStillSame = sc.shapes.find((s) => s.kind === 'conn') === conn;

  const doc = window.__dump();
  const record = doc.shapes.find((r) => r.kind === 'conn');

  return {
    conn: conn && { name: conn.name, from: conn.from, to: conn.to, routing: conn.routing },
    noopKeptIdentity,
    noopRecorded,
    connStillSame,
    version: doc.version,
    keys: record === undefined ? [] : Object.keys(record),
    record,
  };
});

t.ok(
  'a no-op commit records no history entry',
  !S.noopRecorded && S.noopKeptIdentity,
  `identity kept: ${S.noopKeptIdentity}, entry recorded: ${S.noopRecorded}`,
);
t.ok('and leaves every connection object identical, not merely equal', S.connStillSame);
t.ok(
  'the saved record carries the endpoints, the routing mode and the route',
  eq(S.keys, ['kind', 'description', 'label', 'name', 'routing', 'points', 'source', 'target']),
  JSON.stringify(S.keys),
);
t.ok('and no zIndex, since array order already is the draw order', !S.keys.includes('zIndex'));
t.ok('adding a kind needs no file-format version bump', S.version === 2, `version ${S.version}`);

/*
  The round trip, which `properties.mjs` also checks but only over a scene of blocks.

  Worth its own assertion here because `points` and `routing` were, for one iteration, a pair
  of writers that interacted: the `points` writer forced `routing` to 'manual', so whichever
  of the two the loader applied second decided what a saved file meant. It got that wrong once
  already, and every `auto` connection in every file came back pinned.

  The coupling is gone rather than merely ordered -- pinning a route is the segment drag's
  job, in `connOps.resize`, not a side effect of restoring points off disk. This assertion is
  what notices if it comes back.
*/
const roundTrip = await page.evaluate(async () => {
  const mod = await import('/src/lib/scene/serialize.ts');
  const doc = window.__dump();
  const back = mod.deserializeScene(doc);
  return {
    same: JSON.stringify(doc) === JSON.stringify(mod.serializeScene(back)),
    routing: back.find((x) => x.kind === 'conn')?.routing ?? null,
  };
});
t.ok('a scene with connections round-trips through the file format exactly', roundTrip.same);
t.ok(
  'and an auto route comes back auto, rather than pinned by its own points',
  roundTrip.routing === 'auto',
  `routing ${roundTrip.routing}`,
);

const rename = await page.evaluate(() => {
  const sc = window.__scene;
  const block = sc.shapes.find((s) => s.kind === 'rect');
  sc.replaceShape(block, { ...block, name: 'fetch_unit' }, 'rename');
  const conn = sc.shapes.find((s) => s.kind === 'conn');
  return { from: conn.from, to: conn.to };
});
t.ok(
  'renaming a block rewrites the connections that point at it',
  rename.from === 'fetch_unit' || rename.to === 'fetch_unit',
  JSON.stringify(rename),
);

const cascade = await page.evaluate(() => {
  const sc = window.__scene;
  const conns = sc.shapes.filter((s) => s.kind === 'conn').length;
  const entriesBefore = sc.history.canUndo;
  sc.selectOnly('fetch_unit');
  window.__host.deleteSelection();
  const after = {
    shapes: sc.shapes.length,
    conns: sc.shapes.filter((s) => s.kind === 'conn').length,
    label: sc.history.undoLabel,
  };
  sc.undo();
  const restored = {
    shapes: sc.shapes.length,
    conns: sc.shapes.filter((s) => s.kind === 'conn').length,
  };
  return { conns, entriesBefore, after, restored };
});
t.ok(
  'deleting a block cascade-deletes the connections bound to it',
  cascade.after.conns === 0 && cascade.conns > 0,
  `${cascade.conns} -> ${cascade.after.conns}`,
);
t.ok(
  'and one undo brings the block and its connections back together',
  cascade.restored.conns === cascade.conns,
  `${cascade.after.conns} -> ${cascade.restored.conns} connections`,
);

/* --------------------------------------- P: what the property panel may change ---- */

/*
  A connection's geometry -- `source`, `target`, `points` -- is `fixed` rather than `edit`:
  saved and restored like everything else, but owned by the canvas.

  Three coupled values that only make sense together are a poor thing to hand-edit one at a
  time. The gestures that set them (drag a bead, drag a segment) keep them consistent by
  construction; the tree editor cannot, and every writer would have had to defend itself
  against the other two.

  `routing` is the deliberate exception, and is checked here too. It is not geometry, it is
  who maintains the geometry, and the canvas can only ever move it one way -- so with it
  read-only a hand-drawn route could never be handed back to the router at all.

  Both halves of the read-only claim are checked. The greying and the schema's `readOnly` are
  signposting -- svelte-jsoneditor has no per-node read-only -- so `applyDocument`'s second
  pass is the real refusal, and a signpost with no gate behind it is worse than neither.
*/

/*
  Select a block first, so that arriving at the connection is a change of *kind* and not just
  of object. The marking is derived from the schema the panel is showing, and until this
  iteration that schema was assigned after the document had already been handed to the editor
  and rendered -- so the greying was one selection behind. It could not show while `rect` was
  the only kind. It is asserted in both directions below.
*/
const blockName = await page.evaluate(() => {
  const b = window.__scene.shapes.find((s) => s.kind === 'rect');
  window.__scene.selectOnly(b.name);
  return b.name;
});
await page.waitForTimeout(400);

const connName = await page.evaluate(() => {
  const sc = window.__scene;
  const c = sc.shapes.find((s) => s.kind === 'conn');
  sc.selectOnly(c.name);
  return c.name;
});
await page.waitForTimeout(400);

const greyed = async (key) =>
  (await page.locator(`[data-path="%2F${key}"].archsim-readonly`).count()) === 1;

t.ok(
  'selecting a connection shows its properties',
  /conn/.test(await row(page, 'kind').innerText()),
  connName,
);
t.ok(
  'the route and both endpoints are marked read-only',
  (await greyed('points')) && (await greyed('source')) && (await greyed('target')),
);
t.ok(
  'and the four a person decides — three names and the routing mode — are not',
  !(await greyed('name')) &&
    !(await greyed('label')) &&
    !(await greyed('description')) &&
    !(await greyed('routing')),
);

await page.evaluate((n) => window.__scene.selectOnly(n), blockName);
await page.waitForTimeout(400);
t.ok(
  'and going the other way carries nothing over: a block’s position and size stay editable',
  !(await greyed('position')) && !(await greyed('size')) && (await greyed('zIndex')),
  'the marking follows the schema on screen, not the one before it',
);
await page.evaluate((n) => window.__scene.selectOnly(n), connName);
await page.waitForTimeout(400);

await clickKey(page, 'points');
const pointsDoc = (await page.locator('.footer').innerText()).replace(/\s+/g, ' ');
t.ok(
  'the footer says so beside the type, rather than leaving the grey to be guessed at',
  /read-only/i.test(pointsDoc) && /Route/.test(pointsDoc),
  pointsDoc.slice(0, 90),
);

await editValue(page, 'label', 'ldst');
t.ok(
  'an editable key still commits with four read-only ones beside it in the document',
  (await page.evaluate(() => window.__scene.shapes.find((s) => s.kind === 'conn').label)) ===
    'ldst',
);

/*
  The escape hatch, end to end and through the panel, because it is the only way back: a
  segment drag moves `routing` to 'manual' and nothing on the canvas moves it off again. The
  route is pinned here with the same function the drag uses, so what is under test is the
  un-pinning and not a hand-made route the router would never have produced.
*/
const pinned = await page.evaluate(() => {
  const sc = window.__scene;
  const c = sc.shapes.find((s) => s.kind === 'conn');
  const auto = c.points.map((p) => [p.x, p.y]);
  const a = c.points[0];
  const bent = window.__route.moveSegment(c.points, 0, { x: a.x + 64, y: a.y + 64 });
  sc.replaceShape(c, { ...c, points: bent, routing: 'manual' }, 'pin');
  const after = sc.shapes.find((s) => s.kind === 'conn');
  return { auto, routing: after.routing, points: after.points.map((p) => [p.x, p.y]) };
});
await page.waitForTimeout(300);
t.ok(
  'a route can be pinned to a shape the router would not have chosen',
  pinned.routing === 'manual' && !eq(pinned.points, pinned.auto),
  `${JSON.stringify(pinned.auto)} -> ${JSON.stringify(pinned.points)}`,
);

await editValue(page, 'routing', 'auto');
const unpinned = await page.evaluate(() => {
  const c = window.__scene.shapes.find((s) => s.kind === 'conn');
  return {
    routing: c.routing,
    points: c.points.map((p) => [p.x, p.y]),
    label: window.__scene.history.undoLabel,
  };
});
t.ok(
  'and typing “auto” in the panel hands it back to the router, which is the only way back',
  unpinned.routing === 'auto' && eq(unpinned.points, pinned.auto),
  `${JSON.stringify(pinned.points)} -> ${JSON.stringify(unpinned.points)}`,
);
t.ok(
  'as one history entry, readably labelled',
  /routing/.test(unpinned.label ?? ''),
  String(unpinned.label),
);

/*
  The gate itself, straight from the module. A second module instance under HMR is harmless
  here in a way it is not for the registry: these are pure functions over a schema built at
  import time, and the read-only pass rejects before any writer -- so `opsFor`, the one thing
  in this file that would need the app's own registry, is never reached.
*/
const gate = await page.evaluate(async (name) => {
  const [proj, schema] = await Promise.all([
    import('/src/lib/props/project.ts'),
    import('/src/lib/scene/shapes/conn.props.ts'),
  ]);
  const shapes = window.__scene.shapes;
  const index = shapes.findIndex((s) => s.name === name);
  const ctx = { shapes, index };
  const s = shapes[index];
  const doc = proj.projectShape(schema.connProps, s, ctx);
  const edits = {
    points: [
      [0, 0],
      [0, 32],
    ],
    source: ['nowhere', 'n'],
    target: ['nowhere', 's'],
  };
  const refused = {};
  for (const key of Object.keys(edits)) {
    const r = proj.applyDocument(schema.connProps, s, { ...doc, [key]: edits[key] }, ctx);
    refused[key] = r.ok ? null : r.error;
  }
  const clean = proj.applyDocument(schema.connProps, s, { ...doc, label: 'x' }, ctx);
  return { refused, clean: clean.ok ? clean.changed.join() : `refused: ${clean.error}` };
}, connName);

t.ok(
  'applyDocument refuses all three, which is what the greying is drawn over',
  ['points', 'source', 'target'].every((k) => gate.refused[k] !== null),
  JSON.stringify(gate.refused).slice(0, 140),
);
t.ok(
  'and names the key and says where it is set instead',
  /cannot be changed/.test(gate.refused.points ?? '') && /canvas/i.test(gate.refused.points ?? ''),
  (gate.refused.points ?? '').slice(0, 110),
);
t.ok('and passes an edit that touches only an editable key', gate.clean === 'label', gate.clean);

/*
  The other half of `fixed`: read-only to the user, not to the loader. `hydrateShape` gates on
  having a writer rather than on being editable, and if it did not, every connection in every
  saved file would come back as whatever `makeConnection` blanks to.
*/
const restored = await page.evaluate(async () => {
  const mod = await import('/src/lib/scene/serialize.ts');
  const doc = window.__dump();
  const record = doc.shapes.find((r) => r.kind === 'conn');
  const c = mod.deserializeScene(doc).find((x) => x.kind === 'conn');
  return {
    source: c.from === record.source[0] && c.fromAnchor === record.source[1],
    target: c.to === record.target[0] && c.toAnchor === record.target[1],
    points: JSON.stringify(c.points.map((p) => [p.x, p.y])) === JSON.stringify(record.points),
    routing: c.routing === record.routing,
  };
});
t.ok(
  'a property the user cannot type is still one the loader puts back',
  restored.source && restored.target && restored.points && restored.routing,
  JSON.stringify(restored),
);

/*
  Put the focus back on the canvas before anything drives the keyboard again. The host ignores
  shortcuts while an editable element has focus, so a caret left in the JSON tree makes
  `drawBlock`'s Digit2 vanish and the drag that follows it draw a marquee instead of a block.
*/
const afterPanel = await diagramCanvas(page).boundingBox();
await page.mouse.click(afterPanel.x + 24, afterPanel.y + 24);
await page.waitForTimeout(200);

/* -------------------------------------------------------------- I: the real pointer ---- */

await page.evaluate(() =>
  window.__scene.commit('reset', () => {
    window.__scene.shapes = [];
    window.__scene.clearSelection();
  }),
);
await drawBlock(page, 140, 120, 300, 240);
await drawBlock(page, 600, 300, 760, 420);

const canvas = await diagramCanvas(page).boundingBox();

/*
  Screen coordinates are derived from the live shapes, never written down.

  Every commit re-derives the world bounds and re-clamps the camera, so a literal canvas
  coordinate written before a commit can point somewhere else after one -- which is exactly the
  "do not hard-code canvas coordinates" rule in verify/README.md, and how the first draft of
  this file failed.
*/
const screenOf = async (world) => {
  const p = await page.evaluate((w) => {
    const s = window.__view.toScreen(w);
    return [s.x, s.y];
  }, world);
  return [canvas.x + p[0], canvas.y + p[1]];
};
const edgeOf = async (name, side, t = 0.5) =>
  screenOf(
    await page.evaluate(
      ([n, sd, frac]) => {
        const b = window.__scene.shapes.find((s) => s.name === n);
        if (sd === 'e') return { x: b.x + b.w, y: b.y + b.h * frac };
        if (sd === 'w') return { x: b.x, y: b.y + b.h * frac };
        if (sd === 'n') return { x: b.x + b.w * frac, y: b.y };
        return { x: b.x + b.w * frac, y: b.y + b.h };
      },
      [name, side, t],
    ),
  );
const centerOf = async (name) =>
  screenOf(
    await page.evaluate((n) => {
      const b = window.__scene.shapes.find((s) => s.name === n);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }, name),
  );
/*
  A point inside the viewport that hits nothing at all.

  Searched rather than guessed: a fixed fraction of the viewport is only empty until someone
  adds a block, and a check that silently starts clicking on a shape reports a cancel that never
  happened. The margin is generous enough to clear the perimeter grab band as well as the body.
*/
const emptyWorldPoint = () =>
  page.evaluate(() => {
    const v = window.__view;
    const w = v.cssW / v.z;
    const h = v.cssH / v.z;
    const clear = (p) =>
      window.__scene.shapes.every((s) => {
        const r =
          s.kind === 'rect'
            ? { x: s.x, y: s.y, w: s.w, h: s.h }
            : {
                x: Math.min(...s.points.map((q) => q.x)),
                y: Math.min(...s.points.map((q) => q.y)),
                w: Math.max(...s.points.map((q) => q.x)) - Math.min(...s.points.map((q) => q.x)),
                h: Math.max(...s.points.map((q) => q.y)) - Math.min(...s.points.map((q) => q.y)),
              };
        const m = 48;
        return p.x < r.x - m || p.x > r.x + r.w + m || p.y < r.y - m || p.y > r.y + r.h + m;
      });
    for (let fy = 0.9; fy > 0.1; fy -= 0.1) {
      for (let fx = 0.9; fx > 0.1; fx -= 0.1) {
        const p = { x: v.camX + w * fx, y: v.camY + h * fy };
        if (clear(p)) return p;
      }
    }
    throw new Error('no empty spot in the viewport');
  });
const emptyWorld = async () => screenOf(await emptyWorldPoint());

const [src, dst] = await page.evaluate(() =>
  window.__scene.shapes.filter((s) => s.kind === 'rect').map((s) => s.name),
);

await page.keyboard.press('Digit3');
t.ok(
  'the digit shortcut declared by the tool selects it',
  (await page.evaluate(() => window.__host.activeToolId)) === 'connect',
  'read from the registry, not from a switch in the host',
);

await page.mouse.move(...(await edgeOf(src, 'e')), { steps: 5 });
await page.waitForTimeout(100);
t.ok(
  'hovering a block edge offers an anchor',
  (await page.evaluate(() => window.__host.tool?.hoverAnchor?.id ?? null)) !== null,
);
await page.mouse.move(...(await emptyWorld()), { steps: 5 });
await page.waitForTimeout(100);
t.ok(
  'and hovering open space offers none',
  (await page.evaluate(() => window.__host.tool?.hoverAnchor ?? null)) === null,
);

await page.mouse.move(...(await edgeOf(src, 'e')), { steps: 5 });
await page.waitForTimeout(80);
await page.mouse.click(...(await edgeOf(src, 'e')));
await page.mouse.move(...(await emptyWorld()), { steps: 8 });
await page.waitForTimeout(120);

const pending = await page.evaluate(() => ({
  from: window.__host.tool?.pendingFrom ?? null,
  ghost: window.__host.tool?.ghostPoints ?? null,
  draft: window.__scene.draft,
}));
t.ok('the first click leaves a connection pending', pending.from !== null, `from ${pending.from}`);
t.ok(
  'with a routed ghost following the cursor',
  pending.ghost !== null && pending.ghost.length >= 2,
);
t.ok(
  'and the ghost never touches the reactive draft channel',
  pending.draft === null,
  'a $state write per pointermove is the cost iteration 3.2 removed',
);

const nBeforeSelf = await page.evaluate(() => window.__scene.shapes.length);
await page.mouse.move(...(await edgeOf(src, 'e', 0.75)), { steps: 4 });
await page.waitForTimeout(80);
await page.mouse.click(...(await edgeOf(src, 'e', 0.75)));
await page.waitForTimeout(150);
t.ok(
  'clicking the source block again is refused rather than making a self-connection',
  (await page.evaluate(() => window.__scene.shapes.length)) === nBeforeSelf &&
    (await page.evaluate(() => window.__host.tool?.pendingFrom ?? null)) !== null,
);

const undoDuring = await page.evaluate(() => ({
  label: window.__scene.history.undoLabel,
  n: window.__scene.shapes.length,
}));
await page.keyboard.press('Meta+z');
await page.waitForTimeout(150);
const afterUndo = await page.evaluate(() => ({
  label: window.__scene.history.undoLabel,
  n: window.__scene.shapes.length,
  pending: window.__host.tool?.pendingFrom ?? null,
}));
t.ok(
  'undo while a connection is pending cancels it instead of undoing the last edit',
  afterUndo.pending === null &&
    afterUndo.label === undoDuring.label &&
    afterUndo.n === undoDuring.n,
  `${undoDuring.label} -> ${afterUndo.label}, pending ${afterUndo.pending}`,
);

// A full, clean gesture.
await page.mouse.move(...(await edgeOf(src, 'e')), { steps: 4 });
await page.waitForTimeout(80);
await page.mouse.click(...(await edgeOf(src, 'e')));
await page.mouse.move(...(await edgeOf(dst, 'w')), { steps: 8 });
await page.waitForTimeout(150);
const ghostAtClick = await page.evaluate(() => window.__host.tool?.ghostPoints ?? null);
await page.mouse.click(...(await edgeOf(dst, 'w')));
await page.waitForTimeout(300);

const made = await page.evaluate(() => {
  const sc = window.__scene;
  const c = sc.shapes.find((s) => s.kind === 'conn');
  return {
    c: c && { name: c.name, from: c.from, to: c.to, routing: c.routing, points: c.points },
    selection: [...sc.selection],
    label: sc.history.undoLabel,
    n: sc.shapes.length,
  };
});
t.ok(
  'the second click commits exactly one connection, named and bound',
  made.n === 3 &&
    made.c != null &&
    made.c.from !== '' &&
    made.c.to !== '' &&
    made.c.from !== made.c.to,
  `${made.n} shapes; ${made.c?.name}: ${made.c?.from} -> ${made.c?.to}`,
);
t.ok(
  'it lands selected, as one history entry',
  made.c != null && eq(made.selection, [made.c.name]) && made.label === 'connect',
  `${JSON.stringify(made.selection)} / ${made.label}`,
);
t.ok(
  'and the committed route is the ghost, not a second opinion of it',
  made.c != null && ghostAtClick != null && eq(xy(made.c.points), xy(ghostAtClick)),
  `${JSON.stringify(ghostAtClick && xy(ghostAtClick))} vs ${JSON.stringify(made.c && xy(made.c.points))}`,
);

await page.mouse.move(...(await emptyWorld()), { steps: 4 });
await page.mouse.move(canvas.x + canvas.width + 40, canvas.y + 20, { steps: 4 });
await page.waitForTimeout(150);
t.ok(
  'leaving the canvas drops the hover bead rather than stranding it',
  (await page.evaluate(() => window.__host.tool?.hoverAnchor ?? null)) === null,
);

// Escape: first cancels, second returns to select.
await page.mouse.move(...(await edgeOf(src, 'e')), { steps: 4 });
await page.waitForTimeout(80);
await page.mouse.click(...(await edgeOf(src, 'e')));
await page.waitForTimeout(80);
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
const esc1 = await page.evaluate(() => ({
  pending: window.__host.tool?.pendingFrom ?? null,
  tool: window.__host.activeToolId,
}));
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
t.ok(
  'Escape cancels a pending connection without leaving the tool',
  esc1.pending === null && esc1.tool === 'connect',
  JSON.stringify(esc1),
);
t.ok(
  'and a second Escape returns to select',
  (await page.evaluate(() => window.__host.activeToolId)) === 'select',
);

// Clicking empty space while pending is the other way out.
await page.keyboard.press('Digit3');
await page.mouse.move(...(await edgeOf(src, 'e')), { steps: 4 });
await page.waitForTimeout(80);
await page.mouse.click(...(await edgeOf(src, 'e')));
await page.mouse.move(...(await emptyWorld()), { steps: 6 });
await page.waitForTimeout(80);
const nBefore = await page.evaluate(() => window.__scene.shapes.length);
await page.mouse.click(...(await emptyWorld()));
await page.waitForTimeout(150);
t.ok(
  'clicking open space while pending cancels rather than dropping a loose end',
  (await page.evaluate(() => window.__scene.shapes.length)) === nBefore &&
    (await page.evaluate(() => window.__host.tool?.pendingFrom ?? null)) === null,
);

// Moving a block re-routes, in one entry.
await page.keyboard.press('Digit1');
const beforeMove = await page.evaluate(() => {
  const c = window.__scene.shapes.find((s) => s.kind === 'conn');
  return { points: c.points.map((p) => [p.x, p.y]) };
});
const grabStart = await centerOf(src);
await page.mouse.move(...grabStart);
await page.mouse.down();
await page.mouse.move(grabStart[0], grabStart[1] + 140, { steps: 10 });
await page.waitForTimeout(100);
const duringDrag = await page.evaluate(() => {
  const c = window.__scene.shapes.find((s) => s.kind === 'conn');
  return c.points.map((p) => [p.x, p.y]);
});
await page.mouse.up();
await page.waitForTimeout(300);
const afterMove = await page.evaluate(() => {
  const sc = window.__scene;
  const c = sc.shapes.find((s) => s.kind === 'conn');
  const b = sc.shapes.find((s) => s.name === c.from);
  const p0 = c.points[0];
  return {
    points: c.points.map((q) => [q.x, q.y]),
    onEdge: p0.x === b.x || p0.x === b.x + b.w || p0.y === b.y || p0.y === b.y + b.h,
    label: sc.history.undoLabel,
  };
});
t.ok(
  'a connection follows its block during the drag, not only on release',
  !eq(duringDrag, beforeMove.points),
  'previewShapes bypasses the commit path, so the select tool re-routes explicitly',
);
t.ok(
  'and its anchor stays on the moved perimeter',
  afterMove.onEdge,
  JSON.stringify(afterMove.points[0]),
);
t.ok('the whole move is one history entry', afterMove.label === 'move', afterMove.label);

// Dragging a segment pins the route.
const segDrag = await page.evaluate(() => {
  const sc = window.__scene;
  const c = sc.shapes.find((s) => s.kind === 'conn');
  sc.selectOnly(c.name);
  return { points: c.points.map((p) => [p.x, p.y]), routing: c.routing };
});
t.ok('a fresh connection is auto-routed', segDrag.routing === 'auto');

if (segDrag.points.length >= 3) {
  const a = segDrag.points[1];
  const b = segDrag.points[2];
  const mid = await screenOf({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 });
  const vertical = a[0] === b[0];
  const push = vertical ? [64, 0] : [0, 64];

  await page.mouse.move(...mid);
  await page.mouse.down();
  await page.mouse.move(mid[0] + push[0], mid[1] + push[1], { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const pinned = await page.evaluate(() => {
    const sc = window.__scene;
    const c = sc.shapes.find((s) => s.kind === 'conn');
    return {
      points: c.points.map((p) => [p.x, p.y]),
      routing: c.routing,
      label: sc.history.undoLabel,
    };
  });
  t.ok(
    'dragging a segment moves it and pins the route to manual',
    pinned.routing === 'manual' && !eq(pinned.points, segDrag.points),
    `${JSON.stringify(segDrag.points)} -> ${JSON.stringify(pinned.points)}`,
  );
  t.ok(
    'and both anchors stay exactly where they were',
    eq(pinned.points[0], segDrag.points[0]) &&
      eq(pinned.points[pinned.points.length - 1], segDrag.points[segDrag.points.length - 1]),
    `${JSON.stringify(pinned.points[0])} / ${JSON.stringify(pinned.points[pinned.points.length - 1])}`,
  );
  t.ok('as one history entry', pinned.label === 'resize', pinned.label);

  const beforeNoop = await page.evaluate(() => window.__scene.history.undoLabel);
  const a2 = pinned.points[1];
  const b2 = pinned.points[2];
  const mid2 = await screenOf({ x: (a2[0] + b2[0]) / 2, y: (a2[1] + b2[1]) / 2 });
  const vertical2 = a2[0] === b2[0];
  const push2 = vertical2 ? [40, 0] : [0, 40];
  await page.mouse.move(...mid2);
  await page.mouse.down();
  await page.mouse.move(mid2[0] + push2[0], mid2[1] + push2[1], { steps: 6 });
  await page.mouse.move(mid2[0], mid2[1], { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  t.ok(
    'a segment dragged back to where it started commits nothing',
    (await page.evaluate(() => window.__scene.history.undoLabel)) === beforeNoop,
    'the fingerprint comparison already covers the route',
  );

  const reauto = await page.evaluate(() => {
    const sc = window.__scene;
    const c = sc.shapes.find((s) => s.kind === 'conn');
    const manual = c.points.map((p) => [p.x, p.y]);
    sc.replaceShape(c, { ...c, routing: 'auto' }, 're-route');
    const after = sc.shapes.find((s) => s.kind === 'conn');
    return { manual, routing: after.routing, points: after.points.map((p) => [p.x, p.y]) };
  });
  t.ok(
    'setting routing back to auto re-routes on the same commit',
    reauto.routing === 'auto' && !eq(reauto.points, reauto.manual),
    `${JSON.stringify(reauto.manual)} -> ${JSON.stringify(reauto.points)}`,
  );
}

/*
  The two round beads on the ends: the only way to move an arrow's ends once it exists.

  Driven with a real pointer rather than through `rebind` directly, because the part most
  likely to be wrong is not the shape's arithmetic -- it is whether the gesture reaches the
  bead at all, with a segment handle, a block edge and a block body all within a few pixels
  of it.
*/
const connState = () =>
  page.evaluate(() => {
    const sc = window.__scene;
    const c = sc.shapes.find((x) => x.kind === 'conn');
    return {
      from: c.from,
      fromAnchor: c.fromAnchor,
      to: c.to,
      toAnchor: c.toAnchor,
      routing: c.routing,
      points: c.points.map((q) => [q.x, q.y]),
      label: sc.history.undoLabel,
    };
  });

/** Identity, not equality: an uncommitted drag restores the snapshot array as it was. */
const markConn = () =>
  page.evaluate(() => {
    window.__probe = window.__scene.shapes.find((x) => x.kind === 'conn');
  });
const connUntouched = () =>
  page.evaluate(() => window.__scene.shapes.find((x) => x.kind === 'conn') === window.__probe);

// A third block, placed through the store at a point the viewport is known to have free, so a
// bead can actually be dragged onto it. Half the clearance the search guarantees, so it cannot
// land on top of anything.
const sink = await page.evaluate(
  (p) => {
    const sc = window.__scene;
    const src = sc.shapes.find((x) => x.kind === 'rect');
    const b = {
      ...src,
      name: 'sink_block',
      label: '',
      x: Math.round(p.x) - 24,
      y: Math.round(p.y) - 24,
      w: 48,
      h: 48,
    };
    sc.commit('add sink', () => {
      sc.shapes = [...sc.shapes, b];
      sc.selectOnly(sc.shapes.find((x) => x.kind === 'conn').name);
    });
    return b.name;
  },
  await emptyWorldPoint(),
);

const H = await page.evaluate(() => {
  const c = window.__scene.shapes.find((x) => x.kind === 'conn');
  const hs = window.__handles(c.name);
  return {
    ids: hs.map((h) => h.id),
    roles: hs.map((h) => h.role ?? 'reshape'),
    ends: hs.slice(0, 2).map((h) => [h.geom, h.pos.x, h.pos.y]),
    p0: [c.points[0].x, c.points[0].y],
    pN: [c.points[c.points.length - 1].x, c.points[c.points.length - 1].y],
    segs: c.points.length - 1,
  };
});
t.ok(
  'a connection offers one rebind handle per end, ahead of every segment handle',
  eq(H.ids.slice(0, 2), ['end:from', 'end:to']) &&
    eq(H.roles, ['rebind', 'rebind', ...Array(H.ids.length - 2).fill('reshape')]),
  JSON.stringify(H.ids),
);
t.ok(
  'sitting exactly on the two anchors, so the bead drawn there is the thing you grab',
  eq(H.ends[0], ['point', ...H.p0]) && eq(H.ends[1], ['point', ...H.pN]),
  JSON.stringify(H.ends),
);

const end0 = await connState();
const beadFrom = await screenOf({ x: end0.points[0][0], y: end0.points[0][1] });
await page.mouse.move(...beadFrom);
await page.mouse.down();
await page.mouse.move(beadFrom[0], beadFrom[1] + 32, { steps: 10 });
await page.waitForTimeout(100);
const sliding = await connState();
await page.mouse.up();
await page.waitForTimeout(300);
const slid = await connState();
t.ok(
  'dragging an end bead slides the anchor along the block it is already on',
  slid.from === end0.from && slid.fromAnchor !== end0.fromAnchor,
  `${end0.fromAnchor} -> ${slid.fromAnchor}`,
);
t.ok(
  'and the route follows it during the drag, not only on release',
  !eq(sliding.points, end0.points),
);
t.ok(
  'without pinning the route, which is what pressing the segment underneath would have done',
  slid.routing === end0.routing && slid.label === 'reanchor',
  `${slid.routing} / ${slid.label}`,
);

await markConn();
const beadTo = await screenOf({
  x: slid.points[slid.points.length - 1][0],
  y: slid.points[slid.points.length - 1][1],
});
await page.mouse.move(...beadTo);
await page.mouse.down();
await page.mouse.move(...(await centerOf(slid.from)), { steps: 12 });
await page.waitForTimeout(100);
const overSelf = await connState();
await page.mouse.up();
await page.waitForTimeout(300);
t.ok(
  'dragging an end onto the block at the other end is refused while it is still a preview',
  overSelf.to === slid.to && (await connUntouched()),
  `to ${overSelf.to}, still ${slid.to}`,
);

await markConn();
await page.mouse.move(...beadTo);
await page.mouse.down();
await page.mouse.move(...(await emptyWorld()), { steps: 12 });
await page.waitForTimeout(100);
await page.mouse.up();
await page.waitForTimeout(300);
t.ok(
  'and dropping one in open space leaves it bound where it was, committing nothing',
  await connUntouched(),
  'a connection has no free end to be left with',
);

await page.mouse.move(...beadTo);
await page.mouse.down();
await page.mouse.move(...(await edgeOf(sink, 'w')), { steps: 14 });
await page.waitForTimeout(100);
await page.mouse.up();
await page.waitForTimeout(300);
const moved = await page.evaluate((n) => {
  const sc = window.__scene;
  const c = sc.shapes.find((x) => x.kind === 'conn');
  const b = sc.shapes.find((x) => x.name === n);
  const tip = c.points[c.points.length - 1];
  return {
    to: c.to,
    toAnchor: c.toAnchor,
    label: sc.history.undoLabel,
    onEdge: tip.x === b.x || tip.x === b.x + b.w || tip.y === b.y || tip.y === b.y + b.h,
  };
}, sink);
t.ok(
  'dragging it onto a different block moves the arrowhead there',
  moved.to === sink && moved.label === 'reanchor',
  `${moved.to} @ ${moved.toAnchor}, ${moved.label}`,
);
t.ok('and the re-routed end lands on that block’s perimeter, not merely near it', moved.onEdge);

/* --------------------------------------------------------- V: rendering invariants ---- */

/*
  The beads are counted through `arc`, which nothing else on this canvas calls -- the dot grid
  and the timeline draw squares, and the only other `arc` in the app belongs to the connect
  tool's hover bead, which is not active here. `rect` would have been the wrong counter for
  exactly that reason: the prototype is shared with the grid's strip cache.
*/
const beads = await page.evaluate(async () => {
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.arc;
  let arcs = 0;
  proto.arc = function patched(...a) {
    arcs++;
    return orig.apply(this, a);
  };
  const frame = async () => {
    window.__session.renderer.requestFrame();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  };
  try {
    const sc = window.__scene;
    sc.selectOnly(sc.shapes.find((x) => x.kind === 'conn').name);
    await frame();
    arcs = 0;
    await frame();
    const selected = arcs;
    sc.clearSelection();
    await frame();
    arcs = 0;
    await frame();
    return { selected, unselected: arcs };
  } finally {
    proto.arc = orig;
  }
});
t.ok(
  'selecting a connection draws exactly two round beads, one per end',
  beads.selected === 2,
  `${beads.selected} arcs`,
);
t.ok(
  'and an unselected one draws none, so the round beads only mean “you can move this”',
  beads.unselected === 0,
  `${beads.unselected} arcs`,
);

const V = await page.evaluate(async () => {
  const proto = CanvasRenderingContext2D.prototype;
  const originals = {};
  const counts = { save: 0, restore: 0, stroke: 0, fill: 0 };
  for (const name of Object.keys(counts)) {
    originals[name] = proto[name];
    proto[name] = function patched(...args) {
      counts[name]++;
      return originals[name].apply(this, args);
    };
  }
  try {
    const sc = window.__scene;
    const blocks = sc.shapes.filter((s) => s.kind === 'rect');
    const conn = sc.shapes.find((s) => s.kind === 'conn');
    // Twenty connections between the same two blocks: distinguishable only by name, but every
    // one of them is a full route the renderer has to paint.
    sc.commit('bulk', () => {
      const extra = [];
      for (let i = 0; i < 20; i++) extra.push({ ...conn, name: `bulk_${i}`, label: '' });
      sc.shapes = [...blocks, ...extra];
      sc.clearSelection();
    });

    const r = window.__session.renderer;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    for (const k of Object.keys(counts)) counts[k] = 0;
    r.requestFrame();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

    const ctx = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
    return {
      counts: { ...counts },
      conns: sc.shapes.filter((s) => s.kind === 'conn').length,
      dash: ctx.getLineDash().length,
      lineJoin: ctx.lineJoin,
      alpha: ctx.globalAlpha,
    };
  } finally {
    for (const name of Object.keys(counts)) proto[name] = originals[name];
  }
});

t.ok(
  'a frame with 20 connections uses no save/restore at all',
  V.counts.save === 0 && V.counts.restore === 0,
  `save ${V.counts.save}, restore ${V.counts.restore} — the diagram stack switches spaces with a restore closure`,
);
t.ok(
  'each unselected connection costs exactly one stroke and one fill',
  V.counts.stroke === V.conns && V.counts.fill >= V.conns,
  `${V.conns} connections -> ${V.counts.stroke} strokes, ${V.counts.fill} fills`,
);
t.ok(
  'and the frame leaves no canvas state behind',
  V.dash === 0 && V.lineJoin === 'miter' && V.alpha === 1,
  `dash ${V.dash}, lineJoin ${V.lineJoin}, alpha ${V.alpha}`,
);

const cull = await page.evaluate(async () => {
  const sc = window.__scene;
  const b0 = sc.shapes.find((s) => s.kind === 'rect');
  const far = { ...b0, name: 'far_block', x: b0.x + 3000, y: b0.y };
  const wire = {
    ...sc.shapes.find((s) => s.kind === 'conn'),
    name: 'long_wire',
    label: '',
    routing: 'auto',
    from: b0.name,
    fromAnchor: 'e',
    to: 'far_block',
    toAnchor: 'w',
  };
  // Let the router build the geometry. Injecting points directly would not survive `reroute`,
  // which re-anchors every auto route on the very commit that adds it.
  sc.commit('cull setup', () => {
    sc.shapes = [b0, far, wire];
    sc.clearSelection();
  });

  const c = sc.shapes.find((s) => s.name === 'long_wire');
  const v = window.__view;
  // Park the camera mid-run, where neither endpoint block is anywhere near the viewport.
  v.camX = (c.points[0].x + c.points[c.points.length - 1].x) / 2;
  v.camY = c.points[0].y - 200;
  v.clampCamera();

  let strokes = 0;
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.stroke;
  proto.stroke = function patched(...a) {
    strokes++;
    return orig.apply(this, a);
  };
  try {
    window.__session.renderer.requestFrame();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  } finally {
    proto.stroke = orig;
  }

  const vp = v.viewportWorld;
  const visible = (p) => p.x >= vp.x && p.x <= vp.x + vp.w && p.y >= vp.y && p.y <= vp.y + vp.h;
  return {
    strokes,
    span: c.points[c.points.length - 1].x - c.points[0].x,
    endsOffScreen: !visible(c.points[0]) && !visible(c.points[c.points.length - 1]),
    flat: Math.min(...c.points.map((p) => p.y)) === Math.max(...c.points.map((p) => p.y)),
  };
});
t.ok(
  'a long connection is drawn whenever any part of it is on screen',
  cull.strokes > 0 && cull.endsOffScreen,
  `${cull.strokes} strokes over a ${cull.span}-unit span with both endpoints off screen`,
);
t.ok(
  'even when its bounding box is zero-height, which a horizontal run always is',
  !cull.flat || cull.strokes > 0,
  `flat: ${cull.flat} — rectsIntersect compares inclusively, so a degenerate rect still hits`,
);

/*
  `report` prints page errors but does not fail on them, and this suite drives the property
  panel harder than any other. A `$state` written immediately before a synchronous
  `editor.set` makes the panel's push effect self-invalidating, and Svelte throws out of the
  flush -- which is a thrown error on every selection change and not one failed assertion
  anywhere. Only `verify/production.mjs` was checking for that, and it runs separately.
*/
t.ok(
  'and nothing threw on the page at any point',
  errors.length === 0,
  errors.slice(0, 2).join(' | '),
);

const code = t.report(errors);
await browser.close();
process.exit(code);
