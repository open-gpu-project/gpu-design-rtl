# Iteration 6 — FIFOs, network interfaces, fabrics and curved links

2026-09-23. Complete. Five commits, `npm run verify` from 381 assertions across eight suites to
495 across ten, plus `verify/production.mjs`'s 16 against the built bundle.

Four component kinds after five iterations of two. The diagram could draw blocks and wires; it
could not draw the machine this repository is about — queues between units, AXI ports on a
crossbar, and the buses between those ports.

## 1. Scope

Delivered:

- **`fifo`** — a queue, drawn as a run of cells. Horizontal or vertical, bounded or unbounded.
- **`nif`** — a network interface: a bus port glued to a parent's border, with a protocol, an
  AXI3 channel and a modport.
- **`fabric`** — a box carrying a row of interfaces on its top and bottom borders.
- **`rect` gains interfaces** too, on all four.
- **A second path family for `conn`** — a centripetal Catmull-Rom curve, chosen automatically
  when both ends are interfaces, with waypoint editing.
- **Cross-shape validation** — a badge and a popup when two interfaces that were joined should
  not have been.

Plus two pieces of ground-clearing the above walked straight into: the shared box/heading/property
machinery extracted out of `rect`, and a two-pass document loader.

Not delivered, and deliberately: obstacle avoidance for curves (§7), and any meaning for
`protocol` beyond a label.

## 2. Decisions that came from the user

| Question                        | Decision                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| How an interface is represented | A first-class child shape, not data nested in its parent                             |
| The interface-type field        | Two keys: `protocol` and `channel`, not one fused enum                               |
| How a FIFO's cells are drawn    | One outline with dividers; `spacing` is the divider **pitch**                        |
| The curve's interpolation       | Centripetal Catmull-Rom through waypoints                                            |
| How waypoints are edited        | A `+` badge inserts; click one and press Delete to remove; the status bar reports it |
| Headings on the new kinds       | The same three `labelMode`s a block has, shared rather than copied                   |

## 3. Load-bearing decisions

### 3.1 An interface is a shape, and that buys the whole editor

Selection, the property panel, a name a connection can bind to, cascade-deletion through
`dependsOn`, undo, the clipboard — none of it needed writing. The alternative, a list of tuples
on the parent, needed all of it: `PropValue` has no object case, so the data would have been a
`list[tuple[...]]`, and making one of those selectable and editable is a sub-object selection
model built from scratch.

The cost is four new optional seams. That is the same way iteration 4 added `anchorAt`,
`corridors` and `rebind` — the contract grows where a real kind needs it to.

### 3.2 The reconcile runs in `commit`, not in `resolve.ts`

`resolve.ts` declares itself a pure function of the shape array, and `SelectTool` calls its
`rerouteAll` directly against a mid-drag preview. Minting a name is not pure. Putting
`expandChildren` in `SceneStore.commit` keeps that module pure, keeps the preview path
mint-free, and makes "skipped during a drag, applied on commit" a property of the commit path
rather than something that merely happens to be true today.

### 3.3 Children are re-seated above their parent on every commit

Both `hitTest` and `anchorHitTest` walk the z-order top-down, so an interface below its parent
is unclickable and a wire aimed at it attaches to the fabric's body instead. Appending a new
child puts it in the right place once — and then one `bringToFront` on the parent buries every
interface it owns. Re-seating makes their position a consequence of ownership rather than of
gesture history, and it costs nothing when it is already right, because the pass returns its
input by reference.

### 3.4 The count is authoritative, so an interface cannot be deleted on its own

`nifOps.deletable` returns false. The alternative — letting Delete remove one — leaves the
parent's count saying something the diagram does not, and the reconcile mints it again on the
next commit anyway. You change the number on the parent.

### 3.5 A FIFO's length is derived, never stored twice

`cells * spacing`, read through one function that `bounds`, `draw`, `hitTest`, the handles, the
anchors and `size`'s own `read` all go through. The obvious alternative has the `cells` writer
and the `spacing` writer each recompute `w` — and iteration 4.1's rule is that a writer touching
a sibling key becomes order-dependent, since `applyDocument` writes in canonical key order and
the alphabetically later key wins. Deriving means there is no ordering to reason about.

It follows that only the cross axis can be resized, so `handles` returns two knobs rather than
eight. A knob on a derived axis is an affordance that refuses to work, which is worse than no
knob: the user has to drag it to find out.

### 3.6 `path` is a separate field from `routing`

`routing` says who maintains the geometry. `path` says what the geometry is. Folding them into
one four-valued enum would encode a 2×2 product as a flat list — and `conn.props.ts` already
argues that distinction the other way round for `routing` itself.

### 3.7 The connect tool asks both ends, via a seam

`preferredPath` is asked of both shapes, and `'curve'` is taken only when they agree. That is
what makes "a plain arrow may still be drawn to an interface" true by construction rather than
by a rule written down somewhere. The tool never learns what a `nif` is.

The family is fixed at the FIRST click, though, and the ghost draws in it while the far end is
loose. Asking both ends every frame is more correct and reads worse: there is no second shape
to ask until the cursor lands on one, so the ghost would draw square and then snap to a curve.
A preview that changes shape under the cursor reads as a bug.

### 3.8 The phantom endpoints duplicate rather than reflect

Which makes the end tangent parallel to the last chord — exactly what `route.ts`'s
`endDirection` assumes when it orients the arrowhead, and the reason that function is reused
unchanged for a curve. A reflected phantom would tilt every arrowhead by an amount depending on
the waypoint before it: a bug with no visible cause.

The conversion is 0/0 at a duplicated knot and is special-cased rather than floored to an
epsilon. See §5.4.

### 3.9 The insert badge is a `HandleRole`, not a new affordance system

`hit.ts` returns exactly `handle | body | empty`, and handles are the only sub-shape affordance
there is. Widening `HandleRole` with `'action'` gets hit priority over the line, a
screen-constant grab radius, a cursor and a drawn knob for free. Inventing a parallel hit pass
would have got none of them.

The violation badge could NOT be a handle, and the difference is instructive: handles exist only
on selected shapes, and a badge that appeared only once you had selected the thing it warns you
about is useless. That one gets its own pass, ahead of the normal hit test.

### 3.10 The sub-part cursor is derived, not maintained

It dies for four unrelated reasons — deselection, multi-selection, the shape being deleted, the
index going stale. Re-checking the three conditions that matter at the point of use covers all
four without a hook per cause. Undo and redo are the exception: they swap the document with
nothing to observe, so `ToolHost` clears it there.

It lives on the tool, not in `SceneStore`. `selection` is part of the undo record, and a cursor
is not document state.

## 4. Defects found by an adversarial review of the FIFO commit

Seven, none of which `svelte-check` or the 406 assertions in place at the time could see. Worth
recording because the shape of them is the lesson: four were reference-identity or arithmetic,
two were pixels, one was a comment.

### 4.1 The flow axis never folded a flip

`resizeBox` encodes "dragged past the far edge" as a negative extent that `normalize` folds, and
`fifoBox` folds it by handing the value to `normalizeRect`. `flowExtent` took `Math.abs` first,
so `normalizeRect` never saw a negative and the box stayed anchored at the DRAGGED edge. Pulling
the west handle of an unbounded 0..320 queue out to 480 drew it at 480..640 and committed that.

### 4.2 The minimum length pushed the edge the drag had pinned

The floor was applied about the origin, which is the only thing `fifoBox` can see. Shrinking the
west edge of a 0..200 queue to 96 gave 96..240: the gesture was shrinking and the pinned edge
grew away from the cursor. The floor moved into `resize`, which is the only place that knows
which handle moved — XOR'd against the flip, because `normalizeRect` relabels the two when a
drag crosses over.

### 4.3 `size`'s writer allocated when nothing changed

Its `read` goes through the derived box, so for a bounded queue it can never return the width
that was typed — which means `applyDocument` calls the writer on every subsequent commit, and an
unconditional `{ ...s }` hands back a content-identical shape with a fresh identity. Three edits
produced three undo entries that restored a byte-identical scene.

### 4.4 `cells` had a floor but no ceiling

`1000000000` passed the schema and the writer and was committed; the next frame tried to build a
billion-segment path. Capped at 1024, **in the schema as well as the writer** — ajv is what draws
the live annotation.

### 4.5 The label plate erased the outline, and missed the descenders

A label wider than its box — easy on a FIFO, whose length is fixed by its cell count — punched a
22-device-pixel hole through both vertical outlines. And the ink around a `middle` baseline is
asymmetric (0.43 above, 0.52 below), so a plate of height `px * INSET_INK_H` centred on the line
misses a `y`'s tail.

### 4.6 An extraction orphaned a doc block

`drawInsetLabel`'s rationale — including the repo's most emphasised drawing rule, that
`fillText`'s fourth argument condenses rather than truncates — ended up attached to `drawPlate`,
a two-`fillRect` helper inserted between the comment and its function.

### 4.7 Two defects in the checks themselves

`components.mjs` imported `scene/registry.ts` by URL inside `page.evaluate` — the trap iteration
4.1 wrote down. After an HMR update the app's copy sits behind a versioned URL, so a bare
specifier resolves to a second module instance with an empty registry and every `opsFor` throws.
Uncaught, so the suite dies with no summary and takes every later suite in the chain with it. It
passed only against a server that had never hot-reloaded.

And one group drew its FIFO at a hard-coded `y + 620`, off the diagram canvas and onto the trace
panel. It created nothing, silently patched the previous group's queue, and moved the time
cursor on the way past.

## 5. Defects found while building, and what they teach

### 5.1 A `<kind>.props.ts` must not import from its `<kind>.ts`

The kind file is what `register.ts` imports, so the pair forms a cycle — and because the props
module consumes the values while it is still evaluating its top-level array, they land in the
temporal dead zone. The app died at load with `Cannot access 'MIN_SPACING' before
initialization`. `rect` and `conn` never met this because their props files ask for nothing back.

Geometry now lives in a third module, `<kind>-geom.ts`, the same separation `route.ts` has from
`conn.ts`. Written into the README's "Adding a shape kind".

### 5.2 A selected parent's handles made its own children ungrabbable

An interface sits exactly where its parent's invisible edge grab zone runs, and handles of a
selected shape beat any body under them. Selecting a fabric covered every one of its interfaces
with a resize zone: pressing a port resized the fabric instead, and the port could not be
grabbed at all until the parent was deselected.

The rule that handles win exists to stop an _unrelated_ shape stealing a resize. A child is not
unrelated, so a selected shape's handles now yield where its own children lie.

### 5.3 Growing the interface count put a new one on top of an old one

Raising the count leaves the interfaces already placed alone — they may have been dragged. But
the even spread for four and the spread for six do not line up, so a new one taking its slot in
the new spread lands on an old one: a fourth at 288 and a sixth at 304, overlapping by 28 of
their 32 units. `freeOffset` tries the spread position first and scans for a clear slot only if
it is taken, which keeps a fresh row spread and a grown row disjoint.

### 5.4 The spline's end tangent was garbage, and an epsilon did not fix it

The phantom endpoints make the outer knot spacing exactly zero, so the centripetal conversion is
0/0 there: numerator and denominator both vanish and floating point returns whatever the rounding
gives. Clamping the spacing to an epsilon only makes the garbage finite — the measured end
tangent was nowhere near the last chord, which is precisely what the arrowhead depends on. The
degenerate case is handled explicitly instead: the control point goes a third of the way along
the chord, which is what it is supposed to mean.

### 5.5 Inserting a waypoint deleted it in the same gesture

`collapseCurve` dropped any waypoint sitting on the chord between its neighbours, by analogy
with `route.ts`'s `collapseRoute`. Inserting into a STRAIGHT curve puts the new point exactly on
the chord by construction — so `normalize` removed it immediately, and clicking the badge did
nothing except record an undo entry.

A curve's waypoints are explicit: the user inserts them with the badge and removes them with
Delete. Nothing else gets an opinion. Deduping coincident points is still required, because the
centripetal parameterisation divides by the chord length.

### 5.6 "A straight line will do" was too weak a test

`leaves > 0 && arrives > 0` passes easily for two ports facing each other but offset across the
gap, and the straight line they get leaves the port at an angle. A bus drawn leaving its own port
diagonally does not read as a bus. The test is cos(15°) now, so a genuinely straight shot stays
exactly straight — two points, no waypoints — and anything meaningfully off-axis bows.

### 5.7 The automatic bow was proportional with no cap

Half the separation, so two rows of ports 380 units apart each pushed a control point 190 out and
the pair ballooned into a lens the width of the gap. A third, capped at six grid steps.

### 5.8 Two affordances that looked identical

Waypoint knobs and insert badges sat side by side on the same line as the same square, so nothing
said which one you drag. The badge is smaller, dimmer and has a cross through it — and the cross
had to be drawn twice before it was legible, because at the first size its arms were 1.4 CSS px.

## 6. Scaffolding left for future iterations

- `protocol` is a one-value enum with a `!==` comparison the compiler calls unreachable. The
  comparison is widened to `string` on purpose: it will stop being unreachable the moment a
  second bus standard lands, and deleting it would mean whoever adds one gets no reminder.
- `channel: 'all'` exists so a diagram drawn at bundle level does not report five violations for
  one wire. Nothing else reads it yet.
- `ShapeOps.subPartOf` / `subPart` / `removeSubPart` are named for sub-parts in general rather
  than for waypoints. A curve is the only kind with any today.
- `Handle.glyph` has one value. A second kind of `action` handle would want a second.

## 7. Flagged for future work

- **No obstacle avoidance on a curve**, the same gap `route.ts` has. `autoWaypoints` knows about
  the two anchors and nothing else, so a link between two distant interfaces will run through
  whatever is between them. The user drags a waypoint, which pins the route — the same bargain
  the rectilinear router strikes.
- **A curve's label rides the arc midpoint** with no minimum-length test, unlike the rectilinear
  branch's `CONN_LABEL_MIN_RUN_PX`. A very short curved link will crowd.
- **`arrowBox` is an axis-aligned box** whose comment rests on routes being rectilinear. A curve
  arriving diagonally over-reports, so `headIsClear` suppresses the arrowhead more readily than
  it should. Rare in practice, because the last control point of an automatic curve sits on the
  interface normal and the approach is square.
- **Interfaces do not avoid each other when dragged.** `freeOffset` only applies when the count
  grows; a user can drag two ports onto the same spot.
- **An interface's label is drawn only on the `n` and `s` faces**, because a horizontal string on
  a vertical face would run across the parent it belongs to.
- **`MAX_CELLS` is a drawing limit, not a hardware one.** A queue deeper than 1024 has to be
  drawn unbounded.

## 8. Conventions and gotchas

- **A `<kind>.props.ts` must not import from its `<kind>.ts`.** See §5.1. Put anything they share
  in `<kind>-geom.ts`.
- **A box kind delegates**: `shapes/box.ts` for handles, resize, anchors and body;
  `shapes/heading.ts` for the label; `props/common.ts` for the nine repeated properties. Each
  takes the body rectangle as a PARAMETER rather than reading `x/y/w/h` off the shape, because a
  FIFO's drawn box is derived and its stored `w` is not the answer.
- **`theme.shapeFill` is translucent.** An opaque plate the colour of a box body is two fills:
  `background`, then `shapeFill` over it. One fill composites and looks almost right.
- **A property writer must return `s` by reference when nothing changed**, not only `reroute` and
  `rebind`. Any writer whose `read` cannot reproduce what the user typed is called on every
  commit thereafter, and every allocation is an undo entry that undoes nothing.
- **Put a numeric ceiling in the SCHEMA, not only in the writer.** The writer refuses the commit;
  ajv is what tells the user, and a value large enough to hang the renderer has to be refused
  before it is committed.
- **Register a new tool AFTER the existing ones.** Digits come from toolbar position, so
  inserting renumbers every tool below — including the literal `Digit4` other suites press.
- **Never import `scene/registry.ts` by URL inside `page.evaluate`.** Use `window.__ops` and
  `window.__doc`. Pure modules like `curve.ts` and `fifo-geom.ts` are safe that way.
- **Derive positions in a check from the live canvas box.** A hard-coded `y + 620` is on the
  trace panel.
- **Adding an `edit` property reorders the document** and fails `verify/production.mjs`, which
  `npm run verify` does not run. This iteration moved both the block's and the connection's.

## 9. How iteration 6 was verified

```
npm run dev                          # terminal 1, port 5183
npm run verify                       # 495 assertions across ten suites
npm run check                        # 504 files, 0 errors
npm run build && npm run preview     # port 4183
node verify/production.mjs           # 16 assertions — NOT in `npm run verify`
npx prettier --check src verify README.md history
```

Two new suites. `verify/components.mjs` (70) covers the FIFO's derived length, the flip and the
floor about the pinned edge, the divider layout in both modes, the label plate as pixels, the
reference-identity contract on every writer, the interface reconcile, z-order re-seating, the
delete refusal, dragging a port between borders, and the two-pass loader. `verify/network.mjs`
(44) covers the spline as arithmetic — straightness, cusps, end tangents, the alignment test —
then which family the tool chooses, the whole waypoint gesture, the violation rules, and the
badge and its popup.

Each intermediate commit was typechecked in an isolated worktree, so the history bisects.
