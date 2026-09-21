import {
  isContextMenuColumn,
  isContextMenuRow,
  isMenuButton,
  isMenuDropDownButton,
  type ContextMenuItem,
  type MenuButton,
  type OnRenderContextMenu,
} from 'svelte-jsoneditor';

/**
 * The tree view's default context menu, cut down to the actions a property bag can actually
 * take.
 *
 * It ships twenty-odd buttons built for editing arbitrary JSON: duplicate, extract, sort,
 * transform, convert-to-object/array/value, and formatted/compacted variants of cut and copy
 * behind dropdown chevrons. Almost none of that applies here. A bag's keys are fixed by its
 * kind's declaration, and `additionalProperties: false` plus `required` reject every structural
 * change those buttons can make -- so offering them is offering a menu of things that will be
 * refused. What survives is the eight actions that operate on a value.
 *
 * Rows, in order. A name is the button's visible label, which is also how the library's own
 * items are matched, so this list is the whole specification of the menu.
 */
const LAYOUT: readonly (readonly string[])[] = [
  ['Edit key', 'Edit value'],
  ['Cut', 'Copy', 'Paste'],
  ['Insert before', 'Insert after'],
  ['Remove'],
];

/**
 * `Edit value` is relabelled `Edit array` or `Edit object` depending on what the caret is on --
 * and both of those happen here, since `position` and `size` are tuples. Its `title` does not
 * change, so that is what identifies it. Every other label is stable.
 */
function nameOf(button: MenuButton): string {
  return (button.title ?? '').startsWith('Edit the value') ? 'Edit value' : (button.text ?? '');
}

/**
 * Index the library's buttons by label, wherever they are nested.
 *
 * A dropdown contributes only its `main` action, which is its default click: the variants
 * behind the chevron are "cut compacted", "copy compacted" and "enforce string", none of which
 * survive the cut. Dropping the dropdowns is also what makes the menu narrow.
 *
 * `unknown[]` because a row may nest a column, and a column is not itself a `ContextMenuItem`.
 * The typeguards take `unknown`, so there is nothing to gain from restating that union here.
 */
function collect(items: readonly unknown[], found: Map<string, MenuButton>): void {
  for (const item of items) {
    if (isMenuButton(item)) found.set(nameOf(item), item);
    else if (isMenuDropDownButton(item)) found.set(nameOf(item.main), item.main);
    else if (isContextMenuRow(item) || isContextMenuColumn(item)) collect(item.items, found);
  }
}

/**
 * Reassembles the menu from `LAYOUT`, reusing the library's own buttons.
 *
 * Reusing them rather than writing replacements is the point: `onClick`, `icon` and -- most of
 * all -- `disabled` stay the library's business, so "Edit key" still greys itself out on a
 * tuple element and "Paste" still knows whether there is a clipboard.
 */
export const simplifyContextMenu: OnRenderContextMenu = (items, { readOnly }) => {
  // Read-only means no single object is selected, so the document on screen is the empty or
  // the multi-selection one. Every action below is disabled against those; suppress the menu
  // rather than pop up eight dead buttons.
  if (readOnly) return false;

  const found = new Map<string, MenuButton>();
  collect(items, found);

  if (import.meta.env.DEV) {
    const missing = LAYOUT.flat().filter((name) => !found.has(name));
    if (missing.length > 0) {
      // Silent otherwise: a renamed label upstream would just drop the button from the menu.
      console.warn(`property context menu: no item labelled ${missing.join(', ')}`);
    }
  }

  const menu: ContextMenuItem[] = [];
  for (const names of LAYOUT) {
    const row = names.flatMap((name) => found.get(name) ?? []);
    if (row.length === 0) continue;
    if (menu.length > 0) menu.push({ type: 'separator' });
    menu.push({ type: 'row', items: row });
  }
  return menu;
};
