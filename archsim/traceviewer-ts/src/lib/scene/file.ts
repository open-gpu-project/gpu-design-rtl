/**
 * The diagram as a file: what gets written, what a read is allowed to believe, and what it is
 * called.
 *
 * Pure, and deliberately so. Nothing under `scene/`, `props/` or `geom/` touches the DOM, which
 * is what lets `verify/` drive them as plain calls rather than through a pointer -- so the Blob,
 * the object URL and the file picker live in `ui/file-transport.ts` instead. The two halves that
 * are worth hammering in a check, `parseSceneDoc` and `saveFileName`, are both here.
 */

import type { SceneDoc } from './serialize';

/** Written on the Blob, so a saved diagram opens in an editor rather than downloading as binary. */
export const SCENE_FILE_MIME = 'application/json';

/**
 * What the open picker offers.
 *
 * The extension as well as the MIME type: Safari's picker filters on the extension and ignores
 * the type for a file it has no registration for, so a MIME alone greys out the very files the
 * app just wrote.
 */
export const SCENE_FILE_ACCEPT = 'application/json,.json';

/** Used until a file has been opened, and whenever an opened name has nothing usable in it. */
export const DEFAULT_SCENE_FILE_NAME = 'diagram.json';

/**
 * The file's text.
 *
 * Two spaces and a trailing newline, which is to say: byte-for-byte what `copySelection` already
 * writes to the system clipboard. One format, two transports -- which is what lets `readDocument`
 * serve the file loader and `readFragment` alike, and what makes a future `trace` sibling key
 * additive rather than a second format to keep in step.
 *
 * It does NOT follow that a saved file can be pasted with Cmd+V. `ToolHost.paste` reads the
 * in-memory `#clipboard` and deliberately never the system one, because reading that back is
 * focus-gated and async. The formats agree; the transports do not cross.
 */
export function sceneFileText(doc: SceneDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * A `SceneDoc` from file text, or null when the text is not a diagram at all.
 *
 * **The one distinction `deserializeScene` cannot draw.** That function is lenient by design and
 * returns `[]` both for "this is not a diagram" and for "this is an empty diagram" -- and those
 * deserve opposite answers. An empty diagram is a document to load; a PNG, a trace, or half a
 * JSON file is an error to report, and loading it as nothing would wipe the diagram the user has
 * open because they picked the wrong file in a list.
 *
 * So the test is `shapes` being an array and nothing more. Not the `version`, which
 * `deserializeScene` has never read and must not start reading: the format is "the schema's
 * non-computed keys", so a reader of either vintage produces a valid document from a file of
 * either vintage, and refusing an unrecognised number would break exactly the files that still
 * work. Not the records either -- a record this build cannot use is skipped downstream, with a
 * count, which is a better answer than refusing the file.
 */
export function parseSceneDoc(text: string): SceneDoc | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON. The only throwing step in the whole read path, which is why it is the only catch.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (!Array.isArray((parsed as { shapes?: unknown }).shapes)) return null;
  return parsed as SceneDoc;
}

/**
 * What a save is called, given the name of the last file opened.
 *
 * There is no document-name concept in the editor, so this is the whole of one: open `xbn.json`,
 * edit, save, and the download is `xbn.json` again. A constant name would have been less code
 * and worse -- the browser suffixes a collision as `diagram (1).json`, so a repeat-save workflow
 * accumulates numbered files in Downloads with no relationship to which diagram they hold.
 *
 * The extension is forced rather than kept. A user who opened `notes.txt` holding a diagram gets
 * `notes.json` back, because what is being written is JSON whatever it arrived as. Any directory
 * part is stripped: a `File.name` never carries one, but a caller other than the picker might.
 */
export function saveFileName(opened: string | null): string {
  if (opened === null) return DEFAULT_SCENE_FILE_NAME;
  const base = opened.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return base === '' ? DEFAULT_SCENE_FILE_NAME : `${base}.json`;
}
