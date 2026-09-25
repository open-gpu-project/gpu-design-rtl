import {
  DEV_URL,
  diagramCanvas,
  dragOn as dragOnCanvas,
  enumOptions,
  open,
  row,
  shapeKinds,
  shapeNames,
  suite,
  toCanvas,
} from './harness.mjs';

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

const dragOn = (from, to) => dragOnCanvas(page, box, from, to);

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
const kinds = () => shapeKinds(page);
const names = () => shapeNames(page);
const nifs = () => page.evaluate(() => window.__scene.shapes.filter((s) => s.kind === 'nif'));
const clear = async () => {
  await page.evaluate(() => {
    const sc = window.__scene;
    sc.commit('reset', () => {
      sc.shapes = [];
      sc.setSelection(new Set());
    });
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
  /*
    And the cell count comes FROM the drag. A fixed count ignores the dragged length on the flow
    axis, because a bounded queue's extent is `cells * spacing` -- so the shape committed was a
    different length from the one the cursor described. Nearest whole cell, hence the half-
    spacing tolerance rather than an equality.
  */
  t.ok(
    'and the cell count follows the dragged length',
    wide?.cells === Math.round(240 / wide?.spacing),
    `${wide?.cells} cells x ${wide?.spacing}`,
  );

  const tall = await shape(await draw('Digit5', 'fifo', slot(1, 0), { w: 50, h: 160 }));
  t.ok('a tall drag runs them vertically', tall?.orientation === 'vertical', tall?.orientation);
  t.ok(
    'a tall drag counts cells down its own axis',
    tall?.cells === Math.round(160 / tall?.spacing),
    `${tall?.cells} cells x ${tall?.spacing}`,
  );

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

// -------------------------------------------------------- the creation ghost ----

/*
  What the preview PROMISES.

  Two ways a ghost lies. It can be blank -- `drawBoxBody` gated `inner` behind `!ghost`, so the
  dividers that are the entire visual identity of a queue only appeared on release. And it can be
  the wrong size: with a fixed `cells`, the derived flow extent ignored the drag, so the dashed
  outline sat at a fixed length however far the cursor went. Neither is reachable from the type
  checker, and neither shows up in any assertion about the committed shape.
*/
{
  await clear();
  const at = slot(0, 0);

  /** Hold the drag open at `size` and read the live draft. */
  const holdAt = async (size) => {
    await page.mouse.move(box.x + at.x + size.w, box.y + at.y + size.h, { steps: 6 });
    await page.waitForTimeout(140);
    return page.evaluate(() => {
      const d = window.__scene.draft;
      if (d === null) return null;
      const b = window.__ops(d.kind).bounds(d);
      return { kind: d.kind, cells: d.cells, spacing: d.spacing, orientation: d.orientation, b };
    });
  };

  await page.keyboard.press('Digit5');
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();

  // Multiples of GRID, so the pointer's snap does not turn up as a discrepancy of its own.
  const short = await holdAt({ w: 128, h: 80 });
  const long = await holdAt({ w: 272, h: 80 });

  t.ok('a queue drag puts a ghost on the draft channel', short?.kind === 'fifo', String(short));
  t.ok(
    'whose cell count grows with the drag',
    short !== null && long !== null && long.cells > short.cells,
    `${short?.cells} -> ${long?.cells}`,
  );
  /*
    EXACTLY on the cursor, on both axes.

    It used to be asserted within half a cell on the flow axis, to leave room for `makeFifo`'s
    rounding. Since iteration 6.2 the pitch is one grid step and a creation drag is grid-snapped
    at both corners, so a dragged extent is always a whole number of cells and the rounding
    cannot fire through any gesture -- which makes the ghost's promise exact, and worth
    asserting as exact. The rounding itself is covered below, by calling `makeFifo` directly
    with corners a gesture could not produce.
  */
  t.ok(
    'and whose box tracks the cursor on the flow axis',
    long !== null && long.b.w === 272,
    `${long?.b.w} vs 272`,
  );
  t.ok('and matches it exactly across', long !== null && long.b.h === 80, String(long?.b.h));

  /*
    Divider ink, sampled across the ghost's flow axis at its vertical centre, in the manner of
    the label-plate probe below. Classified by colour: a lit ghost divider is `theme.ghostStroke`
    (#7dd3fc), far bluer than the empty body it is drawn on.
  */
  const lit = await page.evaluate(() => {
    const d = window.__scene.draft;
    const v = window.__view;
    const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
    const b = window.__ops(d.kind).bounds(d);
    let hits = 0;
    for (let i = 1; i < d.cells; i++) {
      const p = v.toScreen({ x: b.x + i * d.spacing, y: b.y + b.h / 2 });
      for (const dx of [0, -1, 1]) {
        const px = g.getImageData(Math.round(p.x * v.dpr) + dx, Math.round(p.y * v.dpr), 1, 1).data;
        if (px[2] > 150 && px[0] < 180) {
          hits++;
          break;
        }
      }
    }
    return { hits, want: d.cells - 1 };
  });
  t.ok(
    'the ghost draws its dividers, not just an empty dashed box',
    lit.want > 0 && lit.hits === lit.want,
    `${lit.hits}/${lit.want}`,
  );

  await page.mouse.up();
  await page.waitForTimeout(160);
  await page.keyboard.press('Digit1');

  const made = await page.evaluate(() => {
    const s = [...window.__scene.shapes].reverse().find((x) => x.kind === 'fifo');
    return s === undefined ? null : { cells: s.cells, b: window.__ops('fifo').bounds(s) };
  });
  t.ok(
    'and what is committed is the shape that was previewed',
    made !== null && made.cells === long.cells && made.b.w === long.b.w && made.b.h === long.b.h,
    `${JSON.stringify(made)} vs ${JSON.stringify(long)}`,
  );

  /*
    The two defaults themselves, which nothing pinned before iteration 6.2 -- which is precisely
    why nothing in the suite noticed when they changed. `blank()` is the file-load default as
    well as the toolbar's, so the two are asserted separately rather than assumed equal.
  */
  const pitch = await page.evaluate(() => {
    const drawn = [...window.__scene.shapes].reverse().find((x) => x.kind === 'fifo');
    const ops = window.__ops('fifo');
    const loaded = window.__doc.deserializeScene({
      version: 2,
      shapes: [
        {
          kind: 'fifo',
          name: 'q',
          label: '',
          subtitle: '',
          labelMode: 'inset',
          description: '',
          position: [0, 0],
          size: [64, 32],
          orientation: 'horizontal',
          cells: 4,
        },
      ],
    })[0];
    // Off-grid corners, which a snapped gesture cannot produce: the rounding, still there.
    const odd = window.__makeFifo({ x: 0, y: 0 }, { x: 105, y: 40 }, 'odd');
    return {
      drawn: drawn?.spacing ?? null,
      blank: ops.blank('z').spacing,
      loaded: loaded?.spacing ?? null,
      odd: { cells: odd.cells, spacing: odd.spacing },
    };
  });
  t.ok(
    'a queue drawn on the canvas has one-grid-step cells',
    pitch.drawn === 16,
    String(pitch.drawn),
  );
  t.ok('so does a fresh one', pitch.blank === 16, String(pitch.blank));
  t.ok(
    'and so does one loaded from a record that omits the pitch',
    pitch.loaded === 16,
    String(pitch.loaded),
  );
  t.ok(
    'and an off-grid extent still rounds to the nearest whole queue',
    pitch.odd.cells === 7 && pitch.odd.spacing === 16,
    JSON.stringify(pitch.odd),
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
  const before = await page.evaluate(() =>
    window.__scene.shapes.map((s) => JSON.stringify(s)).join('|'),
  );
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
    new one cannot simply take its slot in the new even spread: the spread for four and the
    spread for six do not line up, and it lands on top of an old one. Observed as a fourth at
    288 and a sixth at 304, overlapping by 28 of their 32 units -- the exact case this asserts,
    and reproducible again now that iteration 6.2 has put an interface back to 32 units.

    Six, which iteration 6.1 had to weaken to five: six 48-unit interfaces needed 288 of this
    face's 336 and could not be fitted around four already sitting at the four-way spread
    positions, so `freeOffset` did the documented thing and overlapped. Six 32-unit ones need
    192, and the question is a real one again rather than a face that is simply full.
  */
  const six = await spans(6);
  t.ok(
    'raising the count adds to the end and leaves the others put',
    six.length === 6 && JSON.stringify(six.slice(0, 4)) === JSON.stringify(four),
    JSON.stringify(six),
  );
  t.ok('and finds a free slot for each new one', !overlapping(six), JSON.stringify(six));

  const two = await spans(2);
  t.ok(
    'lowering it removes from the end',
    two.length === 2 && JSON.stringify(two) === JSON.stringify(four.slice(0, 2)),
    JSON.stringify(two),
  );

  /*
    What the 32-unit default is FOR, and the thing item 4 of iteration 6.2 is actually about:
    an interface's connection point is the centre of an edge, so it sits on a grid dot only
    while the along extent is a multiple of two grid steps. At 48 every anchor was 8 units off
    every dot, and so was every wire leaving one. Asserted on all four sides of a grid-aligned
    parent, since the two faces a fabric offers are not the two a block does.
  */
  const onGrid = await page.evaluate(() => {
    const ops = window.__ops('nif');
    const base = {
      kind: 'nif',
      name: 'p',
      label: '',
      description: '',
      parent: 'f',
      offset: 64,
      length: 32,
      depth: 16,
      protocol: 'axi3',
      modport: 'slave',
      pending: [0, 0],
      inward: true,
    };
    // A grid-aligned parent, and boxes placed the way `nifBox` would on each of its faces.
    const pr = { x: 128, y: 96, w: 320, h: 160 };
    const boxes = {
      n: { x: pr.x + 64, y: pr.y, w: 32, h: 16 },
      s: { x: pr.x + 64, y: pr.y + pr.h - 16, w: 32, h: 16 },
      e: { x: pr.x + pr.w - 16, y: pr.y + 64, w: 16, h: 32 },
      w: { x: pr.x, y: pr.y + 64, w: 16, h: 32 },
    };
    const out = {};
    for (const side of ['n', 'e', 's', 'w']) {
      const b = boxes[side];
      const s = { ...base, side, x: b.x, y: b.y, w: b.w, h: b.h };
      // Both ids. An `in` the parent does not offer resolves to the outward edge.
      out[side] = ['out', 'in'].flatMap((id) => {
        const a = ops.resolveAnchor(s, id);
        return [a.pos.x, a.pos.y];
      });
    }
    return { out, length: window.__ops('nif').blank('z').length };
  });
  const everyOn = Object.values(onGrid.out)
    .flat()
    .every((v) => v % 16 === 0);
  t.ok(
    'an interface’s anchors land on the grid, on all four sides',
    everyOn,
    JSON.stringify(onGrid.out),
  );
  t.ok(
    'because the default along extent is two grid steps',
    onGrid.length === 32,
    String(onGrid.length),
  );

  /*
    A face of MIXED vintages, on a fabric of its own so that setting the lengths cannot itself
    manufacture the overlap. This is what every document written before iteration 6.2 becomes
    the moment a port is added to it: `length` is saved per interface, so the ones already
    there are 48 units long and the new ones are 32. `freeOffset` used to test both intervals
    with a single length -- the new one's -- and called an old neighbour clear when it
    overlapped by up to 16 units.
  */
  await clear();
  const old48 = await draw('Digit6', 'fabric', slot(0, 0), { w: 340, h: 80 }, { interfaces: 2 });
  await page.evaluate(() => {
    const sc = window.__scene;
    for (const pin of sc.shapes.filter((s) => s.kind === 'nif')) {
      const cur = sc.shapes.find((x) => x.name === pin.name);
      sc.replaceShape(cur, { ...cur, length: 48 }, 'vintage');
    }
  });
  await page.waitForTimeout(160);
  const vintage = (await nifs()).map((s) => ({
    side: s.side,
    lo: s.offset,
    hi: s.offset + s.length,
  }));
  t.ok(
    'a fabric can carry interfaces of two vintages at once',
    vintage.length === 2 && vintage.every((s) => s.hi - s.lo === 48) && !overlapping(vintage),
    JSON.stringify(vintage),
  );

  await patchShape(old48, { interfaces: 4 });
  const mixed = (await nifs()).map((s) => ({
    side: s.side,
    lo: s.offset,
    hi: s.offset + s.length,
  }));
  t.ok(
    'and a new one packs against its neighbours’ own lengths, not against its own',
    mixed.length === 4 && !overlapping(mixed),
    JSON.stringify(mixed),
  );
  t.ok(
    'while the older ones keep the length they were saved with',
    mixed.filter((s) => s.hi - s.lo === 48).length === 2,
    JSON.stringify(mixed.map((s) => s.hi - s.lo)),
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

  /*
    The inward edge, asked of the PARENT and cached on the child.

    `anchorAt`, `resolveAnchor` and `anchors` are pure functions of one shape and never see the
    parent, so the answer has to be carried on the interface -- written by `reroute`, which does
    have the parent, exactly the way the box is. And it has to be in `reroute`'s unchanged
    comparison: a field in the returned object but not in the guard makes every commit allocate,
    and `commit` compares by identity, so each one records an undo entry that undoes nothing.
  */
  const inward = await page.evaluate(() => {
    const sc = window.__scene;
    const ops = window.__ops('nif');
    const pin = sc.shapes.find((s) => s.kind === 'nif');
    const deps = new Map(sc.shapes.map((s) => [s.name, s]));
    return { cached: pin.inward, stable: ops.reroute(pin, deps) === pin };
  });
  t.ok('a fabric’s interfaces are given an inward edge', inward.cached === true);
  t.ok('and re-rerouting one allocates nothing, so the undo history stays clean', inward.stable);
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

  /*
    What the panel offers for an interface. Asserted through the rendered rows rather than through
    the schema: a check that read the schema would pass against a panel still rendering a stale
    document, which is the one state `applyDocument` refuses.
  */
  await page.evaluate(() =>
    window.__scene.selectOnly(window.__scene.shapes.find((s) => s.kind === 'nif').name),
  );
  await page.waitForTimeout(400);
  t.ok(
    'an interface offers its protocol and its modport',
    JSON.stringify(await enumOptions(page, 'protocol')) === JSON.stringify(['axi3']) &&
      JSON.stringify(await enumOptions(page, 'modport')) === JSON.stringify(['master', 'slave']),
    `${JSON.stringify(await enumOptions(page, 'protocol'))} ${JSON.stringify(await enumOptions(page, 'modport'))}`,
  );

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

// ------------------------------------------------- the interface's box and its label ----

/*
  The interface is FLUSH INSIDE its parent's border, not centred on it.

  Straddling read as a pin glued to the outside, and a pin is the wrong picture for a bus port.
  Two consequences are worth asserting rather than assuming: the whole box must be inside the
  parent with its outward edge exactly on the border line, and `depth` must now be clamped --
  half of an over-deep box used to hang outside, where there was always room, and the whole of
  one has nowhere to go.

  `nif-geom.ts` is pure, so importing it by URL is safe here; it is `scene/registry.ts` that
  must never be reached that way.
*/
{
  const geom = await page.evaluate(async () => {
    const m = await import('/src/lib/scene/shapes/nif-geom.ts');
    const pr = { x: 100, y: 200, w: 320, h: 80 };
    const boxes = {};
    for (const side of ['n', 'e', 's', 'w']) boxes[side] = m.nifBox(pr, side, 64, 48, 16);
    return {
      pr,
      boxes,
      // A parent shallower than the interface is deep. Nowhere to put the overflow.
      shallow: m.nifBox({ x: 0, y: 0, w: 200, h: 10 }, 'n', 0, 48, 16),
      depth: m.NIF_DEPTH,
      length: m.NIF_LENGTH,
    };
  });

  const inside = (b) =>
    b.x >= geom.pr.x &&
    b.y >= geom.pr.y &&
    b.x + b.w <= geom.pr.x + geom.pr.w &&
    b.y + b.h <= geom.pr.y + geom.pr.h;
  t.ok(
    'an interface is wholly inside its parent on every border',
    Object.values(geom.boxes).every(inside),
    JSON.stringify(geom.boxes),
  );

  const coincident = {
    n: geom.boxes.n.y === geom.pr.y,
    s: geom.boxes.s.y + geom.boxes.s.h === geom.pr.y + geom.pr.h,
    e: geom.boxes.e.x + geom.boxes.e.w === geom.pr.x + geom.pr.w,
    w: geom.boxes.w.x === geom.pr.x,
  };
  t.ok(
    'with its outward edge exactly on the border line',
    Object.values(coincident).every(Boolean),
    JSON.stringify(coincident),
  );
  t.ok(
    'a parent shallower than the interface clamps the depth instead of punching through',
    geom.shallow.h === 10,
    JSON.stringify(geom.shallow),
  );

  /*
    And the label is drawn INSIDE, which is what the depth is for. It used to be painted past
    the outward face -- over the background, outside the parent -- and dropped outright on the
    `e` and `w` borders, silently losing half the positions a block offers.
  */
  await clear();
  const blk = await draw('Digit3', 'rect', slot(0, 0), { w: 260, h: 140 }, { interfaces: 1 });
  const pin = (await nifs())[0].name;

  /** Bright label ink inside the port's box, and in a band just outside its outward edge. */
  const ink = async (side) => {
    await patchShape(pin, { side, offset: 32, label: 'MEM', length: 64, depth: 20 });
    await page.evaluate(() => window.__scene.clearSelection());
    await page.waitForTimeout(180);
    return page.evaluate(
      ([n, f]) => {
        const s = window.__scene.shapes.find((x) => x.name === n);
        const v = window.__view;
        const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
        // Near-white, which only the label is. The two modport border colours and the amber of
        // a selected port all fail this on at least one component.
        const bright = (x, y) => {
          const d = g.getImageData(Math.round(x * v.dpr), Math.round(y * v.dpr), 1, 1).data;
          return d[0] > 180 && d[1] > 180 && d[2] > 180;
        };
        const a = v.toScreen({ x: s.x, y: s.y });
        const b = v.toScreen({ x: s.x + s.w, y: s.y + s.h });
        let within = 0;
        for (let x = a.x + 2; x < b.x - 2; x += 1) {
          for (let y = a.y + 2; y < b.y - 2; y += 1) if (bright(x, y)) within++;
        }
        // A band of the same thickness on the far side of the outward edge, which is the
        // parent's border -- so this is outside the parent altogether.
        const away = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s.side];
        let beyond = 0;
        for (let x = a.x; x <= b.x; x += 1) {
          for (let y = a.y; y <= b.y; y += 1) {
            const px = x + away[0] * (b.x - a.x + 3);
            const py = y + away[1] * (b.y - a.y + 3);
            if (bright(px, py)) beyond++;
          }
        }
        return { within, beyond, side: s.side, ok: f !== '' };
      },
      [pin, blk],
    );
  };

  t.ok(
    'a block’s port has no inward edge — a block has not said it has an inside',
    (await shape(pin))?.inward === false,
    String((await shape(pin))?.inward),
  );

  const north = await ink('n');
  t.ok('a label is drawn inside the interface box', north.within > 0, JSON.stringify(north));
  t.ok('and nothing is drawn past its outward edge', north.beyond === 0, JSON.stringify(north));

  /*
    `e` and `w` are the halves that used to be dropped. The text is turned a quarter turn so it
    runs along the border, always anticlockwise, so it reads bottom-to-top rather than upside
    down on one of the two.
  */
  const east = await ink('e');
  t.ok(
    'an e-side port has a label at all, turned to run along the border',
    east.within > 0,
    JSON.stringify(east),
  );
  t.ok('and it stays inside the box too', east.beyond === 0, JSON.stringify(east));

  /*
    And the label has a floor on the box's DEPTH, not just its width. `fitText` bounds width
    alone, so a port zoomed out until it is a few pixels deep would otherwise render glyphs
    taller than the box holding them -- the same shrink budget `insetType` applies to a block's
    heading.
  */
  const zoomed = await page.evaluate(
    ([n]) => {
      const v = window.__view;
      v.zoomTo(0.25, { x: v.cssW / 2, y: v.cssH / 2 });
      return { depth: window.__scene.shapes.find((x) => x.name === n).depth * 0.25 };
    },
    [pin],
  );
  await page.waitForTimeout(200);
  const faint = await page.evaluate(
    ([n]) => {
      const s = window.__scene.shapes.find((x) => x.name === n);
      const v = window.__view;
      const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
      const a = v.toScreen({ x: s.x, y: s.y });
      const b = v.toScreen({ x: s.x + s.w, y: s.y + s.h });
      let lit = 0;
      for (let x = a.x - 2; x <= b.x + 2; x += 0.5) {
        for (let y = a.y - 2; y <= b.y + 2; y += 0.5) {
          const d = g.getImageData(Math.round(x * v.dpr), Math.round(y * v.dpr), 1, 1).data;
          if (d[0] > 180 && d[1] > 180 && d[2] > 180) lit++;
        }
      }
      return lit;
    },
    [pin],
  );
  t.ok(
    'a port too shallow on screen drops its label rather than overflowing',
    zoomed.depth < 11 && faint === 0,
    `${zoomed.depth}px deep, ${faint} lit`,
  );
  await page.evaluate(() => window.__view.resetZoom());
  await page.waitForTimeout(160);
}

// ------------------------------------------------------------ dragging a pin ----

{
  await clear();
  const fab = await draw('Digit6', 'fabric', slot(0, 0), { w: 320, h: 80 }, { interfaces: 3 });
  const geom = await shape(fab);
  const pin = (await nifs())[0].name;

  const toScreen = (x, y) => toCanvas(page, x, y);
  const centreOf = async (n) => {
    const s = await shape(n);
    return toScreen(s.x + s.w / 2, s.y + s.h / 2);
  };
  const glue = () =>
    page.evaluate(
      ([n, f]) => {
        const s = window.__scene.shapes.find((x) => x.name === n);
        const p = window.__scene.shapes.find((x) => x.name === f);
        // The OUTWARD edge is what sits on the border line -- the box is wholly inside the
        // parent, not centred on the border, so its midpoint is half a depth in from it.
        return {
          side: s.side,
          offset: s.offset,
          on:
            Math.abs(s.y - p.y) < 0.01
              ? 'n'
              : Math.abs(s.y + s.h - (p.y + p.h)) < 0.01
                ? 's'
                : 'off',
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
      return { offset: s.offset, onBorder: Math.abs(s.y - p.y) < 0.01 };
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
        .map((s) => `${s.parent}/${s.side}/${s.offset}/${s.protocol}/${s.modport}`),
      // `box` is computed, so it must NOT be in the record.
      recordKeys: Object.keys(doc.shapes.find((r) => r.kind === 'nif') ?? {}),
    };
  });
  t.ok('a scene of fabrics and interfaces round-trips', round.same, JSON.stringify(round.order));
  t.ok(
    'carrying each interface parent, side, offset, protocol and modport',
    round.pins.every((p) => /^[^/]+\/[nesw]\/-?\d+\/axi3\/(master|slave)$/.test(p)),
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
          // Not a property of any kind -- see the assertion below.
          unknownKey: 'ignored',
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
      stale: 'unknownKey' in (back.find((s) => s.kind === 'nif') ?? {}),
      pin: back.find((s) => s.kind === 'nif')?.modport,
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
  /*
    An unknown key in a file is ignored. `hydrateShape` iterates the SCHEMA and skips any key not
    in it, so the key above is neither carried onto the shape nor treated as an error. That is
    what lets a file keep loading after a property is removed, and why `SceneDoc.version` need
    not change when one is.
  */
  t.ok('a record carrying a key no kind defines still loads', r.pin === 'slave', r.pin);
  t.ok('and the key is ignored rather than kept on the shape', r.stale === false);
}

const failed = t.report(errors);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
