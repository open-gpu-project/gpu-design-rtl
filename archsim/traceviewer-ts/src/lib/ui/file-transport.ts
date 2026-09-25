/**
 * Text in and out of a file, through the two mechanisms every browser has.
 *
 * **Deliberately not the File System Access API.** `showSaveFilePicker` and `showOpenFilePicker`
 * would give a real save-in-place and a real path, and Safari implements neither -- and Safari is
 * where this app's rendering is measured, so it is not a browser to degrade. A Blob download and
 * an `<input type="file">` work everywhere and behave identically everywhere, which is worth more
 * here than saving over the file you opened.
 *
 * The DOM half of `scene/file.ts`, kept apart from it so nothing under `scene/` has to touch a
 * document. No runes: there is no state here worth rendering from, only a reused element.
 */

/** What `pickTextFile` resolves to. `name` is a bare filename -- a picker never yields a path. */
export interface PickedFile {
  readonly name: string;
  readonly text: string;
}

/**
 * Save `text` as a download named `name`.
 *
 * Synchronous and unreportable: once the anchor is clicked the browser owns the outcome, and
 * there is no event for "the user cancelled the save panel". That is fine for what this is used
 * for -- the document is still in the editor either way -- and it is why this returns `void`
 * rather than a promise that could only ever resolve.
 */
export function downloadText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  /*
    Appended before the click and removed after.

    A detached anchor's `click()` is enough in Chrome and is not in every engine, and the element
    has to be gone again before the next save or they accumulate. Hidden is not needed: it is in
    the document for one synchronous statement and never gets a chance to lay out.
  */
  document.body.appendChild(a);
  a.click();
  a.remove();
  /*
    Revoked on the next task, not here.

    Revoking synchronously after `click()` has been observed to kill the download before it
    starts in Safari -- the navigation the click queues resolves the URL later, by which point a
    synchronous revoke has already invalidated it. One turn of the event loop is enough, and the
    cost of being wrong in the other direction is one blob held until the tab closes.
  */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/*
  ONE input element, created on first use and reused forever.

  Two reasons, and the second is the one that is easy to get wrong. A programmatic `.click()` on
  an input that is not in the document does not open the picker in Safari, so it has to be
  appended -- and a fresh element per call then leaks a node on every cancel, because `cancel` is
  Safari 16.4+ and there is no older event that fires when the user dismisses the panel. One
  reused singleton has neither problem, and only one picker can be open at a time anyway, so one
  is not a cache but the whole model.
*/
let input: HTMLInputElement | null = null;
let pending: ((file: PickedFile | null) => void) | null = null;

function settle(file: PickedFile | null): void {
  const resolve = pending;
  pending = null;
  resolve?.(file);
}

function ensureInput(): HTMLInputElement {
  if (input !== null) return input;
  const el = document.createElement('input');
  el.type = 'file';
  // Out of the layout and out of the tab order, but still in the document -- see above.
  el.style.display = 'none';
  el.addEventListener('change', () => {
    const file = el.files?.[0];
    if (file === undefined) {
      settle(null);
      return;
    }
    // `Blob.text()`, not a `FileReader`: it is a promise already, and this is the one place the
    // read is allowed to be async because nothing has been committed yet.
    void file.text().then(
      (text) => settle({ name: file.name, text }),
      () => settle(null),
    );
  });
  // Safari 16.4+ and Chrome only. Where it does not fire, the promise from a dismissed pick is
  // simply superseded by the next one -- see `pickTextFile`.
  el.addEventListener('cancel', () => settle(null));
  document.body.appendChild(el);
  input = el;
  return el;
}

/**
 * Ask for a file and read it as text. Resolves null when the pick was dismissed, or when the
 * file could not be read.
 *
 * **Must be called from within a user gesture.** Safari opens a file picker only inside a
 * user-activation task, so this works from a click handler or a keydown handler and silently
 * does nothing from a timer or a promise continuation.
 */
export function pickTextFile(accept: string): Promise<PickedFile | null> {
  const el = ensureInput();
  el.accept = accept;
  /*
    Cleared before every open, and this is load-bearing rather than tidy. `change` fires on a
    CHANGE of value, so re-picking the file that is already in the input fires nothing at all and
    the second open would hang -- which is precisely the "open, edit the file elsewhere, open it
    again" loop this exists for.
  */
  el.value = '';
  // Any earlier pick that never reported is answered now, so at most one promise is ever
  // outstanding. This is what keeps a browser without the `cancel` event from accumulating them.
  settle(null);
  return new Promise<PickedFile | null>((resolve) => {
    pending = resolve;
    el.click();
  });
}
