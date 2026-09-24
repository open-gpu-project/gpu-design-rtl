import { DEV_URL, diagramCanvas, open, suite } from './harness.mjs';

/*
  Iteration 6's component kinds: the FIFO so far.

  Two things here cannot be reached from the type checker and are the reason this file exists.
  The first is that a FIFO's length is DERIVED -- `cells * spacing` -- so a drag that says
  otherwise must be overruled, and every consumer has to read it through one function. The
  second is the label plate, which is pixels: it has to be opaque, and `theme.shapeFill` alone
  is not, so a single-fill version composites over the dividers and looks almost right.

  Also covers the two-pass loader, because the case it fixes is a document that only LOOKS fine:
  the connection is dropped in silence, three layers down, and nothing throws.
*/

const t = suite('components');
const { browser, page, errors } = await open(DEV_URL);

const canvas = diagramCanvas(page);
const box = await canvas.boundingBox();

/** Draw a FIFO with the tool, then push a property patch onto it. */
async function drawFifo(x, y, w, h, patch = {}) {
  await page.keyboard.press('Digit5');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const name = await page.evaluate(() => {
    const f = [...window.__scene.shapes].reverse().find((s) => s.kind === 'fifo');
    return f?.name ?? null;
  });
  if (name !== null && Object.keys(patch).length > 0) {
    await page.evaluate(
      ([n, pt]) => {
        const sc = window.__scene;
        const f = sc.shapes.find((s) => s.name === n);
        sc.replaceShape(f, { ...f, ...pt }, 'probe');
      },
      [name, patch],
    );
    await page.waitForTimeout(150);
  }
  return name;
}

const shape = (name) =>
  page.evaluate((n) => window.__scene.shapes.find((s) => s.name === n) ?? null, name);

// ---------------------------------------------------------------- the tool ----

{
  await page.keyboard.press('Digit4');
  const four = await page.evaluate(() => window.__host.activeToolId);
  await page.keyboard.press('Digit5');
  const five = await page.evaluate(() => window.__host.activeToolId);
  /*
    Digits come from toolbar POSITION, so a kind registered ahead of an existing tool renumbers
    it silently -- including the literal `Digit4` that `connections.mjs` presses. Asserting both
    together is what makes "appended, not inserted" the thing under test.
  */
  t.ok(
    'the queue tool takes the next free digit and moves no existing one',
    four === 'connect' && five === 'fifo',
    `4=${four} 5=${five}`,
  );

  const name = await drawFifo(200, 180, 260, 70);
  const f = await shape(name);
  t.ok('dragging creates a queue', f !== null && f.kind === 'fifo', JSON.stringify(f));
  t.ok('a wide drag runs the cells horizontally', f?.orientation === 'horizontal', f?.orientation);

  const tall = await shape(await drawFifo(700, 180, 60, 240));
  t.ok('a tall drag runs them vertically', tall?.orientation === 'vertical', tall?.orientation);
}

// ------------------------------------------------------- the derived length ----

{
  const name = await drawFifo(200, 420, 300, 70, { cells: 4, spacing: 48 });
  const geom = await page.evaluate(async (n) => {
    const m = await import('/src/lib/scene/shapes/fifo-geom.ts');
    const reg = await import('/src/lib/scene/registry.ts');
    const f = window.__scene.shapes.find((s) => s.name === n);
    const at = (patch) => {
      const s = { ...f, ...patch };
      return {
        flow: m.flowExtent(s),
        bounds: reg.opsFor(s).bounds(s),
        dividers: m.dividers(s).map((d) => [d.at, d.gap]),
        handles: reg
          .opsFor(s)
          .handles(s)
          .map((x) => x.id),
      };
    };
    return {
      four: at({ cells: 4, spacing: 48 }),
      nine: at({ cells: 9, spacing: 48 }),
      coarse: at({ cells: 4, spacing: 96 }),
      unbounded: at({ cells: -1, spacing: 48, w: 600 }),
      cramped: at({ cells: -1, spacing: 48, w: 10 }),
      vertical: at({ cells: 5, spacing: 48, orientation: 'vertical' }),
    };
  }, name);

  // The drag was 300px wide; the length is 4 * 48 regardless, which is the whole point.
  t.ok(
    'length is cells x spacing, not what the drag asked for',
    geom.four.flow === 192 && geom.four.bounds.w === 192,
    `${geom.four.flow} / ${geom.four.bounds.w}`,
  );
  t.ok('more cells lengthen it', geom.nine.flow === 9 * 48, String(geom.nine.flow));
  t.ok('wider spacing lengthens it too', geom.coarse.flow === 4 * 96, String(geom.coarse.flow));
  t.ok(
    'vertical derives the height instead',
    geom.vertical.bounds.h === 5 * 48 && geom.vertical.bounds.w !== 5 * 48,
    JSON.stringify(geom.vertical.bounds),
  );

  t.ok(
    'a bounded queue draws cells-1 interior dividers',
    geom.four.dividers.length === 3 && geom.nine.dividers.length === 8,
    `${geom.four.dividers.length} / ${geom.nine.dividers.length}`,
  );
  t.ok(
    'and they sit on the spacing pitch',
    JSON.stringify(geom.four.dividers.map((d) => d[0])) === JSON.stringify([48, 96, 144]),
    JSON.stringify(geom.four.dividers),
  );
  t.ok(
    'none of them is a gap border',
    geom.four.dividers.every((d) => d[1] === false),
  );

  /*
    Handles on the free axis only. A knob on a derived axis is an affordance that refuses to do
    anything, which is worse than no knob: the user has to drag it to find that out.
  */
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
    geom.unbounded.handles.length === 8,
    JSON.stringify(geom.unbounded.handles),
  );

  // 1 + 3, with the two gap borders dashed, and the length authored rather than derived.
  t.ok(
    'unbounded draws one cell then three',
    geom.unbounded.dividers.length === 4,
    JSON.stringify(geom.unbounded.dividers),
  );
  t.ok(
    'with exactly two dashed gap borders',
    geom.unbounded.dividers.filter((d) => d[1]).length === 2,
    JSON.stringify(geom.unbounded.dividers),
  );
  t.ok(
    'unbounded keeps the length the user gave it',
    geom.unbounded.flow === 600,
    String(geom.unbounded.flow),
  );
  t.ok(
    'but floors it so the four cells and the gap still fit',
    geom.cramped.flow === 4 * 48 + 16,
    String(geom.cramped.flow),
  );
}

// ------------------------------------------------------------ the label plate ----

{
  const name = await drawFifo(200, 620, 300, 80, { cells: 4, spacing: 48, label: 'WIDE_LABEL' });

  /** Divider ink down the column of the queue's middle divider. */
  const column = async (patch) => {
    await page.evaluate(
      ([n, pt]) => {
        const sc = window.__scene;
        const f = sc.shapes.find((s) => s.name === n);
        sc.replaceShape(f, { ...f, ...pt }, 'probe');
        sc.clearSelection();
      },
      [name, patch],
    );
    await page.waitForTimeout(200);
    return page.evaluate((n) => {
      const f = window.__scene.shapes.find((s) => s.name === n);
      const v = window.__view;
      const g = document.querySelector('[data-panel-id="diagram"] canvas').getContext('2d');
      const p = v.toScreen({ x: f.x + 2 * f.spacing, y: f.y + f.h / 2 });
      let out = '';
      for (let dy = -24; dy <= 24; dy += 2) {
        const d = g.getImageData(
          Math.round(p.x * v.dpr),
          Math.round((p.y + dy) * v.dpr),
          1,
          1,
        ).data;
        // The divider is a light blue hairline; the body fill behind it is far darker.
        out += d[2] > 120 ? '|' : '.';
      }
      return out;
    }, name);
  };

  const tabbed = await column({ labelMode: 'tabbed_left' });
  const inset = await column({ labelMode: 'inset' });

  t.ok('with the body empty the divider runs unbroken', /^\|+$/.test(tabbed), tabbed);
  /*
    One contiguous band, not a speckle. A translucent plate -- `theme.shapeFill` on its own --
    composites over the divider instead of hiding it, which reads as a dimmed line rather than
    no line and would show up here as `|` samples inside the band.
  */
  t.ok('an inset label blots one contiguous band out of it', /^\|+\.+\|+$/.test(inset), inset);
  t.ok(
    'and the band is the label, not the whole cell',
    inset.includes('|') && inset.includes('.'),
    inset,
  );
}

// ------------------------------------------------------- serialization ----

{
  const round = await page.evaluate(async () => {
    const ser = await import('/src/lib/scene/serialize.ts');
    const before = window.__scene.shapes;
    const back = ser.deserializeScene(ser.serializeScene(before));
    const key = (s) => `${s.kind}:${s.name}`;
    return {
      same: JSON.stringify(before.map(key)) === JSON.stringify(back.map(key)),
      fifos: back
        .filter((s) => s.kind === 'fifo')
        .map((s) => `${s.cells}/${s.spacing}/${s.orientation}`),
    };
  });
  t.ok(
    'a scene of queues round-trips through the file format',
    round.same,
    JSON.stringify(round.fifos),
  );
  t.ok(
    'carrying cells, spacing and orientation',
    round.fifos.every((f) => /^-?\d+\/\d+\/(horizontal|vertical)$/.test(f)),
    JSON.stringify(round.fifos),
  );
}

/*
  The two-pass loader.

  Array order in the file is the Z-ORDER, which says nothing about what depends on what, while a
  record's writers see only the shapes loaded before it. A connection stored below its blocks --
  one `Cmd+[` does that -- had its endpoints refused, kept `blank`'s empty `from`, and was then
  dropped by `normalize`. Nothing threw; the wire was simply not there. Iteration 6 makes the
  chain three deep, so this goes from latent to ordinary.
*/
{
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
        source: ['a', 'e'],
        target: ['b', 'w'],
        points: [
          [160, 88],
          [240, 88],
        ],
      },
      {
        kind: 'rect',
        name: 'a',
        label: '',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        position: [80, 48],
        size: [80, 80],
      },
      {
        kind: 'rect',
        name: 'b',
        label: '',
        subtitle: '',
        labelMode: 'inset',
        description: '',
        position: [240, 48],
        size: [80, 80],
      },
    ],
  };
  const r = await page.evaluate(async (d) => {
    const ser = await import('/src/lib/scene/serialize.ts');
    const back = ser.deserializeScene(d);
    return {
      names: back.map((s) => s.name),
      wires: back.filter((s) => s.kind === 'conn').map((s) => `${s.from}->${s.to}`),
    };
  }, doc);

  t.ok(
    'a connection stored before its blocks still loads',
    JSON.stringify(r.wires) === JSON.stringify(['a->b']),
    JSON.stringify(r.wires),
  );
  t.ok(
    'and the file order, which is the z-order, is left alone',
    JSON.stringify(r.names) === JSON.stringify(['w0', 'a', 'b']),
    JSON.stringify(r.names),
  );
}

const failed = t.report(errors);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
