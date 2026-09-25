# Iteration 6 — Queues, network interfaces, fabrics, curved links and a diagram file

2026-09-23 to 2026-09-24. Complete.

Four component kinds after five iterations of two. The diagram could draw blocks and wires; it could
not draw the machine this repository is about — queues between units, AXI ports on a crossbar, and
the buses between those ports. Using the result then turned up a run of cases where the code
promised something it did not deliver, and the iteration closed with the first file I/O the editor
has had.

## Scope

Delivered:

- **`fifo`** — a queue, drawn as a run of cells. Horizontal or vertical, bounded or unbounded.
- **`nif`** — a network interface: a bus port seated inside its parent's border, with a `protocol`
  and a `modport`.
- **`fabric`** — a box carrying a row of interfaces on its top and bottom borders, each with an
  inward edge as well as an outward one. **`rect` gains interfaces** too, on all four borders.
- **A second path family for `conn`** — a centripetal Catmull-Rom curve, chosen automatically when
  both ends are interfaces, with waypoint editing.
- **Save and open a diagram**, from the toolbar and from `⌘S` / `⌘O`.
- **Multi-line subtitles**, which the property editor and the file format had always accepted and
  the canvas silently collapsed into one run.
- **A text width cache**, the half of the Safari slowdown that scales with shape count (iteration 3,
  _the Safari measurement_, covers the grid half). The dot grid's row strips became its only
  renderer once the user confirmed them in Safari.

Plus the ground-clearing the above walked into: the shared box/heading/property machinery extracted
out of `rect`, and a two-pass document loader.

Chronology:

- **6.0, components** — the FIFO, the interface, the fabric, curved links, and a compatibility check
  between joined interfaces.
- **6.1, refinements** — the queue's creation ghost, the interface as a port inside its parent with
  `out`/`in` anchors, one icon set from Lucide.
- **6.2, fold and defaults** — the fold settles, a gesture moves what it moves, links run straight
  unless that would run backwards, one-step queue cells and two-step interfaces.
- **6.3, files and fitting** — save/open, the compatibility check and `channel` withdrawn, the text
  width cache, multi-line subtitles, strips as the only grid renderer.

Not delivered, deliberately: obstacle avoidance for curves, and any meaning for `protocol` beyond a
label.

## Decisions that came from the user

| Question                         | Decision                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| How an interface is represented  | A first-class child shape, not data nested in its parent                                |
| The interface-type fields        | `protocol` and `modport` (an AXI3 `channel` key existed briefly and was removed)        |
| How a FIFO's cells are drawn     | One outline with dividers; `spacing` is the divider **pitch**                           |
| The FIFO drag                    | `cells` follows the drag, so the ghost is exactly the shape that gets committed         |
| A queue's pitch                  | One grid step, so the dividers land on the dots                                         |
| An interface's length            | Two grid steps, chosen for where the anchor lands rather than for the box               |
| The modport marker               | No tick; the **border colour** says master or slave, the inside holds the label         |
| The curve's interpolation        | Centripetal Catmull-Rom through waypoints                                               |
| How waypoints are edited         | A `+` badge inserts; click one and press Delete to remove; the status bar reports it    |
| When a link should bow           | Only when a straight line would leave one port backwards or reach the other from behind |
| The lagging wire                 | Fix the fold, and fix what a gesture moves; they are different defects                  |
| Headings on the new kinds        | The same three `labelMode`s a block has, shared rather than copied                      |
| Lucide delivery                  | `@lucide/svelte` (ISC, no transitive deps), deep-imported one module per icon           |
| Connection compatibility         | Withdrawn after user testing; two masters joined by a bus is simply a bus               |
| What a load does to the document | Replaces it, as **one undoable step** labelled `load`                                   |
| What a save is called            | **The name of the last file opened**, `diagram.json` before any                         |
| A subtitle too long for its box  | Draw the **largest prefix of lines that fits**, dropping from the bottom                |
| The grid renderer                | Strips, and only strips, once confirmed in real Safari                                  |

## Load-bearing decisions

### An interface is a shape, and that buys the whole editor

Selection, the property panel, a name a connection can bind to, cascade-deletion through
`dependsOn`, undo, the clipboard — none of it needed writing. The alternative, a list of tuples on
the parent, needed all of it: `PropValue` has no object case, so the data would have been a
`list[tuple[...]]`, and making one of those selectable and editable is a sub-object selection model
built from scratch. The cost was a handful of new optional seams on `ShapeOps` — the same way
iteration 4 added `anchorAt`, `corridors` and `rebind`: the contract grows where a real kind needs
it to.

**The reconcile runs in `commit`, not in `resolve.ts`.** `resolve.ts` is a pure function of the
shape array, and `SelectTool` calls `rerouteAll` directly against a mid-drag preview. Minting a name
is not pure. `expandChildren` (in `scene/expand.ts`, called from `SceneStore.commit`) keeps that
module pure, keeps the preview path mint-free, and makes "skipped during a drag, applied on commit"
a property of the commit path rather than something that happens to be true today.

**Children are re-seated immediately above their parent on every commit.** Both `hitTest` and
`anchorHitTest` walk the z-order top-down, so an interface below its parent is unclickable and a
wire aimed at it attaches to the fabric's body. Appending a new child is right once — then one
`bringToFront` on the parent buries every interface it owns. Re-seating makes their position a
consequence of ownership rather than of gesture history, and costs nothing when already right,
because the pass returns its input by reference.

**The count is authoritative, so an interface cannot be deleted on its own.** `nifOps.deletable`
returns false. Letting Delete remove one leaves the parent's count saying something the diagram does
not, and the reconcile would mint it again on the next commit anyway. You change the number on the
parent.

### An interface sits inside its parent

The whole box is in the parent's body, its outward edge coincident with the border line. A bus port
is part of the thing, the way a connector is part of a chip package; a box straddling the border
read as a pin glued to the outside. Two things follow:

- **The label has somewhere to go.** It is drawn inside, centred, and turned a quarter turn on `e`
  and `w` so it runs along the border.
- **"Inward" means something.** The far edge faces the parent's interior, which is where a
  crossbar's internal routing has to land. A fabric's ports take links on it; a block's do not.

`depth` is clamped to the parent, because an over-deep box has nowhere to go but through the far
border. The trade to accept: `hitTest` is `pointInRect` over the box, so a port eats a depth-deep
band of the parent's interior for body presses, and `childCovers` in `canvas/hit.ts` punches a
matching hole in the parent's edge-resize zone. That is right — the port is the thing you want to
grab there.

### An anchor id must not name something that can change

An interface's two anchors are `'out'` and `'in'`, named by edge rather than by compass point. An id
that does not name a side cannot go stale when the port is dragged to another border — the defect is
unrepresentable rather than handled. Everything unrecognised resolves to the outward edge: a legacy
compass id from an older file, an `in` on a port with no inward edge, plain nonsense. A wire that
cannot find its end would otherwise vanish. `anchorAt` and `resolveAnchor` are both built from one
`nifAnchors` in `nif-geom.ts`, so they cannot drift.

### A per-shape seam whose answer belongs to the parent is resolved in `reroute`

`interfaceInward` is asked of the PARENT, like `interfaceSides`, so a `nif` never switches on its
parent's kind (`plain-box.ts` supplies it for `fabric`). But `anchorAt` and `resolveAnchor` are pure
functions of one shape and cannot see the parent. So the answer is cached on the child as a
`computed` field, written by `reroute` — which has the parent — exactly as the box is. This is the
second field to take that route, after `pending`.

The tax: `inward` must join `reroute`'s unchanged-comparison. A field that participates in the
returned object but not in the guard makes every commit allocate, `commit` compares by identity, and
each one records an undo entry that undoes nothing.

### A FIFO's length is derived, never stored twice

`cells * spacing`, read through one function that `bounds`, `draw`, `hitTest`, the handles, the
anchors and `size`'s own `read` all go through. The alternative has the `cells` writer and the
`spacing` writer each recompute `w` — and a writer touching a sibling key is order-dependent, since
`applyDocument` writes in canonical key order and the alphabetically later key wins. Deriving means
there is no ordering to reason about. It follows that only the cross axis of a bounded queue can be
resized, so `handles` returns two knobs rather than eight: a knob on a derived axis is an affordance
that refuses to work, which is worse than no knob.

**Every writer of a derived field derives it the same way — including the one that runs during a
gesture.** The creation ghost originally hard-coded `cells: 4`, so the drag chose the orientation
and then had no further effect on the flow axis. `makeFifo` derives `cells` from the dragged extent:
`round`, so the nearest whole queue wins; floored at 1, because `cells: 0` is refused by the schema;
capped at `MAX_CELLS` (1024), the same ceiling the property writer holds. At a one-step pitch a
snapped drag cannot produce a fractional count, so the ghost matches the drag exactly.

`MAX_CELLS` is **in the schema as well as the writer**: the writer refuses the commit, but ajv is
what draws the live annotation, and a value large enough to hang the renderer has to be refused
before it is committed.

### A queue's pitch is one grid step, and its minimum gap is a ratio

`spacing` defaults to `GRID` (in `makeFifo` and in `blank()`, which is also the file-load default),
so dividers line up with the dots behind them. `MIN_GAP` could not stay a constant: it was `GRID`,
which was half a cell at the old two-step default and exactly one cell at the new one, and would
have turned a minimum-size unbounded queue into a uniform run of five — losing the 1-gap-3 shape
whose whole job is to say "and so on" without an ellipsis glyph. It is `minGap(spacing)` now, half
the pitch. **A constant that is secretly a ratio breaks when the thing it was a ratio of changes**;
nothing declared that `MIN_GAP` was half a cell.

### An interface's length is chosen for where its anchor lands

`NIF_LENGTH` is `GRID * 2` because a connection point is the centre of an edge and `offset` is
grid-snapped: the centre is on a dot exactly when half the length is a whole number of grid steps.
At 48 every anchor sat 8 units off every dot, and so did every wire leaving one — the actual
complaint, which the box's size only mediates. A precondition rather than a guarantee: it also needs
a grid-aligned parent and no clamp biting, and the prop docs say so.

### A saved geometric constant creates documents of two vintages

`length` is a saved `edit` property, so changing the default changes nothing about existing
documents — every one keeps its 48-unit ports. That is right, and it made a latent bug reachable:
packing passed the CONSTANT to `freeOffset`, which tested overlap with one length for both
intervals, so a new 32-unit port on an old fabric landed through a real neighbour by up to 16 units.
`occupied` is a list of `NifSpan`s (`{offset, length}`) and the overlap test reads both. Code that
packs, measures or compares shapes of a saved geometric property reads each one's own value.

**Growing the count must not stack a new port on an old one.** Raising the count leaves existing
interfaces alone — they may have been dragged — but the even spreads for four and for six do not
line up, so a new one taking its slot in the new spread can land on an old one. `freeOffset` tries
the spread position first and scans for a clear slot only if it is taken, which keeps a fresh row
spread and a grown row disjoint.

### The shared box machinery takes the body as a parameter

`shapes/box.ts` owns handles, resize, box anchors and the body; `shapes/heading.ts` the label;
`props/common.ts` the repeated properties. Each takes the body rectangle as a PARAMETER rather than
reading `x/y/w/h` off the shape, because a FIFO's drawn box is derived and its stored `w` is not the
answer. Geometry a kind shares between its ops and its props lives in `<kind>-geom.ts`
(`fifo-geom.ts`, `nif-geom.ts`) — see _Defects_ for why.

**A ghost draws its body, not its text.** `drawBoxBody` once gated both `inner` and the heading
behind `!flags.ghost`, which is the whole reason a queue's preview was a blank dashed rectangle: the
dividers are its entire visual identity. `inner` runs unconditionally now; the heading stays
suppressed. `nif` and `conn` already followed that rule.

### `path` is a separate field from `routing`

`routing` says who maintains the geometry; `path` (`'ortho' | 'curve'`) says what the geometry is.
Folding them into one four-valued enum would encode a 2×2 product as a flat list.

**The connect tool asks both ends, via a seam.** `preferredPathOf` asks each shape's
`preferredPath`, and `'curve'` is taken only when both agree. That makes "a plain arrow may still be
drawn to an interface" true by construction, and the tool never learns what a `nif` is. The family
is chosen at the first click and the ghost draws in it while the far end is loose — asking every
frame is more correct and reads worse, because there is no second shape until the cursor lands on
one, and a preview that changes shape under the cursor reads as a bug.

### The curve

**Phantom endpoints duplicate rather than reflect**, which makes the end tangent parallel to the
last chord — exactly what `route.ts`'s `endDirection` assumes when it orients the arrowhead, so that
function is reused unchanged. A reflected phantom would tilt every arrowhead by an amount depending
on the waypoint before it. The centripetal conversion is 0/0 at a duplicated knot and is
special-cased: the control point goes a third of the way along the chord, which is what it is
supposed to mean. An epsilon only made the garbage finite.

**A curve's waypoints are explicit.** The user inserts them with the badge and removes them with
Delete; nothing else gets an opinion. `collapseCurve` dedupes coincident points, which the
parameterisation requires because it divides by chord length, and drops nothing else.

**A link runs straight unless a straight line would run backwards.** `autoWaypoints` returns no
waypoints when the chord leaves the front of one port and arrives at the front of the other — both
dot products against the anchor normals positive — and two on the outward normals when it would not.
That is the whole rule, replacing an earlier 15-degree alignment threshold that bowed the offset
facing pairs which are most of a real diagram. The case that wants a bow keeps it without being
named: two anchors sharing a normal — a loopback, two ports on one face of one parent, two on the
same face of different parents diagonally apart — make `arrives` exactly `-leaves`, so they can
never both be positive; two ports facing away bow on two negative terms. A `sameFaceLink` predicate
was the first draft and was rejected: it reads `side`, which is not the edge a wire attached to,
needs endpoint shapes at a call site that has only a name, and would teach a tool what a `nif` is.

**The bow is capped.** `reach` is a third of the separation, at least two and at most six grid
steps. Half the separation, uncapped, ballooned two rows of ports 380 units apart into a lens the
width of the gap.

### Waypoint editing reuses the handle system

**The insert badge is a `HandleRole`**, `'action'`, not a new affordance system. `hit.ts` returns
exactly `handle | body | empty`, and widening the role gets hit priority over the line, a
screen-constant grab radius, a cursor and a drawn knob for free. The badge is smaller and dimmer
than a waypoint knob and carries a cross, because two identical squares side by side on one line
said nothing about which one you drag.

**The sub-part cursor is derived, not maintained.** It dies for four unrelated reasons —
deselection, multi-selection, the shape being deleted, the index going stale — and re-checking the
conditions at the point of use covers all four without a hook per cause. The funnels that swap the
document with nothing to observe — undo, redo, and a file load — clear it explicitly. It lives on
the tool, not in `SceneStore`, because `selection` is part of the undo record and a cursor is not
document state. The seams are named generally (`subPartOf`, `subPart`, `removeSubPart`); a curve is
the only kind with sub-parts today.

### The fold reads back what it already folded, and settles

`rerouteAll` once built its `byId` map from the array it was handed, so a pass resolved exactly one
level of the graph. The real chain is two deep — `conn → nif → fabric` — so a wire on a port read
that port as it stood on entry, catching up only on the next commit; a block-to-block wire never
showed it. A port read from a file was the extreme case: an interface has no saved position, only a
side and an offset, so it carries `blank()`'s `0,0` until its own `reroute` runs, and its wire drew
itself to the world origin.

The fix is `byId.set(next.name, next)` beside `corridors.absorb(next)`. With children re-seated
above their parents on every commit, the whole chain resolves in one sweep. What ordering cannot
cover is a connection the user pushed BELOW its own ports with `sendToBack`, so the sweep repeats to
a fixed point, as `pruneOrphans` already does. This replaces iteration 4's position (iteration 4,
_The reroute fold_) that the fold is a single pass and must not be fed its own results — whose
objection was that a fixed point was asserted rather than argued. The argument is now written out in
`resolve.ts`: a `nif` depends only on a parent with no `reroute` and is final after one sweep; an
`auto` connection is a function of `(a, b, corridors)` and never reads its own points; a `manual`
one reads them, but `patchStart`/`patchEnd` return by reference once the ends match; corridors flow
bottom-up within a sweep and are discarded between sweeps.

- **A fresh `CorridorIndex` per sweep.** Reusing it keeps runs that no longer exist, and
  `BUNDLE_BONUS` is large enough to route onto a corridor that has gone.
- **The cap is derived, not picked** — `sweepCap`, the longest chain of `dependsOn` edges in the
  actual array, on the precedent of `BUNDLE_REACH`. A cycle is a programming error: it throws in DEV
  and degrades to one sweep in production.
- **The repeat sweep is skipped in the common case.** A sweep records the lowest index depending on
  each name and asks for another only when a shape changed ABOVE one of its dependents. Dragging two
  connected blocks changes only connections, and nothing depends on a connection — one sweep, at the
  old cost. This matters because `rerouteAll` runs on every `pointermove`.

`ShapeOps.reroute`'s contract is now idempotence, `reroute(reroute(s)) === reroute(s)`, not merely
identity when nothing changed. The invariant is stated no further than it holds: the result is a
fixed point, but not necessarily what one sweep against fully resolved dependencies would give,
because `patchStart`/`patchEnd` composed with `collapseRoute` is path-dependent — as it already was
across a preview and its commit.

### A gesture moves what it moves, not what is selected

`SelectTool` once translated exactly the selection, which is wrong at both ends. A connection whose
BOTH endpoints are moving was not moved, so a hand-drawn bus between two ports of one fabric
deformed as the fabric travelled (`reroute`'s manual branch splices the interior through and slides
only the ends — right for one end moving, wrong for both). And a port selected together with its own
parent moved twice — once by `translate`, once by `reroute` re-gluing it — so `Cmd+A` and a drag
slid every port along its border. `movesWith` in `resolve.ts` answers the right question:

```
follows   = children, transitively, of anything in the selection    -- moved by reroute
carried   = has dependencies, has no parent, and every dependency
            is in the selection or in `follows`                     -- moved bodily
result    = (selection \ follows) ∪ carried
```

A carried connection's ends arrive where its ports arrive, so the patch returns by reference. The
set is resolved once at pointer-down, so the drag frames and the commit agree. Two consequences
accepted and recorded: a fabric moved by typing into the property panel still leaves a hand-drawn
route behind, because only gestures are covered; and a rigid translation can split a bundle that
patching would have held, which beats patching a route whose ends both moved a thousand units.

The rejected alternative — rigid translation inside `conn.reroute` when both ends' deltas match — is
fatally ambiguous: dragging a manual connection by its own body gives both ends exactly the drag, so
the rule would read the user's gesture as a rigid move and silently undo it. Geometry cannot tell
"my endpoints moved" from "I was moved"; only the tool knows.

### The modport is a border colour, kept clear of selection

The modport is the port's border colour, and `nifMarkMaster` is violet, because
`shapeStrokeSelected` is amber and a selected slave must not look like an unselected master. A
semantic colour must not share a hue with selection. The port's box is an opaque fill: a theme fill
drawn over a shape rather than over the background must be opaque, or it looks almost right and
fails exactly where something is drawn behind it (`theme.shapeFill` is translucent, so a FIFO's
label plate is two fills, `background` then `shapeFill`).

### Icons are components

`ToolDeclaration.icon` is a `LucideIcon`, replacing hand-written path data that came in two
incompatible styles (some authored as stroke data but drawn under a fill rule, rendering as thin
slivers). There is one kind of icon, so the mismatch is unrepresentable.

### Connection compatibility checking was built and withdrawn

The first cut judged every link between two interfaces — protocol, AXI3 channel, master against
slave, outward against inward edge — and marked a violation with a red badge and a popup, through a
`diagnose` seam on `ShapeOps`. User testing decided against it: a diagram is a drawing of intent,
and two masters joined by a bus is simply a bus. It was deleted entirely rather than disabled —
seam, store diagnostics, render flag, badge, popup layer, theme constants, and the `channel`
property that existed mainly to feed it. `network.mjs` asserts the seam is absent, because a
deletion that leaves a seam behind is how the next change reintroduces half of it. Removing
`channel` needed no migration and no version bump: `hydrateShape` iterates the schema, not the
record, so an old file's key is ignored, and `SceneDoc.version` stays 2 because bumping it would
tell a v2-only reader to refuse a file it can read. The "insert badge" — the waypoint `+` handle —
is a different thing and stays.

### One document format, two transports

A saved file is `serializeScene`'s output, `JSON.stringify(doc, null, 2)` plus a trailing newline:
to the byte what `⌘C` puts on the system clipboard. That is what lets the file loader and the
clipboard share a read pipeline, and what will make a future `trace` key beside `shapes` additive
rather than a second format. It does NOT follow that a saved file pastes with `⌘V`: paste reads the
in-memory clipboard and never the system one, which is focus-gated and async. The formats agree; the
transports do not cross.

The work splits at the DOM. Nothing under `scene/`, `props/` or `geom/` touches it, which is what
lets `verify/` drive them as pure calls, so `scene/file.ts` holds the format, `parseSceneDoc` and
`saveFileName`, and `ui/file-transport.ts` the Blob, object URL and picker. `EditorSession` does the
load.

**`parseSceneDoc` draws the distinction `deserializeScene` cannot.** `deserializeScene` is lenient
and answers `[]` both to "not a diagram" and to "an empty diagram". Those need opposite handling:
loading an unreadable file as empty wipes what the user has open on account of a mis-click, so a
non-diagram is refused **without committing anything**. The test is `shapes` being an array and
nothing more — explicitly not `version`, because a reader of either vintage produces a valid
document from a file of either vintage.

**`readDocument` names the pipeline the clipboard already had.** Deserialize, `normalize`,
`pruneOrphans` — `deserializeScene` alone would keep a degenerate rect and a connection naming an
absent block. The clipboard's `readFragment` and the file load both call `readDocument`, which also
returns a `dropped` count, because a load that silently lost half a diagram is worse than one that
says so.

**The load goes through `scene.commit('load', …)`**, which buys more than undo: it clears the draft,
so a half-drawn rect cannot outlive its document; it runs the reconcile, so a fabric recording
`interfaces: 2` with no `nif` records gets them minted as part of the load; and it resolves
dependencies against the geometry the wires arrived with. `host.documentReplaced()` runs after it,
in that order, because the commit re-derives the world bounds `zoomToFit` reads. Loading as a fresh
document with history cleared was rejected: `⌘Z` back to what you had is worth more than a clean
undo stack, and it would have meant reaching past `commit`'s private bookkeeping.

**`⌘S` and `⌘O` are on `window`, in the capture phase**, in `App.svelte`. The diagram's key handler
is wrong for three reasons: it refuses keys unless the diagram pane owns the keyboard, so `⌘S` would
fall through to Safari's Save Page precisely when the property panel has focus; it refuses editable
targets; and `CanvasSurface`'s listeners die when the dock remounts the pane. A shortcut for the
document cannot be owned by one view of it. Capture was measured, not assumed: `svelte-jsoneditor`'s
editable cell calls `stopPropagation` on every keydown, so a bubble listener never fires with the
caret in the panel. `⇧⌘S` is left to the browser.

**Transport choices.** One reused `<input type="file">`, not one per open: Safari needs it in the
document for a programmatic `.click()`, and `cancel` is Safari 16.4+, so per-call elements leak a
node on every dismissal. The File System Access API was rejected because Safari implements neither
half. A timestamped save name was rejected because open `xbn.json`, edit, save, get `xbn.json` back
is what makes the file feel like the document; the accepted cost is `xbn (1).json` accumulating in
Downloads.

### Multi-line subtitles

**The budget generalises with the zero- and one-line answers bit-identical.**
`insetType(hCss, subtitleLines: number)` replaces a boolean, and every number the boolean produced
is a number the count produces, which makes the existing half of `verify/labels.mjs` the regression
net (a table of pre-change values is pinned in it). `n` lines cost `n` line-heights and `n` leads,
so the per-line room is `(availH - INSET_INK_H*LABEL_FONT_PX - n*INSET_LEAD_PX) / (n*INSET_INK_H)`,
the old `room` exactly at `n = 1`. The largest fitting prefix has a closed form, because that
expression decreases in `n`; a brute-force loop is asserted to agree at every height.

**The prefix rule is the product decision.** Under all-or-nothing, typing a second line would blank
a subtitle the block was already showing — a feature that deletes text the user can see. Lines drop
from the bottom, where the reader has the gist; the full text stays on hover and in the panel.
Capping at two lines was rejected: it ignores what the user typed, and the height budget already
bounds the cost.

**One shared size, chosen by the widest line** — one `fitFontPx` over a measurer that maxes across
the lines. Lines at different sizes read as ragged, and `n` searches would multiply the probe count
in exactly the zoom band the cache fixes. A line that cuts down to nothing but an ellipsis comes
back empty but **keeps its slot**, or the text below it would jump as the box zoomed past its width.

**`insetBaselines` uses `Math.trunc`, not `Math.round`.** The one-line code placed baselines at
`cy ∓ Math.floor(gap * dpr / 2)`, a symmetric floor of the magnitude; `trunc` of a signed offset is
the same floor, and `round` is off by one device pixel wherever `gap * dpr` is odd — every size a
shrunk label takes. Plate boundaries go at the midpoint of consecutive baselines rather than hugging
each line's ink, which would leave a sliver (on a FIFO, a stub of divider) between plates; at one
line that midpoint is `cy` exactly.

### The text width cache

The grid explains the zoom band of the Safari slowdown; it does not explain "more than twenty
shapes", because the grid's cost is independent of shape count. Labels are. `drawInsetLabel` reaches
`measureText` through `fitFontPx`'s binary search, whose one-probe fast path holds only while the
label fits at the ceiling — for typical blocks, until about `z = 0.48`, after which the fit falls
through to `fitText`'s own probes, and `insetType` switches the subtitle on in the same band. A box
went from about one measurement a frame to ten or sixteen, at integer sizes that change every frame
during a pinch.

`cachedTextWidth` in `canvas/text.ts` is a module-level `Map<fontShorthand, Map<string, number>>`.
Module-level because a text advance is a pure function of `(shorthand, string)` — the dpr is inside
the shorthand and the theme decides colour, not metrics — and because it must be reachable from
callers with no `DrawContext`: `tabRect` runs from `hitTest` through `HitContext.measure`. Measured:
24 two-line boxes at `z = 0.61` cost 26 `measureText` calls cold and **zero** on every repeat frame.
`flagMeasurer` in the timeline is deliberately not cached, its key space being unbounded.

- **`cachedTextWidth` assigns the font; `measureAt` does not.** Several subtitle lines are measured
  at one size, so the assignment hoists out of the loop; three lines cost the same four font sets as
  one. `cachedTextWidth` still assigns unconditionally, hit or miss, so promises like
  `fitInsetLine`'s "leaves `ctx.font` at the size it chose" survive.
- **The cap is global**, 4096 entries across the whole table, then dropped wholesale. Per-font is
  not a bound: one string at eleven sizes is eleven entries in eleven maps. An LRU would pay a touch
  on every hit to optimise a case that does not arise — the live key space is in the hundreds.
- **Three obvious clears are wrong** and the source says so: not per frame (not surviving between
  frames is the defect), not on a dpr change (the dpr is in the key), not on a theme change. The one
  that would be needed, on `document.fonts.ready`, does not apply: every font stack is system fonts.

## Defects, and what they teach

**A `<kind>.props.ts` must not import its `<kind>.ts`.** The kind file is what `register.ts`
imports, so the pair forms a cycle, and the props module consumes the values while still evaluating
its top-level array — temporal dead zone. The app died at load with
`Cannot access 'MIN_SPACING' before initialization`. Anything the two share lives in
`<kind>-geom.ts`.

**Every bus link lost its arrowhead because the head's axis-aligned box was tested.** `headIsClear`
asked whether the head's BOX overlapped either endpoint's block. An axis-aligned box is exact only
for an axis-aligned triangle: rotate the head and the corner behind a barb swings past the tip's
plane, so the box overlaps the very face the arrow points at. Rectilinear routes always arrived
square, so this never showed; straight bus links made a glancing arrival the ordinary case. What
makes a blob is the wedge sitting inside a block, so the test is now the head's base point — a
point, so nothing needs deflating and no tolerance is needed. Found only with pixels: the geometry
was right and the decision was wrong.

**A check can be weakened by a change it never mentions.** Lengthening interfaces to 48 made six of
them not fit a 336-unit face, so an interface-packing group was relaxed to five; when the length
became 32 the relaxation outlived its reason until someone noticed, and the group is back to six. A
check relaxed to accommodate a constant should name the constant. Its companion lesson: a check
asserting "a free slot is found" must stay clear of the case where there is none, or it asserts
something the code explicitly refuses to promise.

**A property writer must return `s` by reference when nothing changed.** `size`'s `read` on a
bounded queue goes through the derived box, so it can never return the width that was typed — which
means `applyDocument` calls the writer on every later commit, and an unconditional `{ ...s }`
produced three undo entries that restored a byte-identical scene. Any writer whose `read` cannot
reproduce what the user typed has this exposure; `reroute` has the same one.

**Resize folds a flip before anything takes an absolute value.** `resizeBox` encodes "dragged past
the far edge" as a negative extent that `normalizeRect` folds; the FIFO's flow extent took
`Math.abs` first, so the box stayed anchored at the dragged edge. And a minimum length applied about
the origin grew the edge the drag had pinned — the floor belongs in `resize`, the only place that
knows which handle moved, XOR'd against the flip.

**A selected parent's handles made its own children ungrabbable.** An interface sits where its
parent's edge grab zone runs, and a selected shape's handles beat any body under them, so pressing a
port resized the fabric. The rule that handles win exists to stop an unrelated shape stealing a
resize; a child is not unrelated, so a selected shape's handles yield where its own children lie.

**Inserting a waypoint deleted it in the same gesture.** `collapseCurve` dropped any waypoint on the
chord between its neighbours, by analogy with `collapseRoute` — and inserting into a straight curve
puts the new point exactly on the chord. Clicking the badge recorded an undo entry and nothing else.
An analogy between two families is not a reason to share a normalisation.

**A decoration nothing asserts on can be wrong for a whole iteration.** The modport tick's two
branches computed the same endpoints in opposite order, so master and slave differed only in colour
despite two comments saying it pointed out or in.

**A label plate wider than its box erased the outline, and missed the descenders.** Ink around a
`middle` baseline is asymmetric (0.43 above, 0.52 below), so a plate centred on the line misses a
`y`'s tail. `fitText` bounds width alone: anything drawn inside a box also needs a floor on the
box's projected depth, or it overflows when zoomed out.

**An extraction orphans a doc block.** `drawInsetLabel`'s rationale — including the rule that
`fillText`'s fourth argument condenses rather than truncates — ended up above a helper inserted
between comment and function; later a `theme.ts` comment sat twenty-five lines above its constant.
Moving code between a comment and its subject is invisible to every tool.

**The checks had their own defects.** `components.mjs` imported `scene/registry.ts` by URL inside
`page.evaluate`, which after an HMR update resolves to a second module instance with an empty
registry; uncaught, it killed the suite and every later one. A group drew at a hard-coded `y + 620`,
off the diagram and onto the trace panel. A group tested "on the border" against a box's midpoint,
passing for the wrong reason until the geometry changed. And after the grid's default flipped, every
`finally` in `grid.mjs` restored the old mode, so the suite would have stayed green testing a
renderer that no longer shipped.

**A bubble-phase `⌘S` never fired from the property panel.** Found by a check that dwelt on the hard
case rather than the easy one, then diagnosed with a four-phase probe.

**A per-map cache cap was not a cap.** The table reached 5052 entries against a stated bound of 4096
— one string at many sizes spreads across many inner maps.

**`CanvasTooltip` keyed `{#each}` on each line's text.** Latent until subtitles split on newlines;
`"AW\nAW"` is a duplicate-key crash. Keyed on the index, which is correct because the tooltip is
rebuilt per hover.

## How it was verified

Two new suites arrived with the components, `components.mjs` and `network.mjs`, and `file.mjs` with
save/open. Coverage is arithmetic where the thing is arithmetic — the spline's straightness, cusps
and end tangents, the bow rule through `window.__curve`, the subtitle budget's closed form against a
loop — and pixels where only pixels can see it: dividers lit in a held-open creation ghost, bright
ink inside a port and none past its outward edge, a probe just off an arrow's axis where only a barb
puts ink. The fold is asserted as `__resolve.rerouteAll(shapes) === shapes` by reference on a
committed scene, which is the fixed-point property, the no-spurious-undo property and a cycle
detector at once; a seeded document with a wire bound to a port proves the origin defect gone. File
coverage: save writes exactly what `__dump` projects, a load is one step labelled `load` and one
`⌘Z` restores the previous document byte-identically, a non-diagram leaves document and history
untouched, a fabric loaded without interfaces gets them minted by the load, and `⌘S` saves with the
caret in the property editor with the browser dialog suppressed. Checks were written to fail against
the commit before them; the few that could not say so. The Safari timing itself is not assertable —
rasterisation happens in Safari's GPU process after `draw()` returns — so the checks count
measurements and the milliseconds were confirmed by hand. Manual passes on a Retina display at fit,
100% and 200% covered port hairlines, rotated `e`/`w` labels, loopbacks, and icon weight.

The iteration ended at 612 assertions across eleven dev suites, plus 17 in `verify/production.mjs`
against the built bundle.
