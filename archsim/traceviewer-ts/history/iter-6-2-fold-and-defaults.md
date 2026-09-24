# Iteration 6.2 — the fold settles, links stop bowing, two defaults shrink

2026-09-24. Complete. Six commits, `npm run verify` from 529 assertions across ten suites to
559, plus `verify/production.mjs`'s 16 against the built bundle.

Iteration 6.1 turned the network interface into a port and gave the queue an honest creation
ghost. Using the result turned up four more things — again, none of them new features, all of
them the code promising something it does not deliver.

## 1. Scope

- **A wire glued to a port keeps up with the fabric that port is on**, during the drag rather
  than one commit later. Two independent halves: when geometry is re-derived, and what a
  gesture moves.
- **A link runs straight unless a straight line would run backwards.** The bow becomes the
  case rather than the default.
- **A queue's cells are one grid step**, so its dividers line up with the dots behind them.
- **An interface is two grid steps long**, so its anchors — the centres of its edges — land on
  the grid, and so does every wire leaving one.

Two earlier decisions are reversed by name, rather than quietly: `iter-4-connections.md` §4.5
("a fixed point with no guarantee of one… do not 'fix' it by feeding the fold its own results")
and `iter-6-components.md` §5.6 (straight when the ports face each other, bowed when they do
not). The first bullet of `iter-6-1-refinements.md` §5 is closed, and its §4.3 — a check
weakened to five interfaces because six 48-unit ones do not fit — is restored to six.

## 2. Decisions that came from the user

| Question               | Decision                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------- |
| The lagging wire       | Fix the fold, and fix what a gesture moves; they are different defects                  |
| When a link should bow | Only when a straight line would leave one port backwards or reach the other from behind |
| A queue's pitch        | One grid step, so the dividers land on the dots                                         |
| An interface's length  | Two grid steps, chosen for where the anchor lands rather than for the box               |

## 3. Load-bearing decisions

### 3.1 The fold reads back what it already folded, and then settles

`rerouteAll` built its `byId` map once, from the array it was handed, so a pass resolved exactly
one level of the graph. The real chain is two deep — `conn → nif → fabric` — so a wire attached
to a port read that port as it stood on entry. The commit after fixed it, which is exactly why
the wire caught up on release, and why a block-to-block wire, a depth-one chain, never showed
the defect at all.

One line changes that: `byId.set(next.name, next)` beside `corridors.absorb(next)`, which has
always worked this way and whose comment already accepted the consequence. `expandChildren`
re-seats every child immediately above its parent on every commit, so in practice the whole
chain resolves in a single sweep.

What ordering cannot cover is a connection the user pushed BELOW its own ports with
`sendToBack`. Under the read-back alone that connection would read them stale permanently
rather than for one frame, so the sweep repeats to a fixed point, exactly as `pruneOrphans`
directly above already does. Three things make that affordable and safe:

- **A fresh `CorridorIndex` per sweep.** Reusing it would keep every run the previous sweep
  produced, including ones that no longer exist, and `BUNDLE_BONUS` is large enough to route
  onto a corridor that has gone.
- **The cap is derived, not picked** — the longest chain of `dependsOn` edges over the actual
  array, on the precedent of `route.ts`'s `BUNDLE_REACH`. Today that is two. A cycle found
  while deriving it is a programming error, so it throws in DEV and degrades to one sweep in
  production.
- **The second sweep is skipped in the common case.** A sweep records the lowest index that
  depends on each name and asks for another only when a shape changed ABOVE one of its own
  dependents. Dragging two connected blocks changes only the connections, and nothing depends
  on a connection: one sweep, at the cost this had before. That matters — `rerouteAll` runs on
  every `pointermove`.

Iteration 4's objection was not that a fixed point was unreachable but that it was asserted
rather than argued, so the argument is now written out in `resolve.ts`: a `nif` depends only on
a parent with no `reroute` and is final after one sweep; an `auto` connection is a function of
`(a, b, corridors)` and never reads its own points; a `manual` one reads them but
`patchStart`/`patchEnd` return by reference once the ends match; corridors flow strictly
bottom-up within a sweep and are discarded between them.

The contract that argument rests on is now stated where it belongs. `ShapeOps.reroute` said only
"return `s` by reference when nothing changed"; under a settling fold the requirement is
`reroute(reroute(s)) === reroute(s)`. Both implementations already satisfy it.

And the invariant is stated precisely and no further: the result is a fixed point, but it is not
necessarily what a single sweep against fully resolved dependencies would have produced —
`patchStart`/`patchEnd` composed with `collapseRoute` is path-dependent. That is not new; the
same two steps already ran across a preview and its commit.

### 3.2 A gesture moves what it moves, not what is selected

`SelectTool` translated exactly the selection. That is wrong at both ends, and neither end is
fixed by §3.1.

- A connection whose **both** endpoints are moving was not moved, so a hand-drawn bus between
  two ports of one fabric kept its interior points in world space and deformed as the fabric
  travelled. `reroute`'s manual branch splices the interior through verbatim and slides only the
  ends, which is right for one end moving and wrong for both.
- A port selected **together with its own parent** moved twice: once by `translate` recording
  into `pending`, once by `reroute` re-gluing it to the parent that also moved. `Cmd+A` and a
  drag slid every port in the document along its border.

So the tool asks a different question, and `movesWith` in `resolve.ts` answers it:

```
follows   = children, transitively, of anything in the selection    -- moved by reroute
carried   = has dependencies, has no parent, and every dependency
            is in the selection or in `follows`                     -- moved bodily
result    = (selection \ follows) ∪ carried
```

A carried connection's ends arrive exactly where its ports arrive, so the patch then finds them
already correct and returns by reference. It is resolved once at pointer-down, so the drag
frames and the commit agree, and `onPointerUp` normalizes and change-tests the same set.

Two consequences, written down rather than discovered later: a fabric moved by **typing into the
property panel** still leaves a hand-drawn route behind, because only gestures are covered; and
a rigid translation can split a bundle where patching would have held it — which is the better
trade, since patching a route whose ends both moved a thousand units is far worse.

### 3.3 A link bows only when a straight line would run backwards

`autoWaypoints` bowed whenever the straight line was more than 15 degrees off either normal.
That threshold was drawn for the case it names — a bus leaving its own port diagonally does not
read as a bus — and is wrong about the case that dominates a real diagram: two ports facing each
other across an offset, which a straight line reaches perfectly well.

One comparison, `ALIGNED` to zero, so the rule is "in front of both ends". The constant is
deleted, and nothing else changes: no signature, no predicate, no tool, no path family.

The case that wants a bow keeps it without being special-cased. When two anchors share a normal
— which is what two ports on one face means — `arrives` is exactly `-leaves`, so they can never
both be positive. That covers a loopback, two ports on one face of the same parent (both terms
zero), two on the same face of different parents diagonally apart, and two facing away from each
other. A rule about `side`, which was the first draft, would have got three of those wrong.

### 3.4 A relative gap, not a constant one

`spacing` defaulted to two grid steps, so a queue's dividers never lined up with the dots behind
them. Halving it is two lines — `makeFifo` and `blank()`, which is also the file-load default —
but `MIN_GAP` had to come with it. It was `GRID`: half a cell at the old default and exactly one
cell at the new one, which would have turned a minimum-size unbounded queue into a uniform run
of five and lost the 1-gap-3 shape whose whole job is to say "and so on" without an ellipsis
glyph. It is `minGap(spacing)` now, half the pitch, which returns 16 at the old default and so
moves nothing that already exists.

The general shape: **a constant that is secretly a ratio breaks when the thing it was a ratio of
changes.** Nothing declared that `MIN_GAP` was half a cell — it was 16 because a cell was 32.

### 3.5 A default chosen for where the anchor lands

`NIF_LENGTH` is two grid steps because an interface's connection point is the centre of an edge
and `offset` is grid-snapped: the centre is on a dot exactly when half the length is a whole
number of grid steps. At 48 every anchor sat 8 units off every dot, and so did every wire
leaving one — the actual complaint, which the box's size only mediates.

Stated as a precondition rather than a guarantee: it also needs a grid-aligned parent and no
clamp biting. A port pushed to the far end of a face 340 wide is clamped to `340 - 32`, which is
not on the grid either.

### 3.6 A saved geometric constant makes documents of two vintages

`length` is a saved `edit` property, so changing the default changes nothing about existing
documents — every one of them keeps its 48-unit ports. That is the right behaviour and it is
also what made a latent bug reachable: `expandInterfaces` passed the CONSTANT to `freeOffset`,
which tested overlap with one length for both intervals, so a new 32-unit port added to such a
fabric was placed against 32-unit assumptions and landed through a real neighbour by up to 16
units. `occupied` is a list of `{offset, length}` spans now and `overlaps` reads both.

## 4. Defects found while building

### 4.1 Every bus link lost its arrowhead

Found with pixels, which is the only way it could have been found: the geometry was right and
the decision was wrong.

`headIsClear` asked whether the arrowhead's BOX overlapped either endpoint's block. An
axis-aligned box is exact only for an axis-aligned triangle — rotate the head and the corner
behind a barb swings past the tip's own plane, so the box reports an overlap with the very face
the arrow is pointing at. Rectilinear routes always met their face square on, so this never
mattered; §3.3 made a glancing arrival at a port the ordinary way a link ends, and the head
vanished from every one of them.

The fix is to ask the question the feature is actually about. A head arriving at 15 degrees off
a port's face genuinely lays a barb across that face, and that is what an arrow meeting a
surface at a glancing angle looks like — not a blob. What makes a blob is the WEDGE sitting
inside a block, so the test is the base point: outside every block means an arrow, inside one
means it is buried. A point, so nothing has to be deflated — `ARROW_TIP_TOL_PX` already records
why deflating the block is not an option — and unlike the tip, the base never lands on an
outline by construction, so it needs no tolerance.

`arrowBox` is kept, exported and checked as the honest description of the head's extent, in the
same spirit as `nif`'s unused `anchors` seam.

### 4.2 A port read from a file routed its wire to the world origin

The same one-level cut-off as §3.1, with no gesture in it at all. An interface deliberately has
no saved position — it has a side and an offset — so a port loaded from a file carries
`blank()`'s `x = y = 0` until its own `reroute` runs. A wire bound to that port resolved against
the origin copy and drew itself to the top-left of the world, settling only on the next commit.
Now covered by a check that seeds exactly that document.

### 4.3 A check can be weakened by a change it never mentions

`iter-6-1` §4.3 weakened an interface-packing group from six to five because six 48-unit ports
do not fit a 336-unit face. Six 32-unit ones fit in 192 of it, so the group is back to six and
asserting something real again. Worth recording as a pattern: **a check relaxed to accommodate a
constant should name the constant**, or the relaxation outlives the reason for it.

### 4.4 An orphaned documentation block

`theme.ts` carried a doc comment for `CULL_MARGIN_PX` twenty-five lines above the declaration,
with another constant's comment in between — a live instance of the defect `iter-6-components.md`
§4.6 already names. Reunited. `geom/types.ts` still described `Anchor` as "unused this revision",
two iterations after connections landed.

## 5. Two designs rejected

Both were the first draft of something in §3, and both are recorded where the code is so they
are not rediscovered.

- **Rigid translation inside `conn.reroute`**, by comparing each end's new anchor against the
  point it replaced and translating when the deltas match. Fatally ambiguous: dragging a manual
  connection by its own BODY gives both ends a delta of exactly the drag, so the rule reads the
  user's own gesture as a rigid move and undoes it — silently, with no undo entry. Geometry
  alone cannot tell "my endpoints moved" from "I was moved"; only the tool knows. That gesture
  now has a check of its own, since nothing covered it.
- **A `sameFaceLink(a, b)` predicate** for the bow rule. It reads `side`, which is not the edge
  a wire attached to; it needs the endpoint shapes at three call sites, one of which has only a
  name and is documented as doing no scan; it would teach a tool what a `nif` is, which
  `preferredPath` exists to prevent. The `> 0` test expresses a superset of it and costs one
  character.

## 6. Flagged for future work

- **A connection's label rides the whole chord on a two-point curve**, so nearly every bus label
  now sits on a diagonal. `iter-6-components.md` already flags the missing
  `CONN_LABEL_MIN_RUN_PX` floor for curves; this widens it from rare to ordinary.
- **Interfaces still do not avoid each other when dragged** — `freeOffset` applies only when the
  count grows — and its scan step is still the interface length, so it can miss an unaligned gap
  on a crowded face.
- **A minimum-size unbounded queue's gap is 8 units.** It reads as a break because both its
  borders are dashed, but it is the tightest the 1-gap-3 shape has ever been drawn.
- **Curved links are still not obstacle-aware**, the caveat iteration 6 §7 records.

## 7. Conventions and gotchas

Everything in iteration 6 §8 and 6.1 §6 still holds. Added by this one:

- **`reroute` must be idempotent**, not merely identity-preserving: `reroute(reroute(s)) ===
reroute(s)`. The fold sweeps until nothing moves.
- **The corridor index lives for one sweep** and is thrown away between them. A run must not
  outlive the connection that drew it.
- **A default a `doc:` string does not state is a default a user cannot discover.** Three of the
  four changes here had their new value written down nowhere a user could reach.
- **A geometric constant that is also a saved property changes nothing about existing
  documents** — so say what a scene of mixed vintages looks like, and make the code that packs,
  measures or compares them read each one's own value.
- **A constant that is secretly a ratio** of another constant must be written as the ratio.
- **An axis-aligned box is not a rotated shape.** It is the right object for "where is this" and
  the wrong one for "does this overlap that".

## 8. How iteration 6.2 was verified

```
npm run dev                          # terminal 1, port 5183
npm run verify                       # 559 assertions across ten suites
npm run check                        # 4483 files, 0 errors
npm run build && npm run preview     # port 4183
node verify/production.mjs           # 16 assertions — NOT in `npm run verify`
npx prettier --check src verify README.md history
```

New coverage, 30 assertions across the network and component suites. Each was written to fail
against the commit before it and pass after, and the ones that could not fail — the fixed point,
the move set as a function — say so here rather than pretending otherwise:

- **The fold settles** — `__resolve.rerouteAll(shapes) === shapes` by reference on a committed
  scene, which is the fixed-point property, the no-spurious-undo property and a cycle detector
  at once; the depth-two sibling of the existing "a connection follows its block during the
  drag", read mid-drag; and a seeded document whose wire is bound to a port record, asserting
  the wire lands on the real anchor rather than the origin.
- **What a gesture moves** — a hand-bent bus between two ports of one fabric travels rigidly
  with it, sampled mid-drag; a fabric selected together with its own port leaves that port's
  offset alone; dragging a connection by its own body still moves its waypoints and leaves both
  ends on their anchors; and the move set itself, as three calls side by side.
- **The bow rule** — through `window.__curve`: an offset facing pair runs straight, and equal
  normals, a diagonal same-normal pair, an arrival from behind and a pair facing away all bow.
  End to end: dragging a port to the opposite border flips the link's shape in the same commit
  as the side change.
- **The arrowhead on a glancing arrival** — a pixel probe just off the arrow's axis, where only
  a barb can put ink. The case §4.1 broke, and invisible to every other kind of check.
- **The defaults themselves** — a queue's pitch out of the canvas, out of `blank()` and out of a
  file record that omits it; `makeFifo` still rounding when handed corners no gesture can make;
  and an interface's length, with its anchors landing on the grid on all four sides.
- **Mixed vintages** — a fabric whose ports are 48 units long grows a 32-unit one that overlaps
  nothing, and the old ones keep the length they were saved with.
- **The queue's ghost** now matches its drag exactly rather than within half a cell, because a
  snapped drag at a one-step pitch cannot produce a fractional cell count.

Manual pass on the Retina display at fit, 100% and 200%: a fabric with a same-face loopback, two
diagonal links to a second fabric's ports, an external arrow and two badged violations. The
loopback still bows and reads as a bus, both diagonals run straight and keep their arrowheads,
2-character port labels are legible at 32 units, and a minimum-size unbounded queue still reads
as one cell, a break and three.
