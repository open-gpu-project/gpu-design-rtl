import { readFile } from 'node:fs/promises';
import {
  DEV_URL,
  diagramCanvas,
  drawBlock,
  drawConnection,
  open,
  row,
  suite,
  traceCanvas,
} from './harness.mjs';

/*
  Saving a diagram to a file and opening one back.

  Almost none of this can be asserted from the outside. A download is a browser-owned side
  effect, a file picker is a native panel, and the two decisions a load makes -- "is this a
  diagram at all" and "what of it survives" -- both happen before anything is committed. So the
  suite works from both ends: `window.__file` for the pure halves, and Playwright's `download`
  and `filechooser` events for the transport, driven through the real toolbar buttons and the
  real keys rather than by calling the session directly.

  The reason this is its own suite rather than more of `properties.mjs`: those two events appear
  nowhere else in `verify/`, and the fixtures here are whole documents rather than single rows.
*/

const t = suite('file');
const { browser, page, errors } = await open(DEV_URL);

const chromeBtn = (label) =>
  page.locator(`[data-panel-id="diagram"] button[aria-label="${label}"]`).first();

/** Run `trigger`, catch the download it causes, and read it back off disk. */
async function saveVia(trigger) {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: await readFile(path, 'utf8') };
}

/** Run `trigger`, answer the picker it opens with `text` under `name`. */
async function openVia(name, text, trigger) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.waitForTimeout(500);
}

const dump = () => page.evaluate(() => window.__dump());
const hint = () => page.evaluate(() => window.__host.hint);

/* ------------------------------------------------------------ the pure halves ---- */

{
  const pure = await page.evaluate(() => {
    const f = window.__file;
    const notDiagrams = ['', '{', 'not json', '42', '"a string"', 'null', '[]', '{"foo":1}'];
    const empty = f.parseSceneDoc('{"version":2,"shapes":[]}');
    return {
      refused: notDiagrams.filter((s) => f.parseSceneDoc(s) !== null),
      empty: empty !== null && empty.shapes.length === 0,
      anyVersion: f.parseSceneDoc('{"version":99,"shapes":[]}') !== null,
      names: [
        f.saveFileName(null),
        f.saveFileName('xbn.json'),
        f.saveFileName('xbn.txt'),
        f.saveFileName('my.diagram.json'),
        f.saveFileName('.json'),
      ],
    };
  });

  t.ok(
    'neither broken JSON nor JSON that is not a diagram parses as one',
    pure.refused.length === 0,
    `accepted ${JSON.stringify(pure.refused)}`,
  );
  /*
    The assertion that separates `parseSceneDoc` from `deserializeScene`. That function answers
    `[]` to both of these, and they need opposite handling: one is a document to load, the other
    is a file to refuse without touching the diagram the user has open.
  */
  t.ok('but an empty diagram parses, because it is a document', pure.empty);
  /*
    `version` is deliberately not a gate. The format is "the schema's non-computed keys", so a
    reader of either vintage produces a valid document from a file of either vintage -- refusing
    an unrecognised number would break the files that still work.
  */
  t.ok('and a version this build has never heard of is not a reason to refuse', pure.anyVersion);
  t.ok(
    'a save is named after the file it was opened from, with .json forced',
    JSON.stringify(pure.names) ===
      JSON.stringify(['diagram.json', 'xbn.json', 'xbn.json', 'my.diagram.json', 'diagram.json']),
    JSON.stringify(pure.names),
  );
}

/* ------------------------------------------------------------- a real document ---- */

await drawBlock(page, 140, 140, 300, 230);
await drawBlock(page, 460, 300, 620, 390);
await drawConnection(page, 300, 185, 460, 345);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

const seeded = await dump();
t.ok(
  'the fixture is two blocks and a wire',
  seeded.shapes.length === 3 && seeded.shapes.some((s) => s.kind === 'conn'),
  JSON.stringify(seeded.shapes.map((s) => s.kind)),
);

/* ------------------------------------------------------------------- the write ---- */

{
  const saved = await saveVia(() => chromeBtn('Save diagram').click());
  /*
    Byte-identical to what `__dump` projects, plus a trailing newline -- which is also, to the
    byte, what `copySelection` writes to the system clipboard. That is the whole format claim:
    one record serves both transports, which is what lets the file loader and `readFragment`
    share a read pipeline. A separate file serializer would pass a round-trip check and lose it.
  */
  t.ok(
    'Save writes the document verbatim, as the same JSON the clipboard carries',
    saved.text === `${JSON.stringify(seeded, null, 2)}\n`,
    saved.text.slice(0, 120),
  );
  t.ok(
    'and calls it diagram.json until a file has been opened',
    saved.name === 'diagram.json',
    saved.name,
  );
  t.ok(
    'and says so in the status bar',
    /^Saved .diagram\.json. — 3 objects\.$/u.test(await hint()),
    await hint(),
  );
}

/* ------------------------------------------------- what the read pipeline adds ---- */

/*
  `readDocument` against a bare `deserializeScene`, on one document, so the difference is the
  only variable. This is the behaviour `readFragment` has always had and the file path would
  have silently lacked: a connection naming a block the file does not contain survives the
  rebuild and is dropped by `pruneOrphans`.
*/
{
  const gap = await page.evaluate((doc) => {
    const f = window.__file;
    const blocks = doc.shapes.filter((s) => s.kind === 'rect');
    const orphaned = {
      version: 2,
      shapes: doc.shapes.filter((s) => s !== blocks[1]),
    };
    const unknown = {
      version: 2,
      shapes: [...doc.shapes, { ...blocks[0], kind: 'no-such-kind', name: 'x' }],
    };
    return {
      bare: window.__doc.deserializeScene(orphaned).length,
      read: f.readDocument(orphaned).shapes.length,
      readDropped: f.readDocument(orphaned).dropped,
      unknownDropped: f.readDocument(unknown).dropped,
      unknownKept: f.readDocument(unknown).shapes.length,
    };
  }, seeded);

  t.ok(
    'a bare rebuild keeps a wire whose block is missing from the file',
    gap.bare === 2,
    `got ${gap.bare}`,
  );
  t.ok(
    'and the read pipeline drops it, which is the whole reason it exists',
    gap.read === 1 && gap.readDropped === 1,
    `kept ${gap.read}, dropped ${gap.readDropped}`,
  );
  t.ok(
    'a record of a kind this build does not know is counted as dropped, not ignored',
    gap.unknownDropped === 1 && gap.unknownKept === 3,
    `kept ${gap.unknownKept}, dropped ${gap.unknownDropped}`,
  );
}

/* -------------------------------------------------------------------- the read ---- */

{
  // Something to replace, and a camera that cannot accidentally already be the fitted one.
  await drawBlock(page, 700, 520, 860, 610);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const v = window.__view;
    v.zoomTo(3, v.viewportCenter);
    window.__host.subPart = { shape: 'nothing', index: 7 };
  });
  await page.waitForTimeout(200);
  const before = await dump();

  await openVia('xbn.json', JSON.stringify(seeded), () => chromeBtn('Open diagram').click());

  const after = await page.evaluate(() => ({
    doc: window.__dump(),
    label: window.__scene.history.undoLabel,
    selected: window.__scene.selection.size,
    subPart: window.__host.subPart,
    z: window.__view.z,
    hint: window.__host.hint,
  }));

  t.ok(
    'opening a file replaces the whole document',
    JSON.stringify(after.doc) === JSON.stringify(seeded),
    JSON.stringify(after.doc.shapes.map((s) => s.name)),
  );
  t.ok('as one undoable step', after.label === 'load', String(after.label));
  t.ok('with nothing selected', after.selected === 0, String(after.selected));
  /*
    The third funnel that has to clear the sub-part cursor explicitly. Everywhere else it is
    derived, and a document swap defeats that because the index can still be valid and mean
    something else entirely.
  */
  t.ok('and no stale sub-part cursor', after.subPart === null, JSON.stringify(after.subPart));
  t.ok(
    'framed to fit what arrived, not to whatever the camera was on',
    after.z !== 3,
    String(after.z),
  );
  t.ok(
    'and the status bar names the file and counts what came in',
    /^Opened .xbn\.json. — 3 objects\.$/u.test(after.hint),
    after.hint,
  );

  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  t.ok(
    'and one undo puts the previous document back exactly',
    JSON.stringify(await dump()) === JSON.stringify(before),
    JSON.stringify((await dump()).shapes.map((s) => s.name)),
  );

  // Redone, so the rest of the suite runs against the opened document rather than the old one.
  await page.keyboard.press('Shift+Meta+z');
  await page.waitForTimeout(400);

  const saved = await saveVia(() => chromeBtn('Save diagram').click());
  t.ok(
    'a save after that is named after the file that was opened',
    saved.name === 'xbn.json',
    saved.name,
  );
}

/* ------------------------------------------------------- refusing, and reporting ---- */

{
  const before = await dump();
  const label = await page.evaluate(() => window.__scene.history.undoLabel);
  await openVia('notes.txt', 'this is not a diagram', () => chromeBtn('Open diagram').click());

  const shown = await page
    .locator('[data-panel-id="diagram"] .text-\\[var\\(--color-ink\\)\\]')
    .first()
    .textContent();

  t.ok(
    'a file that is not a diagram leaves the diagram exactly as it was',
    JSON.stringify(await dump()) === JSON.stringify(before),
  );
  /*
    No commit at all, not a commit of nothing. Loading an unreadable file as an empty document
    would wipe what the user has open because they picked the wrong entry in a list -- undoable,
    but only if they notice, and the file they actually wanted is still unopened either way.
  */
  t.ok(
    'and pushes no history entry, so there is nothing to undo',
    (await page.evaluate(() => window.__scene.history.undoLabel)) === label,
  );
  t.ok(
    'the status bar says which file and why',
    /^Could not open .notes\.txt. — that is not a diagram file\.$/u.test(await hint()),
    await hint(),
  );
  // Through the DOM as well as the field, so the channel is checked end to end: a message
  // nothing renders is not a report.
  t.ok('and the status bar is what renders it', shown?.trim() === (await hint()), String(shown));
}

{
  const lossy = {
    version: 2,
    shapes: [...seeded.shapes, { kind: 'no-such-kind', name: 'ghost' }],
  };
  await openVia('lossy.json', JSON.stringify(lossy), () => chromeBtn('Open diagram').click());
  t.ok(
    'a file with a record this build cannot read loads the rest, and says how much went',
    /^Opened .lossy\.json. — 3 objects, 1 could not be read\.$/u.test(await hint()),
    await hint(),
  );
}

/* ------------------------------------------------- what the commit does for free ---- */

/*
  A fabric mints its interfaces inside the load's own commit, because `scene.commit` runs
  `#expandChildren`. That is not decoration: a hand-written or hand-edited file recording
  `interfaces: 2` with no `nif` records would otherwise sit wrong until the next unrelated edit.
*/
{
  await page.keyboard.press('Digit6');
  const box = await diagramCanvas(page).boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');

  const withFabric = await dump();
  /*
    `interfaces: 2` written into the record, with the `nif` records taken out. A fabric drawn
    with the tool starts at zero, so stripping its children off the dump alone would assert
    nothing -- this is the file a person hand-edits, or an older build wrote.
  */
  const stripped = {
    version: 2,
    shapes: withFabric.shapes
      .filter((s) => s.kind !== 'nif')
      .map((s) => (s.kind === 'fabric' ? { ...s, interfaces: 2 } : s)),
  };
  const fabric = stripped.shapes.find((s) => s.kind === 'fabric');

  await openVia('fabric.json', JSON.stringify(stripped), () => chromeBtn('Open diagram').click());
  const nifs = await page.evaluate(
    () => window.__scene.shapes.filter((s) => s.kind === 'nif').length,
  );
  t.ok(
    'a fabric loaded without its interfaces gets them minted by the load itself',
    fabric !== undefined && fabric.interfaces > 0 && nifs === fabric.interfaces,
    `wanted ${fabric?.interfaces}, got ${nifs}`,
  );
}

/* ----------------------------------------------------------------- the two keys ---- */

/*
  The assertions that pin the bindings at WINDOW level rather than in `ToolHost.#globalKey`.
  That handler refuses keys unless the diagram pane owns the keyboard and refuses them again
  when the target is editable -- so both of these would fall through to Safari's own Save Page
  and Open File panels, which is the one outcome that must not happen.
*/
{
  await page.locator('[data-panel-id="diagram"] canvas').click({ position: { x: 260, y: 220 } });
  await page.waitForTimeout(300);
  const rows = await row(page, 'label').count();
  if (rows > 0) {
    await row(page, 'label').locator('.jse-value').first().dblclick();
    await page.waitForTimeout(250);
    const saved = await saveVia(() => page.keyboard.press('Meta+s'));
    t.ok(
      'Cmd+S saves with the caret in the property editor',
      saved.name.endsWith('.json'),
      saved.name,
    );
    await page.keyboard.press('Escape');
  } else {
    t.ok('Cmd+S saves with the caret in the property editor', false, 'no label row to focus');
  }
}

{
  /*
    On `window` in the CAPTURE phase, registered after the app's own listener there, so it runs
    immediately after it and observes the `preventDefault` rather than racing it.

    Not the bubble phase, which is the trap: `svelte-jsoneditor` calls `stopPropagation` on every
    keydown it sees, so a bubble listener does not fire at all while the caret is in the property
    panel -- and a check that never runs reads as a check that failed.
  */
  await page.evaluate(() => {
    window.__prevented = {};
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyS' || e.code === 'KeyO') window.__prevented[e.code] = e.defaultPrevented;
      },
      true,
    );
  });

  await saveVia(() => page.keyboard.press('Meta+s'));
  t.ok(
    'and suppresses the browser own Save Page dialog',
    (await page.evaluate(() => window.__prevented.KeyS)) === true,
  );

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Meta+o'),
  ]);
  t.ok(
    'Cmd+O opens the picker, and suppresses the browser own Open File dialog',
    (await page.evaluate(() => window.__prevented.KeyO)) === true,
  );
  // Dismissed, so the suite does not leave a picker waiting on a promise.
  await chooser.setFiles([]);
  await page.waitForTimeout(300);
}

{
  // From the trace panel, which is exactly where `#globalKey` would have refused.
  await traceCanvas(page).click({ position: { x: 200, y: 80 } });
  await page.waitForTimeout(300);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Meta+o'),
  ]);
  t.ok('Cmd+O reaches the document from a panel that is not the diagram', true);
  await chooser.setFiles([]);
  await page.waitForTimeout(300);
}

const failed = t.report(errors);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
