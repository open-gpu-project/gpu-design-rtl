import { DEV_URL, diagramCanvas, open, suite } from './harness.mjs';

/*
  Iteration 6's curved links: the spline, the waypoint editing on it, and the badge that says
  two interfaces should not have been joined.

  Almost none of this is visible in a screenshot, which is why it is here as arithmetic. Whether
  the parameterisation cusps, whether the end tangent is really parallel to the last chord (the
  arrowhead's orientation depends on it), whether a straight shot stays exactly straight, whether
  a writer allocates when nothing changed -- all of it passes a pixel diff either way.

  `window.__curve`, `__ops` and `__doc` reach the app's own modules. Importing `scene/registry.ts`
  by URL from inside `page.evaluate` is the trap iteration 4.1 wrote down; pure modules like
  `curve.ts` are safe to import that way, and are, where it reads better.
*/

const t = suite('network');
const { browser, page, errors } = await open(DEV_URL);

const canvas = diagramCanvas(page);
const box = await canvas.boundingBox();

const toScreen = (x, y) =>
  page.evaluate(
    ([a, b]) => {
      const p = window.__view.toScreen({ x: a, y: b });
      return { x: p.x, y: p.y };
    },
    [x, y],
  );

async function click(at) {
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(140);
}

async function drag(from, to) {
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(220);
}

/** Load a document straight in, so every coordinate in a check is one the check chose. */
async function seed(shapes) {
  await page.evaluate((list) => {
    const sc = window.__scene;
    sc.commit('seed', () => {
      sc.shapes = window.__doc.deserializeScene({ version: 2, shapes: list });
      sc.setSelection(new Set());
    });
  }, shapes);
  await page.waitForTimeout(220);
}

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
const block = (name, x, y, w, h) => ({
  kind: 'rect',
  name,
  label: name,
  subtitle: '',
  labelMode: 'inset',
  description: '',
  position: [x, y],
  size: [w, h],
  interfaces: 0,
});

async function setPins(parent, spec) {
  await page.evaluate(
    ([p, list]) => {
      const sc = window.__scene;
      sc.shapes
        .filter((s) => s.kind === 'nif' && s.parent === p)
        .forEach((pin, i) => {
          const [side, channel, modport] = list[i] ?? list[0];
          const cur = sc.shapes.find((x) => x.name === pin.name);
          sc.replaceShape(cur, { ...cur, side, channel, modport }, 'pins');
        });
    },
    [parent, spec],
  );
  await page.waitForTimeout(220);
}

const pinsOf = (parent) =>
  page.evaluate(
    (p) =>
      window.__scene.shapes
        .filter((s) => s.kind === 'nif' && s.parent === p)
        .map((s) => ({ name: s.name, x: s.x + s.w / 2, y: s.y + s.h / 2 })),
    parent,
  );

const wires = () =>
  page.evaluate(() =>
    window.__scene.shapes
      .filter((s) => s.kind === 'conn')
      .map((s) => ({ name: s.name, path: s.path, routing: s.routing, points: s.points.length })),
  );

/** Draw a link with the connection tool between two world points. */
async function connect(a, b) {
  await page.keyboard.press('Digit4');
  await click(await toScreen(a.x, a.y));
  await click(await toScreen(b.x, b.y));
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(200);
}

// ----------------------------------------------------------- the spline, as maths ----

{
  const r = await page.evaluate(() => {
    const C = window.__curve;
    const P = (x, y) => ({ x, y });
    const straight = [P(0, 0), P(100, 0)];
    const bent = [P(0, 0), P(50, 40), P(100, 0)];
    const four = [P(0, 0), P(40, 60), P(90, -20), P(140, 30)];
    const unit = (x, y) => {
      const l = Math.hypot(x, y);
      return { x: x / l, y: y / l };
    };
    const near = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

    // Tangent reversals along the run: a cusp shows up as the direction flipping.
    let reversals = 0;
    let prev = null;
    for (let i = 0; i <= 60; i++) {
      const p0 = C.curveAt(four, i / 60);
      const p1 = C.curveAt(four, Math.min(1, i / 60 + 0.004));
      const d = { x: p1.x - p0.x, y: p1.y - p0.y };
      if (prev !== null && d.x * prev.x + d.y * prev.y < 0) reversals++;
      prev = d;
    }

    const flat = C.flattenCurve(bent);
    const bbox = flat.reduce(
      (acc, p) => ({ lo: Math.min(acc.lo, p.y), hi: Math.max(acc.hi, p.y) }),
      { lo: Infinity, hi: -Infinity },
    );

    const auto = (an, bn, ax, ay, bx, by) =>
      C.autoWaypoints(
        { id: 'a', pos: P(ax, ay), normal: an },
        { id: 'b', pos: P(bx, by), normal: bn },
      ).length;

    return {
      straightFlat: C.flattenCurve(straight).every((p) => Math.abs(p.y) < 1e-9),
      bends: bbox.hi > 20,
      // Centripetal Catmull-Rom cannot cusp between knots; uniform can.
      reversals,
      // The duplicated phantom is what makes this true, and `route.ts`'s arrowhead assumes it.
      endParallel: near(C.curveEndDirection(bent), unit(100 - 50, 0 - 40)),
      endParallelFour: near(C.curveEndDirection(four), unit(140 - 90, 30 + 20)),
      facing: auto(P(1, 0), P(-1, 0), 0, 0, 200, 0),
      offset: auto(P(1, 0), P(-1, 0), 0, 0, 200, 120),
      sameWay: auto(P(0, -1), P(0, -1), 0, 0, 200, 0),
      // Same normal, diagonally apart: two ports on the same face of two DIFFERENT parents.
      sameWayDiagonal: auto(P(0, -1), P(0, -1), 0, 0, 240, 160),
      // In front of the source, behind the target -- the half of the rule `arrives` carries.
      behind: auto(P(1, 0), P(1, 0), 0, 0, 200, 0),
      awayFromEachOther: auto(P(-1, 0), P(1, 0), 0, 0, 200, 0),
      keepsCollinear: C.collapseCurve([P(0, 0), P(50, 0), P(100, 0)]).length,
      keepsBend: C.collapseCurve([P(0, 0), P(50, 40), P(100, 0)]).length,
      dedupes: C.collapseCurve([P(0, 0), P(50, 40), P(50, 40), P(100, 0)]).length,
    };
  });

  t.ok('two control points is exactly a straight line', r.straightFlat);
  t.ok('a waypoint actually bends it', r.bends);
  t.ok(
    'and the spline never cusps between its knots',
    r.reversals === 0,
    `${r.reversals} reversals`,
  );
  /*
    The arrowhead's orientation rides on this. The phantom endpoints DUPLICATE their knot rather
    than reflecting it, which makes the end tangent parallel to the last chord -- exactly what
    `endDirection` assumes. The conversion is 0/0 there and has to be handled explicitly; an
    epsilon floor only makes the garbage finite, and the tangent came out nowhere near the chord.
  */
  t.ok('the end tangent is parallel to the last chord, on a three-point curve', r.endParallel);
  t.ok('and on a four-point one', r.endParallelFour);

  t.ok(
    'two interfaces facing each other get no waypoints at all',
    r.facing === 0,
    String(r.facing),
  );
  /*
    Iteration 6.2 inverted which of these is the common case. The rule used to be cos(15
    degrees) off either normal, which made a bow of anything meaningfully off-axis -- including
    the offset pair below, which is most of a real diagram. It is now simply "in front of
    both", so a link runs straight unless a straight line would leave or arrive backwards.
  */
  t.ok(
    'and neither does an offset pair, which runs straight rather than bowing',
    r.offset === 0,
    String(r.offset),
  );
  /*
    What still bows, and none of it by naming a fabric. Two anchors that SHARE a normal -- a
    loopback, two ports on one face -- make `arrives` exactly `-leaves`, so they can never both
    be positive; the diagonal pair is two ports on the same face of different parents, where a
    straight chord would run down through the far parent's body.
  */
  t.ok('but a pair facing the same way on one plane bows', r.sameWay === 2, String(r.sameWay));
  t.ok(
    'as does the same pair pulled diagonally apart',
    r.sameWayDiagonal === 2,
    String(r.sameWayDiagonal),
  );
  t.ok('as does a line that arrives at its target from behind', r.behind === 2, String(r.behind));
  t.ok(
    'and a pair facing away from each other',
    r.awayFromEachOther === 2,
    String(r.awayFromEachOther),
  );

  /*
    A waypoint is EXPLICIT: the user inserts it with the badge and removes it with Delete.
    Dropping one merely because it sits on the chord looked tidy and broke the feature --
    inserting into a straight curve puts the new point exactly on the chord by construction, so
    `normalize` deleted it in the same gesture that made it and clicking the badge did nothing.
  */
  t.ok(
    'a waypoint on the chord is kept, not tidied away',
    r.keepsCollinear === 3,
    String(r.keepsCollinear),
  );
  t.ok('a waypoint holding a bend is kept', r.keepsBend === 3, String(r.keepsBend));
  // Deduping is still required: the centripetal parameterisation divides by the chord length.
  t.ok('but two waypoints in the same place become one', r.dedupes === 3, String(r.dedupes));
}

// ------------------------------------------------- which family the tool chooses ----

{
  await seed([
    fabric('A', 80, 60, 320, 56, 1),
    fabric('B', 80, 360, 320, 56, 1),
    block('C', 520, 360, 120, 90),
  ]);
  await setPins('A', [['s', 'aw', 'master']]);
  await setPins('B', [['n', 'aw', 'slave']]);

  const [a] = await pinsOf('A');
  const [b] = await pinsOf('B');
  await connect(a, b);
  let w = await wires();
  t.ok(
    'a link between two interfaces is drawn as a curve',
    w[0]?.path === 'curve',
    JSON.stringify(w),
  );
  t.ok(
    'and an aligned pair gets a straight one — two points, no waypoints',
    w[0]?.points === 2,
    JSON.stringify(w),
  );

  // An interface to a plain block: one end wants a curve, the other does not.
  await connect(a, { x: 580, y: 360 });
  w = await wires();
  const toBlock = w.find((x) => x.name !== w[0].name);
  t.ok(
    'a plain arrow may still be drawn to an interface, and stays rectilinear',
    toBlock !== undefined && toBlock.path === 'ortho',
    JSON.stringify(w),
  );

  /*
    The bow rule end to end, and the settling fold with it. Dragging A's port from the bottom
    border to the top one reverses its outward normal, so the straight line to B now leaves
    backwards through A's own body and the link has to bow instead.

    The point of driving it through a gesture is the phrase "in the same commit": the shape of
    the link is two levels down from the thing that moved (fabric -> port -> link), which is
    exactly the chain that used to resolve one level per commit.
  */
  const bus = w[0].name;
  /*
    Pressed on the INWARD half of the port's box, not on its centre: two wires leave the centre
    of its outward edge, connections sit above their ports in the z-order, and a press within a
    few pixels of a wire grabs the wire.
  */
  const grip = await page.evaluate(() => {
    const s = window.__scene.shapes.find((x) => x.kind === 'nif' && x.parent === 'A');
    return [s.x + 12, s.y + 4];
  });
  const at = await toScreen(grip[0], grip[1]);
  const top = await toScreen(grip[0], 64);
  await page.keyboard.press('Digit1');
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + top.x, box.y + top.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const flipped = await page.evaluate((n) => {
    const sc = window.__scene;
    const pin = sc.shapes.find((s) => s.kind === 'nif' && s.parent === 'A');
    const link = sc.shapes.find((s) => s.name === n);
    return { side: pin.side, points: link.points.length, label: sc.history.undoLabel };
  }, bus);
  t.ok(
    'dragging a port to the opposite border moves it there',
    flipped.side === 'n',
    JSON.stringify(flipped),
  );
  t.ok(
    'and the link it carries bows in the same commit as the side change',
    flipped.points === 4,
    JSON.stringify(flipped),
  );
}

// ----------------------------------------------------------- waypoint editing ----

{
  await seed([fabric('A', 80, 60, 320, 56, 1), fabric('B', 80, 400, 320, 56, 1)]);
  await setPins('A', [['s', 'aw', 'master']]);
  await setPins('B', [['n', 'aw', 'slave']]);
  const [a] = await pinsOf('A');
  const [b] = await pinsOf('B');
  await connect(a, b);
  const name = (await wires())[0].name;
  await page.evaluate((n) => window.__scene.selectOnly(n), name);
  await page.waitForTimeout(200);

  const handles = () =>
    page.evaluate(
      (n) =>
        window.__handles(n).map((h) => ({
          id: h.id,
          role: h.role ?? 'reshape',
          glyph: h.glyph ?? null,
          pos: h.pos,
        })),
      name,
    );
  let hs = await handles();
  t.ok(
    'a straight curve offers its two ends and one insert badge',
    hs.filter((h) => h.role === 'rebind').length === 2 &&
      hs.filter((h) => h.role === 'action').length === 1,
    hs.map((h) => h.id).join(' '),
  );
  /*
    The badge is a HANDLE with an `action` role rather than a bespoke affordance, so it inherits
    hit priority over the line, a screen-constant grab radius and a knob. It is drawn as a plus
    rather than as the same square a waypoint uses, because two affordances that look identical
    say nothing about which one you drag.
  */
  t.ok(
    'the badge is drawn as a plus, not as another resize knob',
    hs.find((h) => h.role === 'action')?.glyph === 'plus',
  );
  t.ok('and a curve offers no segment handles', !hs.some((h) => h.id.startsWith('seg:')));

  const ins = hs.find((h) => h.role === 'action');
  await click(await toScreen(ins.pos.x, ins.pos.y));
  t.ok(
    'clicking it inserts a waypoint',
    (await wires())[0].points === 3,
    JSON.stringify(await wires()),
  );
  t.ok('which pins the route to manual', (await wires())[0].routing === 'manual');
  t.ok(
    'under its own undo entry',
    (await page.evaluate(() => window.__scene.history.undoLabel)) === 'insert point',
  );
  t.ok(
    'and the new point is selected, ready to be moved',
    JSON.stringify(await page.evaluate(() => window.__host.subPart)) ===
      JSON.stringify({ shape: name, index: 1 }),
    JSON.stringify(await page.evaluate(() => window.__host.subPart)),
  );

  hs = await handles();
  const way = hs.find((h) => h.id.startsWith('way:'));
  const from = await toScreen(way.pos.x, way.pos.y);
  await drag(from, { x: from.x + 96, y: from.y });
  const moved = await page.evaluate((n) => {
    const w = window.__scene.shapes.find((s) => s.name === n);
    return { x: w.points[1].x, y: w.points[1].y };
  }, name);
  t.ok(
    'dragging the waypoint moves it',
    Math.abs(moved.x - way.pos.x) > 64,
    `${way.pos.x} -> ${moved.x}`,
  );

  const label = await page.locator('.text-\\[var\\(--color-accent\\)\\]').allTextContents();
  t.ok(
    'and the status bar names it, counts it and gives its position',
    label.some((x) => /waypoint 1 \/ 1 · -?\d+, -?\d+/.test(x)),
    JSON.stringify(label),
  );

  await page.keyboard.press('Delete');
  await page.waitForTimeout(220);
  t.ok(
    'Delete removes the waypoint, not the connection',
    (await wires())[0]?.points === 2,
    JSON.stringify(await wires()),
  );
  t.ok(
    'under its own undo entry too',
    (await page.evaluate(() => window.__scene.history.undoLabel)) === 'delete point',
  );
  /*
    Nothing in `ToolHost` changes for any of this: `host.onKeyDown` gives the active tool first
    refusal before the global bindings see the key, so the whole feature is one branch in
    `SelectTool.onKeyDown` that returns `false` when there is no sub-part to remove.
  */
  await page.keyboard.press('Delete');
  await page.waitForTimeout(220);
  t.ok(
    'and with no waypoint selected, Delete falls through to the connection',
    (await wires()).length === 0,
  );

  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(250);
  t.ok('undo brings it back', (await wires()).length === 1, JSON.stringify(await wires()));
  t.ok(
    'and clears the sub-part cursor, which undo has no business restoring',
    (await page.evaluate(() => window.__host.subPart)) === null,
  );
}

// -------------------------------------------------------- violations and the badge ----

{
  await seed([fabric('A', 80, 60, 420, 56, 3), fabric('B', 80, 400, 420, 56, 3)]);
  await setPins('A', [
    ['s', 'aw', 'master'],
    ['s', 'aw', 'master'],
    ['s', 'r', 'master'],
  ]);
  await setPins('B', [
    ['n', 'aw', 'slave'],
    ['n', 'aw', 'master'],
    ['n', 'w', 'slave'],
  ]);
  const A = await pinsOf('A');
  const B = await pinsOf('B');
  for (let i = 0; i < 3; i++) await connect(A[i], B[i]);

  const diag = await page.evaluate(() =>
    Object.fromEntries([...window.__scene.diagnostics].map(([k, v]) => [k, v])),
  );
  const all = await wires();
  const clean = all.filter((w) => diag[w.name] === undefined);
  t.ok('a matched pair reports nothing', clean.length === 1, JSON.stringify(Object.keys(diag)));
  t.ok(
    'two masters is a violation',
    Object.values(diag).some((v) => v.some((m) => /Both ends are masters/.test(m))),
    JSON.stringify(diag),
  );
  t.ok(
    'so is a channel that does not match',
    Object.values(diag).some((v) => v.some((m) => /channel connects only to itself/.test(m))),
    JSON.stringify(diag),
  );
  t.ok(
    'and the messages are prose, not codes',
    Object.values(diag)
      .flat()
      .every((m) => m.length > 40 && /[a-z] [a-z]/.test(m)),
  );

  const allChannel = await page.evaluate(() => {
    const ops = window.__ops('conn');
    const nif = (n, ch, mp) => ({
      kind: 'nif',
      name: n,
      parent: 'p',
      side: 'n',
      offset: 0,
      length: 32,
      depth: 8,
      protocol: 'axi3',
      channel: ch,
      modport: mp,
      label: '',
      description: '',
      pending: [0, 0],
      x: 0,
      y: 0,
      w: 32,
      h: 8,
    });
    const wire = {
      kind: 'conn',
      name: 'w',
      label: '',
      description: '',
      labelOffset: [0, 0],
      from: 'a',
      to: 'b',
      fromAnchor: 'n',
      toAnchor: 'n',
      routing: 'auto',
      path: 'curve',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const run = (ca, cb) =>
      ops.diagnose(
        wire,
        new Map([
          ['a', nif('a', ca, 'master')],
          ['b', nif('b', cb, 'slave')],
        ]),
      ).length;
    return {
      allToAw: run('all', 'aw'),
      awToAll: run('aw', 'all'),
      awToW: run('aw', 'w'),
      ortho: ops.diagnose(
        { ...wire, path: 'ortho' },
        new Map([
          ['a', nif('a', 'aw', 'master')],
          ['b', nif('b', 'w', 'master')],
        ]),
      ).length,
    };
  });
  t.ok(
    'an “all” interface is compatible with any single channel',
    allChannel.allToAw === 0 && allChannel.awToAll === 0,
    JSON.stringify(allChannel),
  );
  t.ok('two different single channels are not', allChannel.awToW === 1, String(allChannel.awToW));
  /*
    A plain arrow between two interfaces is explicitly allowed -- it says "this talks to that"
    without claiming the two are wired -- so checking it would report violations about a
    relationship the user never asserted.
  */
  t.ok(
    'and a plain arrow between interfaces is never checked',
    allChannel.ortho === 0,
    String(allChannel.ortho),
  );

  // The badge: drawn and clicked from one function, which is what stops the two drifting.
  const bad = Object.keys(diag)[0];
  const at = await page.evaluate(async (n) => {
    const s = window.__scene.shapes.find((x) => x.name === n);
    const m = await import('/src/lib/scene/shapes/conn.ts');
    const p = m.badgeScreen(s, (q) => window.__view.toScreen(q));
    return { x: p.x, y: p.y };
  }, bad);
  await click(at);
  const dialog = page.locator('[role="dialog"][aria-label="Connection violations"]');
  t.ok('clicking the badge opens the violations popup', (await dialog.count()) === 1);
  t.ok(
    'listing every violation on that link',
    (await page.locator('[role="dialog"] li').count()) === diag[bad].length,
    `${await page.locator('[role="dialog"] li').count()} vs ${diag[bad].length}`,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  t.ok('and Escape closes it', (await dialog.count()) === 0);

  // Fixing the diagram must clear the badge.
  await page.evaluate((n) => {
    const sc = window.__scene;
    const w = sc.shapes.find((x) => x.name === n);
    const pin = sc.shapes.find((x) => x.name === w.to);
    sc.replaceShape(pin, { ...pin, modport: pin.modport === 'master' ? 'slave' : 'master' }, 'fix');
  }, bad);
  await page.waitForTimeout(250);
  t.ok(
    'and correcting the modport clears it',
    !(await page.evaluate((n) => window.__scene.diagnostics.has(n), bad)),
  );
}

// -------------------------------------------------------------- serialization ----

{
  const round = await page.evaluate(() => {
    const before = window.__scene.shapes;
    const back = window.__doc.deserializeScene(window.__doc.serializeScene(before));
    const w = back.filter((s) => s.kind === 'conn');
    return {
      same: before.length === back.length,
      paths: w.map((s) => `${s.path}/${s.points.length}`),
    };
  });
  t.ok('a scene of curved links round-trips', round.same, JSON.stringify(round.paths));
  t.ok(
    'keeping the path family and every waypoint',
    round.paths.every((p) => p.startsWith('curve/')),
    JSON.stringify(round.paths),
  );

  const manual = await page.evaluate(() => {
    const doc = {
      version: 2,
      shapes: [
        {
          kind: 'fabric',
          name: 'A',
          label: '',
          subtitle: '',
          labelMode: 'inset',
          description: '',
          position: [0, 0],
          size: [200, 40],
          interfaces: 1,
        },
        {
          kind: 'fabric',
          name: 'B',
          label: '',
          subtitle: '',
          labelMode: 'inset',
          description: '',
          position: [0, 300],
          size: [200, 40],
          interfaces: 1,
        },
        {
          kind: 'conn',
          name: 'w',
          label: '',
          description: '',
          labelOffset: [0, 0],
          routing: 'manual',
          path: 'curve',
          source: ['A.if_1', 'n'],
          target: ['B.if_1', 'n'],
          points: [
            [16, 0],
            [180, 150],
            [16, 300],
          ],
        },
      ],
    };
    const back = window.__doc.deserializeScene(doc);
    const w = back.find((s) => s.kind === 'conn');
    return w === undefined ? null : { path: w.path, pts: w.points.length, routing: w.routing };
  });
  /*
    A diagonal control polygon would be refused outright by the `ortho` guard in the `points`
    writer, which is why that guard has to be gated on `path` -- and `path` sorts before
    `points`, so the writer already sees the new family on a document that sets both.
  */
  t.ok(
    'a hand-written curved route with waypoints loads',
    manual !== null && manual.pts === 3,
    JSON.stringify(manual),
  );
  t.ok('and keeps its manual flag', manual?.routing === 'manual', JSON.stringify(manual));
}

// ------------------------------------------ an interface's two anchors, and the edge rule ----

/*
  An interface offers exactly two connection points: the centre of its outward edge, and -- on a
  fabric's ports only -- the centre of its inward one. Three things here are invisible to the
  type checker.

  The ids are EDGES, not compass points, and that fixes a live defect. `resolveAnchor` used to
  redirect only the face directly opposite the outward one, so a port dragged from the top border
  to the right-hand one left its wire attached to the short end of the box, running along the
  border instead of away from it. An id that does not name a side cannot go stale when the side
  changes.

  The normals must be the shared references out of `NORMALS`, because identity on a normal is a
  legitimate thing for a caller to test.

  And the edge a wire used is a rule of its own: outward-to-inward is a line drawn through a
  border, not a bus.
*/
{
  const anchors = await page.evaluate(() => {
    const ops = window.__ops('nif');
    const base = {
      kind: 'nif',
      name: 'p',
      label: '',
      description: '',
      parent: 'f',
      side: 'n',
      offset: 0,
      length: 48,
      depth: 16,
      protocol: 'axi3',
      channel: 'all',
      modport: 'slave',
      pending: [0, 0],
      inward: false,
      x: 100,
      y: 200,
      w: 48,
      h: 16,
    };
    const at = (p) => ({ ...base, ...p });
    const shot = (a) => (a === null ? null : { id: a.id, x: a.pos.x, y: a.pos.y, n: a.normal });
    const inward = at({ inward: true });
    // An `e`-side port, same box, to show the id does not carry the side with it.
    const east = at({ side: 'e' });
    return {
      plain: ops.anchors(at({})).map((a) => a.id),
      fabric: ops.anchors(inward).map((a) => a.id),
      out: shot(ops.resolveAnchor(at({}), 'out')),
      in: shot(ops.resolveAnchor(inward, 'in')),
      legacy: shot(ops.resolveAnchor(at({}), 'n:16')),
      nonsense: shot(ops.resolveAnchor(at({}), 'wat')),
      inOnBlock: shot(ops.resolveAnchor(at({}), 'in')),
      eastOut: shot(ops.resolveAnchor(east, 'out')),
      shared:
        ops.resolveAnchor(at({}), 'out').normal ===
        window.__ops('rect').anchors({
          kind: 'rect',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
        })[0].normal,
    };
  });

  t.ok(
    'a block’s port offers one anchor, its outward edge',
    JSON.stringify(anchors.plain) === JSON.stringify(['out']),
    JSON.stringify(anchors.plain),
  );
  t.ok(
    'a fabric’s port offers two',
    JSON.stringify(anchors.fabric) === JSON.stringify(['out', 'in']),
    JSON.stringify(anchors.fabric),
  );
  t.ok(
    'the outward anchor is the centre of the outward edge, pointing away',
    anchors.out.x === 124 && anchors.out.y === 200 && anchors.out.n.y === -1,
    JSON.stringify(anchors.out),
  );
  t.ok(
    'the inward one is the centre of the opposite edge, pointing in',
    anchors.in.x === 124 && anchors.in.y === 216 && anchors.in.n.y === 1,
    JSON.stringify(anchors.in),
  );
  t.ok('and the normal is the shared table reference, not an equal copy', anchors.shared);

  /*
    One rule covers three cases: a legacy `n:16` from a file written before the ids were edges,
    an `in` on a port whose parent does not offer one, and plain nonsense. A wire that cannot
    find its end would otherwise vanish, and the outward edge is the one a port always has.
  */
  t.ok(
    'a legacy compass id resolves to the outward edge',
    anchors.legacy?.id === 'out',
    JSON.stringify(anchors.legacy),
  );
  t.ok('so does nonsense', anchors.nonsense?.id === 'out', JSON.stringify(anchors.nonsense));
  t.ok(
    'and so does “in” on a port whose parent offers no inward edge',
    anchors.inOnBlock?.id === 'out',
    JSON.stringify(anchors.inOnBlock),
  );
  /*
    The defect the edge ids delete. With a compass id, a port dragged from `n` to `e` kept a
    wire pinned to whichever face the id named -- the short end of the box -- and the wire ran
    along the parent's border instead of away from it.
  */
  t.ok(
    'and the same id follows a port dragged to another border',
    anchors.eastOut?.n.x === 1 && anchors.eastOut?.n.y === 0,
    JSON.stringify(anchors.eastOut),
  );

  const edge = await page.evaluate(() => {
    const ops = window.__ops('conn');
    const nif = (n, mp, inward) => ({
      kind: 'nif',
      name: n,
      parent: 'f',
      side: 'n',
      offset: 0,
      length: 48,
      depth: 16,
      protocol: 'axi3',
      channel: 'all',
      modport: mp,
      label: '',
      description: '',
      pending: [0, 0],
      inward,
      x: 0,
      y: 0,
      w: 48,
      h: 16,
    });
    const wire = (fa, ta, path = 'curve') => ({
      kind: 'conn',
      name: 'w',
      label: '',
      description: '',
      labelOffset: [0, 0],
      from: 'a',
      to: 'b',
      fromAnchor: fa,
      toAnchor: ta,
      routing: 'auto',
      path,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    // One master and one slave throughout, so the modport rule never contributes a message.
    const run = (fa, ta, ia = true, ib = true, path = 'curve') =>
      ops.diagnose(
        wire(fa, ta, path),
        new Map([
          ['a', nif('a', 'master', ia)],
          ['b', nif('b', 'slave', ib)],
        ]),
      );
    return {
      outOut: run('out', 'out'),
      inIn: run('in', 'in'),
      mixed: run('out', 'in'),
      unavailable: run('out', 'in', true, false),
      legacy: run('n:16', 'out'),
      ortho: run('out', 'in', true, true, 'ortho'),
    };
  });

  t.ok('two outward edges are clean', edge.outOut.length === 0, JSON.stringify(edge.outOut));
  t.ok(
    'and so are two inward ones — a crossbar’s internal routing is real',
    edge.inIn.length === 0,
    JSON.stringify(edge.inIn),
  );
  t.ok(
    'one of each is a violation',
    edge.mixed.length === 1 && /inward edge/.test(edge.mixed[0]),
    JSON.stringify(edge.mixed),
  );
  /*
    A hand-edited file may say `in` on a port whose parent offers no inward edge. It is DRAWN on
    the outward edge, so the outward edge is what has to be reported on -- otherwise the file
    earns a violation about a wire nobody can see.
  */
  t.ok(
    'an “in” the parent does not offer is judged as the outward edge it is drawn on',
    edge.unavailable.length === 0,
    JSON.stringify(edge.unavailable),
  );
  t.ok(
    'a legacy id counts as outward here too',
    edge.legacy.length === 0,
    JSON.stringify(edge.legacy),
  );
  t.ok(
    'and a plain arrow is still never checked',
    edge.ortho.length === 0,
    JSON.stringify(edge.ortho),
  );
}

// ------------------------------------------------- the fold settles, in one call ----

/*
  Iteration 6.2. `rerouteAll` used to build its dependency map ONCE, from the array it was
  handed, so a call resolved exactly one level of the graph. The real chain is two deep --
  `conn -> nif -> fabric` -- which is why a wire glued to a port lagged the fabric that port
  sits on: live during the drag for a block-to-block wire, one commit late for this one.

  None of it shows in a screenshot taken after the gesture ends, which is how it survived two
  iterations. All three checks here are about a moment DURING a gesture, or about the array
  identity a second sweep hands back.
*/
{
  await seed([fabric('A', 120, 120, 320, 56, 1), block('C', 640, 400, 120, 90)]);
  await setPins('A', [['s', 'aw', 'master']]);
  const [pin] = await pinsOf('A');
  await connect(pin, { x: 640, y: 445 });

  const shot = () =>
    page.evaluate(() => {
      const sc = window.__scene;
      const w = sc.shapes.find((s) => s.kind === 'conn');
      const p = sc.shapes.find((s) => s.kind === 'nif');
      const a = window.__ops('nif').resolveAnchor(p, 'out');
      return {
        p0: [w.points[0].x, w.points[0].y],
        anchor: [a.pos.x, a.pos.y],
        pin: [p.x, p.y],
      };
    });

  /*
    The fixed point, which is three properties in one assertion: that the fold settles, that a
    settled array comes back BY REFERENCE (so a commit touching nothing cannot push an undo
    entry), and -- because `sweepCap` walks the graph -- that there is no dependency cycle.
  */
  const fixed = await page.evaluate(() => {
    const shapes = window.__scene.shapes;
    return window.__resolve.rerouteAll(shapes) === shapes;
  });
  t.ok('a committed scene is already a fixed point of the fold', fixed);

  const before = await shot();
  const grab = await toScreen(280, 144);
  await page.mouse.move(box.x + grab.x, box.y + grab.y);
  await page.mouse.down();
  await page.mouse.move(box.x + grab.x, box.y + grab.y - 96, { steps: 10 });
  await page.waitForTimeout(140);
  const during = await shot();
  await page.mouse.up();
  await page.waitForTimeout(250);

  /*
    The depth-two sibling of `connections.mjs`'s "a connection follows its block during the
    drag". That one passes on a depth-one chain and so passed before this change too; this one
    drags the FABRIC and watches the wire on its port, which is the case that lagged.
  */
  t.ok(
    'the port moves with the fabric mid-drag',
    JSON.stringify(during.pin) !== JSON.stringify(before.pin),
    JSON.stringify(during.pin),
  );
  t.ok(
    'and the wire on it keeps up in the same frame, not on release',
    JSON.stringify(during.p0) === JSON.stringify(during.anchor),
    `${JSON.stringify(during.p0)} vs anchor ${JSON.stringify(during.anchor)}`,
  );

  /*
    The load case, which is the same cut-off with no gesture in it at all. An interface has no
    saved position -- deliberately, it has a side and an offset -- so a port read from a file
    carries `blank()`'s origin until its own `reroute` runs. A wire bound to that port used to
    resolve against the origin copy and draw itself to the top-left of the world.
  */
  await seed([
    fabric('F', 160, 160, 320, 56, 1),
    {
      kind: 'nif',
      name: 'p',
      label: '',
      description: '',
      parent: 'F',
      side: 'n',
      offset: 96,
      size: [48, 16],
      protocol: 'axi3',
      channel: 'all',
      modport: 'master',
    },
    block('D', 640, 300, 120, 90),
    {
      kind: 'conn',
      name: 'w',
      label: '',
      description: '',
      labelOffset: [0, 0],
      routing: 'auto',
      path: 'curve',
      source: ['p', 'out'],
      target: ['D', 'w'],
      points: [
        [0, 0],
        [10, 10],
      ],
    },
  ]);

  const loaded = await page.evaluate(() => {
    const sc = window.__scene;
    const w = sc.shapes.find((s) => s.kind === 'conn');
    const p = sc.shapes.find((s) => s.kind === 'nif');
    if (w === undefined || p === undefined) return null;
    const a = window.__ops('nif').resolveAnchor(p, 'out');
    return {
      p0: [w.points[0].x, w.points[0].y],
      anchor: [a.pos.x, a.pos.y],
      pin: [p.x, p.y],
    };
  });
  t.ok(
    'a port read from a file is placed on its parent’s border',
    loaded !== null && JSON.stringify(loaded.pin) !== JSON.stringify([0, 0]),
    JSON.stringify(loaded),
  );
  t.ok(
    'and a wire bound to it lands on the real anchor, not the world origin',
    loaded !== null && JSON.stringify(loaded.p0) === JSON.stringify(loaded.anchor),
    JSON.stringify(loaded),
  );
}

// ------------------------------------- the arrowhead on a glancing arrival ----

/*
  A pixel check, because this one is invisible to every other kind.

  Iteration 6.2 made a straight diagonal the ordinary shape of a bus link, and a diagonal
  arrival meets a port at a glancing angle. `headIsClear` used to ask whether the head's BOX
  overlapped the target -- and an axis-aligned box cannot rotate, so the corner behind a barb
  swings past the tip's own plane and reports an overlap with the very face the arrow points
  at. Every bus link in the app lost its arrowhead, and nothing in the suite could tell: the
  geometry is right, the decision was wrong, and only lit pixels show the difference.

  Probed just off the arrow's axis, on the side away from the target, where the barb is the
  only thing that can put ink: the line itself is 1.5 CSS px wide and cannot reach.
*/
{
  await seed([fabric('S', 120, 120, 256, 80, 1), fabric('T', 560, 400, 256, 80, 1)]);
  await setPins('S', [['s', 'all', 'master']]);
  await setPins('T', [['n', 'all', 'slave']]);
  const [s] = await pinsOf('S');
  const [d] = await pinsOf('T');
  await connect(s, d);
  await page.evaluate(() => {
    window.__scene.setSelection(new Set());
    window.__session.renderer.requestFrame();
  });
  await page.waitForTimeout(300);

  const probe = await page.evaluate(() => {
    const v = window.__view;
    const sc = window.__scene;
    const c = sc.shapes.find((x) => x.kind === 'conn');
    if (c === undefined) return { n: -1, why: 'no link' };
    const pts = c.points;
    if (pts.length !== 2) return { n: -1, why: `${pts.length} points, so not a straight run` };
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dx = tip.x - prev.x;
    const dy = tip.y - prev.y;
    const l = Math.hypot(dx, dy);
    const dir = { x: dx / l, y: dy / l };
    // A glancing arrival is the point of the check; assert the geometry rather than assume it.
    const glance = Math.abs(dir.y);
    const target = sc.shapes.find((x) => x.name === c.to);
    /*
      Well inside the head: a third of the way from its base to its tip, where the triangle is
      still 3 CSS px wide either side of the axis, and 1.3 px off that axis -- clear of the
      1.5 px line, which is the only other thing that could light these pixels.
    */
    const base = { x: tip.x - dir.x * 6, y: tip.y - dir.y * 6 };
    const inTarget = (q) =>
      q.x >= target.x &&
      q.x <= target.x + target.w &&
      q.y >= target.y &&
      q.y <= target.y + target.h;
    const cand = [
      { x: base.x - dir.y * 1.3, y: base.y + dir.x * 1.3 },
      { x: base.x + dir.y * 1.3, y: base.y - dir.x * 1.3 },
    ].filter((q) => !inTarget(q));
    if (cand.length === 0) return { n: -1, why: 'no clear side' };
    const at = v.toScreen(cand[0]);
    const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
    const x0 = Math.round((at.x - 1) * v.dpr);
    const y0 = Math.round((at.y - 1) * v.dpr);
    const w = Math.max(1, Math.round(2 * v.dpr));
    const data = g.getImageData(x0, y0, w, w).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i] - 148) < 40 &&
        Math.abs(data[i + 1] - 163) < 40 &&
        Math.abs(data[i + 2] - 184) < 40
      )
        n++;
    }
    return { n, total: w * w, glance, why: '' };
  });

  t.ok(
    'a bus link between two ports arrives at a glancing angle',
    probe.glance !== undefined && probe.glance > 0.1 && probe.glance < 0.7,
    JSON.stringify(probe),
  );
  t.ok(
    'and still draws its arrowhead there',
    probe.n > 0 && probe.n >= probe.total * 0.6,
    JSON.stringify(probe),
  );
}

// ----------------------------------------- dragging a connection by its own body ----

/*
  The gesture the move set must NOT break, and which nothing covered before iteration 6.2.

  The first design for "a connection whose ends both moved travels rigidly" lived inside
  `conn.reroute` and compared each end's new anchor against the point it replaced. Dragging a
  connection by its body gives both ends a delta of exactly the drag, so that rule would have
  read the user's own gesture as a rigid move and silently undone it -- with no undo entry to
  notice, because nothing changed. Hence a check for the gesture itself.
*/
{
  await seed([
    block('P', 160, 160, 120, 90),
    block('Q', 560, 160, 120, 90),
    {
      kind: 'conn',
      name: 'hand',
      label: '',
      description: '',
      labelOffset: [0, 0],
      routing: 'manual',
      path: 'curve',
      source: ['P', 'e'],
      target: ['Q', 'w'],
      points: [
        [280, 205],
        [380, 112],
        [460, 112],
        [560, 205],
      ],
    },
  ]);

  const shot = () =>
    page.evaluate(() => {
      const w = window.__scene.shapes.find((s) => s.kind === 'conn');
      return w === undefined ? null : w.points.map((q) => [q.x, q.y]);
    });

  const before = await shot();
  // A point ON the wire, read from the curve rather than guessed at -- and with the wire
  // unselected, so the press cannot land on a waypoint knob or an insert badge instead of on
  // the body. `verify/README.md`'s rule about hard-coded coordinates applies to curves twice.
  const mid = await page.evaluate(() => {
    const w = window.__scene.shapes.find((s) => s.kind === 'conn');
    const at = window.__curve.curveAt(w.points, 0.5);
    return [at.x, at.y];
  });
  const grab = await toScreen(mid[0], mid[1]);
  await page.mouse.move(box.x + grab.x, box.y + grab.y);
  await page.mouse.down();
  await page.mouse.move(box.x + grab.x + 64, box.y + grab.y + 48, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await shot();

  const d = [after[1][0] - before[1][0], after[1][1] - before[1][1]];
  t.ok(
    'dragging a hand-drawn route by its body moves its waypoints',
    (d[0] !== 0 || d[1] !== 0) &&
      after[2][0] - before[2][0] === d[0] &&
      after[2][1] - before[2][1] === d[1],
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
  t.ok(
    'and both ends stay on the anchors it is bound to',
    JSON.stringify(after[0]) === JSON.stringify(before[0]) &&
      JSON.stringify(after[3]) === JSON.stringify(before[3]),
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
}

// ------------------------------------------------- what a gesture actually moves ----

/*
  Iteration 6.2, the second half. The select tool used to translate exactly the selection,
  which is wrong at both ends: a shape `reroute` will re-glue must not ALSO be moved by hand,
  and a connection whose two endpoints are both moving must be moved rather than patched.

  Both cases need a fabric with two ports and a hand-drawn bus between them -- the geometry
  that iteration 6 made ordinary and nothing covered.
*/
{
  await seed([fabric('G', 160, 200, 384, 120, 2), block('E', 800, 240, 120, 90)]);
  await setPins('G', [
    ['n', 'aw', 'master'],
    ['n', 'aw', 'slave'],
  ]);
  const pins = await pinsOf('G');
  await connect(pins[0], pins[1]);

  // Bend it by hand: a waypoint in the middle, dragged, which is what flips it to `manual`.
  const bent = await page.evaluate(() => {
    const sc = window.__scene;
    const w = sc.shapes.find((s) => s.kind === 'conn');
    const a = w.points[0];
    const b = w.points[w.points.length - 1];
    const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) - 96 };
    sc.replaceShape(w, { ...w, routing: 'manual', points: [a, mid, b] }, 'bend');
    return { interior: [mid.x, mid.y] };
  });
  await page.waitForTimeout(200);

  const read = () =>
    page.evaluate(() => {
      const sc = window.__scene;
      const w = sc.shapes.find((s) => s.kind === 'conn');
      const g = sc.shapes.find((s) => s.name === 'G');
      const ports = sc.shapes.filter((s) => s.kind === 'nif');
      return {
        pts: w.points.map((q) => [q.x, q.y]),
        routing: w.routing,
        origin: [g.x, g.y],
        offsets: ports.map((s) => s.offset),
      };
    });

  const before = await read();
  t.ok(
    'a bus between two ports of one fabric can be bent by hand',
    before.routing === 'manual' && before.pts.length === 3,
    JSON.stringify(before.pts),
  );

  const grab = await toScreen(352, 300);
  await page.mouse.move(box.x + grab.x, box.y + grab.y);
  await page.mouse.down();
  await page.mouse.move(box.x + grab.x + 128, box.y + grab.y + 64, { steps: 10 });
  await page.waitForTimeout(140);
  const during = await read();
  await page.mouse.up();
  await page.waitForTimeout(250);

  const delta = [during.origin[0] - before.origin[0], during.origin[1] - before.origin[1]];
  const moved = (i) =>
    during.pts[i][0] - before.pts[i][0] === delta[0] &&
    during.pts[i][1] - before.pts[i][1] === delta[1];
  t.ok('dragging the fabric moves it', delta[0] !== 0 || delta[1] !== 0, JSON.stringify(delta));
  /*
    The interior point is the whole test. Patching only slides the two ends, so before this
    change the waypoint stayed in world space and the bus deformed as the fabric travelled --
    and it did so mid-drag AND on release, because `reroute` splices the interior through
    verbatim on every sweep.
  */
  t.ok(
    'and a hand-drawn bus between two of its ports travels rigidly with it',
    moved(0) && moved(1) && moved(2),
    `${JSON.stringify(before.pts)} -> ${JSON.stringify(during.pts)} for ${JSON.stringify(delta)}`,
  );

  // Select the fabric TOGETHER with one of its own ports. The port is moved by `reroute`
  // because its parent moved; translating it as well slid it along the border by the delta.
  await page.evaluate(
    (pin) => {
      const sc = window.__scene;
      sc.setSelection(new Set(['G', pin]));
    },
    (await pinsOf('G'))[0].name,
  );
  await page.waitForTimeout(150);

  const beforeBoth = await read();
  const grab2 = await toScreen(352, 300 + 64);
  await page.mouse.move(box.x + grab2.x, box.y + grab2.y);
  await page.mouse.down();
  await page.mouse.move(box.x + grab2.x + 96, box.y + grab2.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterBoth = await read();

  t.ok(
    'selecting a fabric with one of its own ports still moves the fabric',
    afterBoth.origin[0] !== beforeBoth.origin[0],
    `${JSON.stringify(beforeBoth.origin)} -> ${JSON.stringify(afterBoth.origin)}`,
  );
  t.ok(
    'and the port rides along rather than sliding down its border',
    JSON.stringify(afterBoth.offsets) === JSON.stringify(beforeBoth.offsets),
    `${JSON.stringify(beforeBoth.offsets)} -> ${JSON.stringify(afterBoth.offsets)}`,
  );

  // The move set as a function, where the three cases are readable side by side.
  const sets = await page.evaluate(() => {
    const sc = window.__scene;
    const w = sc.shapes.find((s) => s.kind === 'conn');
    const pin = sc.shapes.find((s) => s.kind === 'nif');
    const sort = (set) => [...set].sort();
    return {
      fabric: sort(window.__resolve.movesWith(sc.shapes, new Set(['G']))),
      withPort: sort(window.__resolve.movesWith(sc.shapes, new Set(['G', pin.name]))),
      portAlone: sort(window.__resolve.movesWith(sc.shapes, new Set([pin.name]))),
      wire: w.name,
      pin: pin.name,
    };
  });
  t.ok(
    'the move set carries a connection whose every end is moving',
    JSON.stringify(sets.fabric) === JSON.stringify(['G', sets.wire].sort()),
    JSON.stringify(sets.fabric),
  );
  t.ok(
    'drops a child that its parent will place anyway',
    !sets.withPort.includes(sets.pin),
    JSON.stringify(sets.withPort),
  );
  t.ok(
    'and leaves a port dragged on its own exactly where it was',
    JSON.stringify(sets.portAlone) === JSON.stringify([sets.pin]),
    JSON.stringify(sets.portAlone),
  );
}

const failed = t.report(errors);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
