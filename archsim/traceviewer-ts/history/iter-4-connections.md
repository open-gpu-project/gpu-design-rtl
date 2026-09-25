# Iteration 4 — Connections

2026-09-22. Complete.

## Scope

A second shape kind, `conn` ([conn.ts](../src/lib/scene/shapes/conn.ts),
[conn.props.ts](../src/lib/scene/shapes/conn.props.ts)); a pure scoring router
([route.ts](../src/lib/scene/route.ts)); the dependency pass lifted out of the store into a pure
module ([resolve.ts](../src/lib/scene/resolve.ts)); sliding perimeter anchors on the block; a
connect tool ([connect-tool.ts](../src/lib/tools/connect-tool.ts)) and `anchorHitTest`
([hit.ts](../src/lib/canvas/hit.ts)); an `onPointerLeave` tool hook. Then a canonical property key
order, a self-sizing documentation footer, draggable endpoints, and a connection's geometry made
read-only in the panel.

- **4, connections** — the kind, the router, anchors, the connect tool, the reroute fold.
- **4.1, panel and endpoints** — one canonical key order, a documentation footer sized to its text,
  round endpoint beads with a `rebind` handle role.
- **4.2, read-only geometry** — `source`, `target` and `points` become `fixed`; `routing` stays
  editable; the loader gates on a writer, not on editability; two panel defects.

Deliberately not changed: the file format. `SceneDoc.version` stayed `2` throughout, because a
record was always a property bag keyed by `kind` — a new kind is new data in the same format, and a
moved key is a change to the file's text, not its meaning.

The acceptance bar was iteration 1's: _adding a connection kind should require no change to any
existing mutation path_. It held — `commit`, `previewShapes`, `replaceShape`, `undo`, `redo` and
serialization were byte-identical. What the reserved seams did not cover, and had to be added:

| Gap                          | Why the original shape contract missed it                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchorAt` / `resolveAnchor` | A fixed list of anchors is enough to _terminate_ on a block but not to _pick_ a point on one; four midpoints cannot say "where I pointed".  |
| `corridors`                  | Nothing anticipated bundling, which needs to ask a shape which of its runs are worth joining.                                               |
| `RouteContext` on `reroute`  | `reroute(s, deps)` saw its endpoints but not its neighbours, so it could re-route but never bundle.                                         |
| `Tool.onPointerLeave`        | No tool had drawn hover-only decoration, so nothing needed to know the pointer had left.                                                    |
| Handle `role` / `rebind`     | A handle could say where it is and how to hit it, but not that dragging it re-attaches this shape to another — every drag went to `resize`. |

All five are additive and optional: a kind may omit the `ShapeOps` methods, a handle may omit its
`role`, and `reroute`'s third argument was safe to make required because nothing implemented it yet.

## Decisions that came from the user

| Decision                                                                                            | Note                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The router may spend a third segment, but only when it buys something                               | The ghost and the common case stay 1–2 segments. A strict 2-segment cap makes bundling impossible rather than merely worse (below). |
| A hand-edited route is pinned; a later block move patches only its ends                             | `routing` is exposed as a property, so setting it back to `auto` is the escape hatch.                                               |
| Bundled lines overlap exactly                                                                       | Rejected: offset lanes.                                                                                                             |
| The anchor dot slides along the edge, grid-snapped                                                  | Rejected: the four fixed midpoints, and a free unsnapped point.                                                                     |
| Sort the JSON editor's keys alphabetically, editable above generated, `kind` always first           | Taken literally, including that it buries `name` in the middle. A rule the reader can predict beats one person's idea of natural.   |
| The detail panel must show all its text; the user may enlarge it but not shrink it below that       | Implemented as `max(measured, asked for)`, which turns out to require keeping two numbers.                                          |
| Give the arrow's ends circular dots, to distinguish them from the square segment handles            | Shape carries the meaning: a square moves a run of the line, a circle moves where the line attaches.                                |
| `source`, `target` and `points` are read-only — they belong to the canvas; `routing` stays editable | The first pass froze all four as asked, then `routing` was put back once it was clear that made a pinned route unrecoverable.       |

The last one is worth recording in its first form. Freezing all four was a defensible reading of
"the user should not edit these outside the provided UI" — right up to the point where it turned out
the provided UI can only move `routing` one way. The rule that came out of it is sharper than the
rule that went in.

## Load-bearing decisions

### Why the cap is three segments

An L's corner is at `(B.x, A.y)` or `(A.x, B.y)` — **fully determined by its two endpoints**. There
is no free parameter, so nothing to snap onto a corridor, and two lines can only share a run by
coincidence. Bundling needs a Z, whose middle coordinate is free.

A second argument is independent of bundling: two anchors facing each other with any offset have no
2-segment route that both leaves along the source normal and arrives into the target face. One end
is always entered through the back of its block, arrowhead pointing out.

The cap is 3, not "as many as it takes". A router that spends segments freely needs obstacle
avoidance to justify them, which is a much larger algorithm. `ROUTE_MAX_SEGMENTS` is a named
constant the cost function reads, so raising it is one edit plus new candidate generators.

### The router scores candidates rather than following rules

`routeConnection` generates every straight, L and Z candidate and takes the argmin of a weighted
cost. Four requirements — short, few segments, leaves along the face normal, bundled onto its
neighbours — are in direct conflict, and a rule ladder has to fix a precedence between them. Scoring
lets the precedence fall out of the weights, which can then be _argued about_ rather than tuned.

The weights are chosen so the behaviour is provable. For two fixed endpoints **every L and every
in-span Z has identical Manhattan length**, so length does not discriminate between them and only
penalises elbows outside the span. Within the span the contest is `W_SEGMENT` (2) against
`BUNDLE_BONUS` (6) against `W_MIDPREF · |m − mid|` (0.25 per cell):

| Situation                                          | Outcome                                          |        Margin |
| -------------------------------------------------- | ------------------------------------------------ | ------------: |
| No corridor nearby                                 | The L wins — routes are 1–2 segments by default  |             2 |
| A corridor within 24 cells of the natural midpoint | The Z wins — lines bundle                        |       up to 4 |
| A corridor far away, or out of span                | Loses on length — no absurd detours              | 2 × overshoot |
| Any route violating a face normal                  | Never wins — bundling cannot buy an ugly arrival |  25 or 10 000 |

`BUNDLE_REACH` is derived from that table, not picked: past `BUNDLE_BONUS / W_MIDPREF` cells a
corridor candidate cannot win, so generating it would be waste.

The normal penalty is **two-tiered**, which is what makes the head-to-head case work. "Through"
(10 000) is diving into the block it just left or arriving through the far side of its target —
visibly broken. "Off-axis" (25) is leaving along the face — merely ugly. With one tier, two anchors
facing away from each other have no legal route and the router picks arbitrarily; with two, it
reliably goes _around_.

`W_INDEX` makes the argmin a deterministic function of the input rather than of `Set` iteration
order.

### An anchor is an edge and an offset

Stored as `<side>:<offset>` — `e:48` — the offset grid-snapped at pick time and measured from the
face's start corner. Rejected: **the four midpoints**, because every connection on a side stacks
onto one point. Rejected: **an unsnapped perimeter point**, because anchors off the grid do not line
up with each other, which quietly undermines bundling at the ends.

Two details are load-bearing. The id stores the offset **as authored, clamped only at resolve
time**, so shrinking a block below an anchor and growing it back puts the connection where the user
left it. And `anchorAt` collapses to the face midpoint once the cursor is more than `ANCHOR_BAND_PX`
inside the block: near the outline the nearest face is obvious, but deep inside a pixel of drift
flips the bead to another side. Collapsing makes "click the middle of the target block" a stable
gesture rather than a lottery. Anchors now come from `anchorAt` and `resolveAnchor` alone, shared by
every box-shaped kind through `plain-box.ts`.

### Bundled lines overlap exactly

Rejected: offset lanes. A lane index has to be stable under insertion _and_ deletion, and with the
z-order fold the index is position-in-fold — so deleting the lowest line of a bundle re-lanes every
line above it, visible churn on an unrelated delete.

The honest cost: two connections with _identical_ anchor pairs draw identically, and `hitTest`
returns only the topmost, so the lower one cannot be picked on the canvas. It is still reachable by
name, by marquee and in the panel. Lanes are the principled fix if it ever bites.

### The reroute fold

`rerouteAll` walks the z-order bottom-up accumulating a `CorridorIndex`, so **a connection may
bundle only onto runs owned by connections below it**. No shape observes its own output. As designed
here the fold was well-founded and settled in one sweep, with no order in which two connections
could chase each other's corridors forever. The alternative — every connection sees every other — is
a fixed point with no guarantee of one, and the failure mode is a scene that re-routes differently
on every commit. The price is that restacking a connection can change its route: visible and
explainable.

Iteration 6, _The fold reads back what it already folded, and settles_, replaced the single-sweep
assumption once dependency chains grew two deep (a connection bound to an interface on a fabric);
the bottom-up corridor rule stands.

`CorridorQuery` is an interface of query methods with no array, because the index is mutated _after_
each `reroute` returns: a shape that retained it would observe geometry that did not exist when it
was built. It is an interface rather than the class so a bucketed index can replace the linear one
without touching a shape.

### The ghost is a plain field, not `scene.draft`

The drag-to-create tool previews through `scene.setDraft`; `ConnectTool` deliberately does not.
`draft` is `$state.raw` and the repaint reads it, so assigning it per `pointermove` is a reactive
write at input frequency — the cost iteration 3 measured and removed for `host.pointer`. Painting
from `drawOverlay` is visually identical and touches no signal. The sharper reason:
`SceneStore.commit()` nulls `draft` on its way past, so any commit landing while a connection is
pending would erase a ghost the tool still believed it owned. A plain field cannot desync from the
tool's own state machine. The tool also compares routes before repainting, so with the free end
snapped the ghost is rebuilt about once per grid cell crossed.

The ghost and the committed connection are built by the same code — `newConnection` and `autoPoints`
in conn.ts — so the line cannot jump on the second click.

### Connections re-route inside the drag preview

`previewShapes` deliberately skips history, bounds and the camera, and therefore the dependency
pass. Without an explicit call every connection would trail a cell behind its block for the whole
drag. `SelectTool` wraps its preview branches in `rerouteAll`, which returns its input untouched
when nothing depends on anything. That is why `resolve.ts` is a pure module rather than a private
store method: the select tool needs the reroute half with no commit to hang it off.

### A dependency pass must return its input by identity

`commit` decides whether to push a history entry by comparing `this.shapes !== before`. So
`rerouteAll` copies on first write, the store's dependency pass assigns only when the result
differs, and `ShapeOps.reroute`'s contract _requires_ returning `s` by reference when nothing
changed. Every function in `route.ts` returns its input reference when nothing changed —
`collapseRoute` builds into a scratch array and discards it if it matches. `rebind` shares the
contract for the same reason. A `reroute` that always allocates is a correctness bug, not a slow
path (see the first defect below).

### One canonical property key order

`propSchema` ([spec.ts](../src/lib/props/spec.ts)) sorts a kind's `props` on the way out, via
`orderProps`, so `PropSchema.props` is already canonical and every consumer — the panel document,
the JSON Schema, the saved record, `applyDocument`'s write loop — is unchanged. This supersedes
iteration 2's statement that declaration order _is_ document order; a kind's array order is now a
reading convenience. The alternative, a separate display order used only by `projectShape`, would
have had the panel and the file disagree about a document that is meant to be the same in both.

The rank is `kind` → editable → everything else, alphabetical within each group, compared with `<`
rather than `localeCompare` so a saved file's key order cannot depend on the machine's locale.
`kind` is pinned by key, not by `mode === 'fixed'`, because `fixed` is a general mode `kind` merely
happened to be the only instance of.

Two consequences that are not obvious from the rule. **The write loop runs in this order too**, so
where two writers interact the alphabetically later key wins. And **changing a property's mode can
reorder the document** — in the panel, the schema and the saved file; `routing` sorts above
`points`, `source` and `target` because it is the only one of the four still editable.

### The footer's floor is measured, and the user's wish is stored separately

Three numbers, not one, in [PropertiesView.svelte](../src/views/PropertiesView.svelte):

| Name          | What it is                                                        |
| ------------- | ----------------------------------------------------------------- |
| `docsContent` | measured — what the text needs at this pane width and font        |
| `docsWanted`  | stored — the last size the user dragged to                        |
| `docsHeight`  | `min(max(docsWanted, docsFloor), docsMax)` — what the footer gets |

Keeping the wish separate is what stops the floor from **ratcheting**. Clamping the stored number up
to each new floor would mean one long documentation string permanently enlarged the footer for every
short one after it; storing it below the floor lets a short doc shrink back while a deliberate
enlargement survives.

The measurement comes from an inner `.doc` block carrying the footer's padding. A plain block inside
an `overflow-y: auto` box is laid out at its natural height however short the box is, so the floor
stays measurable in the case that matters — the text does **not** fit. With the padding on it, its
`clientHeight` is exactly what the footer needs; left on the footer, the measurement understated it
by 16px.

A drag re-bases off `docsHeight` rather than `docsWanted`, so it is 1:1 from the first pixel even
while the floor overrides the wish; that let a clamping `$effect` be deleted outright.
`scrollbar-gutter: stable` defends against the one way the measure-then-resize loop could fail to
settle — a scrollbar appearing, narrowing the column, reflowing the text taller. macOS overlay
scrollbars take no width, so it is inert there and necessary elsewhere.

### A handle says what dragging it means

Moving a connection's end is not a resize. `ShapeOps.resize` is pure in the shape, and nothing pure
in a connection can answer "which block is under the cursor" — only the tool sees the rest of the
scene. So the handle record carries a `role` (`HandleRole` in [shape.ts](../src/lib/scene/shape.ts);
iteration 6 later added a third value):

| Role                | The tool's move                                             |
| ------------------- | ----------------------------------------------------------- |
| `reshape` (default) | `resize(s, id, p, mods)` — geometry, as before              |
| `rebind`            | resolve `anchorHitTest` first, then `rebind(s, id, target)` |

The alternative was for `SelectTool` to recognise `'end:from'`, putting the first `switch` on a
kind's private vocabulary into the one file that had stayed generic. A `role` is data; the tool
routes on it without knowing what `end:to` means.

`rebind` rewrites `from`/`fromAnchor` or `to`/`toAnchor` and nothing else — not `points`, not
`routing`. The geometry follows because `reroute` already owns it and both callers already run it
(`SelectTool` over its preview, `commit` over the result); writing a route here too would give the
two a chance to disagree. Leaving `routing` alone means a hand-drawn route survives its ends being
moved, which is what `patchStart`/`patchEnd` are for. Two drops are refused by returning `s` **by
reference**, rendering as the bead simply not following the cursor: over nothing (a connection has
no representable free end), and over the block at the other end (the router would drive straight
through it, `normalize` would return null on release, and the drag would silently revert — refusing
early turns a disappearing gesture into one that visibly does not take).

The beads are the connect tool's bead — same radius, same two colours, both meaning "this is where
the line attaches"; they can never be on screen together. They are drawn by `connOps.draw`, not by
the select tool's square-handle overlay, both ends in one path. The **order** of the handle list is
load-bearing: `hitTest` takes the first match, which is what puts an end bead ahead of the segment
leaving it.

### `fixed` is a claim about authority, not about storage

`mode === 'edit'` had been answering three questions that had the same answer for every property
that existed:

| Question                               | Asked by         | Was            | Is             |
| -------------------------------------- | ---------------- | -------------- | -------------- |
| May the **user** set this key?         | `applyDocument`  | `edit`         | `edit`         |
| Does the **file** carry this key?      | `serializeShape` | not `computed` | not `computed` |
| May the **loader** set it from a file? | `hydrateShape`   | `edit`         | has a `write`  |

A read-only property that is nonetheless real, saved state is the first case where the first and
third differ. `fixed` now means "another part of the app is in charge of this", not "this does not
really change" — which is why `kind` and `points` share a mode with nothing else in common. Left on
`mode === 'edit'`, `hydrateShape` would load every connection in every file as `connOps.blank`:
unbound, a zero-length route at the origin, exactly what `normalize` discards. A fourth mode was
rejected: the modes are valuable as a small enumeration a reader holds at once, and what varies is
not a fourth kind of property but a second question about the same one. `write !== undefined` says
it directly. A read-only property therefore still needs its `write`; only `computed` properties,
absent from the file, legitimately have none.

### Three of them are one value; `routing` is a choice about that value

`source`, `target` and `points` are not independent: the first point sits on the anchor `source`
names and the last on `target`'s. Change one in a tree editor and the other two describe a different
connection, and every writer would have to defend itself against the other two. The canvas gestures
cannot produce an inconsistent triple — `rebind` changes a binding and lets `rerouteAll` supply the
geometry; a segment drag moves the line and pins it in one write.

`routing` does not say where the connection runs; it says **who is responsible for saying where it
runs**. It has to stay editable because the canvas moves it only one way: a segment drag sets
`manual`, and nothing sets `auto` — there is no gesture whose natural meaning is "stop keeping the
thing I just drew". With `routing` read-only, one stray drag pinned a route for life, and the only
recovery was to delete and redraw it, losing its label, description and name.

The writers of the three read-only properties keep their validation (`asEndpoint`, `asPointList`,
`isRectilinear`, `checkEndpoint`). That is not dead code: their input is now a file — hand-written,
hand-merged, or from a version of the app that no longer exists. A `source` naming a block absent
from the document makes the connection load unbound and get dropped, rather than load bound to
nothing and cascade later from somewhere with no context.

### A writer must not set a sibling key

The `points` writer used to end with `routing: 'manual'`, so that a hand-typed route would not be
overwritten on the next block move. It also ran on the load path, so whichever of the pair
`hydrateShape` applied second decided what a saved file meant (the first panel defect below). The
key reorder fixed that by coincidence; the coupling was then removed rather than re-ordered.
`points` is no longer editable, so the loader is its writer's only caller, and the loader has the
record's own `routing` right there — the writer second-guessing it is exactly the bug. Pinning is
now the job of the gesture that draws a route, `connOps.resize`, which sets `manual` in the same
write that moves the segment.

This mattered more than it looked: putting `routing` back in the editable group flipped the two
keys' order, so under the old forcing the bug would have returned verbatim. Decoupled, the order is
not load-bearing at all — a better place than having the order right. One behaviour changed: a
hand-written file listing `points` but omitting `routing` now loads as `auto` and re-routes. That is
the right reading, and no file the app writes is affected, since both keys are always emitted. The
rule: if a gesture needs two keys moved together, move them in the gesture.

## Defects, and what they teach

**The dependency pass would have made every commit undoable.** The store's dependency pass ended in
an unconditional `this.shapes = current.map(...)`. It had never run, because no kind implemented
`dependsOn` until connections. Registering the kind would have made every commit in the app push an
undo entry — including no-ops in a scene with no connections — so `Cmd+Z` would appear to do
nothing, in code paths nowhere near a connection. The identity contract above is the fix, and one
assertion exists purely to pin it. A seam that has never executed has never been tested; the commit
that first executes it inherits every latent bug in it.

**Excluding the source block turned a refusal into a silent cancel.** The connect tool passed its
pending source to `anchorHitTest` as a shape to exclude. But a click-click tool treats a click on
nothing as "never mind", so clicking the source cancelled the gesture and the explanatory refusal
was unreachable. Hit-testing now reports what is actually under the cursor, and the tool refuses a
self-connection where it can say why; the ghost separately declines to preview into the source.
Hiding the bad input and explaining it are different behaviours, and hiding produces unexplained UI.

**Checks that would have passed silently.** One hard-coded canvas coordinates, which every commit
invalidates by re-deriving bounds and re-clamping the camera; screen points are now derived from
live geometry. Another injected a hand-made `manual` route, which `reroute` re-anchored to the real
blocks, so the camera was parked where the connection no longer was and a culling bug was reported
that did not exist. Assertions against a scene have to survive the machinery that owns it.

**Every saved `auto` connection loaded back as `manual`.** Under declaration order `hydrateShape`
applied `routing` then `points`, and the `points` writer forced `manual`, so a round trip silently
pinned every auto route. Nothing caught it: the round-trip assertion was over a scene of blocks. The
key reorder fixed it by coincidence, so an assertion now hydrates a real connection and checks its
routing (confirmed by making `orderProps` a no-op and watching it fail). A writer with a side effect
on another property is order-dependent by construction, and a round trip asserted over one kind is
not asserted at all.

**The splitter reported a minimum above its maximum.** `aria-valuemin` was the unclamped floor,
which exceeds the ceiling where the documentation cannot fit (a short pane, scaled-up fonts). Now
capped at `docsMax` and pinned by an assertion at a 40px root font. The same check caught the
footer's CSS cap written as `calc(100% - 5rem)` against a pixel `80` in script — equal only at a
16px root. Both are `80px`.

**The beads inherited their line width.** The bead path never set `ctx.lineWidth` and worked only
because the segment-knob loop above it did. It is set explicitly now, and the rings are re-aligned
against their own width rather than the thicker route stroke's, which at dpr 2 put them on half
pixels. The same class of cross-shape leak applies to `lineJoin`: `connOps.draw` sets it round and
must restore it, or every box stroked afterwards softens.

**A module imported by URL in a check may be a second copy.**
`await import('/src/lib/scene/registry.ts')` returned an empty registry, because Vite appends `?t=`
once a module is invalidated and the bare specifier minted a fresh instance. It bites only modules
with module-level state, and only after an edit during the session — it passes cold and fails later.
Fixed by exposing `window.__handles(name)` from the DEV block, alongside `__route` and `__anchor`.

**The read-only marking was one selection behind.** `PropertiesView`'s effect pushed the document
(which renders the tree synchronously, calling `onClassName` for every node) and only then assigned
`shownSpec`. So classes were computed from the previous selection's schema, and a key that schema
had never heard of fell to the read-only branch. The first connection after a block showed `routing`
grey; worse, the first block after a connection showed `position` and `size` grey. It could not
happen while `rect` was the only kind — being one behind was indistinguishable from being right. The
fix is `classSpec`, a plain `let` assigned immediately before the push and read by `onClassName`.

**Assigning `shownSpec` before the push makes the effect self-invalidating.** The obvious fix
type-checks, fixes the marking, and throws
`TypeError: Cannot read properties of null (reading 'schedule')` out of Svelte's flush on every
selection change. `validator` is `$derived` from `shownSpec` and the synchronous render reads it, so
the effect writes a signal and reads it back within one run. What a synchronous render reads must be
current before the render and must not be `$state`; a plain `let` is how a third-party component
gets a value the reactivity graph does not know about. It cost a round trip because no dev suite
failed — `report` printed the page error under 260 passing assertions — so `connections.mjs` now
ends by asserting nothing threw.

## How it was verified

`verify/connections.mjs`, split by what each group needs rather than what it covers: pure router
functions via `window.__route` (200 seeded-random routes for rectilinearity, endpoint fidelity and
the segment cap; bundling in and out of range; determinism; head-to-head), anchors via
`window.__anchor`, the store (the no-op-commit guard, rename propagation, cascade delete restored by
one undo, the saved record's keys), real-pointer interaction, real-frame drawing (one stroke and one
fill per connection, no canvas state left behind, the `bounds` cull), endpoint handles via
`__handles`, and a read-only group that asserts both the greying and the gate behind it. The
assertions to keep: **a no-op commit records no history entry**; **the committed route is the ghost,
not a second opinion of it**; **a property the user cannot type is still one the loader puts back**
(the only check distinguishing "read-only" from "not loaded"); and **an auto route comes back
auto**. `verify/production.mjs` confirms registration in a production build and asserts the panel's
row order against the shipped bundle.

The iteration ended at 261 assertions across six dev suites (connections 91, properties 38), plus 15
in `verify/production.mjs`.
