import { open, suite, PREVIEW_URL } from './harness.mjs';

/**
 * The built bundle, against `vite preview`. The DEV-only `window.__*` hooks are gone here, so
 * everything is asserted through the DOM -- which is the point: this is the artifact a user
 * would actually open.
 */
const t = suite('production bundle');
const { browser, page, errors } = await open(PREVIEW_URL, { clearStorage: false });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

t.ok('loads cleanly', errors.length === 0, errors.slice(0, 3).join(' | '));
t.ok('DEV hooks are stripped', await page.evaluate(() => window.__scene === undefined));
t.ok('dock rendered', (await page.locator('.sv-dock').count()) > 0);
const builtPanels = (
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-panel-id]')].map((e) => e.dataset.panelId),
  )
)
  .sort()
  .join();
t.ok('every panel present', builtPanels === 'diagram,properties,trace', builtPanels);

const c = await page.evaluate(() => {
  const el = document.querySelector('[data-panel-id="diagram"] canvas');
  const r = el.getBoundingClientRect();
  return { w: el.width, h: el.height, cw: r.width, ch: r.height, dpr: devicePixelRatio };
});
t.ok(
  'canvas bitmap matches its box at dpr 2',
  c.dpr === 2 &&
    Math.abs(c.w - Math.round(c.cw * 2)) <= 1 &&
    Math.abs(c.h - Math.round(c.ch * 2)) <= 1,
  JSON.stringify(c),
);

t.ok(
  'jsoneditor CSS survives the production build',
  (await page.evaluate(() => getComputedStyle(document.querySelector('.jse-main')).display)) ===
    'flex',
);

const sc = await page.evaluate(() => ({
  page: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
  panes: [...document.querySelectorAll('.sv-dock__content')].every(
    (e) => e.scrollHeight <= e.clientHeight + 1,
  ),
}));
t.ok('no page scrollbar', sc.page);
t.ok('no dock pane scrollbar', sc.panes);

const box = await page.locator('[data-panel-id="diagram"] canvas').boundingBox();
await page.mouse.move(box.x + 120, box.y + 120);
await page.keyboard.press('Digit2');
await page.mouse.move(box.x + 120, box.y + 120);
await page.mouse.down();
await page.mouse.move(box.x + 320, box.y + 260, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(600);

const keys = await page.evaluate(() =>
  [...document.querySelectorAll('[data-path]')]
    .map((e) => decodeURIComponent(e.getAttribute('data-path')))
    .filter((p) => p !== '' && !p.slice(1).includes('/')),
);
t.ok(
  'property panel populated, in declaration order',
  keys.join() === '/kind,/name,/label,/position,/size,/description,/zIndex',
  JSON.stringify(keys),
);
t.ok(
  'read-only rows are marked',
  (await page.locator('[data-path="%2FzIndex"].archsim-readonly').count()) === 1 &&
    (await page.locator('[data-path="%2Fkind"].archsim-readonly').count()) === 1,
);

await page.locator('[data-path="%2Flabel"] .jse-value').first().dblclick();
await page.waitForTimeout(150);
await page.keyboard.type('L1 cache');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
t.ok(
  'an edit commits',
  (await page.locator('[data-path="%2Flabel"]').innerText()).includes('L1 cache'),
);

// The two overrides most at risk from a CSS pipeline: both target library-owned classes and
// win on specificity alone, so a rewrite that renames or reorders would silently undo them.
t.ok(
  'the documentation grip survives the production build',
  (await page.evaluate(() => {
    const g = document.querySelector('.grip');
    return g ? getComputedStyle(g).cursor : null;
  })) === 'row-resize',
);
t.ok(
  'and so do the overrides that let the panel own its own height and popups',
  await page.evaluate(() => {
    const main = getComputedStyle(document.querySelector('.jse-main')).minHeight;
    const pop = document.createElement('div');
    pop.className = 'jse-absolute-popup';
    document.querySelector('.editor').append(pop);
    const pos = getComputedStyle(pop).position;
    pop.remove();
    return main === '0px' && pos === 'fixed';
  }),
);

await page.locator('[data-path="%2Fsize"] .jse-key').first().click();
await page.waitForTimeout(250);
t.ok(
  'the footer documents the selected key',
  /Extent as \[width, height\]/.test(await page.locator('.footer').innerText()),
);

t.ok('no errors after interacting', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
process.exit(t.report());
