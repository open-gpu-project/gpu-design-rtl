# Iteration 7 — Autogrouping and alignment

2026-09-25, revised 2026-09-26. In progress: 7.0, 7.1 and 7.2 are done. 7.1 has had two rounds of
changes from the user's hand passes; 7.2, alignment, has had none.

Iteration 7 is about grouping and aligning what is already on the canvas. Before any of that, 7.0
changes how the canvas is driven, because the work that follows lives on the selection. The
toolbar is split into zones, the Select tool is a Shift-hold away from any tool, and there is now a
tree of every object you can select from. 7.1 then makes the diagram nest: a block drawn around
other things contains them, and everything that acts on a block acts on what is inside it. 7.2
lines things up within that nesting: a shape being moved, resized or drawn snaps to its siblings.

## Scope

Delivered so far:

- **The toolbar in three zones.** Document (open, save, undo, redo) on the left. Tools in the
  centre: the tool clusters, then restacking and Delete. View (zoom) on the right. The centre zone
  sits on the bar's true centre whatever the two sides hold.
- **Holding `⇧` switches to the Select tool**, from any tool, for as long as it is held, with its
  crosshair cursor.
- **`⌘` (or Ctrl) is now the adding modifier**, for a click in either selection tool and for a band.
- **A click in the Select tool selects** what is under it, where it used to only clear.
- **An Objects panel**: a read-only tree of every object, under a root row for the diagram,
  topmost first, docked left of the canvas and above the trace. Wires that sit side by side in one
  list fold under a single row. Each row shows its kind's icon, then its label, then its name
  greyed out when the two differ.
- **`ViewController.revealRect`**, the diagram's counterpart to `TimelineView.revealTick`.
- **Autogrouping.** A parent/child hierarchy derived from where things are, never stored. A drag,
  a move typed into Properties, delete, cut and copy all take a block's group with it. Restacking
  works within a parent. Selecting something outlines every block it lies in. The Objects tree
  nests by the hierarchy, and Properties has a read-only `parent` row.
- **The band takes what it wholly covers**, not what it touches, which is what makes a band inside
  a group select the children rather than the group.
- **Alignment snapping.** A block, FIFO or fabric being moved, resized or drawn snaps to the
  placed shapes that share its parent: edges to edges and medians to medians, on both axes. The
  grid wins, so alignment only picks among positions the grid offers. A rose guide shows each
  alignment, one per coordinate however many shapes lie on it.

Chronology:

- **7.0, driving the canvas** — the toolbar zones, the Shift hold, ⌘ for adding, and the object
  tree.
- **7.1, autogrouping** — the derived hierarchy and everything that reads it, the containment
  band, and the tree nesting by the hierarchy. Planned alongside 7.0 and reconciled with it before
  it started.
- **7.1, after the first hand pass** — kind icons in the tree, the label leading the row, no rows
  for wires, and a fabric parenting the wires between its own interfaces.
- **7.1, after the second hand pass** — wires back in the tree, folded where two or more sit side
  by side, and the tree moved to the left of the canvas. Then brighter grid dots, set by one dial.
- **7.2, alignment** — the per-parent index, the magnet, the guides, and the draft drawn under the
  tool overlay. Planned with two questions to the user and a design review. The review took the
  snap distance from 6 px to 10 and added the refusal of a snap that changes the parent.

Not delivered, deliberately: reordering, renaming, type-ahead or ⇧-range selection in the tree. It
is read-only. Nor grouping by hand, or re-parenting by dragging a row: nesting is positional only.
Alignment has no modifier to suspend it, and no targets beyond siblings: a child is not snapped to
its parent's edges or centre lines, and not to the shape's own children.

## Decisions that came from the user

| Question                                | Decision                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| What goes in the middle of the toolbar  | Everything done on the canvas: the tools, the shapes, restacking and Delete              |
| What goes on the left                   | The document commands: open and save, undo and redo                                      |
| What holding Shift does                 | Switches to the Select tool, from any tool, until it is released; crosshair cursor       |
| What adds to the selection              | `⌘`/Ctrl, since Shift now means the hold                                                 |
| A click in the Select tool              | Selects the object under it; `⌘`-click toggles; empty space clears unless `⌘` is held    |
| The tree's order                        | Topmost first, as a layers panel reads, and children the same way                        |
| Clicking a row                          | Selects it, and pans (never zooms) to centre it, but only if it is not fully in view     |
| Where the tree goes                     | Above Properties in the right column; the dock key is bumped so layouts reset once       |
| One diagram or several                  | One today, under its own root row, built so a second is a new root rather than a rewrite |
| How a hierarchy is made                 | Positionally: a block around other things contains them; there is no manual grouping     |
| Z-order within a group                  | Children are re-seated above their parent on every commit                                |
| A wire's parent                         | The innermost block both of its ends lie in                                              |
| Deleting, cutting or copying a parent   | Takes everything under it                                                                |
| What a band selects                     | Only what lies wholly inside it                                                          |
| A parent moved from Properties          | Carries its children, as a drag does                                                     |
| What selecting shows                    | A faint outline on every block the selection lies in                                     |
| What the tree nests by (revisited)      | The full hierarchy, once the tree existed; the plan predated it                          |
| The Properties `parent` row (revisited) | Kept alongside the tree, read-only, on every kind                                        |
| What a tree row shows (hand pass)       | The kind's icon, then the label, then the name greyed out; the kind text stays           |
| Wires in the tree (hand pass)           | None at all. First asked for last in each list, then dropped outright                    |
| A wire between a fabric's own ports     | The fabric's child, wherever its route runs, although a fabric encloses nothing          |
| Wires in the tree (second pass)         | Back, in order; two or more side by side fold under one "wires" row, a lone one does not |
| Where the tree goes (second pass)       | Left of the canvas, above the trace; Properties stays right; the dock key is bumped      |
| The grid dots (second pass)             | Brighter; one dial in `grid.ts`, `GRID_DOT_BRIGHTNESS`, set to 2                         |
| What aligns                             | A block, FIFO or fabric, the source, being moved, resized or drawn                       |
| What it aligns with                     | The placed shapes with the same parent; not the parent itself                            |
| Which features meet                     | Edges with edges, medians with medians, on each axis                                     |
| Alignment against the grid              | The grid wins: only positions a grid-only gesture could reach are offered                |
| What shows an alignment                 | A line, one per coordinate, however many targets lie on it                               |

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

The second hand pass undid this. Objects, the canvas and Properties now share one row, so
Properties' 280 and the canvas's 360 floor their widths again, and the tree's is the dock's 200.
The canvas went from 0.72 of the width to 0.6: 833 CSS px in the checks' 1400 px window.

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

### The hierarchy is derived, and each role is read off an existing seam

`scene/hierarchy.ts` is a pure function of the shape array, memoised on the array's identity in a
`WeakMap`, and it is never written onto a shape. Undo, file load and paste therefore needed
nothing, and no field can disagree with the geometry. The renderer, the tree and the Properties
row all ask on every frame, preview frames included, for one build per array.

A shape's role comes from seams it already had, with no switch on `kind`. It is **owned** if its
kind implements `childOf`, and its parent is the owner it names when that owner is valid; an
interface with a missing or empty owner is a stray at the top level. It is a **link** if its kind
has no `childOf` and it has a non-empty `dependsOn`. A link between one shape's own parts -- two
of its interfaces, or the shape and one of them -- is that shape's. Any other link goes under the
first adopting shape common to both ends' inclusive ancestor chains. Anything else is **placed**,
under the smallest-area adopting shape whose bounds contain its own, edges included. `adopts` is
the one new seam: true on a block, false on a fabric, absent on a FIFO.

The own-parts rule came from the hand pass. A fabric adopts nothing, so the wires between its
ports -- its internal routing, which is the reason fabric ports take links on their inward edge --
went to whatever block lay around the fabric. That meant copying a fabric on its own dropped its
routing, and selecting one of those wires did not outline the fabric. Now they belong to it,
whatever their route. The rule needs at least one end to be an interface, so a shape wired to
itself, which only a hand-edited file can hold, does not become a parent. It never names a link.

Owned-by-kind, rather than owned-by-claim, also came out of that round. An interface depends on
its parent, and `childOf` reads an empty parent as none, so a stray interface with `parent: ""`
used to be taken for a wire. That was harmless while wires had rows, but once they did not, the
stray vanished from the tree. A kind with `childOf` is now never a link and never placed.

The memo has a price: an array handed to it must never be mutated afterwards. `deserializeScene`
fills its array in place while hydrating, so no property's `write` may call `hierarchyOf`. The
array it returns is finished and is fine, and every seeded check commits one.

### Ownership is one level deep, which makes the hierarchy total

A valid owner exists, is not the shape itself, and is not itself owned; any other claim puts the
shape at the top level. That is the rule `expandChildren` already enforced by never emitting a
child's child, so it changes nothing for a committed document. It exists for the input nothing
commits: `verify/objects.mjs` feeds the outline an ownership cycle, a dangling owner and a
self-owner on purpose, and the tree now reads `hierarchyOf`, whose DEV cycle assertion would
otherwise have fired on them. A shape with no geometry has NaN bounds, contains nothing and is
contained by nothing.

### Ties, and the one arrangement that cannot be a tree

Identical rectangles nest by z-order: the nearer lower one is the parent, so a stack of them is a
chain and whatever is inside goes to the deepest. Two of equal area that are not nested compare
by name, so the answer does not depend on z-order and the seat pass cannot change it. A shape
inside two rectangles that only partly overlap goes to the smaller one, and the larger does not
carry it. That is recorded as an open item rather than solved.

### Every commit seats the array by the hierarchy

`seatByHierarchy` runs between `expandChildren` and `resolveDependencies`. It emits a pre-order
forest: each shape, then its owned children (the interface-above-its-owner invariant that
`hitTest` and `rerouteAll`'s single sweep rely on), then the subtrees of what it groups. Sibling
lists keep their relative order, so it is the identity on any flat scene and on anything already
seated, and returns its input by reference then, as `commit`'s undo check requires.
`expandChildren`'s own re-seat is now that pass's owned-children case.

Restacking goes through the same emitter. `restackTree` applies the old transform to each
sibling list, so a child brought to front stays in its parent's block, a child sent to back stays
above its parent, and a parent carries its subtree. That also fixed an older bug: sending a block
backward past a fabric with ports was put back by the commit's re-seat, and still recorded an undo
entry.

### A move takes the group; an owner's interfaces still follow by reroute

`movesWith` is now: the selection and all its descendants move; what is owned by something moving
is left to its owner's reroute; and anything with no owner whose every dependency is moving is
carried bodily. A wire inside a group always has both ends inside it, so it always travels
rigidly. `SceneStore.replaceShape` asks the same question when an edit moves a shape without
resizing it, so a `position` typed into Properties carries the group too. That retired the old
caveat that a hand-drawn route between a fabric's ports deformed when the fabric was moved from
the panel.

### The band takes what it wholly covers

`shapesInRect` is `rectContains(band, bounds(s))`. In the pointer tool a press inside a group
lands on the block around it and drags the whole group, so the band is how you select inside
one, and a band that took whatever it touched would always take the group too. A connection's
bounds come from its drawn route, so containment means all of its ink. The `intersects` seam
existed only for the overlap rule, and it went with it, along with `segmentIntersectsRect`.

### The ancestor outline

`RenderFlags.ancestor`, set from `ancestorsOf(input.shapes, input.selection)`. That reads the
preview array while a gesture is in flight, so the outline drops off a parent live as a block is
dragged out of it. The precedence is ghost, then selected, then ancestor, then plain. A tabbed
ancestor's tab takes the same stroke, through a `StrokeRole` that `drawTab` takes instead of a
boolean. The colour is emerald, because amber, blue, sky and violet all already mean something
on this canvas.

### The tree nests by the hierarchy, and follows a selection that moves

`outlineOf` now builds from `hierarchyOf`, and `outline.ts`'s own `childOf`-only `ancestorsOf` is
gone. This supersedes 7.0's claim that a drag never re-parents. One that carries something across
a border does, and the row moves while the drag is still going. A drag inside a group crosses
nothing, so it still makes no DOM mutation in the pane, and a check counts that.

The canvas-to-tree effect used to act only on a Set it had not seen. Dragging an already-selected
block into a closed group keeps the same Set, so its row vanished into the closed parent. It now
also acts when the rows on the way down to the sole selection have changed. Collapsing and then
panning still reopens nothing, because that path has not changed. Since the second hand pass the
path is `pathTo`'s row keys rather than the hierarchy's ancestors, so it takes in the folded row a
wire sits in as well.

### Wires fold where they sit side by side, and every kind declares its icon

The first hand pass took wires out of the tree, because a diagram has a wire for every pair of
things that talk and listing them buried the blocks. The second brought them back, folded. In any
one parent's list, topmost first, a run of two or more links goes under a single `wires` row in the
place the run would have had, and a link with an object on either side of it stays a row of its
own. Nothing is re-sorted: the tree still reads in paint order. `outlineOf` does the folding, as a
second node type, `OutlineWires`, beside `OutlineObject`, so the markup never decides what is a
wire. Nothing is ever folded out of sight under a link, because nothing can have a link as its
parent.

A folded row is keyed `${diagram}/wires:${name}`, after the bottom-most wire of its run. A new wire
is appended, so it lands on top of its parent's list; the bottom one is usually the oldest, and
drawing more wires keeps the key, and with it whether the row is open. A check draws one onto an
open run and finds it still open, one longer. Deleting or restacking that bottom wire changes the
key and closes the row, which `open-items.md` records. Names may contain anything, so the key is
kept apart from an object's `${diagram}:${name}` by the diagram id, which contains neither `:` nor
`/`.

The folded row is a container, like the diagram's root row. A click opens or closes it anywhere on
the row, the arrows focus it without changing the selection, and it has no `aria-selected`. Clicking
it could have selected its whole run, but then moving through the tree with ↓ would select a
handful of wires at a time. `pathTo` gives the keys of every row that has to be open to show an
object, a folded one included; the canvas-to-tree effect opens exactly those. It replaced
`listedInOutline` and the effect's own ancestor walk.

`ShapeOps.icon` is required, so a new kind cannot arrive without one. The create and connect
tools read their icon from the kind they draw, so the tree and the toolbar cannot show different
glyphs. An interface, which has no tool, uses `ethernet-port`.

### The Properties `parent` row

A `computed` string on every kind but the interface, read from the hierarchy and empty at the top
level. Computed rows are skipped by `serializeShape` and by the select tool's fingerprint, so the
file format is unchanged. The interface keeps its own `fixed` `parent` row, since an interface is
owned rather than enclosed and its owner is saved.

### Alignment picks among grid positions, and nowhere else

The user chose between two answers when alignment and the grid disagree, and chose the grid. So a
snap may only land where the grid-only gesture could have landed. For a move that is a delta that
is a whole number of cells, because a move keeps a shape's offset from the grid. For a resize or a
create it is a pointer on a grid point. Centring a 32-wide block on a 48-wide one would need an
8-unit offset, and is never offered; centring it on a 96-wide one is. Nothing alignment makes is
geometry the grid could not have made, so it can never write a half-unit position into a file
whose `position` is an integer pair.

That makes the snap a choice among a handful of grid points, not a solve. `magnet` walks the grid
points within the tolerance of the raw gesture coordinate, nearest first, with the grid's own
answer first on a tie, and takes the first whose real geometry puts a moving feature exactly on a
target. The raw coordinate for a move is `p.world - drag.start`. `drag.start` is already a grid
point, so rounding that coordinate gives exactly the old `p.snapped - drag.start`, and nothing
changes where no target is in reach.

### When the snap moves a landing at all

Every candidate is a grid point, and every grid point but the nearest lies at least half a step (8
units) from the raw coordinate. Alignment therefore changes a landing only while `ALIGN_SNAP_PX`
in world units exceeds 8, which is below z = ALIGN_SNAP_PX / 8. At the 6 px first planned that was
z = 0.75: at 100 % the magnet would never have pulled, and there would only have been lines. At
10 px it is z = 1.25. At 100 % an aligned position catches the pointer 10 units out instead of 8,
so the pull is slight and the drag slop still cannot trigger a jump. At 50 % it catches it 20 units
out, and further out the pull grows until grid positions next to a target cannot be reached
without zooming in. Closer than z = 1.25 the guides are all it adds.

### One index per parent, keyed by one number

`scene/align.ts` builds it once per gesture, at press, in one pass over `hierarchyOf` of the
pre-drag array. For every parent, and for the top level under `null`, there are four maps:
x-edges, x-medians, y-edges and y-medians. Each is keyed by a single coordinate, so a lookup is
`map.get(v)`. Edges and medians are kept apart because each meets only its own kind: a block whose
left edge lands on its neighbour's median is not aligned.

Two targets on one coordinate share one entry, whose span is the union of their extents across the
axis. That merge is the de-duplication the user asked for. One guide per coordinate, drawn from
the entry's span and the source's own, reaches every shape on it.

Only placed shapes are entered, which `Hierarchy.isPlaced` answers from the role `build` already
assigns: not a wire, not an interface, not a stray, and no switch on `kind`. What the gesture
moves is left out entirely, as a target and as a candidate parent. Reading every other shape's
parent off the whole array is sound: nothing outside the moving set has its parent inside it,
since a shape whose parent moves is a descendant and moves too. A resize leaves out the shape's
descendants as well, so a block shrunk into its own child does not take that child for its
parent.

It is built rather than memoised. What it leaves out is per gesture, so no two gestures would
share an entry, and a memo would have brought back the rule that its array must never be mutated.

### Guides are read off real geometry

`alignSnap` checks every candidate against the source's real bounds at that point, through the
gesture's own `geometryAt`: a translate for a move, the kind's `resize` for a resize, the tool's
`make` for a create. The guides are then taken from the bounds at the answer it settles on, never
from the candidate. So a guide appears for exactly what lines up:

- plain grid snapping that happens to align, which is most of what the user sees at 100 %
- a FIFO whose cell count rounds, or an unbounded one held at its minimum length, only where its
  real edge lands
- nothing for a ⇧ corner resize, which is left to the grid, because the square constraint rewrites
  one axis from the other

A move's guides cover all three features of both axes. A resize's cover the axes its handle moves.
A create's appear once the draft is a shape `normalize` accepts, so the degenerate first pixels of
a drag, a line or a point, show none.

### A snap never changes the parent

The parent is the one the source has at the grid-only position, and the targets are its children.
A candidate that would put the source under a different parent is refused. Without that, a block
flush against its group's border could snap its left edge onto a sibling's right edge and leave the
group. Its guide would then point at a shape that was no longer its sibling. The check that drives
exactly that case fails with the refusal switched off, and nothing else does.

Each axis is found with the other held on the grid. When both snap, the pair is checked once more
together, and if it fails the single-axis snap nearer the pointer is kept.

### Which shape of a gesture aligns

For a move it is the pressed shape, or the outermost of its ancestors that is also moving, since
that group is what moves against its surroundings. The rest of the move set follows by the same
delta. For a resize it is the shape whose box handle is held: `resizeAxes` in `shapes/box.ts` now
reads the handle grammar for both `resizeBox` and the snap, and a handle it does not know aligns
nothing. A resize's moving edge is whichever edge is not the pin, so it stays right after a drag
flips past the far edge. For a create the anchor aligns its edges at the press, and the drag then
aligns the moving corner and the medians with the anchor held.

### The draft is drawn under the overlay

The renderer drew the tool overlay and then the draft. Only the create tool sets a draft, and until
now it had no overlay, so nothing depended on the order. With the guides in the overlay, the
ghost's dashed outline was drawn over the guide down the very edge being aligned, and broke it into
dashes. The draft now goes first. A check counts rose rows down the ghost's aligned edge: 49 of 49
with the new order, 25 of 49 with the old.

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
- **A band check had leaned on overlap (7.1).** The tree's live-band check swept a band after a pan
  had moved the camera by (60, 40), so its band only partly covered one of the blocks it expected.
  Under containment it failed. It now re-pins the camera first.
- **A seeded wire vanished (7.1).** The first `groups.mjs` seed loaded wires that named interfaces
  in the same document as their owners. Interfaces do not exist until a commit mints them, so the
  loader refused those ends and the wires were dropped. Seeding is now two commits, with the wires
  added on top of the first commit's dump.
- **A gate check only passed on a fresh load (7.1).** The connections check imported
  `conn.props.ts` by URL, and projecting its document now reaches `opsFor` through `parent`. On a
  fresh page load that resolves to the app's own module; after an HMR invalidation it would be a
  second, empty registry. It takes the schema from `__ops('conn')` now.
- **Two docking checks meant the canvas and said "first" (second hand pass).** The splitter drag
  took the page's first splitter and the maximize check its first Maximize button. With the tree
  now left of the canvas, both were the tree's. The drag widened the canvas instead of narrowing
  it, and the maximized tree left the canvas unmounted, so its health read nothing and the suite
  threw. The drag now goes right, and the Maximize button is looked up inside the canvas's leaf.
- **A guard asked for more canvas than its checks use (second hand pass).** `groups.mjs` required
  960 px, and the narrower canvas is 833. Its gestures reach x = 800; the scenes further right are
  only read through the hierarchy. The guard now asks for 816 and says why.
- **The status bar wrapped (second hand pass).** At 833 px the readouts broke onto two lines inside
  a bar of fixed height. A screenshot showed it, not a check. The bar is now one line: the hint
  shortens with an ellipsis and the readouts keep their width.
- **A planned tolerance that could not have done anything (7.2).** The first plan put the snap
  distance at 6 px. Review showed that with the grid winning, a snap only moves a landing when its
  reach exceeds half a cell. At 6 px that meant never at 100 %, so the magnet would have been
  invisible at the zoom the user works at. It is 10 px.
- **A check pressed half-way between two grid points (7.2).** The off-grid guard pressed an 80-wide
  block at its centre, x = 360, which is 22.5 cells. The move's start is the snapped press, so
  sub-pixel rounding of the pointer decided which cell it started from, and the block landed at 64
  where the check's comment said 80. The guard held either way, but its arithmetic did not. Every
  press in the suite is now on a grid point.

## Verification

`npm run verify` is 734 assertions across fourteen suites, and `production.mjs` is 17. After 7.0 it
was 633 across twelve, 685 at the end of 7.1 before the hand-pass changes, 692 after the first
round of them, and 701 across thirteen after the second. New in 7.0: the ⇧-hold group in `input.mjs`, the click-and-modifier group
in `selection.mjs`, the zone checks that replaced the old cluster slice, and `verify/objects.mjs`.
New in 7.1: `verify/groups.mjs` (42), the nesting group and two pure-model cases in `objects.mjs`,
the containment checks in `selection.mjs`, and `/parent` in `production.mjs`'s row order.

Against the 7.0 code, `groups.mjs` fails 31 of the 35 checks it reaches, then stops at the missing
`parent` row. The four that pass hold on either build: the canvas is big enough, a no-op commit
records nothing, and two undo round-trips. `objects.mjs` fails both new pure-model cases and stops
at the nesting group's first twisty, since `cluster` has no children to open. `selection.mjs` fails
both new containment checks. The canvas-to-tree chain rule was checked by switching it off:
exactly the check that drags a selected block into a closed group fails.

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

For 7.1 there was no hand pass. A dpr-2 screenshot of a nested scene with a child selected was
checked instead: the child is amber, both enclosing blocks and the outer block's tab are emerald,
and the tree shows the nesting. Nested ancestor tints stack, so an inner group reads slightly
greener than the one around it.

The user's first hand pass of 7.1 produced the round of changes above. It added seven checks,
five in `objects.mjs` and two in `groups.mjs`, and changed two. Of those nine, eight fail against
the code before the round: the icons, the text order, the unlabelled name, the model without
wires, the nested rows, a selected wire leaving its group closed, a fabric's own-ports wire, and
copying a fabric alone. The ninth is a guard and passes on both: a wire from a fabric's port to a
block beside it still goes to the block around both. The round itself was checked by one more
dpr-2 screenshot, of the tree and of a fabric wire's ancestor outline, and has had no hand pass.

The second hand pass's round changed or added fourteen checks in `objects.mjs`, for 58 there: the
layout, the folding and its keys and `pathTo` in the pure model, the wire back among the nested
rows, and a new folded-wires group. All fourteen fail against the code before the round. A
throwaway copy of the suite let the missing folded row's clicks time out quietly, so it ran through
to its report rather than stopping at the first one. Two changed docking checks also fail there,
because they are written for the new layout: the splitter drag and the storage key. `groups.mjs`'s
lowered guard passes on both. A dpr-2 screenshot showed the layout, a folded run opened onto a
selected wire, and the status bar on one line. This round has had no hand pass either.

The brighter grid added no checks. `verify/grid.mjs` reads both dot colours from the theme, so its
pixel-identity checks now compare against the new ones, and every suite still passes at 701. A
dpr-2 screenshot of two blocks on the grid at brightness 2 is the only look it has had.

7.2 added `verify/align.mjs`, 33 checks. Most of its gestures run at z = 0.5, and every one is
built so the grid alone lands 16 units from the alignment. One runs at z = 1 and two at z = 2,
either side of the z = 1.25 line. It was run three ways against a throwaway copy of the app:

- **Alignment switched off** (`alignSnap` returning the grid point and no guides, and no `__align`
  hook): 23 of the 32 it then had fail. That is every check of the index and the pure functions,
  and every landing, guide and no-undo check. The 9 that pass are guards that hold on both builds:
  - the canvas is big enough, and no page errors
  - the guide is gone after release, and one undo restores the shape
  - an off-grid centring is never taken
  - a child aligns with neither its parent nor a block outside its group
  - a snap across a group border is refused
  - a ⇧ corner resize stays square
  - at z = 2 the landing is the grid's
- **The parent refusal switched off:** exactly the border check fails.
- **The old draw order restored:** exactly the ghost-edge check fails.

The switched-off run predates the ghost-edge check, which was then run against the old order on
its own. The only look is a dpr-2 screenshot at z = 1 of a block dragged level with three
siblings: the grid alone would have left its top 16 above theirs, and the magnet takes it the
rest of the way. The screenshot shows three guides, one each for the shared top, median and
bottom, each running from the first sibling to the block. No hand pass yet, and no Safari.
