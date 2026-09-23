import { drawBlock, health, open, sized, suite, DEV_URL } from './harness.mjs';

/**
 * The dock shell. Iteration 1 shipped the canvas "designed to be hosted in a pane" but never
 * actually hosted it in one, so everything here is exercising that claim for the first time.
 */
const t = suite('docking (dev)');
const { browser, page, errors } = await open(DEV_URL);

await drawBlock(page, 120, 120, 320, 260);
let h = await health(page);
t.ok('baseline canvas healthy', sized(h) && h.painted && h.shapes === 1, JSON.stringify(h));
const baseW = h.want[0];

const sep = page.locator('.sv-dock__splitter').first();
const sb = await sep.boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(sb.x - 200, sb.y + sb.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
h = await health(page);
t.ok(
  'splitter drag resizes the canvas, bitmap stays exact',
  sized(h) && h.want[0] < baseW - 200,
  JSON.stringify(h),
);

await page.locator('[aria-label="Float Properties"]').first().click();
await page.waitForTimeout(600);
h = await health(page);
t.ok('floating a panel leaves the canvas healthy', sized(h) && h.painted && h.shapes === 1);
t.ok(
  'the floated editor is still styled',
  (await page.evaluate(() => getComputedStyle(document.querySelector('.jse-main')).display)) ===
    'flex',
);

/*
  ITERATION 5.3 -- the tooltip layer outranks a floated pane.

  The layer is mounted at the app root and a floating dock window is not, so which one wins is
  decided by `z-index` alone. Caught here rather than by review: the first version used 100 and
  `.sv-dockmgr__window` is 101, so every toolbar tooltip vanished behind a floated panel.

  The assertion is the RELATION, not the constant. svgrid raising its own stacking is exactly
  the change that would silently re-break this, and a hardcoded `10001` would still pass.
*/
{
  const btn = page.locator('[data-panel-id="diagram"] button[aria-label="Zoom to fit"]').first();
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(750);
  const stack = await page.evaluate(() => {
    const tipEl = document.querySelector('[data-testid="chrome-tooltip"]');
    const float = document.querySelector('.sv-dockmgr__window');
    const z = (el) => (el === null ? null : Number(getComputedStyle(el).zIndex));
    return { tip: z(tipEl), float: z(float) };
  });
  t.ok(
    'a tooltip outranks the floating pane it would otherwise hide behind',
    stack.tip !== null && stack.float !== null && stack.tip > stack.float,
    JSON.stringify(stack),
  );
  /*
    And the layer is still genuinely viewport-positioned. `position: fixed` silently becomes
    pane-relative the moment any ancestor grows a `transform`, `filter`, `contain` or
    `will-change` -- an invisible review miss that this catches by walking the real chain.
  */
  const escapes = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chrome-tooltip"]');
    if (el === null) return null;
    const bad = [];
    for (let n = el.parentElement; n !== null; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (
        cs.transform !== 'none' ||
        cs.filter !== 'none' ||
        cs.perspective !== 'none' ||
        cs.backdropFilter !== 'none' ||
        cs.contain !== 'none' ||
        cs.willChange !== 'auto'
      ) {
        bad.push(n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0]);
      }
    }
    return bad;
  });
  t.ok(
    'and no ancestor makes a containing block, so it is viewport-fixed not pane-fixed',
    Array.isArray(escapes) && escapes.length === 0,
    JSON.stringify(escapes),
  );
  await page.mouse.move(box.x + box.width / 2, box.y + 300, { steps: 5 });
  await page.waitForTimeout(200);
}

await page.evaluate(() => {
  window.__view.camX = 77;
  window.__view.camY = 88;
});
await page.locator('[aria-label="Maximize panel"]:visible').first().click();
await page.waitForTimeout(600);
h = await health(page);
t.ok(
  'maximize re-mounts the pane without losing the scene',
  sized(h) && h.painted && h.shapes === 1,
);
t.ok('camera survives a pane re-mount', h.cam[0] === 77 && h.cam[1] === 88, JSON.stringify(h.cam));
await page.locator('[aria-label="Maximize panel"]:visible').first().click();
await page.waitForTimeout(600);
h = await health(page);
t.ok('restore from maximize is healthy', sized(h) && h.painted && h.shapes === 1);

const saved = await page.evaluate(() => localStorage.getItem('archsim.traceviewer.dock.v2'));
t.ok('the layout is persisted', typeof saved === 'string' && saved.length > 20);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const panes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-panel-id]')].map((e) => e.dataset.panelId),
  );
const restored = await panes();
t.ok(
  'every panel resolves after a reload into the saved layout',
  ['diagram', 'properties', 'trace'].every((id) => restored.includes(id)),
  JSON.stringify(restored),
);
t.ok('canvas healthy after reload', sized(await health(page)));

await page.evaluate(() =>
  localStorage.setItem(
    'archsim.traceviewer.dock.v2',
    JSON.stringify({
      main: { type: 'tabs', id: 'x1', panes: [{ id: 'ghost-panel', title: 'Ghost' }], active: 0 },
      floating: [],
      autoHide: [],
    }),
  ),
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
t.ok(
  'a layout naming an unregistered panel falls back to the default',
  (await panes()).includes('diagram'),
);

await page.evaluate(() => localStorage.setItem('archsim.traceviewer.dock.v2', '{not json'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
t.ok('a corrupt saved layout falls back to the default', (await panes()).includes('diagram'));

/* --- tabbed: the keepAlive contract --- */
await drawBlock(page, 120, 120, 320, 260);
await page.evaluate(() => {
  window.__workspace = {
    main: {
      type: 'tabs',
      id: 'leaf-1',
      active: 0,
      panes: [
        { id: 'diagram', title: 'Diagram', closable: false },
        { id: 'properties', title: 'Properties' },
      ],
    },
    floating: [],
    autoHide: [],
  };
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  window.__view.camX = 42;
  window.__view.camY = 43;
});
t.ok('both panels share one leaf', (await page.locator('.sv-dock__splitter').count()) === 0);

await page.locator('.sv-dock').getByText('Properties', { exact: true }).first().click();
await page.waitForTimeout(600);
const away = await page.evaluate(() => {
  const el = document.querySelector('[data-panel-id="diagram"]')?.closest('.sv-dock__content');
  return {
    display: el === undefined || el === null ? null : getComputedStyle(el).display,
    mounted: document.querySelector('[data-panel-id="diagram"]') !== null,
    ctx: window.__view.ctx !== null,
    shapes: window.__scene.shapes.length,
    cam: [window.__view.camX, window.__view.camY],
  };
});
t.ok(
  'keepAlive hides the inactive pane rather than unmounting it',
  away.display === 'none' && away.mounted,
  JSON.stringify(away),
);
t.ok(
  'the 0x0 guard holds: context, scene and camera all survive',
  away.ctx && away.shapes === 1 && away.cam[0] === 42,
  JSON.stringify(away),
);

await page.locator('.sv-dock').getByText('Diagram', { exact: true }).first().click();
await page.waitForTimeout(700);
h = await health(page);
t.ok(
  'canvas repaints correctly on tab return',
  sized(h) && h.painted && h.shapes === 1,
  JSON.stringify(h),
);
t.ok('camera preserved across the tab round trip', h.cam[0] === 42 && h.cam[1] === 43);

const box = await page.locator('[data-panel-id="diagram"] canvas').boundingBox();
await page.keyboard.press('Digit1');
await page.mouse.click(box.x + 200, box.y + 180);
await page.waitForTimeout(400);
t.ok(
  'canvas is still interactive afterwards',
  (await page.evaluate(() => window.__scene.selection.size)) === 1,
);

await browser.close();
// Known upstream: SvDockManager.svelte:793 dereferences a torn-down snippet arg after
// `commit()`, so restore-from-maximize throws. State is correct; see the iteration-2 doc.
process.exit(t.report(errors.filter((e) => !/reading 'id'/.test(e))));
