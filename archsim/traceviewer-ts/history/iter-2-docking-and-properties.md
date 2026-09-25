# Iteration 2 — dock shell and schema-driven property editor

2026-09-20. Complete and verified in a real browser.

Read [iteration 1](./iter-1-canvas-foundation.md) first. This document records what changed, the
design defects a green type-check and a working-looking UI did not reveal, and one third-party bug
you will hit.

## Scope

Delivered: an `@svgrid/grid` `SvDockManager` workspace with drag-to-dock, splitters, tabs, floating
windows and auto-hide; the canvas reduced to one panel among several; a panel registry; layout
persistence with validation; a property model where each shape kind declares its properties
**once**; and a Properties panel built on `svelte-jsoneditor` in tree mode, live-validated against a
generated JSON Schema, with a documentation footer.

Deliberately not built: multi-object editing, connections, a layers panel, import/export buttons
(the round trip worked and was tested, but nothing called it yet), and a real test suite.

The production bundle grew from iteration 1's 73 KB to ~1 MB (328 KB gzipped), essentially all of it
`svelte-jsoneditor`, which statically imports its text mode and so drags in CodeMirror, FontAwesome
and `lodash-es` even though only tree mode is used.

## Decisions that came from the user

| Decision                                                         | Note                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SvDockManager`**, not the simpler `SvDockLayout`              | Its `{main, floating, autoHide}` state is a superset of the tiled-only tree, so choosing it now avoids migrating a persisted layout later.                                                                        |
| **`name` is the identity. No UUIDs.**                            | Verbatim: _"I'm against using a stable UUID because I want to be able to query the diagram later. That's why I specified the Name field, which is an id version of the Label field."_ `ShapeBase.id` was deleted. |
| Extra rectangle properties: `description`, plus read-only `kind` | `locked` was offered and declined.                                                                                                                                                                                |
| The property panel handles **one object at a time**              | 0 selected → a hint; 2+ → a read-only array view and a banner.                                                                                                                                                    |
| Numeric edits **are used exactly as typed** — no grid snapping   | Canvas drags still snap to `GRID` (16). The panel is the escape hatch for placement the grid cannot express, and nothing silently rewrites a number you deliberately entered.                                     |

## Load-bearing decisions

### Identity is the name

`ShapeBase` is `{kind, name, label}`; `ShapeId` became `ShapeName`. Every former `s.id` was a `Map`
key, `Set` membership or `findIndex`, so the rename was mechanical. Human-readable identity is what
makes the diagram queryable later; what it costs is that names can collide and change, and three
things stop that from being a footgun:

- **`SceneStore.nextName()` scans the live name set** instead of trusting a counter. Undo, delete
  and import all free up `block_3`, and handing it out twice would be two shapes sharing one
  identity, not a cosmetic annoyance.
- **`SceneStore.replaceShape(prev, next, label)`** is the only path the editor commits through. It
  swaps the shape, migrates the selection if the name changed, and gives every other shape a chance
  to rewrite references — all inside one `commit`, so one history entry.
- **`ShapeOps.renameRef?(s, from, to)`** is the optional seam through which a referring shape
  follows a rename. It was added here with no implementers so that connections would make rename an
  additive change rather than a breaking one to every mutation path; connections and interfaces
  implement it now.

Loading de-duplicates names (`alu`, `alu_2`) rather than merging identities.

### The session is owned by the app, not by the canvas panel

`EditorSession` (`session.svelte.ts`) holds the `SceneStore`, `ViewController`, `ToolHost` and
`Renderer`; `App.svelte` constructs it and puts it in context, and `DiagramView` is a pure consumer.
This is not tidiness: **`SvDockManager` re-mounts a pane's content when it is maximized, floated or
popped out — `keepAlive` only covers tab switching.** With the session hoisted, maximizing preserves
the scene and the camera. The same re-mount is why `detach` on `CanvasViewport` and `ToolHost` takes
the canvas it is detaching and no-ops if that is not the live one: Svelte may run the new pane's
`onMount` before the old one's cleanup.

### One declaration drives four consumers

`PropSchema` (`props/spec.ts`) is a list of `PropDef`s, each with a `key`, `title`, long-form `doc`,
`PropType`, `mode`, `read` and (when editable) `write`. From that one declaration come the editor
document (`projectShape`), the file record (`serializeShape`, the same projection minus `computed`
properties), the JSON Schema ajv validates against (`jsonSchemaFor`), and the footer documentation
(`doc` verbatim plus `describeType`). `ShapeOps.serialize`/`deserialize` were replaced by `props`
and `blank(name)`; the panel document and the saved file are the same projection, so they cannot
drift. `propSchema` sorts every kind's props into one canonical order — `kind`, the editable keys,
then the derived ones, each group alphabetical — so reordering a declaration array changes nothing.

The value grammar has **no object case**: scalars, fixed-length tuples of scalars, and lists whose
item is a scalar or a tuple. Flatness is structural, not a convention; a polyline is
`list[tuple[int,int]]` and needs no new machinery.

### Three modes, because read-only is two different things

`edit` is editable and saved. `fixed` is not editable but is saved (`kind`); since iteration 4 a
`fixed` property with a writer is also restored from the record on load (`hydrateShape` and
`applyDocument` ask different questions), it simply cannot be typed. `computed` is neither — it is
re-derived from the document (`zIndex` is the shape's index); writing it to the file would give draw
order two sources of truth that could disagree.

**`svelte-jsoneditor` has no per-node read-only.** The mechanism is `applyDocument`, which rejects
any change to a non-`edit` property. The `archsim-readonly` class from `onClassName` and the
schema's `readOnly: true` are signposting only.

### The editor round trip

Both directions are guarded by one string comparison.

- **Scene → editor**: an `$effect` re-derives the document and calls `push`, which no-ops when the
  serialized text already matches `pushed`. It uses the editor's `update()` (same instance,
  expansion state and caret survive, and it does not fire `onChange`) except when the panel switches
  to a different object, where `set()` is correct.
- **Editor → scene**: `onChange` sets `pushed` to the editor's own text, then validates and commits.
  The effect the commit triggers re-derives identical text, compares equal, and does nothing.

Pushing is idempotent, so that comparison is the entire loop guard: no `applying` flag, no epoch
counter, no `untrack`. It depends on key order being stable, which the canonical sort guarantees.

A rejected edit is **left in the tree** with an explanation rather than yanked away — reverting
someone's text mid-thought is hostile, and the schema annotation already marks it red. It clears on
a successful edit or on selecting a different object. The error has its own alert strip, separate
from the documentation footer, because it must outlive the caret: committing a value moves the caret
to the next row.

### The panel describes the document it is holding

The push is deferred for the length of a canvas gesture, and pressing an unselected block is a
gesture: the select tool changes the selection on pointerdown and begins a move in the same handler.
Between pointerdown and pointerup the selection has moved on and the document has not — for as long
as the user keeps dragging.

So everything wrapped around the editor — the validator, `readOnly`, `onClassName`, the footer, the
veil — reads `shownSpec` / `shownCount`, written only where a document is actually pushed, never the
live selection. They are statements about the document on screen. They are two plain `$state`
sources rather than one record because assigning a `$state` its current value is a no-op in runes
mode (strict equality, not `safe_not_equal`): `shownSpec` keeps its identity across a selection
change within one kind, so the validator, which must not change identity, is not rebuilt.

Anything that defers on `isGesturing()` also needs a wake-up that is not the scene: a click that
never moves commits nothing, so no scene signal arrives. `ToolHost.gestureVersion` is bumped
whenever a gesture ends, however it ends.

`set()` needs one thing more: it re-creates the tree, and the new instance inherits the old caret
and expands that path against the incoming document as it mounts. A path that is not there throws.
So the caret is dropped ahead of a document whose keys differ, and only then — holding the caret on
`size` while clicking from block to block is worth keeping, and there the path still resolves.

### Keyboard ownership

`ToolHost` listens on `window`, but `onKeyDown` passes three independent filters: `acceptsKeys()`
(does the diagram panel own the keyboard), `e.defaultPrevented`, and an `isEditableTarget` that
walks ancestors via `closest()`. Each has a hole on its own. **`onKeyUp` and window blur are
deliberately ungated** — a Space-keyup that arrives while another panel has focus would otherwise
latch the space-held state forever. This was not optional: `TreeMode.svelte` calls
`preventDefault()` on Delete and Ctrl+A but never `stopPropagation()`, so deleting a JSON node also
deleted the selected block.

Ownership is tracked by `PanelHost` on capture-phase `pointerdown` and `focusin`, because
`SvDockManager`'s own focus tracking never observes focus moving inside a pane.

### The panel clips; its popups must not

A dock pane is three nested `overflow: hidden` boxes: `.sv-dock__cell`, `.sv-dock__leaf` (for its
rounded corners) and `.sv-dock__content` (forced from `auto` to keep a scrollbar off the canvas).
Anything a panel renders over the rest of the app — context menu, autocomplete, colour picker — is
sheared off at the pane boundary, and a side panel is exactly where a menu is too wide to fit.

`svelte-jsoneditor` positions all of those through one `.jse-absolute-popup` root, placing each at
`top - rootRect.top` / `left - rootRect.left`. Pinning that root to `position: fixed` at the
viewport origin solves both halves at once: a fixed box is clipped only by ancestors in its
containing-block chain, which now ends at the viewport, and with `rootRect` at 0,0 the library's
offsets become the viewport coordinates they were derived from. One declaration in `app.css`, no
portal, no observer. It holds only while no ancestor establishes a containing block for fixed
positioning — a `transform`, `filter`, `contain` or `will-change` on any pane wrapper would silently
re-clip the menu. svgrid's only `transform` is on `.sv-dock__guide`, a drag overlay that is never a
parent of pane content.

The documentation footer is resizable against the tree by a grip styled like svgrid's splitters. Its
height is three numbers: what the user last dragged to (`docsWanted`), a floor that is never shorter
than the text in it (`docsFloor`), and a ceiling derived from the two flexible boxes (`docsMax`), so
the banner, alert strip and grip are accounted for without enumerating them. `.jse-main`'s shipped
`min-height: 150px` is overridden to `0`; the tree already scrolls.

### A context menu for a property bag

The tree's default context menu is twenty-odd buttons for editing arbitrary JSON — duplicate,
extract, sort, transform, convert, and formatted/compacted cut and copy variants. On a property bag
`additionalProperties: false` plus `required` reject every structural change those make, so offering
them is offering a menu of refusals.

`onRenderContextMenu` receives the whole item tree and may return a different one.
`props/context-menu.ts` indexes the library's own buttons by label and reassembles four rows: the
two edit buttons, the clipboard, insert before/after, and remove. Reusing the buttons rather than
writing replacements is the point — `onClick`, `icon` and above all `disabled` stay the library's
business, so "Edit key" still greys out on a tuple element and "Paste" still knows whether there is
a clipboard. A dropdown contributes only its `main` action, which drops the variants and narrows the
menu. Labels are the match key except for `Edit value`, which the library relabels `Edit array` or
`Edit object` depending on the caret (both happen, since `position` and `size` are tuples); its
`title` does not change, so that identifies it. A label that goes missing upstream produces a DEV
warning rather than a silently absent button. Returning `false` when the editor is read-only
suppresses the menu outright, which the empty and multi-selection documents want.

## Defects, and what they teach

**Click-to-select never reached the property panel.** The panel kept showing the previous block, and
the next edit was applied against the wrong object — surfacing as a bogus "zIndex is computed"
rejection that would have been very hard to reason out from the source. The effect deferred while
`isGesturing()`, and a click that never moves commits nothing, so nothing retried. Fixed with
`gestureVersion`: anything that defers on a gesture needs a wake-up for the gesture's end.

**Pressing an unselected block filled the panel with validation errors** — one "must have required
property" per key — that vanished on mouse-up. Reported by the user. The validator was derived from
the selection while the push was deferred, so the empty document was validated against the new
block's schema. Block-to-block never showed it, because the validator keeps its identity within one
kind. Nothing handed to the editor may be derived from the selection.

**Deselecting with a tuple element selected threw `Cannot convert path` out of the editor's mount**
and unwound the panel's own `$effect`, since `set()` flushes synchronously. `set()` handed the new
tree the old caret, and `/size/1` is not in the empty document. It had been sitting there unnoticed:
every check deselected with a top-level key selected, where the lookup returns `undefined` instead
of throwing.

**The tree's context menu was sheared off at the pane boundary.** Reported by the user, not by any
check. Invisible to review because nothing in the panel's code positions the menu, and invisible to
a box-geometry assertion because a clipped element still reports its full `getBoundingClientRect()`.
Hit-testing all four corners, docked and floated, is what proves it.

**The first resizable footer collapsed the documentation to 21px in a floating window.** It took
`.jse-main`'s `min-height: 150px` as the editor's floor — sensible for an editor that owns its page,
wrong for a pane whose height the user sets. Only reproducible in a float; the docked pane is too
tall to hit it.

**Upstream: restore-from-maximize throws
`TypeError: Cannot read properties of null (reading 'id')`** in `@svgrid/grid@3.0.5`
`SvDockManager.svelte:793`. `commit(...)` reassigns the workspace, Svelte tears down the
`mainLeafActions` snippet, and the trailing `emit({..., tabsId: leaf.id})` in the same handler
dereferences a nulled `leaf`. The state change lands correctly; only the telemetry call explodes.
Reproducible on the default layout with one button. Not fixable from here; `verify/docking.mjs`
filters it explicitly.

**An analysis that was right in its reasoning and wrong in its conclusion.** Reading
`vitePreprocess` (it keys off `attributes.lang`, never `attributes.src`) suggested
`svelte-jsoneditor`'s `<style src="./X.scss">` blocks would be dropped and that `svelte-preprocess`
plus `sass` were needed. But `svelte-package` inlines compiled CSS into the published `.svelte`
files; the `src=` attribute is vestigial. `svelte.config.js` stays `export default {}`. Read the
shipped file, not the preprocessor's source — and the suites assert
`getComputedStyle('.jse-main').display === 'flex'` rather than merely that the editor rendered.

## How it was verified

Playwright suites against real Edge (`channel: 'msedge'`) at `deviceScaleFactor: 2`, driven through
DEV-only hooks (`window.__workspace` arranges panes without scripting a drag) and, for the built
bundle under `vite preview`, through the DOM alone. `verify/properties.mjs` covered projection,
commit granularity, undo, duplicate-name and computed-property refusal, rename with selection
migration, Delete-key scoping, canvas-drag propagation, the serialize round trip, the footer grip
and the context menu's escape from the pane; `verify/docking.mjs` covered splitter, float,
maximize/restore, camera survival across re-mount, layout persistence and its fallbacks, and the
`keepAlive` contract; `verify/production.mjs` covered the bundle including the two
specificity-dependent CSS overrides. The iteration ended at **68 assertions** (35 + 18 + 15). Of the
defects, one was headed off by review, two came from the user and the rest from a browser. Iteration
1's conclusion holds: compiling is not running.
