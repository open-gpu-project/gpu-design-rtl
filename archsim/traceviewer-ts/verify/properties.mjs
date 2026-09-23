import {
  DEV_URL,
  clickKey,
  drawBlock,
  editValue,
  emptySpot,
  enumOptions,
  health,
  open,
  row,
  selectValue,
  sized,
  suite,
} from './harness.mjs';

/** The property panel: projection, commit, rejection, rename, and the documentation footer. */
const t = suite('properties (dev)');
const { browser, page, errors } = await open(DEV_URL);

const state = () =>
  page.evaluate(() => ({
    n: window.__scene.shapes.length,
    shapes: window.__scene.shapes.map((s) => ({ ...s })),
    sel: [...window.__scene.selection],
    canUndo: window.__scene.history.canUndo,
    label: window.__scene.history.undoLabel,
  }));
const alert = async () => (await page.locator('.alert').innerText()).replace(/\s+/g, ' ');
const footer = async () => (await page.locator('.footer').innerText()).replace(/\s+/g, ' ');

t.ok(
  'bitmap is round(cssSize * dpr) at dpr 2',
  sized(await health(page)),
  JSON.stringify(await health(page)),
);

const box = await drawBlock(page, 120, 120, 300, 240);
await drawBlock(page, 400, 300, 560, 400);
let s = await state();
t.ok(
  'two blocks with sequential auto-names',
  s.n === 2 && s.shapes.map((x) => x.name).join() === 'block_1,block_2',
);

/*
  Selecting an unselected block begins a move gesture on the pointerdown, so the panel defers
  its push until the pointerup. For that whole window the selection has moved on and the
  document has not, and everything around the editor has to stay with the document it is still
  holding: the empty one is not a rect, and validating it as one lit up a "must have required
  property" error per key for as long as the button was held.
*/
await page.keyboard.press('Digit1');
await page.mouse.click(emptySpot(box).x, emptySpot(box).y); // nothing selected: the editor holds `{}`
await page.waitForTimeout(300);
await page.mouse.move(box.x + 200, box.y + 180);
await page.mouse.down();
await page.waitForTimeout(400);
const held = await page.evaluate(() => ({
  complaints: document.querySelectorAll('.jse-validation-error-message').length,
  veil: !!document.querySelector('.veil'),
  selected: window.__scene.selection.size,
}));
t.ok(
  'a press that changes the selection does not validate the document it has not replaced yet',
  held.complaints === 0 && held.veil && held.selected === 1,
  JSON.stringify(held),
);

await page.mouse.up();
await page.waitForTimeout(400);
t.ok(
  'click selects, and the panel follows a selection-only change',
  (await state()).sel.join() === 'block_1',
);

await editValue(page, 'label', 'Vector ALU');
s = await state();
t.ok('editing a property commits to the scene', s.shapes[0].label === 'Vector ALU');
t.ok(
  'the commit is one history entry, readably labelled',
  s.canUndo && /label/.test(s.label ?? ''),
  String(s.label),
);

await page.mouse.click(emptySpot(box).x, emptySpot(box).y);
await page.keyboard.press('ControlOrMeta+z');
await page.waitForTimeout(300);
t.ok('a single undo reverts a property edit', (await state()).shapes[0].label === '');
await page.keyboard.press('ControlOrMeta+Shift+z');
await page.waitForTimeout(300);

await page.mouse.click(box.x + 200, box.y + 180);
await page.waitForTimeout(300);
await editValue(page, 'name', 'block_2');
t.ok('a duplicate name is refused', (await state()).shapes[0].name === 'block_1');
t.ok('the refusal is explained', /already named/i.test(await alert()));

await editValue(page, 'name', 'valu');
s = await state();
t.ok('a free name commits', s.shapes[0].name === 'valu');
t.ok('the selection follows the rename', s.sel.join() === 'valu');

await editValue(page, 'zIndex', '5');
t.ok('the computed zIndex refuses to be written', (await state()).shapes[0].name === 'valu');
t.ok('the refusal says it is computed', /computed/i.test(await alert()));

await clickKey(page, 'size');
const f = await footer();
t.ok(
  'the footer documents the selected key while an error is up',
  /Size/.test(f) && /width, height/.test(f),
  f.slice(0, 80),
);

const before = (await state()).n;
await clickKey(page, 'description');
await page.keyboard.press('Delete');
await page.waitForTimeout(400);
t.ok(
  'Delete in the property panel does not delete the selected block',
  (await state()).n === before,
);

await page.mouse.click(emptySpot(box).x, emptySpot(box).y);
await page.mouse.click(box.x + 200, box.y + 180);
await page.waitForTimeout(300);
await page.mouse.move(box.x + 200, box.y + 180);
await page.mouse.down();
await page.mouse.move(box.x + 260, box.y + 240, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
s = await state();
const shown = await page.evaluate(
  () => document.querySelector('[data-path="%2Fposition"]')?.innerText.replace(/\s+/g, ' ') ?? '',
);
t.ok('a canvas drag moves the block', s.shapes[0].x !== 128);
t.ok('the panel follows the drag', shown.includes(String(s.shapes[0].x)), shown);
t.ok('the whole drag is still one history entry', /move/i.test(s.label ?? ''));

const rt = await page.evaluate(async () => {
  const mod = await import('/src/lib/scene/serialize.ts');
  const doc = window.__dump();
  const again = mod.serializeScene(mod.deserializeScene(doc));
  const dup = mod.deserializeScene({
    version: 2,
    shapes: [doc.shapes[0], { ...doc.shapes[0] }, { ...doc.shapes[0], kind: 'nope' }],
  });
  return { same: JSON.stringify(doc) === JSON.stringify(again), names: dup.map((x) => x.name) };
});
t.ok('dump -> deserialize -> serialize round-trips exactly', rt.same);
t.ok(
  'duplicate names repaired and unknown kinds skipped on import',
  rt.names.length === 2 && rt.names[0] !== rt.names[1],
  JSON.stringify(rt.names),
);

/*
  The documentation footer sizes itself to its own text, may be enlarged but not shrunk below
  that, and yields to the two clamps that keep the split usable. Every number here is read off
  the live layout rather than off component state -- the whole point of the grip is where the
  boundary actually lands, and `content` is what the text actually needs.
*/
const geom = () =>
  page.evaluate(() => {
    const f = document.querySelector('.footer');
    // Scoped, unlike its siblings: `.doc` is a generic enough name that a second, hidden
    // properties pane -- which the dock's keep-alive contract leaves in the tree -- could
    // answer first, and every comparison below would then quietly measure the wrong box.
    const d = document.querySelector('.footer > .doc');
    const e = document.querySelector('.editor');
    return {
      footer: Math.round(f.clientHeight),
      // `clientHeight` on both sides: the engine has already rounded it, so the equalities
      // below cannot fail by half a pixel on a line box that does not land on the grid.
      content: d.clientHeight,
      editor: Math.round(e.clientHeight),
      total: Math.round(f.clientHeight + e.clientHeight),
      scrolls: f.scrollHeight > f.clientHeight + 1,
    };
  });

/** Negative `dy` drags the grip up, growing the documentation. */
async function dragGrip(dy) {
  const g = await page.locator('.grip').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + 2 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

await clickKey(page, 'position'); // the longest documentation a block carries
const g0 = await geom();
t.ok(
  'the documentation is given room for all of its text without being asked',
  g0.footer === g0.content && !g0.scrolls,
  `${g0.footer}px for ${g0.content}px of text`,
);

await dragGrip(-120);
const g1 = await geom();
t.ok(
  'dragging the grip trades tree height for documentation height, one for one',
  g1.footer === g0.footer + 120 && g1.editor === g0.editor - 120 && g1.total === g0.total,
  JSON.stringify([g0, g1]),
);

await dragGrip(-2000);
const gTop = await geom();
t.ok('the tree keeps its floor however far the grip is dragged', gTop.editor === 80, gTop.editor);

await dragGrip(2000);
const gBottom = await geom();
t.ok(
  'and the documentation cannot be dragged shorter than its own text',
  gBottom.footer === gBottom.content && !gBottom.scrolls,
  `${gBottom.footer} vs the ${gBottom.content} it needs`,
);

const blocks = (await state()).n;
await page.locator('.grip').focus();
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Shift+ArrowUp');
await page.waitForTimeout(250);
const gKeys = await geom();
t.ok(
  'the grip is keyboard-operable, with a coarse step on Shift',
  gKeys.footer === gBottom.footer + 40,
  `${gBottom.footer} -> ${gKeys.footer}`,
);
t.ok('and its arrow keys never reach the canvas', (await state()).n === blocks);

/*
  The two halves of `max(what the text needs, what you asked for)`, which is the whole rule.
  A size the user asked for has to outlive the property that prompted it; a floor must not,
  or one long documentation string would enlarge the footer permanently.
*/
await clickKey(page, 'kind');
const gKeep = await geom();
t.ok(
  'a size the user asked for survives switching to a shorter documentation string',
  gKeep.footer === gKeys.footer && gKeep.content < gKeep.footer,
  `${gKeep.footer} kept, ${gKeep.content} needed`,
);
await dragGrip(2000);
const gShrunk = await geom();
await clickKey(page, 'position');
const gRegrown = await geom();
t.ok(
  'but a floor does not ratchet: give the size back and the longer text takes it again',
  gShrunk.footer === gShrunk.content && gRegrown.footer === gRegrown.content,
  `${gShrunk.footer} -> ${gRegrown.footer}`,
);

/*
  Text that cannot fit however the split is arranged. Forced with the root font size rather
  than with a contrived string, because the real cause is a user who has scaled their fonts up
  -- and the invariant that matters is that the tree survives it.
*/
await page.evaluate(() => document.documentElement.style.setProperty('font-size', '40px'));
await page.waitForTimeout(400);
const gHuge = await geom();
const ariaHuge = await page.evaluate(() => {
  const g = document.querySelector('.grip');
  return ['valuemin', 'valuenow', 'valuemax'].map((k) => Number(g.getAttribute(`aria-${k}`)));
});
await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
await page.waitForTimeout(400);
t.ok(
  'documentation with nowhere to fit scrolls instead of swallowing the tree',
  gHuge.scrolls && gHuge.content > gHuge.footer && gHuge.editor >= 80,
  `${gHuge.content} of text in ${gHuge.footer}, tree ${gHuge.editor}`,
);
t.ok(
  'and the splitter still reports a range assistive technology can act on',
  ariaHuge[0] <= ariaHuge[1] && ariaHuge[1] <= ariaHuge[2],
  `min ${ariaHuge[0]}, now ${ariaHuge[1]}, max ${ariaHuge[2]} — the floor must not outrank the ceiling`,
);

// Leave a size that is distinctively the user's, for the persistence check at the end of the
// file to recognise. A footer sitting on its floor would pass that check for the wrong reason.
await dragGrip(-96);

/*
  The context menu is wider than a docked side panel, so it flips to open leftwards -- straight
  across the pane boundary. Three nested `overflow: hidden` ancestors used to shear off the part
  that landed on the canvas side, so this hit-tests all four corners rather than trusting the
  box: a clipped menu still reports its full rect.
*/
const menu = () =>
  page.evaluate(() => {
    const el = document.querySelector('.jse-contextmenu');
    if (!el) return { open: false };
    const r = el.getBoundingClientRect();
    const hit = (x, y) => !!document.elementFromPoint(x, y)?.closest('.jse-contextmenu');
    return {
      open: true,
      onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      whole: [
        hit(r.left + 3, r.top + 3),
        hit(r.right - 3, r.top + 3),
        hit(r.left + 3, r.bottom - 3),
        hit(r.right - 3, r.bottom - 3),
      ].every(Boolean),
      rect: [r.left, r.top, r.right, r.bottom].map(Math.round),
    };
  });

/*
  Its contents, cut down to what a property bag can actually do: the rest of the default menu
  offers structural edits that `additionalProperties: false` and `required` reject on arrival.
  Read off the rendered buttons rather than the callback's return value -- the layout is the
  deliverable, and the library owns half of it.
*/
// On the key, not the row: a row's insert areas answer to the same `data-path`, and landing
// on one turns the selection into an "after", which every action but Paste is disabled for.
await clickKey(page, 'label'); // the menu acts on a selection
await row(page, 'label').locator('.jse-key').first().click({ button: 'right' });
await page.waitForTimeout(350);
const items = await page.evaluate(() => {
  const el = document.querySelector('.jse-contextmenu');
  return {
    rows: [...el.querySelectorAll(':scope > .jse-row')].map((r) =>
      [...r.querySelectorAll('button')].map((b) => b.innerText.trim()),
    ),
    dropdowns: el.querySelectorAll('[data-type="jse-open-dropdown"]').length,
    live: [...el.querySelectorAll('button')].filter((b) => !b.disabled).length,
  };
});
t.ok(
  'the context menu is the eight actions a property bag has, and nothing else',
  JSON.stringify(items.rows) ===
    JSON.stringify([
      ['Edit key', 'Edit value'],
      ['Cut', 'Copy', 'Paste'],
      ['Insert before', 'Insert after'],
      ['Remove'],
    ]),
  JSON.stringify(items.rows),
);
t.ok(
  'nothing hidden behind a dropdown, and every button live on a selected value',
  items.dropdowns === 0 && items.live === 8,
  JSON.stringify(items),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await row(page, 'label').first().click({ button: 'right' });
await page.waitForTimeout(350);
let m = await menu();
t.ok(
  'the context menu escapes the dock pane it overflows',
  m.open && m.whole && m.onScreen,
  JSON.stringify(m),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

/*
  Deselecting while a tuple element is selected used to throw out of the editor's mount: `set`
  re-creates the tree, the new one inherits the caret, and `/size/1` is not in the empty
  document. The throw unwound the panel's own effect on the way out, which left the veil down
  over a document that was no longer there -- so the state afterwards is worth asserting too.
*/
await page.locator('[data-path="%2Fsize%2F1"] .jse-value').first().click();
await page.waitForTimeout(250);
const thrown = errors.length;
await page.mouse.click(emptySpot(box).x, emptySpot(box).y);
await page.waitForTimeout(500);
t.ok(
  'deselecting with a tuple element selected does not throw out of the editor',
  errors.length === thrown,
  errors.slice(thrown).join(' | ').slice(0, 120),
);
t.ok(
  'and the panel lands in the empty state, documentation included',
  (await page.evaluate(() => !!document.querySelector('.veil'))) &&
    /Select a property/.test(await footer()),
  await footer(),
);
await page.locator('.veil').click({ button: 'right' });
await page.waitForTimeout(350);
t.ok('with no context menu, since there is nothing to act on', !(await menu()).open);

// Put a block back in the panel for the float check. Through the store rather than the canvas:
// the block has been dragged since, and where it is now is not what is being tested here.
await page.evaluate(() => window.__scene.selectOnly(window.__scene.shapes[0].name));
await page.waitForTimeout(400);

await page
  .locator('.sv-dock__leaf', { has: page.locator('text=Properties') })
  .last()
  .hover();
await page.locator('[aria-label^="Float"]').last().click();
await page.waitForTimeout(700);
await row(page, 'label').first().click({ button: 'right' });
await page.waitForTimeout(350);
m = await menu();
t.ok(
  '...including out of a floating window, the tightest clip box there is',
  m.open && m.whole && m.onScreen,
  JSON.stringify(m),
);
await page.keyboard.press('Escape');

/*
  GROUP T -- iteration 5's two new block properties.

  The load-bearing one is the second: `subtitle` and `labelMode` were added to a shape kind that
  already had saved files in the wild, and the claim that no version bump was needed rests
  entirely on `hydrateShape` filling a missing key from the blank. That is the assertion that
  fails if the default is dropped or `labelMode` is given a writer that rejects absence -- and it
  fails silently, because a scene that loads with no label mode at all still renders.
*/
await page.evaluate(() => window.__scene.setSelection(new Set()));
await page.waitForTimeout(200);
await drawBlock(page, 120, 120, 300, 230);
await page.waitForTimeout(300);

const T = await page.evaluate(() => {
  const sc = window.__scene;
  const b = sc.shapes[sc.shapes.length - 1];
  sc.commit('describe', () => {
    sc.shapes = sc.shapes.map((s) =>
      s === b ? { ...s, label: 'XU', subtitle: 'Execution unit', labelMode: 'tabbed_right' } : s,
    );
  });
  const doc = window.__dump();
  const rec = doc.shapes.find((r) => r.name === b.name);

  // A record as an older file would have written it: the three new keys simply absent.
  const legacy = { ...rec };
  delete legacy.subtitle;
  delete legacy.labelMode;
  return { keys: Object.keys(rec), rec, legacy };
});

t.ok(
  'the saved block record carries the subtitle and the label mode, in canonical order',
  JSON.stringify(T.keys) ===
    JSON.stringify([
      'kind',
      'description',
      'label',
      'labelMode',
      'name',
      'position',
      'size',
      'subtitle',
    ]),
  JSON.stringify(T.keys),
);

// Imported by URL, like the round-trip check above: `serialize.ts` holds no module-level state,
// so a second instance of it is the same function.
const load = (rec) =>
  page.evaluate(async (r) => {
    const mod = await import('/src/lib/scene/serialize.ts');
    return mod
      .deserializeScene({ version: 2, shapes: [r] })
      .map((s) => ({ subtitle: s.subtitle, labelMode: s.labelMode, label: s.label }));
  }, rec);

const roundTrip = await load(T.rec);
t.ok(
  'and both survive a save and load unchanged',
  roundTrip.length === 1 &&
    roundTrip[0].subtitle === 'Execution unit' &&
    roundTrip[0].labelMode === 'tabbed_right',
  JSON.stringify(roundTrip),
);

const legacyLoad = await load(T.legacy);
t.ok(
  'a file written before these keys existed still loads, defaulting to the old appearance',
  legacyLoad.length === 1 &&
    legacyLoad[0].subtitle === '' &&
    legacyLoad[0].labelMode === 'inset' &&
    legacyLoad[0].label === 'XU',
  JSON.stringify(legacyLoad),
);

/*
  The dropdown. Two halves, and the second is the one worth keeping: an editable enum SHOULD be
  a select, and a read-only one should NOT be -- a dropdown on `kind` would look like a choice
  and be refused by `applyDocument` whichever way it was moved.
*/
await page.evaluate(() => {
  const sc = window.__scene;
  sc.setSelection(new Set([sc.shapes[sc.shapes.length - 1].name]));
});
await page.waitForTimeout(400);

t.ok(
  'an editable enum is a dropdown offering exactly its declared values',
  JSON.stringify(await enumOptions(page, 'labelMode')) ===
    JSON.stringify(['inset', 'tabbed_left', 'tabbed_right']),
  JSON.stringify(await enumOptions(page, 'labelMode')),
);
t.ok(
  'and a read-only one is not, so nothing offers a choice it will refuse',
  (await enumOptions(page, 'kind')).length === 0,
  JSON.stringify(await enumOptions(page, 'kind')),
);

await selectValue(page, 'labelMode', 'tabbed_left');
const picked = await page.evaluate(() => {
  const sc = window.__scene;
  return { mode: sc.soleSelected()?.labelMode, label: sc.history.undoLabel };
});
t.ok(
  'picking from it commits, as one labelled history entry',
  picked.mode === 'tabbed_left' && typeof picked.label === 'string' && picked.label !== '',
  `${picked.mode} / ${picked.label}`,
);

/*
  Last, because it drops the scene: reloading keeps only what was persisted.

  Compared against the stored number rather than against the height on screen before the
  reload, because those two are only the same thing while the size the user asked for is the
  larger half of the max -- and after a reload nothing is selected, so there is no text to
  floor it.
*/
const wanted = await page.evaluate(() =>
  Number(localStorage.getItem('archsim.traceviewer.props.docs.v1')),
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
t.ok(
  'the documentation height survives a reload',
  (await geom()).footer === wanted,
  `${(await geom()).footer} want ${wanted}`,
);

await browser.close();
process.exit(t.report(errors));
