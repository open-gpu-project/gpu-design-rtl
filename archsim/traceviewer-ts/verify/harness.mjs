import { chromium } from 'playwright';

/**
 * Shared bits for the browser checks.
 *
 * These run against a real browser at deviceScaleFactor 2 because, as iteration 1 found the
 * hard way, a green `svelte-check` means almost nothing here: three of its nine bugs were
 * invisible at dpr 1, and the primary development machine is a Retina Mac.
 *
 * Edge is used via `channel` so nothing has to be downloaded.
 */
export const DEV_URL = process.env.TARGET ?? 'http://localhost:5183/';
export const PREVIEW_URL = process.env.TARGET ?? 'http://localhost:4183/';

export function suite(name) {
  const pass = [];
  const fail = [];
  return {
    ok(label, cond, detail = '') {
      (cond ? pass : fail).push(`${label}${detail ? ` :: ${detail}` : ''}`);
    },
    report(errors = []) {
      console.log(`\n=== ${name} ===`);
      for (const p of pass) console.log('  ✓', p);
      const unique = [...new Set(errors)];
      if (unique.length > 0) {
        console.log('  page errors:', unique.join(' | ').slice(0, 200));
      }
      for (const f of fail) console.log('  ✗', f);
      console.log(`  ${pass.length} passed, ${fail.length} failed`);
      return fail.length;
    },
  };
}

export async function open(url, { clearStorage = true } = {}) {
  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(url, { waitUntil: 'networkidle' });
  if (clearStorage) {
    // Cleared here rather than via addInitScript, which would re-run on every reload and
    // silently defeat any test of layout persistence.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(900);
  return { browser, page, errors };
}

/** Canvas vitals: correct bitmap for its box, a live 2d context, and actually painted. */
export const health = (page) =>
  page.evaluate(() => {
    const v = window.__view;
    const c = v.canvas;
    if (c === null) return { alive: false };
    const d = c
      .getContext('2d')
      .getImageData(0, 0, Math.min(c.width, 300), Math.min(c.height, 300)).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 89) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return {
      alive: v.ctx !== null,
      w: c.width,
      h: c.height,
      want: [Math.round(v.cssW * v.dpr), Math.round(v.cssH * v.dpr)],
      painted: seen.size > 1, // grid dots against the background
      shapes: window.__scene.shapes.length,
      cam: [v.camX, v.camY],
    };
  });

export const sized = (h) => h.alive && h.w === h.want[0] && h.h === h.want[1] && h.w > 0;

/**
 * The diagram's canvas.
 *
 * Scoped by panel since iteration 3: the trace panel has a canvas too, and a bare
 * `locator('canvas')` is a strict-mode violation rather than a wrong answer.
 */
export const diagramCanvas = (page) => page.locator('[data-panel-id="diagram"] canvas');

/** The trace panel's canvas. */
export const traceCanvas = (page) => page.locator('[data-panel-id="trace"] canvas');

/**
 * A point inside the diagram canvas that no test block occupies.
 *
 * Derived from the live box rather than hard-coded. Iteration 3 shrank the diagram pane to make
 * room for the trace panel, and a fixed `y + 600` silently moved from "empty canvas" to "the
 * trace panel below it" -- which selected a trace row instead of deselecting.
 */
export const emptySpot = (box) => ({
  x: box.x + box.width - 120,
  y: box.y + box.height - 60,
});

/** Draw a block with the rect tool, in canvas-relative CSS pixels. */
export async function drawBlock(page, x1, y1, x2, y2) {
  const box = await diagramCanvas(page).boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.keyboard.press('Digit3');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  return box;
}

/**
 * Draw a connection with the connect tool, in canvas-relative CSS pixels.
 *
 * Click-click, not a drag, and the moves before each click matter: the tool picks its anchor
 * from the hovered perimeter, so a click with no preceding move lands on a stale hover.
 * Leaves the connect tool active, the way the real gesture does.
 */
export async function drawConnection(page, x1, y1, x2, y2) {
  const box = await diagramCanvas(page).boundingBox();
  await page.keyboard.press('Digit4');
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.click(box.x + x1, box.y + y1);
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.click(box.x + x2, box.y + y2);
  await page.waitForTimeout(250);
  return box;
}

/**
 * Sweep a marquee band with the marquee tool, in canvas-relative CSS pixels.
 *
 * `steps` matters: the band arms only past DRAG_SLOP_PX and applies the selection on move, so
 * a single-jump drag would arm and select in one event and never exercise the live update.
 * Leaves the marquee tool active, the way the real gesture does.
 */
export async function marqueeSelect(page, x1, y1, x2, y2, { shift = false } = {}) {
  const box = await diagramCanvas(page).boundingBox();
  await page.keyboard.press('Digit2');
  await page.mouse.move(box.x + x1, box.y + y1);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
  return box;
}

/** Property rows carry `data-path="%2F<key>"` (a URL-encoded JSON pointer). */
export const row = (page, key) => page.locator(`[data-path="%2F${key}"]`);

export async function editValue(page, key, text) {
  await row(page, key).locator('.jse-value').first().dblclick();
  await page.waitForTimeout(150);
  // Never Cmd+A here: the tree intercepts it as "select all nodes", even mid-edit.
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}

/**
 * Set an enum property, which the panel renders as a `<select>` and not a text row.
 *
 * `editValue` cannot drive one: it double-clicks and types, and there is nothing to type into.
 * Two ways to set a value means two helpers -- the alternative is a single helper that guesses
 * from the DOM, which would pass just as happily against a dropdown that had silently reverted
 * to a text box.
 */
export async function selectValue(page, key, value) {
  await row(page, key).locator('select.jse-enum-value').first().selectOption(value);
  await page.waitForTimeout(400);
}

/** The options a property's dropdown offers, in order. Empty when it is not a dropdown. */
export async function enumOptions(page, key) {
  const sel = row(page, key).locator('select.jse-enum-value').first();
  if ((await sel.count()) === 0) return [];
  return await sel.locator('option').allTextContents();
}

export async function clickKey(page, key) {
  await row(page, key).locator('.jse-key').first().click();
  await page.waitForTimeout(250);
}
