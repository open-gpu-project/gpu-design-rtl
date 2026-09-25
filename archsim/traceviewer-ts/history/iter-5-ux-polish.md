# Iteration 5 — UX polish: what the document holds, and what the canvas says when you zoom out

2026-09-23. Complete. Papercuts found by using the app, not by reading it. No file-format change, no
router change.

## Scope

Most of this iteration is one sentence said several ways: **the document already held something the
canvas never showed you**, or showed it only at the zoom you happened to test at. `description`
existed on both kinds and was documented as "never drawn". A connection's `name` — the identifier
every other record refers to it by — was invisible, because a wire draws its `label` and nothing
else. A block could carry one line of text however much there was to say about it, and that line
vanished all at once below a threshold. The toolbar claimed a tooltip the browser never drew.

What it delivered:

- Blocks gain `subtitle` and `labelMode` (`inset` | `tabbed_left` | `tabbed_right`, the tab sitting
  above the top edge), and `description` becomes a hover tooltip, from a new `ShapeOps.tooltip` seam
  and `CanvasTooltip.svelte`.
- The trace cursor becomes one flag on its stem, draggable by its body.
- Connections gain `labelOffset`, a `[par, perp]` nudge in CSS pixels relative to the run the label
  rides.
- An editable enum property renders as a dropdown.
- `MAJOR_EVERY` 5 → 6, so five minor dots sit between two majors.
- `fitText` and `textMeasurer` move to `canvas/text.ts`, so both canvases truncate with one
  function; the renderer's inline cull margin becomes `CULL_MARGIN_PX`.
- A marquee tool, a `ShapeOps.intersects` seam, and a clipboard (`Cmd+C`/`Cmd+X`/`Cmd+V`) whose
  payload is a real `SceneDoc`.
- Every native `title` on the app's own chrome replaced by one app-owned tooltip layer, driven by
  `tip()`.
- Shortcut hints as Mac symbols from one table (`keys.ts`); the toolbar split into two clusters,
  with digits assigned by position; inset text that shrinks with its block instead of vanishing;
  arrowheads dropped when they would be drawn on top of a block they join.

Chronology:

- **5, the document says more than the canvas shows** — subtitle, label modes and the tab, both
  canvas tooltips, the cursor flag, `labelOffset`, the enum dropdown, `MAJOR_EVERY` = 6,
  `CULL_MARGIN_PX`.
- **5.2, marquee and clipboard** — the marquee tool, `intersects`, copy/cut/paste,
  `nextFreeIndexedName`.
- **5.3, chrome tooltips** — why the native toolbar tooltip never appeared; `tip()` and the one
  app-root layer; the toolbar's first coverage.
- **5.4, zoomed out** — `keys.ts`, the Pointer/Select rename and toolbar clusters, the height budget
  and measured width for inset text, `DrawContext.boundsOf` and the arrowhead rule.

Deliberately not changed across the iteration: `SceneDoc.version` (still `2`); a box's `bounds`,
which stays the bare rectangle although the tab is drawn outside it; `anchorAt` and the resize
handles, which do not know about the tab — only `hitTest` grew; the tabbed label path, which already
read well at every zoom and was left alone when inset text was reworked; `ARROW_LEN_PX`, still 9 CSS
px and not scaled with zoom; and dragging empty space with the pointer tool, which still pans.

## Decisions that came from the user

| Decision                                                                      | Note                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Three label modes, not a boolean** — `inset`, `tabbed_left`, `tabbed_right` | Asked for by name.                                                                                                                                                                                                              |
| **The tab sits outside the block**, as a folder tab above the top edge        | Chosen over two in-corner alternatives that would have stayed inside `bounds` and cost nothing; this choice is why the cull margin had to become a constant (_Decoration outside `bounds` is a promise about the cull margin_). |
| **A tabbed block's body stays empty**                                         | The subtitle moves into the tooltip rather than being drawn in both places.                                                                                                                                                     |
| **The label offset is in CSS pixels**, not world units                        | Chosen against consistency with every other geometric property, and correctly (_The connection label offset is in screen pixels_).                                                                                              |
| **The marquee is its own tool**, not a gesture on the pointer                 | Both were offered; this one is why nothing about panning had to change.                                                                                                                                                         |
| **Paste centres under the pointer**                                           | Falling back to a cascading grid step when the pointer is elsewhere.                                                                                                                                                            |
| **A connection is copied only when both of its blocks are**                   | And is re-pointed at the copies.                                                                                                                                                                                                |
| **A copy fills the gaps in its own numbering**                                | `block0, block2, block4, block6` pastes as `block1, block3, block5, block7`. Asked for by example, and the example is now the assertion.                                                                                        |
| **No `Ctrl`/`Cmd`+click toggle**                                              | Asked for, then withdrawn: `Shift`+click already toggles, and a second modifier for one behaviour is a thing to explain rather than learn.                                                                                      |
| **Mac symbols only**                                                          | The first ask was platform-adaptive hints; on seeing the plan it became "just display the Mac shortcuts — that way we don't have to create and maintain extra logic for this detection."                                        |
| **Tools separated from shapes; numbered left to right**                       | The arrow tool became **Pointer** and the band tool **Select**.                                                                                                                                                                 |
| **Tool ids renamed too**, not just labels                                     | So `setTool('select')` means the tool the toolbar calls Select. The cost is the one rename a compiler cannot catch (_Defects, and what they teach_).                                                                            |
| **A readability floor of 8 CSS px** for inset text                            | Chosen from a table of what each floor would show at each block height; 6px keeps text alive further out, 8px is where it stops being worth reading.                                                                            |
| **"A few-pixel padding just to separate the text from the border"**           | After the first shrink ramp still looked over-padded. Three pixels, all four sides.                                                                                                                                             |
| **Text on tall blocks must not look stretched**                               | A second follow-up on the same text, on the opposite axis.                                                                                                                                                                      |
| **Shrink only, never grow** past full size                                    | 13px label, 10px subtitle are ceilings.                                                                                                                                                                                         |
| **Only the two blocks a connection joins** decide its arrowhead               | Not every block the head happens to pass over.                                                                                                                                                                                  |

## Load-bearing decisions

### New block properties, and why the file format did not move

`subtitle` and `labelMode` were added to a kind with saved scenes already in `localStorage`. Nothing
was needed to make those load, and the reason looks like luck but is not: `hydrateShape` skips a key
the record does not have, leaving the blank's value, and the blank says `labelMode: 'inset'`. A
scene saved before these keys existed loads with its label centred — exactly what it did before. The
default is the compatibility guarantee, not a convenience, and `verify/properties.mjs` asserts it by
deleting the keys from a real record and loading it back. It fails silently otherwise: a block with
no label mode still renders.

The canonical key order does move: editable keys sort alphabetically, so `labelMode` lands between
`label` and `name`. That reaches three consumers at once — panel rows, generated schema, saved file
— and broke the row-order assertion in `verify/production.mjs`, the one suite `npm run verify`
cannot vouch for. Nothing else, because a record is an unordered bag.

### Canvas tooltips: a seam, and a dwell that is the feature

Tooltip text is per-kind — a block's answer depends on its `labelMode`, a wire's heading is its
`name` — so it is an optional `ShapeOps.tooltip` returning `{ title, lines }`, and `ToolHost` never
learns what a `rect` is. An inset block does not repeat the subtitle already drawn on it; a tabbed
one shows the subtitle above the description.

The harder half is that hovering is a pointermove feature, in a file whose pointermove path was
already made allocation- and signal-free in iteration 3 (`host.pointer` is `$state.raw` compared on
the _snapped_ point, so 60 moves cost a handful of writes, not 60). A tooltip that hit-tested per
move would have put that straight back. So the move handler does no hit test and writes no signal:
it stores the point in a plain field and restarts a `setTimeout`, and the hit test runs once, when
the dwell (`HOVER_DELAY_MS`, 450ms) expires. This is not merely cheaper, it is the correct shape of
the feature — a hover tooltip is _by definition_ about a pointer that has stopped, so every hit test
in between would have been thrown away.

A tooltip already showing must go when the pointer really moves, and that _is_ a signal write. It is
gated on `HOVER_SLOP_PX` (4), because a tooltip that vanishes under a one-pixel tremor cannot be
read, and nobody holds perfectly still. Pressing dismisses it, and a drag never raises one.

`@svgrid/grid` ships an unused `createTooltip`/`SvTooltip`. Not used: it is built around a DOM
anchor with its own hover triggers, and the anchor here is a canvas region with a dwell clock we
own. A synthetic proxy element would have been more moving parts than the component saved.

### Chrome tooltips: why the native one could not stay

The report was that toolbar tooltips never appeared. What had been "checked" earlier was the `title`
attribute, read out of the DOM with `page.evaluate`. The attribute was right the whole time; the
attribute is not the feature.

The app was not at fault, and that was established rather than assumed: under a pointer resting on a
tool button the toolbar subtree took zero DOM mutations over 2.5s (with a positive control), the app
scheduled zero frames, the button was genuinely the hovered element with no overlay or containment
ancestor, and the accessibility tree resolved the description. The obvious suspect — the innermost
hovered node being a `<path>` inside the button's `<svg>` — is false, and falsifiable from
Chromium's source: `SVGElement::title()` returns a _null_ string without a `<title>` child, so the
ancestor walk continues to the `<button>`.

What happens is below Blink. On macOS Chromium does not draw the tooltip. It registers an
`NSToolTipRect` and **fakes an `NSEventTypeMouseEntered`** so AppKit's `NSToolTipManager` runs its
own dwell and draws it as an OS window. That fake enter is suppressed when the window under the
**real window-server cursor** is not the browser's (a guard against overlapping windows — any
always-on-top panel trips it), and the last string is cached, so once suppressed, re-hovering the
same button sends nothing until a different title is hovered in between. Dead tooltips, stickily,
while the rest of the browser has them.

That makes the native tooltip not merely untested but **untestable** here, through every channel:

- **Synthetic input cannot arm it.** `page.mouse.move` is `Input.dispatchMouseEvent`, which never
  moves the OS cursor, so the AppKit check sees wherever the user left it. A genuine `CGEventPost`
  needs an Accessibility grant this process does not have.
- **Nothing reports it.** No CDP domain carries tooltip text; the only seam is a C++ browser-test
  hook.
- **No screenshot contains it.** A page screenshot is a renderer compositor surface; an AppKit
  tooltip is an OS window.

So `title=` was a permanent exemption from the rule that every behaviour has an assertion in
`verify/`, and that exemption is what let the feature be reported working. An in-app tooltip is the
only version the project's conventions can hold. Every control the app draws now uses `tip()` on the
same 450ms dwell as the canvas; the `title` attributes belonging to `@svgrid/grid` and
`svelte-jsoneditor` are theirs and were left.

### The chrome tooltip layer sits outside every pane

The first instinct — render the tooltip beside the control — was measured and is wrong: a
`position: fixed` box appended to a tool button is **not** topmost at its own coordinates; the
identical box appended at the app root is. `.stage` in `CanvasSurface` is `contain: strict`, so a
stacking context, and it comes _after_ the toolbar; two stacking contexts at `z-index: auto` paint
in tree order, so the canvas covers anything the toolbar hangs below itself. Recovering inline means
picking a `z-index` that beats the dock's, the JSON editor's popup layer and whatever ships next.
One layer (`ChromeTooltip`, mounted in `App.svelte` because it outlives every pane) has no such
fight.

The layer still needs a z-index relative to the dock, and it is stated as a relation in `app.css`
(`--z-chrome-tip`, above `.sv-dockmgr__window` and `.sv-grid-tooltip`), not picked by feel;
`verify/docking.mjs` asserts the relation rather than the constant. `position: fixed` rather than
`absolute` for the reason `app.css` gives for `.jse-absolute-popup`: the panel host and the dock add
several `overflow: hidden` clip rects, and a fixed box's containing block is the viewport — verified
at every anchor site that no ancestor establishes one.

### `tip()`: an attachment, reading through a thunk

`{@attach tip(...)}` rather than a wrapper component: a wrapper would put a second box in a flex
row, and not every anchor is a button (two are status-bar `<span>`s). `pointerenter`/`pointerleave`,
never the bubbling `pointerover`/`pointerout`: every control wraps an `<svg>`, and the bubbling pair
reports a crossing each time the pointer passes between a button and its own icon, re-arming the
dwell so the tooltip never appears for a pointer that never left — an in-app reimplementation of the
bug.

A derived tooltip (`Undo: paste`) is passed as a thunk, and the layer does the reactive read at
render time. See _Defects, and what they teach_ for why a string is wrong.

Keyboard focus shows it at once, on `:focus-visible` only — a click focuses the button too, and
"show on focus" plus "dismiss on press" would flash a clicked button's tooltip straight back up. No
dwell on focus: a dwell models pointer indecision, and a Tab is deliberate. While visible, the
anchor gets `aria-describedby` at the layer — a description, not a name, because every icon button
already has an `aria-label` and what the tooltip adds is the key. Escape dismisses it without
swallowing the key the canvas uses to cancel gestures.

The anchor rect is read once, when the dwell expires. A resize, a (captured) scroll, a dock
rearrangement or window blur drops the tooltip rather than re-measuring it; chasing the anchor would
be a second layout dependency for a case that only arises while the user is doing something else.

### Shortcut hints: one Mac table, digits by position

`toolTipText(descriptor)` lives in `tools/registry.ts`, beside the lookup that answers to the key,
so the toolbar cannot advertise a key that does nothing, and "registering a tool is the only step"
stays true — a lookup table in `Toolbar.svelte` keyed by tool id would pass almost every assertion
and silently give the next tool nothing. Hints elsewhere go through `shortcutFor`/`pressTo` in the
same file.

**Mac notation only.** Detection would be two string tables of which the developer only ever sees
one rendered — a branch checkable only by assertion, about a table nobody reads, which is how the
`title` failure went uncaught. `keys.ts` is a map and a sort. What it buys is that every `Cmd+…`
literal became a call against one table, so the next one cannot come out as `Cmd`. The sort is
Apple's canonical modifier order (`^⌥⇧⌘`), so `keys('cmd', 'shift', 'z')` and
`keys('shift', 'cmd', 'z')` both give `⇧⌘Z` — `⌘⇧Z` is the kind of wrong that looks right until it
sits next to a system menu. `⌫`, not `⌦`: both keys delete the selection, but `⌫` is the one every
Mac keyboard has. Esc, Home and End stay words, since their glyphs are not printed on the keys and
read as puzzles.

**The digit is assigned, not declared.** Tools once declared `shortcut: '1'`. Renumbering those
literals is the obvious change and the wrong one: a declared order is a second place the order is
written down, and two places disagree — insert a tool, renumber the neighbours you are looking at,
and the toolbar reads 1, 2, 4, 3. So a `ToolDeclaration` carries `group` (`tool` | `shape`) and
`order`, and `allTools()` sorts and fills `shortcut` from position; the keys count across the
toolbar by construction, and past the ninth a tool simply gets none (a bare label). `group` rather
than import order in `register.ts`, because which side of the rule a tool sits on is a fact about
the tool, not about a file its author is not editing. The result is Pointer(1) Select(2) |
Rectangle(3) Connection(4) Queue(5) Fabric(6).

### The trace cursor is one flag

The old cursor drew a triangle on the timescale baseline and, separately, a rounded readout floating
beside it: two shapes the eye has to associate, in a panel that already had an idiom for "a thing at
an exact tick, labelled" — the event flag. The cursor is now that, its stem starting at the top of
the body; a flag on a pole is one object. It flips left at the right edge and stays on screen.

The body is now a forty-pixel affordance that looks draggable, so it is: `cursorFlagBox` in
`timeline/layout.ts` makes the box that responds the box that was painted — the `visibleFlags` rule
applied to the one piece of timeline geometry that had not needed it. That exposed something the old
±6px grab zone had hidden: the drag set the tick from the raw pointer x, so grabbing anywhere but
the stem snapped the cursor to the pointer. Invisible at 6px, a visible jump at the end of a 40px
body. The drag now carries a `grabDx` fixed at press. **A wider grab target turned a rounding error
into a bug**; it revealed it rather than caused it.

### The connection label offset is in screen pixels

Every other geometric property is world units and integers. The label is drawn at a fixed 11px at
every zoom, so a nudge in world units would be 10px of clearance at z=1 and 30px at z=3 — the label
drifting away from its wire exactly as you zoom in to look. The property is screen-sized because the
thing it moves is; its `doc` says so, since the footer is where a user would otherwise discover it
by experiment.

The axes come from the run, not the screen: `par` follows the run in stored point order and `perp`
is that turned 90° clockwise, so one offset means the same on a horizontal and a vertical wire. The
check in `verify/connections.mjs` asserts both axes on a _vertical_ run, because on a horizontal one
`par`/`perp` degenerate into x/y and three of four wrong rotations still pass. The cost, which will
surprise someone: re-routing an `auto` connection can hand the label to a different run, and the
offset then applies there.

### An enum dropdown, and the trap in adding one

Three display modes typed by hand, spelled exactly, are not three modes anyone will find.
`svelte-jsoneditor` ships `renderJSONSchemaEnum`, unwired; it reads the enum from the schema
`jsonSchemaFor` already generates, so the options _are_ the declaration. It reads `classSpec`, the
plain non-reactive copy, not `shownSpec` — it runs inside the editor's synchronous render, which is
iteration 4's reactive-read-in-render trap verbatim. And it is restricted to `edit` properties: a
dropdown on `kind` would look like a choice and be refused by `applyDocument` whichever way it
moved, a worse lie than the greyed text row it would replace. `jsonSchemaFor` is memoized per kind
behind `schemaFor`, since the renderer asks once per value node per render. A dropdown cannot be
driven by the harness's `editValue`, so `selectValue` and `enumOptions` are separate helpers,
deliberately — one that sniffed the DOM would pass as happily against a dropdown silently reverted
to a text box.

### Five dots between majors

`MAJOR_EVERY` counts minor _steps_, so five dots between majors is 6. The LOD ladder is written in
terms of the constant and needed no change. What moved is not visible in the diff: boundaries sit at
`MIN_DOT_PX / (GRID · MAJOR_EVERY^k)`, and at 6 the second moves to 8/96 ≈ 0.083 — **below
`ZOOM_MIN` (0.1), so unreachable**. z = 0.5 is the only level change a user can provoke.
`verify/grid.mjs` had probed a z = 0.1 cliff that no longer exists; it is now a sweep asserting no
step anywhere between `ZOOM_MIN` and 0.5, the stronger claim, which breaks if `ZOOM_MIN` is lowered
or the ratio reduced. The peak grid cost is set by `MIN_DOT_PX`, not this ratio, so the iteration-3
performance work stands.

### Decoration outside `bounds` is a promise about the cull margin

The tab is drawn above the block's top edge, outside `bounds`. `bounds` is world geometry and the
tab is screen-sized, so folding it in would make the box depend on zoom and churn the world box and
camera clamp on every wheel notch. Screen-sized decoration is instead covered by the renderer's cull
margin, as the arrowhead and label plate already were. That margin was an inline `16` with three
comments in three files asserting it was big enough, and this iteration added decorations that crowd
or exceed it — a 15px tab, a label offset bounded at 64px. Three prose claims about a literal is how
the fourth gets it wrong, so it is `CULL_MARGIN_PX` (now 96), and `labelOffset`'s range
(`CONN_LABEL_OFFSET_MAX`) is checked against it in the writer, not only the schema — ajv is advisory
in this editor.

The same reasoning keeps the tab out of `intersects` (_A bounding box is the wrong shape for a
wire_): that signature has no `worldPerPx`, so including a screen-sized tab would make a band's
answer depend on the zoom it was drawn at. The residue, stated rather than fixed: `zoomToFit` pads
by 64 _world_ units, which at very low zoom is fewer CSS pixels than the tab is tall — but at that
zoom the tab is below its size gate and not drawn.

The tab is drawn in CSS space rather than device space, purely so `tabRect`'s measurement and
`fillText`'s output come from one font string; `tabRect` carries its CSS-pixel text budget alongside
the world rectangle (see _Defects, and what they teach_ for why it must be carried, not re-derived).

### The marquee is a separate tool

Dragging empty space pans — the primary pan gesture, relied on by every suite. A marquee wants the
same gesture and there is no way to give it to both. A separate tool makes the question disappear
rather than be decided: the pointer keeps every gesture it had, and Select owns press-drag-release
unconditionally, with no hit test on the way down, because a region tool treats a press on a block
like a press on empty space. `Shift`+drag unions with the prior selection, a press that never
travels past `DRAG_SLOP_PX` is a click, and the drawn band and its hit box come from one `#rect()`.

Two departures from house style, both deliberate. **The band is built from `p.world`, not
`p.snapped`**: every other gesture snaps because it commits geometry; a selection region commits
none, and snapping would make the band jump a cell at low zoom while the shapes stay put.
**Releasing commits nothing**: selection is not history anywhere in the app. `isGesturing()` is
still true while banding, so undo, redo and delete are refused mid-band, and `Escape` restores the
selection the press found.

### A bounding box is the wrong shape for a wire

The obvious `shapesInRect` tests each shape's `bounds`: exact for a block, badly wrong for a
connection, whose bounds enclose the whole route — an L-shaped wire's box is mostly empty, and a
band in the empty corner would take a wire it visibly never crossed. So `intersects` is an optional
`ShapeOps` seam with a `bounds` fallback, and `conn` tests the band against each run with
`segmentIntersectsRect` (Liang–Barsky slab clipping in `geom/math.ts`: no special case for a segment
wholly inside, and it degenerates correctly to point-in-rect when the endpoints coincide).

**Overlap, not containment.** The request said "within", and this is the one place it is not taken
literally: a band that had to _enclose_ a wire would have to enclose its bounding box, which for the
L case is most of the diagram, and intersect is what every comparable editor does. One line in
`shapesInRect` if that judgement is ever wrong.

### The clipboard is the file format, and paste is "load, then rename"

The clipboard holds a `SceneDoc` — no second format. `copyFragment` keeps the selected shapes and
runs `pruneOrphans`: a connection whose block was not selected is absent from the sub-array and so
_is_ an orphan, and the user's rule falls out of an existing function that settles cascades and
stays kind-agnostic. The kept shapes are serialized in their z-order; the loader is two-pass, so a
wire may precede its blocks and a copy keeps its stacking. Copy mirrors the JSON to the system
clipboard best-effort; paste reads the in-memory slot, which is the source of truth because
`navigator.clipboard.readText()` is async and focus-gated.

Paste reads the doc back through `readDocument` **under the fragment's original names** and renames
afterwards through `renameRef`. Rewriting the stored endpoints first would have needed a per-kind
declaration of which serialized keys hold names — a second reference seam, free to drift from
`renameRef`. Loading first works because the loader's `PropContext` holds only the records already
in the fragment, so a connection naming its own fragment's block finds it even when that name is
also taken in the live scene. Paste is then literally "load, then N renames", which is what
`SceneStore.replaceShape` does for one. **Do not seed the loader's `taken` set with live names** to
"fix" paste: blocks would load renamed while the wires still named the old ones, `checkEndpoint`
would fail, and every pasted wire would vanish through three silent layers (`normalize`,
`hydrateShape` skipping a failed write, `pruneOrphans`).

### A copy is named for the series it came from

`uniqueName` could not do it: its suffix pattern is `/^(.*?)_(\d+)$/`, so `block0` does not parse as
`block` + `0` and a copy would have been `block0_2`. `nextFreeIndexedName` in `scene/names.ts` is a
second function rather than a smarter first: `uniqueName` repairs a duplicate _inside_ one document;
this one names a copy.

The rule is **the lowest free number at or above the copied one**. The discarded alternative, "the
lowest free number for that prefix", reproduces the user's example just as well and then fails on a
real scene: with `block0` and `block999` present, a copy of `block999` becomes `block1` — free,
lowest, and a different block to anyone reading the diagram. Membership is tested on the formatted
_string_, so padding stays cosmetic (`block007` copies to `block008`, and `block7`/`block07` cannot
collide). A digit run too long to be a safe integer falls back to `uniqueName`, because `n + 1` past
2^53 is `n` and the loop would never end; names come off disk, so that is reachable. As a bonus,
`block_2` parses as `block_` + `2`, so its copy is `block_4`, not `block_2_2`.

### Mint every name before applying any rename

The defect this feature existed not to ship, silent in every layer. Mint names against the live
scene only, and copy `block0` and `block1` into a scene where only `block0` is present. `block0`
collides and mints `block1` — free in the _scene_, and the name of the other, still-unrenamed shape
in the fragment. Apply the map through `renameRef` one entry at a time: `block0 → block1` rewrites
the wire's `from`; `block1 → block2` then matches **both** ends. The result is `from === to`.
`pruneOrphans` cannot help (that block exists), the router happily routes a self-connection, and the
scene holds a shape `normalize` says cannot exist, with nothing thrown.

The fix is in the minting: reserve `live ∪ every original name in the fragment` first, and skip
minting for a shape whose name is not live. No minted name can equal an un-renamed original, so the
sweep is order-independent and `renameRef` is unchanged. Skipping free names is not an optimisation:
it is what makes paste into an unrelated document keep its names and cut-then-paste restore the
originals exactly. **The general rule:** a rename map applied one entry at a time is safe only if
its values are disjoint from its un-renamed keys; any future bulk rename needs the same reservation.

### One vector for the whole fragment

Paste centres the fragment's `unionBounds` under the pointer (`centringDelta`), and the **delta** is
snapped, never the shapes afterwards. Snapping per shape moves shapes by different amounts and
shears the fragment; the visible casualty is a `manual` route, whose `points` would leave its own
anchors so `patchStart`/`patchEnd` bend the end runs to compensate. With one integer delta, anchor
and `points[0]` both move by `d`, both patches hit their `samePoint` early-outs, and the pasted
route is congruent to its original. The fallback cascade (`cascadeDelta`) is keyed on the pointer
position: two pastes at two places each land where asked; only repeats at one unmoved pointer would
otherwise stack an invisible exact overlap. `host.pointer` is null off-canvas, before the first move
and after leave — all "no anchor", the fallback branch. Cut and delete share
`#deleteIds(ids, label)` and differ only in the undo label.

### Inset text: height is a budget, not a gate

Block text used to be all-or-nothing below 44 CSS px. It first shipped as a ramp,
`fit = min(1, min(w, h) / 44)` with the label at `13 · fit`, and the reply was that the padding was
excessive. It was: 44 is a reference square, so a 30px block got 8.9px type with 11.7px of nothing
above and below — 22% of the block inked, type small for no visible reason.

The rewrite (`insetType` in `scene/shapes/heading.ts`, a function of height alone) _spends_ the
height. A line of N px type paints a measured `INSET_INK_H · N` of ink, so the height less a margin
converts directly into a size:

```
availH   = h - 2 · INSET_MARGIN_PX            // 3px per side, all four sides, unscaled
label    = min(13, availH / INSET_INK_H)
room     = (availH - INSET_INK_H · 13 - INSET_LEAD_PX) / INSET_INK_H
subtitle = min(10, room)                      // dropped below the 8px floor (INSET_TEXT_MIN_PX)
```

`INSET_INK_H` is **measured, not assumed**. `textBaseline` is `'middle'`, centring the em box, which
has slack no glyph reaches, so budgeting against the font size reserves a third more than the text
uses. Ink about that origin measures 0.4248 above / 0.5059 below worst-case over printable ASCII;
`INSET_INK_ABOVE` = 0.43 and `INSET_INK_BELOW` = 0.52 are those plus a pixel of antialias spill.
`INSET_LEAD_PX` is derived, not chosen: what is left of `INSET_LINE_GAP_PX` once both lines' ink is
taken out, which keeps ordinary-zoom spacing exactly as it was. Size from `actualBoundingBox`, never
`fontBoundingBox`, which Chrome rounds to whole pixels (its ratio moves 5% across 8–16px). Round the
solved device size _down_: the budget fills the height exactly, so rounding up spends margin already
allocated.

What falls out, untuned: **full size arrives at 31 CSS px** (it used to need 44), and everything
from 31 up is byte-identical to before. **The subtitle still goes first**, now because it is paid
for out of `room` — what the label did not need — so a subtitle can never appear under no label
(13.6px buys a label, 28.9 the pair). **The margin is a minimum, not a target**: above ~18.35px the
label is pinned at its ceiling and leftover height is centring space, so fill is not monotone in
height — it peaks near 80% around 30px and dips to 43% just below the subtitle threshold. That is
the price of "shrink only", not removable without letting type grow. Blocks between 35 and 58 px
tall, below the old subtitle gate, now show a subtitle they never had; intended, in the spirit of
the request.

`LABEL_MIN_PX` had been doing two jobs, the block gate and the shortest connection run worth a
label; it is now `CONN_LABEL_MIN_RUN_PX`, its one remaining meaning. `INSET_PAD_X_PX`,
`INSET_FULL_PX` and `SUBTITLE_MIN_PX` are gone. A gate expressed in the units a ramp scales is not a
gate: the old subtitle rule, `h ≥ 58 · fit` with `fit ∝ h`, reduced to `44 ≥ 58`, false at every
size, which is why it was replaced rather than scaled.

### Inset text: width is measured, never condensed

The second report was that text on tall narrow blocks looked **vertically stretched** when zoomed
out. It was squeezed on the other axis. `fillText(text, x, y, maxWidth)` does not truncate and does
not scale uniformly — it **condenses**, compressing the glyph run horizontally and leaving the em
height alone (81% of natural width on a 70×260 `MEMORY` block at z=0.75, 65% at 0.50). The
`min(w, h)` in the old ramp was a poor proxy for "does it fit": it shrank the type of every tall
block whether or not the label overflowed, and let it condense anyway. So width left the ramp
entirely, and **`fillText`'s `maxWidth` is never the answer**: no inset `fillText` is passed one,
and that is the whole correctness argument.

`fitFontPx` (`canvas/text.ts`) binary-searches for the largest whole _device_-pixel size in
`[floor, ceiling]` whose string measures within the budget; `fitInsetLine` wraps it and falls back
to `fitText`'s ellipsis only once shrinking has bottomed out at the floor. Four things are easy to
get wrong:

- **Shrink before cut.** These are short hardware identifiers: `XBN_ARB` and `XBN_MUX` both truncate
  to `XBN_…`, `XU0` and `XU1` to `X…`. A 9px whole word carries strictly more than a 13px stub. A
  line that cuts down to a bare ellipsis is dropped.
- **Never extrapolate a size.** Width is not linear in font size — advances are grid-fitted at small
  sizes, up to 10.6% more per pixel at the bottom of the range — and the error runs the wrong way,
  so a closed-form size overflows. The straight-line guess only places the search's first split;
  every size returned was measured at that size.
- **Feed the fit the _unaligned_ box.** The outline is snapped to device pixels and jitters by one
  as a block pans; a budget that inherited the jitter would step the type, or gain a letter, while
  the user merely dragged.
- **Clamp the subtitle at both ends.** With width shrinking the label independently, a short
  subtitle under a long label can come out larger than it and invert the hierarchy; clamping to the
  label's size alone drops it off blocks with room. It is
  `max(floor, min(ownBudget, label · 10/13))`.

The trade, stated plainly: type size now depends on string length, so a rank of identical boxes can
show several sizes, and zooming steps through about ten one-pixel sizes an octave where the old code
froze at 13px and smeared. Widening a block never shrinks its type (it would flicker under the
pointer). At the time this cost ~2.8 `measureText` calls per block and was deliberately uncached;
iteration 6 put these probes behind the shared text width cache (`cachedTextWidth`) once Safari
showed them costing per shape count.

### `DrawContext.boundsOf`, and nothing wider

`ShapeOps.draw` cannot see another shape, by design — the purity contract is what makes undo a swap
of array references. But "would this arrowhead land inside a block I join, at this zoom?" cannot be
answered from the connection alone, nor precomputed: `reroute` runs on commit, so a pinch-zoom would
never refresh it, and forcing a commit would push undo entries. `boundsOf(name): Rect | null` is
**the one thing a draw may learn about the rest of the scene**. A `shapeByName` would hand `conn.ts`
a shape to read fields off and a `draw` to re-enter, and purity would stop being enforceable by
construction. The renderer backs it with a `Map` built on first ask and discarded with the frame —
lazy because a frame with no connection in view never asks, per-frame because a longer-lived cache
would index shapes that had moved. It indexes _every_ shape, not just the culled-in ones: a wire can
be on screen while its block is not, which is exactly when its head is deciding. Null is normal —
the connect tool's ghost is bound to nothing at its loose end. When the temptation comes to widen it
(culling a label against a neighbour is the likely next caller), this is the argument against.

### The arrowhead is dropped when it would sit on a block

The head is a constant 9 CSS px while blocks shrink with zoom, so two blocks a short gap apart,
zoomed out, put the wedge inside the source block — a blob that says less than nothing. The rule is
to draw the bare line and drop the head, and only the two blocks the connection joins are consulted.
The line is always still drawn, and zooming back in brings the head back (nothing is cached across
frames).

As first built here, the test was the head's axis-aligned box, discounted along the arrow's axis by
a 1.5px tip tolerance: the tip sits exactly on the target's outline and `alignStroke` rounds it, so
a plain inclusive intersect would drop every head in the scene. Deflating the _block_ instead was
rejected, and that reasoning survives: zoomed out far enough a block is two or three device pixels
across, precisely the case this catches, and a deflated block has no area left. Iteration 6 refined
the rule once straight diagonal links were the norm — a box cannot rotate, so a glancing arrival
reported an overlap and every bus link lost its head. `headIsClear` now tests only the head's **base
point** (see iteration 6): the base never lands on an outline by construction, so it needs no
tolerance at all, and the box and tolerance are gone.

## Defects, and what they teach

**`bind:this` nulls, it does not undefine.** `CanvasTooltip` measured its box in an `$effect`
guarded by `el === undefined`. Svelte sets a torn-down `bind:this` to `null`, which for a tooltip is
every hide, so every dismissal threw — and no assertion failed; the suite printed it in its
page-errors line and reported all passed. The type is `HTMLDivElement | null`. A green run does not
mean the page did not throw; read that line.

**Two mutations that were the feature working.** The no-signal-per-move assertion read 2 instead
of 0. Chasing it rather than loosening the bound found both were the _previous_ tooltip being
correctly torn down as the sweep began. The fix was to settle the pointer before installing the
counter and scope the observer to the diagram pane (over `document.body` it also caught the status
bar's readout), and the assertion is now an exact zero. The chrome-tooltip sweep repeated this:
arriving from the canvas nulls `host.pointer` and blanks the status bar, so the probe starts inside
the toolbar.

**"XBN" drew as "X…" at 116%, and the obvious fix was also wrong.** The tab's width was measured in
CSS pixels, stored in world units and projected back by `draw`; at zoom 1 the round trip is exact,
at 1.16 it loses the last bit, so a label that fit exactly was ellipsized. `Math.ceil` on the width
fixed the screenshot, and **the regression test passed against the unfixed code** — the symptom is a
coin toss and the sweep won it at every zoom tried. Asserting the _headroom_ instead showed `ceil`'s
worst-case slack was 0.08px, not 1px. The round trip is now out of the decision: `tabRect` carries
the CSS-pixel budget, and the check runs the real `fitText` over 56 label/zoom pairs. A test written
from the symptom of a floating-point bug can pass against the bug; revert the fix and watch it fail.

**A derived tooltip dismissed itself.** With `tip(\`Undo:
${label}\`)`the reactive read was in the markup, so every commit re-ran the attachment and its teardown dismissed the visible tooltip — which never came back, since`pointerenter`does not refire for a pointer that never left. Hover Undo, press`Cmd+Z`, and it vanished the moment its text became worth reading. `tip()`
takes a thunk and the layer reads it.

**A floated pane covered every toolbar tooltip.** The layer shipped at `z-index: 100`; the dock
window is 101. The design had argued against a z-index arms race and then lost one by inattention.
The answer was a stated relation with an assertion, not a bigger number.

**The toolbar had no coverage at all.** Every suite reached tools by digit key or `window.__host`,
so the button's `onclick` could have been deleted with the suite green, for the project's whole
life. Clicking a tool button is now asserted. Reading an attribute is not testing a feature.

**An assertion that could not fail.** The first cut check read `undoLabel` after the paste that
followed it and tested `typeof label === 'string'`, true of `'paste'`. Read a history label at the
moment it is written, and compare its value.

**Coordinates computed before `zoomToFit` are stale.** New groups failed because an earlier group
had left the camera elsewhere (`resetZoom` restores zoom, not pan), so groups open with `zoomToFit`.
Then band checks swept hard-coded canvas coordinates the blocks had been drawn at — before that
reset — and caught one of two targets. `bandOver(indices)` projects live shapes through the live
camera.

**"Too much padding" was undersized type; "vertically stretched" was horizontally condensed.**
Horizontal clearance was already 2.7px per side; reducing `INSET_PAD_X_PX` would have changed almost
nothing. And nothing in the code touched a glyph's vertical scale. Both reports were accurate about
what it looked like and misleading about what to change; measuring first is what aimed the fixes at
the right axis.

**Renaming a tool id is the one rename the compiler cannot catch.** `ToolId` admits any string, so
moving `'select'` onto a different tool left every `setTool('select')` type-checking while
activating the wrong one. Rename the old owner out of the way first, and grep for the literal.

**Pixel probes lie in predictable ways.** A probe counting `connStroke` pixels saw zero ink on a
wire the connect tool had left selected (amber, not grey); a band around a block caught grid dots;
overlapping scratch blocks caught a neighbour's label. And `⌫` at 13px looked like tofu in a
screenshot — measure the glyph's advance against U+FFFF's instead.

## How it was verified

Playwright suites against the dev server, each group opening with `zoomToFit`, with the
`page errors:` line read on every run (none printed); `npm run check`, `npm run build`,
`verify/production.mjs` against `vite preview`, and prettier. Screenshots at 100/70/50/35% zoom
caught what the suites did not. The realised text-to-outline margin was measured over block × zoom
samples (worst 3.50 CSS px against a 3px target, `Math.floor` on the device size erring the safe
way). New suites this iteration: `verify/selection.mjs` (with the harness's `marqueeSelect`) and
`verify/labels.mjs`. The iteration went from 261 to **381 assertions across eight dev suites**, plus
**16** in `verify/production.mjs`. The assertions most worth keeping: the pre-`labelMode` file still
loading, the exact-zero mutation sweep holding the canvas tooltip to a dwell, a minted name never
landing on an un-renamed fragment name, a pasted manual route congruent to its original, and a
fitted line never wider than its budget (1194 string × width samples).
