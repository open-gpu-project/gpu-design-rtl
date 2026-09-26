# Iteration 7 — Autogrouping and alignment

2026-09-25. In progress: 7.0 is done, and the autogrouping and alignment work it prepares for has
not started.

Iteration 7 is about grouping and aligning what is already on the canvas. Before any of that, 7.0
changes how the canvas is driven, because the work that follows lives on the selection. The
toolbar is split into zones, the Select tool is a Shift-hold away from any tool, and there is now a
tree of every object you can select from.

## Scope

Delivered so far:

- **The toolbar in three zones.** Document (open, save, undo, redo) on the left. Tools in the
  centre: the tool clusters, then restacking and Delete. View (zoom) on the right. The centre zone
  sits on the bar's true centre whatever the two sides hold.
- **Holding `⇧` switches to the Select tool**, from any tool, for as long as it is held, with its
  crosshair cursor.
- **`⌘` (or Ctrl) is now the adding modifier**, for a click in either selection tool and for a band.
- **A click in the Select tool selects** what is under it, where it used to only clear.
- **An Objects panel**: a read-only tree of every object under a root row for the diagram,
  topmost first, above Properties in the right column.
- **`ViewController.revealRect`**, the diagram's counterpart to `TimelineView.revealTick`.

Chronology:

- **7.0, driving the canvas** — the toolbar zones, the Shift hold, ⌘ for adding, and the object
  tree.

Not delivered, deliberately: reordering, renaming, type-ahead or ⇧-range selection in the tree. It
is read-only.

## Decisions that came from the user

| Question                               | Decision                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| What goes in the middle of the toolbar | Everything done on the canvas: the tools, the shapes, restacking and Delete              |
| What goes on the left                  | The document commands: open and save, undo and redo                                      |
| What holding Shift does                | Switches to the Select tool, from any tool, until it is released; crosshair cursor       |
| What adds to the selection             | `⌘`/Ctrl, since Shift now means the hold                                                 |
| A click in the Select tool             | Selects the object under it; `⌘`-click toggles; empty space clears unless `⌘` is held    |
| The tree's order                       | Topmost first, as a layers panel reads, and children the same way                        |
| Clicking a row                         | Selects it, and pans (never zooms) to centre it, but only if it is not fully in view     |
| Where the tree goes                    | Above Properties in the right column; the dock key is bumped so layouts reset once       |
| One diagram or several                 | One today, under its own root row, built so a second is a new root rather than a rewrite |

## Load-bearing decisions

### The hold is a state machine with one reconcile

Four fields on `ToolHost`. `#shiftHeld` is Shift as the last eligible event reported it.
`#heldFrom` is the tool the hold switched away from, and is non-null exactly while a hold is in
force. `#holdRefused` records that a tool was chosen explicitly while Shift was down.
`#hintBeforeHold` is the status-bar text to put back. `#reconcileHold` is the only thing that acts
on them: the hold should be in force iff `#shiftHeld && !#holdRefused`, and reconcile enters or
leaves it to make that true.

**Only two things may start a hold.** One is a bare Shift keydown, with ⌘, ⌃ and ⌥ all up, that
passes the three existing keyboard filters. The other is a canvas `pointerdown` carrying
`shiftKey`, which is synced on the first line of `onPointerDown` so the press is dispatched to the
right tool. The second is what makes a ⇧-press on the canvas band even while the trace panel or a
Properties caret owns the keyboard.

**Anything that shows Shift up clears it:** any keydown (checked before the filters), a keyup
(ungated, like Space), a pointermove, a pointerup, and a window blur. Any one alone has a hole: a
swallowed keyup, the other Shift key, a focus change mid-hold. Together they end a hold however it
was left behind.

**Reconcile never acts mid-gesture**, so a gesture always finishes as the tool it started in. It
runs again on every path that ends one: after every keydown, at the end of `onPointerUp`, in
`onPointerCancel`, and in `onWindowBlur` after the cancel. The consequences are all deliberate:

- ⇧ pressed during a move keeps it a move, and the hold takes over at mouse-up if ⇧ is still down.
- ⇧ pressed once a corner drag has started is still `resizeBox`'s square constraint. Pressed
  _before_ grabbing the corner, it starts a band instead.
- With a connection pending, ⇧ leaves it pending. Escape cancels it, and the hold engages then.

**`setTool` is an explicit choice, and the hold never goes through it.** The old `setTool` body is
now `#activate`. Public `setTool` clears `#heldFrom` and sets `#holdRefused = #shiftHeld` before
`#activate`'s same-id early return, so a tool picked during a hold (from the toolbar, a digit, or a
tool's own Escape-to-pointer) wins until Shift comes up. Picking Select itself during a hold keeps
Select after the release. `#activate` also fixed a cursor bug that predates all this: switching
tools while Space was held showed the new tool's cursor, not `grab`.

**The hint.** Entering saves the hint that was showing and writes the hold's own. Leaving restores
the saved one, but only if the hold's hint is still the one showing. A message written during the
hold, such as a file that failed to open, is news, and is kept.

### Why ⌘ took over adding

Shift could not keep both meanings. By the time a tool sees a ⇧-press, the hold has already made
it a press in the Select tool. Keeping Shift as the adding key inside the marquee would have made
every ⇧-band add and every ⇧-click toggle, so the hold could never replace a selection, which is
what a band is for. ⌘ and Ctrl are the pair `#globalKey` already reads as the command modifier.
`addsToSelection(mods)` in `tools/pointer.ts` is the one definition, read by the pointer tool, the
marquee and the tree.

### The tree shares the diagram's keyboard

`acceptsKeys` is true for the diagram and for the Objects panel. The tree is read-only, so there is
nothing of its own for `⌫`, `⌘Z`, the clipboard, `⌘A` or the arrange chords to act on. Pressed
while it is focused, they act on the diagram it shows. The tree's own keydown handler takes only
the arrows, Home and End, and only those call `preventDefault`, so Space, the digits, Escape and
every ⌘ chord reach the window listener untouched.

### The outline returns its previous rows by reference

`outlineRows(roots, open, prev)` hands back `prev` itself when every row matches it on every field
the markup reads: the rule `reroute` follows. A drag previews a new `shapes` array on every
pointermove but never renames, restacks or reparents, so the rows derivation settles on the same
array and the tree re-renders nothing. `verify/objects.mjs` counts it: zero DOM mutations in the
pane over a 20-step drag. The tree reads parents through `childOf`, so it never switches on
`kind`. A placed-set, plus a sweep for anything the walk from the top level missed, means a
malformed cycle can neither loop nor lose a shape.

### Canvas to tree waits for the gesture, and acts once per selection

The effect that opens a newly selected object's ancestors tracks `scene.selection` and
`host.gestureVersion`, and nothing else. It bails while `isGesturing()`, because the marquee writes
the selection on every move. It acts only on a Set it has not seen, remembered in a plain `let`.
Collapsing a parent, or a pan (which ends a gesture without selecting), therefore never re-opens
what the user just closed.

### Reveal pans only, and not at all for something already in view

`revealRect` does nothing when the rect is inside the viewport inset by `REVEAL_INSET_PX`, which
leaves the camera exactly where it was. Otherwise it recentres rather than nudging, for the reason
`revealTick` gives, and `clampCamera` has the last word. The inset is written in terms of
`TAB_H_PX`, because a label tab hangs above its block, outside the bounds `revealRect` is given.

### Scrolling stays inside the tree

Never `scrollIntoView`, and `focus()` always gets `{ preventScroll: true }`. Both would scroll the
dock's `overflow: hidden` wrappers, which have no scrollbar to scroll them back with. The tree
scrolls its own box by setting `scrollTop`. A check asserts that after `End`, every dock box and
panel host is still at `scrollTop` 0.

### A pane's `minSize` binds only on its direct parent split

The dock's `nodeMin` honours a leaf's `minSize` along its direct parent split only. Properties'
280 is now a floor on its height within the right column, not on the column's width, and the
column's width is held by nothing but the dock-wide floor of 200. Objects has no `minSize`, since
one would bind only against Properties.

### A gesture that ends from the keyboard says so

`gestureVersion` was bumped only by the pointer paths (`onPointerUp`, `onPointerCancel`, a blur).
A gesture can also end from a key, such as Escape on a pending connection or mid-band, or from a
tool switch that aborts it. Everything that defers on `isGesturing()` then waited for a signal that
never came. The tree made it reachable: select a row during a pending connection, press Escape, and
Properties stayed empty until the next drag. `#noteGestureEnd` compares `isGesturing()` either side
of `onKeyDown` and `setTool`, and bumps the counter when a gesture ended in between. ⌘A during a
pending connection had the same defect before the tree existed.

### The status bar's sub-part readout needs the sole selection

`subPartLabel` now returns null unless the sub-part's shape is the sole selection. The pointer tool
has always re-checked that for its own copy, but `host.subPart` is a mirror, and ⌘A, the marquee
and now the tree change the selection without going through the tool. All three left a stale
"waypoint 2 / 3" on screen.

## What went wrong on the way

- **A check in `properties.mjs` had been testing the wrong pane since the trace panel arrived.** It
  clicked the page's last `Float` button, which is Trace's, and then ran the context-menu check
  against a Properties pane that was still docked. It now clicks `Float Properties`, asserts that
  Properties is what floated, and resets the layout before the suite's final reload so the floated
  pane is not restored into a measurement.
- **A cleanup `undo()` could take out a check's own seed.** The ⇧-hold group undid its move
  unconditionally, and against code where the press missed the block there was no move to undo, so
  the undo removed the seed and every later step failed for that reason. It now undoes only a
  committed `move`, and each step re-pins the camera.
- **Properties never heard that a keyboard-ended gesture was over.** It was found by checking an
  open item written into the plan, "a tree selection made during a pending connection reaches
  Properties only when that gesture ends". When the gesture ended by Escape, the selection never
  reached Properties at all. The fix and its check are above; the check fails with the fix turned
  off.
- **A reveal moved the camera out from under a later step.** The mutation check dragged a block that
  an earlier tree click had panned off screen. The drag became a pan, and the pan's cleared
  selection was the mutation it counted.

## Verification

`npm run verify` is 633 assertions across twelve suites, and `production.mjs` is 17. New: the
⇧-hold group in `input.mjs`, the click-and-modifier group in `selection.mjs`, the zone checks that
replaced the old cluster slice, and `verify/objects.mjs`.

Run against the code before 7.0: 13 of the 21 new input checks fail, all eight new selection
checks fail, and `objects.mjs` stops at its first query because there is no Objects pane. The eight
input checks that pass there cannot fail without a hold to get wrong:

- Three are negative: ⇧ is ignored while the trace or a Properties caret owns the keyboard, and
  after ⌘.
- Three guard behaviour the hold must not interrupt, which the old code already had: a move stays a
  move, a pending connection stays pending, and ⇧ during a corner drag keeps it square.
- Two are the second half of a pair whose first half fails: letting go returns to the pointer
  tool, and a toolbar pick survives the release.

The manual pass was done in Edge at dpr 2: toolbar centring at four window widths, maximising and
floating Objects, and the Properties editor's height (251 px at the default layout, against a 200 px
floor). It was not done in real Safari.
