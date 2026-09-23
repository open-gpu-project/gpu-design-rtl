/**
 * Keyboard shortcuts written the way a Mac keyboard writes them: `⇧⌘Z`, not `Shift+Cmd+Z`.
 *
 * Mac notation only, deliberately. Detecting the platform would mean a second symbol table that
 * nobody here ever sees rendered, and a branch that can only be wrong somewhere else -- so this
 * module is one table, and the app is a Mac app until someone runs it somewhere else.
 *
 * Top-level rather than under `ui/`, because the consumers are a component, the tool registry
 * and a scene module's property documentation. A scene module reaching into `lib/ui` for a
 * string would be the worse dependency.
 */

/**
 * A modifier name, a named key, or a literal key.
 *
 * Spelled out rather than taking the symbols directly so that call sites stay greppable and
 * the canonical ordering below has something to sort.
 */
export type KeyToken =
  | 'cmd'
  | 'shift'
  | 'opt'
  | 'ctrl'
  | 'del'
  | 'esc'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'enter'
  | 'home'
  | 'end'
  | (string & {});

const MODIFIER: Record<string, string> = {
  ctrl: '^',
  opt: '⌥',
  shift: '⇧',
  cmd: '⌘',
};

/**
 * Apple's order, which is the order the glyphs are printed in everywhere else on the system.
 * Sorting rather than trusting the call site is what makes `⇧⌘Z` the only spelling of redo.
 */
const MODIFIER_ORDER = ['ctrl', 'opt', 'shift', 'cmd'];

/**
 * Keys with a glyph worth using. `del` is `⌫` -- Backspace -- because that is the key a Mac
 * keyboard actually has; the forward-delete `⌦` is on full-size keyboards only, and both keys
 * already delete the selection.
 *
 * Esc, Home and End stay as words: their glyphs (`⎋`, `↖`, `↘`) are not printed on the keys and
 * read as puzzles. The arrows are printed on theirs.
 */
const NAMED: Record<string, string> = {
  del: '⌫',
  esc: 'Esc',
  home: 'Home',
  end: 'End',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  enter: '↩',
};

/** `keys('shift', 'cmd', 'z')` -> `⇧⌘Z`. Modifiers may be given in any order. */
export function keys(...tokens: readonly KeyToken[]): string {
  const mods: string[] = [];
  const rest: string[] = [];
  for (const token of tokens) {
    const k = token.toLowerCase();
    if (k in MODIFIER) mods.push(k);
    else if (k in NAMED) rest.push(NAMED[k]!);
    else {
      // A single character is a literal key: 'z' -> 'Z', ']' -> ']'. Anything longer was meant
      // to be one of the names above, so it is a typo, and every call site here is a literal.
      if (token.length > 1 && import.meta.env.DEV) throw new Error(`unknown key token: ${token}`);
      rest.push(token.toUpperCase());
    }
  }
  mods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...mods.map((m) => MODIFIER[m]!), ...rest].join('');
}

/**
 * A label with its shortcut in parentheses: `hint('Undo', 'cmd', 'z')` -> `Undo (⌘Z)`.
 *
 * One function owns the parentheses, so the toolbar, the trace panel and the tool registry
 * cannot each punctuate it differently.
 */
export function hint(label: string, ...tokens: readonly KeyToken[]): string {
  return tokens.length === 0 ? label : `${label} (${keys(...tokens)})`;
}
