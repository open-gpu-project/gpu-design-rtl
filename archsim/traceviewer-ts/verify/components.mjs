import { DEV_URL, diagramCanvas, open, suite } from './harness.mjs';

/*
  Iteration 6's component kinds: the FIFO, the fabric, and the network interfaces a fabric or a
  block carries.

  Three things here cannot be reached from the type checker, and they are why this file exists.

  The first is that a FIFO's length is DERIVED -- `cells * spacing` -- so a drag that says
  otherwise must be overruled, and the minimum length of an unbounded one has to be enforced
  about the edge the drag PINNED rather than about its origin.

  The second is pixels: the label plate must be opaque (`theme.shapeFill` alone is not) and must
  stay inside the outline it is painted over.

  The third is the reference-identity contract. A writer that allocates when nothing changed
  records an undo entry that undoes nothing, and no assertion about geometry will ever notice.

  Nothing here imports `scene/registry.ts` by URL from inside `page.evaluate`. That is the trap
  iteration 4.1 wrote down: after an HMR update the app's own copy sits behind a versioned URL, a
  bare specifier resolves to a SECOND module instance with an empty registry, and `opsFor` throws
  `no ShapeOps registered` -- an uncaught error, so the suite dies with no summary and takes every
  later suite in the chain with it. `window.__ops` and `window.__doc` reach the live one.
*/

const t = suite('components');
const { browser, page, errors } = await open(DEV_URL);

const canvas = diagramCanvas(page);
const box = await canvas.boundingBox();

/*
  Positions derived from the live canvas, never hard-coded -- the convention iteration 3 added
  after the diagram pane shrank to make room for the trace panel and a fixed `y + 600` quietly
  became "the trace panel below it". A press delivered there moves the time cursor and clears the
  diagram selection, and the drag it belonged to creates nothing.
*/
const slot = (col, row) => ({
  x: 60 + col * Math.floor((box.width - 140) / 2),
  y: 40 + row * Math.floor((box.height - 120) / 2),
});
const within = (p) => p.x > 0 && p.y > 0 && p.x < box.width - 40 && p.y < box.height - 40;

async function dragOn(from, to) {
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(160);
}

/** Draw with a shape tool, then push a property patch onto whatever it made. */
async function draw(digit, kind, at, size, patch = {}) {
  const to = { x: at.x + size.w, y: at.y + size.h };
  if (!within(at) || !within(to))
    throw new Error(`gesture outside the canvas: ${JSON.stringify([at, to])}`);
  await page.keyboard.press(digit);
  await dragOn(at, to);
  await page.keyboard.press('Digit1'); // back to the pointer, or the next drag draws another one
  const name = await page.evaluate(
    (k) => [...window.__scene.shapes].reverse().find((s) => s.kind === k)?.name ?? null,
    kind,
  );
  if (name !== null && Object.keys(patch).length > 0) await patchShape(name, patch);
  return name;
}

async function patchShape(name, patch) {
  await page.evaluate(
    ([n, p]) => {
      const sc = window.__scene;
      const s = sc.shapes.find((x) => x.name === n);
      sc.replaceShape(s, { ...s, ...p }, 'probe');
    },
    [name, patch],
  );
  await page.waitForTimeout(160);
}

const shape = (name) =>
  page.evaluate((n) => window.__scene.shapes.find((s) => s.name === n) ?? null, name);
const kinds = () => page.evaluate(() => window.__scene.shapes.map((s) => s.kind));
const names = () => page.evaluate(() => window.__scene.shapes.map((s) => s.name));
const nifs = () => page.evaluate(() => window.__scene.shapes.filter((s) => s.kind === 'nif'));
const clear = async () => {
  await page.evaluate(() => {
    const sc = window.__scene;
    sc.commit('reset', () => {
      sc.shapes = [];
      sc.setSelection(new Set());
    });
    sc.history.clear?.();
  });
  await page.waitForTimeout(120);
};

// ------------------------------------------------------------------ the tools ----

{
  await page.keyboard.press('Digit4');
  const four = await page.evaluate(() => window.__host.activeToolId);
  await page.keyboard.press('Digit5');
  const five = await page.evaluate(() => window.__host.activeToolId);
  await page.keyboard.press('Digit6');
  const six = await page.evaluate(() => window.__host.activeToolId);
  await page.keyboard.press('Digit1');
  /*
    Digits come from toolbar POSITION, so a kind registered ahead of an existing tool renumbers
    it silently -- including the literal `Digit4` that `connections.mjs` presses. Asserting all
    three together is what makes "appended, not inserted" the thing under test.
  */
  t.ok(
    'the new tools take the next free digits and move no existing one',
    four === 'connect' && five === 'fifo' && six === 'fabric',
    `4=${four} 5=${five} 6=${six}`,
  );

  const wide = await shape(await draw('Digit5', 'fifo', slot(0, 0), { w: 240, h: 60 }));
  t.ok('dragging creates a queue', wide !== null && wide.kind === 'fifo', JSON.stringify(wide));
  t.ok(
    'a wide drag runs the cells horizontally',
    wide?.orientation === 'horizontal',
    wide?.orientation,
  );

  const tall = await shape(await draw('Digit5', 'fifo', slot(1, 0), { w: 50, h: 160 }));
  t.ok('a tall drag runs them vertically', tall?.orientation === 'vertical', tall?.orientation);

  const fab = await shape(await draw('Digit6', 'fabric', slot(0, 1), { w: 300, h: 70 }));
  t.ok('dragging creates a fabric', fab !== null && fab.kind === 'fabric', JSON.stringify(fab));
  t.ok('a new fabric starts with no interfaces', fab?.interfaces === 0, String(fab?.interfaces));
  t.ok(
    'and no interface tool exists — they come from the count',
    !(await page.evaluate(() => window.__host.toolGroups.flat().some((x) => x.id === 'nif'))),
  );
}

// ------------------------------------------------- the FIFO's derived length ----

{
  const geom = await page.evaluate(() => {
    const ops = window.__ops('fifo');
    const base = {
      kind: 'fifo',
      name: 'q',
      label: '',
      subtitle: '',
      labelMode: 'inset',
      description: '',
      x: 0,
      y: 0,
      w: 320,
      h: 64,
      orientation: 'horizontal',
      cells: 4,
      spacing: 48,
    };
    const mods = { shift: false, alt: false, ctrl: false, meta: false };
    const at = (p) => {
      const s = { ...base, ...p };
      const b = ops.bounds(s);
      return {
        span: `${b.x}..${b.x + b.w}`,
        w: b.w,
        h: b.h,
        handles: ops.handles(s).map((x) => x.id),
      };
    };
    const drag = (p, handle, x) => {
      const s = { ...base, ...p };
      const b = ops.bounds(ops.resize(s, handle, { x, y: 32 }, mods));
      return `${b.x}..${b.x + b.w}`;
    };
    return {
      four: at({}),
      nine: at({ cells: 9 }),
      coarse: at({ spacing: 96 }),
      vertical: at({ cells: 5, orientation: 'vertical' }),
      free: at({ cells: -1, spacing: 32, w: 600 }),
      cramped: at({ cells: -1, spacing: 32, w: 10 }),
      dividers: (() => {
        const d = window.__scene.shapes; // unused; kept out of the closure below
        return null;
      })(),
      flipPast: drag({ cells: -1, spacing: 32 }, 'w', 480),
      flipTight: drag({ cells: -1, spacing: 32 }, 'w', 400),
      pinEast: drag({ cells: -1, spacing: 32, w: 200 }, 'w', 96),
      pinWest: drag({ cells: -1, spacing: 32, w: 200 }, 'e', 96),
      boundedIgnoresStored: at({ cells: 4, spacing: 48, w: -500 }).span,
    };
  });

  t.ok(
    'length is cells x spacing, not what the drag asked for',
    geom.four.w === 192,
    String(geom.four.w),
  );
  t.ok('more cells lengthen it', geom.nine.w === 9 * 48, String(geom.nine.w));
  t.ok('wider spacing lengthens it too', geom.coarse.w === 4 * 96, String(geom.coarse.w));
  t.ok(
    'vertical derives the height instead',
    geom.vertical.h === 5 * 48 && geom.vertical.w !== 5 * 48,
    JSON.stringify(geom.vertical),
  );
  t.ok(
    'a bounded queue ignores a stored length entirely, sign included',
    geom.boundedIgnoresStored === '0..192',
    geom.boundedIgnoresStored,
  );

  t.ok(
    'a bounded horizontal queue offers only the cross axis',
    JSON.stringify(geom.four.handles) === JSON.stringify(['n', 's']),
    JSON.stringify(geom.four.handles),
  );
  t.ok(
    'a bounded vertical one offers the other cross axis',
    JSON.stringify(geom.vertical.handles) === JSON.stringify(['w', 'e']),
    JSON.stringify(geom.vertical.handles),
  );
  t.ok(
    'an unbounded one offers all eight, since its length is free',
    geom.free.handles.length === 8,
    JSON.stringify(geom.free.handles),
  );

  t.ok('unbounded keeps the length the user gave it', geom.free.w === 600, String(geom.free.w));
  t.ok(
    'but floors it so the four drawn cells and a gap still fit',
    geom.cramped.w === 4 * 32 + 16,
    String(geom.cramped.w),
  );

  /*
    The flip and the floor, together, because they interact.

    `resizeBox` encodes "dragged past the far edge" as a negative extent that the kind's
    `normalize` folds. Taking the magnitude of the stored length made that fold unreachable, so
    the box stayed anchored at the DRAGGED edge: pulling the west handle of a 0..320 queue out to
    480 drew it at 480..640, a whole box-width past the edge that was supposed to stay put. And
    because the floor was applied about the origin, shrinking the west edge of a 0..200 queue
    pushed the pinned east edge OUT while the gesture was shrinking the box.
  */
  t.ok('flipping past the pinned edge folds about it', geom.flipPast === '320..480', geom.flipPast);
  t.ok(
    'a flip that lands inside the floor still folds about the pinned edge',
    geom.flipTight === '320..464',
    geom.flipTight,
  );
  t.ok(
    'shrinking the west edge holds the east edge still',
    geom.pinEast === '56..200',
    geom.pinEast,
  );
  t.ok(
    'and shrinking the east edge holds the west edge still',
    geom.pinWest === '0..144',
    geom.pinWest,
  );
}

// ------------------------------------------------------------- the dividers ----

{
  const d = await page.evaluate(async () => {
    // Pure geometry, so a second module instance is harmless -- unlike the registry.
    const m = await import('/src/lib/scene/shapes/fifo-geom.ts');
    const base = { orientation: 'horizontal', x: 0, y: 0, w: 600, h: 64 };
    const of = (p) => m.dividers({ ...base, ...p }).map((v) => [v.at, v.gap]);
    return {
      four: of({ cells: 4, spacing: 48 }),
      nine: of({ cells: 9, spacing: 48 }),
      one: of({ cells: 1, spacing: 48 }),
      free: of({ cells: -1, spacing: 48, w: 600 }),
      max: m.MAX_CELLS,
    };
  });
  t.ok(
    'a bounded queue draws cells-1 interior dividers',
    d.four.length === 3 && d.nine.length === 8,
    `${d.four.length} / ${d.nine.length}`,
  );
  t.ok('a one-cell queue draws none', d.one.length === 0, JSON.stringify(d.one));
  t.ok(
    'and they sit on the spacing pitch',
    JSON.stringify(d.four.map((v) => v[0])) === JSON.stringify([48, 96, 144]),
    JSON.stringify(d.four),
  );
  t.ok(
    'none of a bounded queue is a gap border',
    d.four.every((v) => v[1] === false),
  );
  t.ok('unbounded draws one cell then three', d.free.length === 4, JSON.stringify(d.free));
  t.ok(
    'with exactly two dashed gap borders',
    d.free.filter((v) => v[1]).length === 2,
    JSON.stringify(d.free),
  );
  t.ok(
    'and they are in ascending order, never doubled',
    d.free.every((v, i) => i === 0 || v[0] > d.free[i - 1][0]),
    JSON.stringify(d.free),
  );
}

// ------------------------------------------------------------ the label plate ----

{
  await clear();
  const name = await draw(
    'Digit5',
    'fifo',
    slot(0, 0),
    { w: 260, h: 90 },
    { cells: 4, spacing: 48, label: 'MEMORY_WRITEBACK' },
  );
  t.ok('the plate group actually built its own queue', name !== null, String(name));

  /** Divider ink down the column of the queue's middle divider. */
  const column = async (patch) => {
    await patchShape(name, patch);
    await page.evaluate(() => window.__scene.clearSelection());
    await page.waitForTimeout(180);
    return page.evaluate((n) => {
      const f = window.__scene.shapes.find((s) => s.name === n);
      const v = window.__view;
      const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
      const p = v.toScreen({ x: f.x + 2 * f.spacing, y: f.y + f.h / 2 });
      let out = '';
      for (let dy = -30; dy <= 30; dy += 2) {
        const d = g.getImageData(
          Math.round(p.x * v.dpr),
          Math.round((p.y + dy) * v.dpr),
          1,
          1,
        ).data;
        /*
          Classified by COLOUR, not by brightness. The divider composites to roughly
          rgb(64,108,161) over the body's rgb(26,38,53) -- but the label's own glyphs are
          #dbe3ef, brighter still. A plain `blue > 120` test therefore reads a letter stroke as a
          surviving divider, which is how the first version of this check passed on a short label
          and failed on a long one for no reason to do with the plate.
        */
        out += d[2] > 120 && d[0] < 140 ? '|' : '.';
      }
      return out;
    }, name);
  };

  /** The outline's own columns, left and right, down the label's height. */
  const outline = async () =>
    page.evaluate((n) => {
      const f = window.__scene.shapes.find((s) => s.name === n);
      const v = window.__view;
      const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
      const ops = window.__ops('fifo');
      const b = ops.bounds(f);
      const read = (wx) => {
        const p = v.toScreen({ x: wx, y: f.y + f.h / 2 });
        let lit = 0;
        for (let dy = -14; dy <= 14; dy += 2) {
          // Two adjacent columns, because the stroke is aligned to whole device pixels and may
          // land on either side of the projected edge.
          for (const dx of [0, -1]) {
            const d = g.getImageData(
              Math.round(p.x * v.dpr) + dx,
              Math.round((p.y + dy) * v.dpr),
              1,
              1,
            ).data;
            if (d[2] > 150) {
              lit++;
              break;
            }
          }
        }
        return lit;
      };
      return { left: read(b.x), right: read(b.x + b.w), samples: 15 };
    }, name);

  const tabbed = await column({ labelMode: 'tabbed_left' });
  const inset = await column({ labelMode: 'inset' });

  t.ok('with the body empty the divider runs unbroken', /^\|+$/.test(tabbed), tabbed);
  /*
    One contiguous band, not a speckle. A translucent plate -- `theme.shapeFill` on its own --
    composites over the divider instead of hiding it, which reads as a dimmed line rather than
    no line and shows up here as `|` samples inside the band.
  */
  t.ok('an inset label blots one contiguous band out of it', /^\|+\.+\|+$/.test(inset), inset);

  /*
    And the plate stops at the outline.

    A label wider than its box is easy on a FIFO, whose length is fixed by its cell count -- and
    an unclamped plate then punched a hole straight through both vertical outlines at the label's
    height. Measured at 22 device pixels per side before the clamp.
  */
  const o = await outline();
  t.ok(
    'a label wider than the box does not erase the left outline',
    o.left === o.samples,
    `${o.left}/${o.samples}`,
  );
  t.ok('nor the right outline', o.right === o.samples, `${o.right}/${o.samples}`);

  /*
    Two lines, one band. Each plate sized to its own ink leaves a sliver of divider showing in
    the gap between them -- a floating stub of line between the label and the subtitle -- so the
    two are made to MEET at the block's vertical centre instead.
  */
  const twoLine = await column({ label: 'WRITEBACK', subtitle: 'AW channel' });
  t.ok(
    'a label and a subtitle blot one band, not two with a sliver between',
    /^\|+\.+\|+$/.test(twoLine),
    twoLine,
  );
}

// --------------------------------------------- the reference-identity contract ----

{
  await clear();
  const name = await draw(
    'Digit5',
    'fifo',
    slot(0, 0),
    { w: 200, h: 80 },
    { cells: 4, spacing: 32 },
  );
  const depth = () =>
    page.evaluate(() => (window.__scene.history.canUndo ? window.__scene.history.undoLabel : null));

  const before = await page.evaluate(() =>
    window.__scene.shapes.map((s) => JSON.stringify(s)).join('|'),
  );
  const entriesBefore = await page.evaluate(() => {
    let n = 0;
    // Count by draining a clone is not possible; use the exposed depth if there is one.
    return window.__scene.history.undoDepth ?? -1;
  });

  /*
    Typing a width a bounded queue cannot have, three times.

    `size.read` goes through the derived box, so it never returns what was typed -- which means
    `applyDocument` calls the writer on EVERY commit thereafter. A writer that allocates
    unconditionally then hands back a content-identical shape with a fresh identity, and
    `commit` -- which compares the array by identity -- records an undo entry for each. They
    restore a byte-identical scene, so the user presses Cmd+Z three times to no visible effect
    before the queue's creation comes off.
  */
  const applied = await page.evaluate((n) => {
    const sc = window.__scene;
    const ops = window.__ops('fifo');
    const def = ops.props.props.find((d) => d.key === 'size');
    const s = sc.shapes.find((x) => x.name === n);
    const ctx = { shapes: sc.shapes, index: sc.shapes.indexOf(s) };
    const r1 = def.write(s, [999, s.h], ctx);
    const r2 = def.write(s, [1, s.h], ctx);
    const r3 = def.write(s, [999, s.h + 16], ctx);
    return {
      derivedIsIgnored: r1.ok && r1.shape === s,
      derivedIsIgnoredEitherWay: r2.ok && r2.shape === s,
      crossAxisStillCommits: r3.ok && r3.shape !== s && r3.shape.h === s.h + 16,
    };
  }, name);
  t.ok(
    'the size writer returns the shape itself when only the derived axis differs',
    applied.derivedIsIgnored,
  );
  t.ok('whatever value the derived axis is given', applied.derivedIsIgnoredEitherWay);
  t.ok('but a real cross-axis change still goes through', applied.crossAxisStillCommits);

  const idem = await page.evaluate((n) => {
    const sc = window.__scene;
    const ops = window.__ops('fifo');
    const s = sc.shapes.find((x) => x.name === n);
    const ctx = { shapes: sc.shapes, index: sc.shapes.indexOf(s) };
    const same = (key, v) => {
      const def = ops.props.props.find((d) => d.key === key);
      const r = def.write(s, v, ctx);
      return r.ok && r.shape === s;
    };
    return {
      cells: same('cells', s.cells),
      spacing: same('spacing', s.spacing),
      orientation: same('orientation', s.orientation),
    };
  }, name);
  t.ok('re-writing the same cells count allocates nothing', idem.cells);
  t.ok('nor the same spacing', idem.spacing);
  t.ok('nor the same orientation', idem.orientation);
  t.ok(
    'and the scene is untouched by any of it',
    (await page.evaluate(() => window.__scene.shapes.map((s) => JSON.stringify(s)).join('|'))) ===
      before,
  );
  void entriesBefore;
  void depth;
}

// -------------------------------------------------------- interfaces on a parent ----

{
  await clear();
  const fab = await draw('Digit6', 'fabric', slot(0, 0), { w: 340, h: 80 });

  const spans = async (n) => {
    await patchShape(fab, { interfaces: n });
    return (await nifs()).map((s) => ({ side: s.side, lo: s.offset, hi: s.offset + s.length }));
  };
  const overlapping = (iv) =>
    iv.some((a, i) =>
      iv.some((z, j) => i !== j && a.side === z.side && a.lo < z.hi && z.lo < a.hi),
    );

  const four = await spans(4);
  t.ok('a count of four spawns four interfaces', four.length === 4, JSON.stringify(four));
  t.ok(
    'spread along the default border, not stacked at its corner',
    new Set(four.map((s) => s.lo)).size === 4 && four.some((s) => s.lo > 0),
    JSON.stringify(four.map((s) => s.lo)),
  );
  t.ok('none of them overlapping', !overlapping(four), JSON.stringify(four));

  /*
    Raising the count keeps the interfaces already placed -- they may have been dragged -- so the
    new ones cannot simply take their slot in the new even spread: the spread for four and the
    spread for six do not line up, and one of the new ones lands on top of an old one. Observed
    as a fourth interface at 288 and a sixth at 304, overlapping by 28 of their 32 units.
  */
  const six = await spans(6);
  t.ok(
    'raising the count adds to the end and leaves the others put',
    six.length === 6 && JSON.stringify(six.slice(0, 4)) === JSON.stringify(four),
    JSON.stringify(six),
  );
  t.ok('and finds free slots for the new ones', !overlapping(six), JSON.stringify(six));

  const two = await spans(2);
  t.ok(
    'lowering it removes from the end',
    two.length === 2 && JSON.stringify(two) === JSON.stringify(four.slice(0, 2)),
    JSON.stringify(two),
  );

  t.ok(
    'a fabric offers only its top and bottom borders',
    JSON.stringify(await page.evaluate(() => window.__ops('fabric').interfaceSides({}))) ===
      JSON.stringify(['n', 's']),
  );
  t.ok(
    'a block offers all four',
    JSON.stringify(await page.evaluate(() => window.__ops('rect').interfaceSides({}))) ===
      JSON.stringify(['n', 'e', 's', 'w']),
  );
}

// ------------------------------------------------------ z-order, delete, cascade ----

{
  const fab = await page.evaluate(
    () => window.__scene.shapes.find((s) => s.kind === 'fabric').name,
  );
  await patchShape(fab, { interfaces: 2 });
  // A second shape, so "restacked past something" is actually observable.
  await draw('Digit3', 'rect', slot(1, 1), { w: 90, h: 70 });

  /*
    Interfaces must sit directly above the parent they are glued to: both `hitTest` and
    `anchorHitTest` walk the z-order top-down, so an interface underneath its parent is
    unclickable and a wire aimed at it attaches to the fabric's body instead. Appending would put
    it there once -- but one `bringToFront` on the parent buries every interface it owns, which is
    why the reconcile re-seats them on every commit.
  */
  const order = await names();
  const fi = order.indexOf(fab);
  const pins = order.filter((n) => n.startsWith(`${fab}.`));
  t.ok(
    'interfaces sit directly above their parent',
    order[fi + 1] === pins[0] && order[fi + 2] === pins[1],
    order.join(','),
  );

  await page.evaluate((n) => window.__scene.selectOnly(n), fab);
  await page.evaluate(() => window.__host.bringToFront());
  await page.waitForTimeout(160);
  const after = await names();
  const ai = after.indexOf(fab);
  t.ok(
    'and are still above it after the parent is brought to the front',
    after[ai + 1] === pins[0] && after[ai + 2] === pins[1],
    after.join(','),
  );
  t.ok('which did move the parent past the other shape', ai > 0, after.join(','));

  // Deleting an interface is refused, and must not record an undo entry for doing nothing.
  const label = await page.evaluate(() => window.__scene.history.undoLabel);
  await page.evaluate(() =>
    window.__scene.selectOnly(window.__scene.shapes.find((s) => s.kind === 'nif').name),
  );
  await page.keyboard.press('Delete');
  await page.waitForTimeout(160);
  t.ok(
    'an interface cannot be deleted on its own',
    (await nifs()).length === 2,
    String((await nifs()).length),
  );
  t.ok(
    'and the refusal records no undo entry',
    (await page.evaluate(() => window.__scene.history.undoLabel)) === label,
    `${label} -> ${await page.evaluate(() => window.__scene.history.undoLabel)}`,
  );

  // Deleting the parent takes them with it, and undo brings all three back.
  await page.evaluate((n) => window.__scene.selectOnly(n), fab);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  t.ok(
    'deleting the parent cascades to its interfaces',
    !(await kinds()).includes('nif') && !(await kinds()).includes('fabric'),
    (await kinds()).join(','),
  );
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(250);
  const back = await kinds();
  t.ok(
    'and one undo restores the parent and both interfaces',
    back.filter((k) => k === 'nif').length === 2 && back.includes('fabric'),
    back.join(','),
  );
}

// ------------------------------------------------------------ dragging a pin ----

{
  await clear();
  const fab = await draw('Digit6', 'fabric', slot(0, 0), { w: 320, h: 80 }, { interfaces: 3 });
  const geom = await shape(fab);
  const pin = (await nifs())[0].name;

  const toScreen = (x, y) =>
    page.evaluate(
      ([a, b2]) => {
        const p = window.__view.toScreen({ x: a, y: b2 });
        return { x: p.x, y: p.y };
      },
      [x, y],
    );
  const centreOf = async (n) => {
    const s = await shape(n);
    return toScreen(s.x + s.w / 2, s.y + s.h / 2);
  };
  const glue = () =>
    page.evaluate(
      ([n, f]) => {
        const s = window.__scene.shapes.find((x) => x.name === n);
        const p = window.__scene.shapes.find((x) => x.name === f);
        const mid = s.y + s.h / 2;
        return {
          side: s.side,
          offset: s.offset,
          on: Math.abs(mid - p.y) < 0.01 ? 'n' : Math.abs(mid - (p.y + p.h)) < 0.01 ? 's' : 'off',
          within: s.x >= p.x && s.x + s.w <= p.x + p.w,
          right: s.x + s.w,
          edge: p.x + p.w,
          parentBox: `${p.x},${p.y} ${p.w}x${p.h}`,
        };
      },
      [pin, fab],
    );

  const parentBefore = (await glue()).parentBox;

  /*
    A press near the border used to start resizing the PARENT: an interface is glued exactly
    where the parent's invisible edge grab zone runs, and handles of a selected shape beat any
    body underneath them. Selecting a fabric therefore covered every one of its interfaces with a
    resize zone and made them ungrabbable until it was deselected.
  */
  await page.evaluate((n) => window.__scene.selectOnly(n), fab);
  const start = await centreOf(pin);
  const acrossTo = await toScreen(geom.x + geom.w / 2, geom.y + geom.h);
  await dragOn(start, acrossTo);
  const moved = await glue();
  t.ok(
    'an interface can be dragged even while its parent is selected',
    moved.on !== 'off',
    JSON.stringify(moved),
  );
  t.ok(
    'dragging it across moves it to the other border',
    moved.side === 's' && moved.on === 's',
    JSON.stringify(moved),
  );
  t.ok(
    'and the parent is not resized by the gesture',
    moved.parentBox === parentBefore,
    `${moved.parentBox} vs ${parentBefore}`,
  );

  const farOut = await toScreen(geom.x + geom.w + 400, geom.y + geom.h);
  await dragOn(await centreOf(pin), farOut);
  const clamped = await glue();
  t.ok(
    'dragging it past the end clamps it inside the parent',
    clamped.within && clamped.right === clamped.edge,
    JSON.stringify(clamped),
  );

  await dragOn(await centreOf(pin), await toScreen(geom.x + geom.w / 2, geom.y));
  t.ok(
    'and it can be dragged back to the first border',
    (await glue()).side === 'n',
    JSON.stringify(await glue()),
  );

  // Moving the parent carries the interfaces, without rewriting their offsets.
  const off = (await glue()).offset;
  await page.evaluate((n) => window.__scene.selectOnly(n), fab);
  const fc = await toScreen(geom.x + geom.w / 2, geom.y + geom.h / 2);
  await dragOn(fc, { x: fc.x + 64, y: fc.y + 48 });
  const carried = await page.evaluate(
    ([n, f]) => {
      const s = window.__scene.shapes.find((x) => x.name === n);
      const p = window.__scene.shapes.find((x) => x.name === f);
      return { offset: s.offset, onBorder: Math.abs(s.y + s.h / 2 - p.y) < 0.01 };
    },
    [pin, fab],
  );
  t.ok('moving the parent carries its interfaces', carried.onBorder, JSON.stringify(carried));
  t.ok(
    'without rewriting the offset the user authored',
    carried.offset === off,
    `${off} -> ${carried.offset}`,
  );
}

// ------------------------------------------------------------- serialization ----

{
  const round = await page.evaluate(() => {
    const before = window.__scene.shapes;
    const doc = window.__doc.serializeScene(before);
    const back = window.__doc.deserializeScene(doc);
    const key = (s) => `${s.kind}:${s.name}`;
    return {
      same: JSON.stringify(before.map(key)) === JSON.stringify(back.map(key)),
      order: back.map(key),
      pins: back
        .filter((s) => s.kind === 'nif')
        .map((s) => `${s.parent}/${s.side}/${s.offset}/${s.protocol}/${s.channel}/${s.modport}`),
      // `box` is computed, so it must NOT be in the record.
      recordKeys: Object.keys(doc.shapes.find((r) => r.kind === 'nif') ?? {}),
    };
  });
  t.ok('a scene of fabrics and interfaces round-trips', round.same, JSON.stringify(round.order));
  t.ok(
    'carrying each interface parent, side, offset and bus identity',
    round.pins.every((p) =>
      /^[^/]+\/[nesw]\/-?\d+\/axi3\/(aw|w|b|ar|r|all)\/(master|slave)$/.test(p),
    ),
    JSON.stringify(round.pins),
  );
  t.ok(
    'and not the derived box, which is computed',
    !round.recordKeys.includes('box') && round.recordKeys.includes('side'),
    JSON.stringify(round.recordKeys),
  );

  const fifoRound = await page.evaluate(() => {
    const doc = window.__doc.serializeScene([
      {
        kind: 'fifo',
        name: 'q',
        label: '',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        x: 16,
        y: 32,
        w: 999,
        h: 64,
        orientation: 'horizontal',
        cells: 4,
        spacing: 48,
      },
    ]);
    const back = window.__doc.deserializeScene(doc);
    const ops = window.__ops('fifo');
    return { size: doc.shapes[0].size, drawn: ops.bounds(back[0]).w, cells: back[0].cells };
  });
  t.ok(
    'a queue saves the length it actually draws',
    fifoRound.size[0] === 192,
    JSON.stringify(fifoRound.size),
  );
  t.ok(
    'and draws the same length after a reload, whatever the record said',
    fifoRound.drawn === 192 && fifoRound.cells === 4,
    `${fifoRound.drawn} / ${fifoRound.cells}`,
  );
}

/*
  The two-pass loader.

  Array order in the file is the Z-ORDER, which says nothing about what depends on what, while a
  record's writers see only the shapes loaded before it. A connection stored below its blocks --
  one `Cmd+[` does that -- had its endpoints refused, kept `blank`'s empty `from`, and was then
  dropped by `normalize`. Nothing threw; the wire was simply not there. Iteration 6 makes the
  chain three deep -- fabric to interface to connection -- so this goes from latent to ordinary.
*/
{
  const r = await page.evaluate(() => {
    const doc = {
      version: 2,
      shapes: [
        {
          kind: 'conn',
          name: 'w0',
          label: '',
          description: '',
          labelOffset: [0, 0],
          routing: 'auto',
          source: ['fab.if_1', 'n'],
          target: ['b', 'w'],
          points: [
            [160, 88],
            [240, 88],
          ],
        },
        {
          kind: 'nif',
          name: 'fab.if_1',
          label: '',
          description: '',
          parent: 'fab',
          side: 'n',
          offset: 32,
          size: [32, 8],
          protocol: 'axi3',
          channel: 'aw',
          modport: 'slave',
        },
        {
          kind: 'fabric',
          name: 'fab',
          label: '',
          subtitle: '',
          labelMode: 'inset',
          description: '',
          position: [80, 48],
          size: [160, 80],
          interfaces: 1,
        },
        {
          kind: 'rect',
          name: 'b',
          label: '',
          subtitle: '',
          labelMode: 'inset',
          description: '',
          position: [320, 48],
          size: [80, 80],
          interfaces: 0,
        },
      ],
    };
    const back = window.__doc.deserializeScene(doc);
    return {
      names: back.map((s) => s.name),
      wires: back.filter((s) => s.kind === 'conn').map((s) => `${s.from}->${s.to}`),
    };
  });
  t.ok(
    'a connection stored before BOTH its interface and that interface’s parent still loads',
    JSON.stringify(r.wires) === JSON.stringify(['fab.if_1->b']),
    JSON.stringify(r.wires),
  );
  t.ok(
    'and the file order, which is the z-order, is left alone',
    JSON.stringify(r.names) === JSON.stringify(['w0', 'fab.if_1', 'fab', 'b']),
    JSON.stringify(r.names),
  );
}

const failed = t.report(errors);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
