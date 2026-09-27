import { button, drawBlock, open, suite, PREVIEW_URL } from './harness.mjs';

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
/*
  Every `window.__*` handle is a DEV hook, so the built bundle must carry none. Svelte's own
  `__svelte` version marker is the one global of that shape the framework itself sets.
*/
const leaked = await page.evaluate(() =>
  Object.getOwnPropertyNames(window).filter((k) => k.startsWith('__') && k !== '__svelte'),
);
t.ok('DEV hooks are stripped', leaked.length === 0, leaked.join(','));
t.ok('dock rendered', (await page.locator('.sv-dock').count()) > 0);
const builtPanels = (
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-panel-id]')].map((e) => e.dataset.panelId),
  )
)
  .sort()
  .join();
t.ok('every panel present', builtPanels === 'diagram,objects,properties,trace', builtPanels);

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

await drawBlock(page, 120, 120, 320, 260);
await page.waitForTimeout(250);

// Through the DOM alone, since the built bundle has no hooks: one object row, the new block,
// shown as selected -- which is the tree reading the scene's selection in a production chunk.
const listed = await page.evaluate(() =>
  [...document.querySelectorAll('[data-panel-id="objects"] [role="treeitem"][data-name]')].map(
    (e) => [e.dataset.name, e.getAttribute('aria-selected')],
  ),
);
t.ok(
  'the object tree lists the new block, selected',
  listed.length === 1 && listed[0][1] === 'true',
  JSON.stringify(listed),
);

const keys = await page.evaluate(() =>
  [...document.querySelectorAll('[data-path]')]
    .map((e) => decodeURIComponent(e.getAttribute('data-path')))
    .filter((p) => p !== '' && !p.slice(1).includes('/')),
);
t.ok(
  'property panel populated, in canonical order: kind, then editable, then generated',
  keys.join() ===
    '/kind,/description,/interfaces,/label,/labelMode,/name,/position,/size,/subtitle,/parent,/zIndex',
  JSON.stringify(keys),
);
t.ok(
  'read-only rows are marked',
  (await page.locator('[data-path="%2FzIndex"].archsim-readonly').count()) === 1 &&
    (await page.locator('[data-path="%2Fparent"].archsim-readonly').count()) === 1 &&
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

/*
  The toolbar tooltip, in the built bundle.

  Worth a check here and not only in `input.mjs` because it is the one feature in the app whose
  whole point is that it survives where a native `title` did not, and because an attachment is
  exactly the kind of thing that can be reachable in dev and tree-shaken or mis-ordered in a
  production chunk. Driven purely through the DOM: there are no `window.__*` hooks here.
*/
const prodBtn = button(page, 'Select');
const prodBox = await prodBtn.boundingBox();
await page.mouse.move(prodBox.x + prodBox.width / 2, prodBox.y + prodBox.height / 2, { steps: 4 });
await page.waitForTimeout(700);
t.ok(
  'the toolbar tooltip names the tool and its key in the built bundle',
  (await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chrome-tooltip"]');
    return el === null ? null : el.textContent.trim();
  })) === 'Select (2)',
);
await page.mouse.move(prodBox.x + prodBox.width / 2, prodBox.y + 260, { steps: 5 });
await page.waitForTimeout(250);

t.ok('no errors after interacting', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
process.exit(t.report());
