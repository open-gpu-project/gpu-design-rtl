# Iteration 2 — dock shell and schema-driven property editor

Status: **complete and verified in a real browser.** 2026-09-20.

Read [iteration 1](./iter-1-canvas-foundation.md) first; its conventions still hold and are not
repeated here. This document records what changed, the two design defects that a green
type-check and a working-looking UI did not reveal, and one third-party bug you will hit.

Two corrections from
[iteration 4.1](./iter-4-1-panel-and-endpoints.md), which you should read before acting on §3:

1. **Key order no longer comes from the declaration.** `propSchema` sorts every kind's `props`
   into one canonical order — `kind`, the editable keys, then the derived ones, each group
   alphabetical — so reordering a declaration array changes nothing. The §3 sentence below
   that says otherwise was true when it was written and is not now.
2. **The documentation footer sizes itself.** It is never shorter than the text in it; the grip
   only makes it larger. §3.7's two-clamp description is now three numbers, not two, and the
   per-suite counts in §9 have moved.

---

## 1. Scope

Delivered: an `@svgrid/grid` `SvDockManager` workspace with drag-to-dock, splitters, tabs,
floating windows and auto-hide; the canvas reduced to one panel among several; a panel registry;
layout persistence with validation; a property model where each shape kind declares its
properties **once**; and a Properties panel built on `svelte-jsoneditor` in tree mode, live
validated against a generated JSON Schema, with a documentation footer.

Deliberately **not** built: multi-object editing, connections, a layers panel, import/export
buttons in the UI (the round trip works and is tested, but nothing calls it yet), and a real
test suite.

46 source files, ~4,400 lines. Production bundle **1,014 KB (328 KB gzipped)** plus 136 KB
(18 KB gzipped) of CSS, up from iteration 1's 73 KB / 26 KB with zero runtime dependencies.
Essentially all of that is `svelte-jsoneditor`, which statically imports its text mode and so
drags in the whole of CodeMirror, plus FontAwesome and `lodash-es`. There is no cheap way out;
see §6.2.

## 2. Decisions that came from the user

| Decision                                                         | Note                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SvDockManager`**, not the simpler `SvDockLayout`              | Its `{main, floating, autoHide}` state is a superset of the tiled-only tree, so choosing it now avoids migrating a persisted layout later.                                                                                                         |
| **`name` is the identity. No UUIDs.**                            | Verbatim: _"I'm against using a stable UUID because I want to be able to query the diagram later. That's why I specified the Name field, which is an id version of the Label field."_ `ShapeBase.id` is **deleted**. See §3.1 for what that costs. |
| Extra rectangle properties: `description`, plus read-only `kind` | `locked` was offered and declined.                                                                                                                                                                                                                 |
| Property panel handles **one object at a time**                  | 0 selected → a hint; 2+ → a read-only array view and a banner.                                                                                                                                                                                     |
| Numeric edits **are used exactly as typed** — no grid snapping   | Canvas drags still snap to `GRID` (16). The panel is the escape hatch for placement the grid cannot express, and nothing silently rewrites a number you deliberately entered.                                                                      |

## 3. Load-bearing architecture

### 3.1 Identity is the name

`ShapeBase` is now `{kind, name, label}`. `ShapeId` was renamed `ShapeName` and every `s.id`
became `s.name` across eight files; all of them were `Map` keys, `Set` membership or
`findIndex`, so the rename was mechanical.

Three things stop that from being a footgun:

- **`SceneStore.nextName()` scans the live name set** instead of trusting its counter. Undo,
  delete and import all free up `block_3`, and handing it out twice is now two shapes sharing
  one identity, not a cosmetic annoyance.
- **`SceneStore.replaceShape(prev, next, label)`** is the only path the editor commits through.
  It swaps the shape, migrates the selection if the name changed, and gives every other shape a
  chance to rewrite references — all inside one `commit`, so one history entry.
- **`ShapeOps.renameRef?(s, from, to)`** is a new optional seam alongside the connection seams
  from iteration 1 §5.1. Nothing implements it yet. Without it, adding connections would turn
  rename into a breaking change to every mutation path instead of an additive one.

`deserializeScene` de-duplicates names on load (`alu`, `alu_2`) rather than merging identities.

### 3.2 The session is owned by the app, not by the canvas panel

`EditorSession` ([`session.svelte.ts`](../src/lib/session.svelte.ts)) holds the `SceneStore`,
`ViewController`, `ToolHost` and `Renderer`. `App.svelte` constructs it and puts it in context;
`DiagramView` is now a pure consumer.

This is not tidiness. **`SvDockManager` re-mounts a pane's content when it is maximized,
floated, or popped out — `keepAlive` only covers tab switching.** Verified: with the session
hoisted, maximizing preserves the scene _and_ the camera (`verify/docking.mjs`).

### 3.3 One declaration drives four consumers

`PropSchema` ([`props/spec.ts`](../src/lib/props/spec.ts)) is a list of `PropDef`s, each with a
`key`, a `title`, a long-form `doc`, a `PropType`, a `mode`, a `read` and (when editable) a
`write`. From that single declaration come:

1. the **editor document** (`projectShape`),
2. the **file record** (`serializeShape` — the same thing minus `computed` properties),
3. the **JSON Schema** ajv validates against (`jsonSchemaFor`),
4. the **footer documentation** (`doc` verbatim, plus `describeType`).

The value grammar has **no object case**: scalars, fixed-length tuples of scalars, and lists
whose item is a scalar or a tuple. Flatness is therefore structural, not a convention. A
polyline is `list[tuple[int,int]]` and needs no new machinery.

`ShapeOps.serialize`/`deserialize` are gone, replaced by `props` and `blank(name)`. The panel
document and the saved file are the same projection, so they cannot drift.

### 3.4 Three modes, because read-only is two different things

`edit` is editable and saved. `fixed` is not editable but _is_ saved (`kind`). `computed` is
neither — it is re-derived from the document (`zIndex` is the shape's index). Writing `zIndex`
to the file would give draw order two sources of truth that could disagree.

**`svelte-jsoneditor` has no per-node read-only.** Enforcement is `applyDocument` step 2, which
rejects any change to a non-`edit` property. The `archsim-readonly` class from `onClassName` and
the schema's `readOnly: true` are signposting only. Do not mistake either for the mechanism.

### 3.5 The editor round trip

Both directions are guarded by one string comparison.

- **Scene → editor**: an `$effect` re-derives the document and calls `push`, which no-ops when
  the serialized text already matches `pushed`. It uses the editor's `update()` (same instance,
  expansion state and caret survive, **and it does not fire `onChange`**) except when the panel
  switches to a different object, where `set()` is correct.
- **Editor → scene**: `onChange` sets `pushed` to the editor's own text, then validates and
  commits. The effect that the commit triggers re-derives identical text, compares equal, and
  does nothing.

Pushing is idempotent, so that comparison is the entire loop guard: no `applying` flag, no epoch
counter, no `untrack`. Key order is stable because it comes from the `props` declaration.

A rejected edit is **left in the tree** with an explanation rather than yanked away — reverting
someone's text mid-thought is hostile, and the schema annotation already marks it red. It is
cleared by a successful edit or by selecting a different object.

### 3.6 Keyboard ownership

`ToolHost` still listens on `window`, but `onKeyDown` now passes three independent filters:
`acceptsKeys()` (does the diagram panel own the keyboard), `e.defaultPrevented`, and a widened
`isEditableTarget` that walks ancestors via `closest()`. All three are needed because each has a
hole on its own. **`onKeyUp` and `onWindowBlur` are deliberately ungated** — a Space-keyup that
arrives while another panel has focus would otherwise latch `#spaceHeld` forever.

Ownership is tracked by `PanelHost` on capture-phase `pointerdown` and `focusin`, because
`SvDockManager`'s own focus tracking never observes focus moving _inside_ a pane.

This was not optional. `TreeMode.svelte` calls `preventDefault()` on Delete and Ctrl+A but never
`stopPropagation()`, so deleting a JSON node also deleted the selected block.

### 3.7 The panel clips; its popups must not

A dock pane is three nested `overflow: hidden` boxes: `.sv-dock__cell`, `.sv-dock__leaf` (which
needs it for its rounded corners) and `.sv-dock__content` (which this app forces from `auto` to
keep a scrollbar off the canvas). Anything a panel renders that is meant to sit _over_ the rest
of the app — a context menu, an autocomplete, a colour picker — is sheared off at the pane
boundary, and a side panel is exactly where a menu is too wide to fit.

`svelte-jsoneditor` positions all of those through one `.jse-absolute-popup` root, placing each
at `top - rootRect.top` / `left - rootRect.left`. Pinning that root to `position: fixed` at the
viewport origin solves both halves at once: a fixed box is only clipped by ancestors in its
**containing-block** chain, and that chain now ends at the viewport — and with `rootRect` at
0,0 the library's offsets _become_ the viewport coordinates they were derived from, so nothing
has to be re-computed. One declaration in `app.css`, no portal, no observer.

It holds only while no ancestor establishes a containing block for fixed positioning — a
`transform`, `filter`, `contain` or `will-change` on any pane wrapper would silently re-clip
the menu. svgrid's only `transform` is on `.sv-dock__guide`, a drag overlay that is never a
parent of pane content. Verified docked _and_ floated, by hit-testing all four corners: a
clipped element still reports its full `getBoundingClientRect()`, so the box alone proves
nothing.

The panel's own layout is the mirror image: the documentation footer is resizable against the
tree via a grip styled like svgrid's splitters, and `docsHeight` is the single source of truth
for it. The ceiling is derived from the two flexible boxes rather than from the panel, so the
banner, the alert strip and the grip are accounted for without enumerating them — and because
those two always sum to the same total, the ceiling is invariant under a drag and can be read
live rather than snapshotted.

### 3.8 The panel describes the document it is holding

The push in §3.5 is deferred for the length of a canvas gesture, and pressing an unselected
block _is_ a gesture: the select tool changes the selection on the pointerdown and begins a move
in the same handler. So between that pointerdown and the pointerup the selection has moved on and
the document has not — a window the user holds open for as long as they keep dragging.

Everything wrapped around the editor therefore reads `shownSpec` / `shownCount`, which are
written only where a document is actually pushed, and never the live selection. The validator,
`readOnly`, `onClassName`, the footer and the veil are all statements _about the document on
screen_; deriving any of them from the selection turns them into statements about a document that
is not there yet. Defect 7 is what that costs.

Two plain `$state` sources rather than one record, because assigning a `$state` its current value
is a no-op in runes mode — `source` uses strict equality, not `safe_not_equal`. `shownSpec` keeps
its identity across a selection change within one kind, so the validator, which must not change
identity (§7), is not rebuilt.

`set()` needs one thing more: it re-creates the tree, and the new instance inherits the caret from
the old one, then expands that path against the incoming document as it mounts. A path that is not
there throws — defect 8. So the caret is dropped ahead of a document whose keys differ, and only
then: holding the caret on `size` while clicking from one block to the next is worth keeping, and
there the path still resolves.

### 3.9 A context menu for a property bag

The tree's default context menu is twenty-odd buttons built for editing arbitrary JSON —
duplicate, extract, sort, transform, convert-to-object/array/value, and formatted/compacted
variants of cut and copy behind dropdown chevrons. A property bag can do almost none of it:
`additionalProperties: false` plus `required` reject every structural change those buttons make,
so offering them is offering a menu of things that will be refused.

`onRenderContextMenu` receives the whole item tree and may return a different one.
[`props/context-menu.ts`](../src/lib/props/context-menu.ts) indexes the library's own buttons by
label and reassembles four rows from them: the two edit buttons, the clipboard, insert
before/after, and remove. Reusing the buttons rather than writing replacements is the point —
`onClick`, `icon` and above all `disabled` stay the library's business, so "Edit key" still greys
itself out on a tuple element and "Paste" still knows whether there is a clipboard. A dropdown
contributes only its `main` action, which is both how the variants are dropped and why the menu
ends up narrower.

Labels are the match key. They are stable except for one: `Edit value` is relabelled `Edit array`
or `Edit object` by what the caret is on, and both happen here because `position` and `size` are
tuples — its `title` does not change, so that is what identifies it. A label that goes missing
upstream produces a DEV warning rather than a silently absent button.

Returning `false` when the editor is read-only suppresses the menu outright, which is what the
empty and multi-selection documents want.

---

## 4. Defects this iteration, and what they teach

| #   | Bug                                                                                                                                                                                                                | Where                                           | Why it was not obvious                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Click-to-select never reached the property panel.** It kept showing the previously selected block, and the next edit was applied against the wrong object — surfacing as a bogus "zIndex is computed" rejection. | `PropertiesView` + `host.svelte.ts`             | The effect defers while `isGesturing()`. A press starts a move-drag, and **a click that never moves commits nothing**, so no scene signal ever arrived to retry. The fix is `ToolHost.gestureVersion`, a counter bumped whenever a gesture ends however it ends. Anything that defers on `isGesturing()` needs that wake-up; the scene alone is not it.                                                                                                                                                    |
| 2   | A refused edit and the key documentation shared the footer, so a stale error hid the docs.                                                                                                                         | `PropertiesView`                                | Only visible once a rejection and a subsequent key click happened in sequence. Split into a separate alert strip; the error has to outlive the selection, because committing a value moves the caret to the next row.                                                                                                                                                                                                                                                                                      |
| 3   | `detach()` could null out a canvas that had just been attached.                                                                                                                                                    | `view.svelte.ts`, `host.svelte.ts`              | Svelte may run a new pane's `onMount` before the old one's cleanup on a re-mount (maximize/float). Prevented rather than observed: both `detach` methods now take the canvas they are detaching and no-op if it is not the live one.                                                                                                                                                                                                                                                                       |
| 4   | **Upstream.** Restore-from-maximize throws `TypeError: Cannot read properties of null (reading 'id')`.                                                                                                             | `@svgrid/grid@3.0.5` `SvDockManager.svelte:793` | `commit(...)` reassigns the workspace, Svelte tears the `mainLeafActions` snippet down, and the trailing `emit({..., tabsId: leaf.id})` in the same handler dereferences a nulled `leaf`. **The state change lands correctly**; only the telemetry call explodes. Reproducible on the default layout with one visible button. Not fixable from here. `verify/docking.mjs` filters it explicitly.                                                                                                           |
| 5   | **The tree's context menu was sheared off at the pane boundary**, with most of it hidden.                                                                                                                          | `app.css`                                       | Reported by the user, not by any check. It is invisible to review because nothing in the panel's own code positions the menu, and invisible to a box-geometry assertion because a clipped element still reports its full rect. Hit-testing the corners is what proves it. See §3.7.                                                                                                                                                                                                                        |
| 6   | The first cut of the resizable footer collapsed the documentation to 21px in a floating window, leaving the grip looking dead.                                                                                     | `PropertiesView`                                | It took `.jse-main`'s own `min-height: 150px` as the editor's floor. That is a sensible default for an editor that owns its page and the wrong one for a pane whose height the user is setting: it forced a 3:1 split in a small float. Overriding it to `0` — the tree already scrolls — let the floor drop to 80px. Only reproducible in a float; the docked pane is too tall to hit it.                                                                                                                 |
| 7   | **Pressing an unselected block filled the panel with validation errors** — one "must have required property" per key — which all vanished on mouse-up.                                                             | `PropertiesView`                                | Reported by the user. The push is deferred for the gesture, but the validator was derived from the _selection_, so for the length of the press the empty document was being validated against the newly selected block's schema. Only reachable from a deselected start: block-to-block never showed it, because the validator keeps its identity within one kind and so never re-runs. See §3.8.                                                                                                          |
| 8   | **Deselecting with a tuple element selected threw `Cannot convert path` out of the editor's mount**, and unwound the panel's own effect on the way out.                                                            | `PropertiesView`                                | Pre-existing, found while verifying the two changes above and confirmed against a reconstruction of the pre-change file. `set()` re-creates the tree and hands the new instance the old caret; `/size/1` is not in the empty document. Never reached before because every existing check deselected with a _top-level_ key selected, where the lookup returns `undefined` instead of throwing. `set()` flushes synchronously, so the throw was inside our own `$effect` and left the panel mid-update too. |

### 4.1 An analysis that was wrong, and what settled it

I concluded — from reading `vitePreprocess` and confirming it keys off `attributes.lang` and
never `attributes.src` — that `svelte-jsoneditor`'s `<style src="./X.scss">` blocks would be
silently dropped, and that `svelte-preprocess` plus `sass` were required. That reasoning was
correct and the conclusion was wrong: **`svelte-package` inlines the compiled CSS into the
published `.svelte` files at publish time**, and the `src=` attribute is vestigial. All 47
style-bearing files carry real CSS (`min-height: 150px`, not `styles.$contents-min-height`).

`svelte.config.js` stays `export default {}`. No preprocessor, no `sass`.

The check that would have settled it in one step is reading the shipped file's style body, not
the preprocessor's source. Every browser suite now asserts
`getComputedStyle('.jse-main').display === 'flex'` rather than merely that the editor rendered.

---

## 5. Scaffolding left for future iterations

- **A third panel** is one `.svelte` under `views/`, one three-line `registerPanel` file under
  `lib/panels/`, and one line in [`register.ts`](../src/lib/register.ts). The dock resolves pane
  ids through the registry, and `panelFor` returns `undefined` (rather than throwing, unlike the
  shape and tool registries) so a saved layout naming a deleted panel renders a placeholder
  instead of bricking the app.
- **A new shape kind** is `shapes/<kind>.ts` plus `shapes/<kind>.props.ts`, widening the `Shape`
  union, and a line in `register.ts`. Nothing switches on `kind`.
- **A new property** is one entry in the kind's `props` array. Schema, validation, editor row,
  footer text and file format all follow.
- **Import/export** already works end to end — `serializeScene`/`deserializeScene` round-trip
  exactly and are tested — but no UI calls them. Two toolbar buttons and a file input.
- **`window.__workspace`** is a DEV-only getter/setter on the dock state, alongside `__scene`,
  `__view`, `__host`, `__dump` and `__resetLayout`. It is how `verify/docking.mjs` arranges
  panes without scripting a drag.

## 6. Flagged for future work

1. **Still no real test suite.** `verify/` holds three Playwright scripts (68 assertions) that
   found defects 1, 2, 6 and 8 above; they are kept because iteration 1's biggest regret was throwing
   the equivalent away. They are not a substitute for the Vitest plan in iteration 1 §6.1, whose
   central warning still stands: under `environment: 'node'` a rune-based suite passes while
   testing nothing.
2. **Bundle size is ~14× iteration 1.** `svelte-jsoneditor`'s `JSONEditorRoot` statically
   imports `TextMode`, so CodeMirror ships even though this app only ever uses tree mode. Code
   splitting the Properties panel behind a dynamic `import()` would keep the canvas' first paint
   cheap; worth doing before there is a third heavy panel.
3. **Auto-hide is enabled but untested.** Float, maximize and tabs are covered; the edge-strip
   fly-out is not.
4. **Pop-out is disabled on purpose** (`allowPopout={false}`). A popped-out canvas renders into
   a second `document` while `CanvasSurface` reads `devicePixelRatio` and `matchMedia` from the
   opener. Broken by construction, so it is not offered.
5. **Only one canvas pane may exist.** The session owns a single `ViewController`; two diagram
   panes would fight over `view.attach()`. Enforced only by `closable: false` and by never
   minting a second `diagram` pane.
6. **`size` allows values below `GRID`.** The user asked for "positive non-zero", so the schema
   floor is 1, and property edits bypass `normalize()` (which drops sub-cell rects) because they
   are deliberate where a sub-cell _drag_ is an accident. A 1×1 block is effectively unclickable
   on the canvas; the property panel is the only way back. Raising the floor is one line in
   `rect.props.ts`.
7. **`name` has no character-set constraint**, only `minLength: 1`. If these are ever emitted as
   RTL identifiers, an identifier pattern is one line in the same place.

## 7. Conventions and gotchas

- **Generated JSON Schema must be draft-07.** `createAjvValidator` imports the draft-07 `Ajv`
  and gets ajv 8's default `strict: true`, which **throws on an unknown keyword at compile
  time — i.e. when the panel mounts, not when anything type-checks**. Tuples are
  `items: [...]` + `additionalItems: false` + `minItems`/`maxItems`, never `prefixItems`.
- **`keepAlive` on `SvDockManager` is required, not a preference.** Without it `DockNodeView`
  wraps pane content in `{#key active.id}` and rebuilds the canvas on every tab switch.
- **`dedupeManagerNodeIds` on every restored layout.** The library mints node ids from a
  module-scoped counter that resets on reload, so a restored tree collides with fresh nodes and
  blows up a keyed `{#each}`.
- **`.sv-dock__content` is `overflow: auto`** and the rule is scoped (specificity 0,2,0), so a
  `:global()` override loses. `app.css` uses `#app .sv-dock__content` to win without
  `!important`.
- **A panel's popups need `#app .jse-absolute-popup { position: fixed }`** to escape the pane's
  three `overflow: hidden` ancestors. Any other library mounted in a panel that positions
  overlays inside its own subtree needs the same treatment. See §3.7.
- **`.jse-main` ships `min-height: 150px`.** Below that the editor overflows its box instead of
  shrinking with it, which silently breaks any layout that gives the panel a height. Overridden
  to `0` in `PropertiesView`.
- **Nothing handed to the editor may be derived from the selection.** The panel's push is
  deferred while a canvas gesture runs, so the validator, `readOnly`, the row classes and the
  footer all have to be derived from the document actually pushed. See §3.8.
- **`editor.set()` re-creates the tree, and the new instance inherits the caret.** Its mount
  expands that path against the incoming document and throws if the path is gone, so clear the
  selection first whenever the keys are about to change. `update()` does not have this problem.
- **`bringToFront` is exported by both `scene/zorder.ts` and `@svgrid/grid`.** Alias one at any
  import site that needs both.
- **Never pass a `$derived` as the editor's `content` prop.** The component assigns to its own
  `content`; a reactive parent expression fights it and reverts keystrokes. Drive it through
  `update()`/`set()` instead.
- Validators are compiled once per kind and cached; only the cheap uniqueness closure is rebuilt.
  Handing the editor a fresh `validator` identity makes it re-validate continuously.
- Uniqueness of `name` is checked **twice on purpose**: in the validator for the live red
  annotation, and again in the `name` writer, which is what actually refuses the commit. The
  editor delivers invalid documents to `onChange` regardless of what a validator says.

## 8. How iteration 2 was verified

Three Playwright suites against real Edge (`channel: 'msedge'`) at `deviceScaleFactor: 2` —
68 assertions, all passing, plus a further 18 written during development and since folded in or
discarded. See [`verify/README.md`](../verify/README.md).

- `verify/properties.mjs` (35) — projection, commit granularity, undo, duplicate-name and
  computed-property refusal, rename with selection migration, the documentation footer, Delete
  key scoping, canvas-drag → panel propagation, the serialize round trip, both clamps on the
  footer grip and its keyboard steps, the context menu's contents and its escape from the pane
  docked and floated, and the two defects below that only appear mid-gesture or mid-caret.
- `verify/docking.mjs` (18) — splitter, float, maximize/restore, camera survival across
  re-mount, layout persistence, fallback from an unregistered panel id and from corrupt JSON,
  and the `keepAlive` contract (hidden pane is `display:none`, context and camera intact).
- `verify/production.mjs` (15) — the built bundle under `vite preview`, asserted through the DOM
  only, since the `window.__*` hooks are correctly absent there. Includes the two
  specificity-dependent CSS overrides, which a pipeline change could silently undo.

Of the eight defects above, one was headed off by review; two came from the user and five from a
browser. Defect 1 presented as a nonsensical "zIndex is computed" error and would have been very
hard to reason out from the source; defect 8 had been sitting in the panel unnoticed. **Iteration 1's conclusion holds unchanged: compiling is not running.**
