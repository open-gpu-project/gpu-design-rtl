# Iteration 4.1 — panel order, a self-sizing footer, and movable endpoints

2026-09-22. Complete. Three follow-ups to iteration 4, none of which changes the file format or
any router behaviour.

Read [iter-4-connections.md](./iter-4-connections.md) first for the connection model, and
[iter-2-docking-and-properties.md](./iter-2-docking-and-properties.md) §3 for the property
grammar. §3.1 below supersedes iter-2's claim that a kind's declaration order _is_ its document
order, and §3.3 adds a fifth row to iter-4 §2's table of seams the original shape contract did
not cover.

---

## 1. Scope

**Changed.**

- One canonical property key order, decided once in `propSchema`
  ([spec.ts](../src/lib/props/spec.ts)) and applied by both
  [rect.props.ts](../src/lib/scene/shapes/rect.props.ts) and
  [conn.props.ts](../src/lib/scene/shapes/conn.props.ts).
- The documentation footer sizes itself to its text and may only be enlarged from there
  ([PropertiesView.svelte](../src/views/PropertiesView.svelte)).
- A connection's two ends are draggable: round beads, a `rebind` seam and a `role` on the handle
  record ([shape.ts](../src/lib/scene/shape.ts),
  [conn.ts](../src/lib/scene/shapes/conn.ts),
  [select-tool.ts](../src/lib/tools/select-tool.ts)).
- `anchorHitTest` now takes the shape list rather than a `HitScene`, because it never read the
  selection and both callers hand it a snapshot ([hit.ts](../src/lib/canvas/hit.ts)).

**Deliberately not changed.** `SceneDoc.version` is still `2` — the keys in a record moved, but
a record was always an unordered property bag. The router, the corridor index, the reroute fold,
`commit`/`undo`/`redo`, the connect tool and every gesture that already existed are untouched.

**Verification surface.** `verify/connections.mjs` 64 → 77, `verify/properties.mjs` 35 → 38.
Suite total 231 → 247 across six suites, plus `verify/production.mjs` at 15. No new dependencies.

---

## 2. Decisions that came from the user

| Decision                                                                                      | Note                                                                                                                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Sort the JSON editor's keys alphabetically, editable above generated, `kind` always first     | Taken literally, including that it buries `name` in the middle. A rule the reader can predict beats one person's idea of natural. |
| The detail panel must show all its text; the user may enlarge it but not shrink it below that | Implemented as `max(measured, asked for)`, which is what §3.2 turns out to require keeping two numbers for.                       |
| Give the arrow's ends circular dots, to distinguish them from the square segment handles      | Shape carries the meaning: a square moves a run of the line, a circle moves where the line attaches.                              |

---

## 3. Load-bearing decisions

### 3.1 The key order is decided once, at declaration, not per consumer

`propSchema` sorts a kind's `props` on the way out, so `PropSchema.props` is already canonical
and every downstream consumer — the panel document, the JSON Schema, the saved record,
`applyDocument`'s write loop — is unchanged. The alternative, a separate "display order" used
only by `projectShape`, would have meant the panel and the file disagreed about a document that
is supposed to be the same thing in both places.

The rank is `kind` → editable → everything else, alphabetical within each group, compared with
`<` rather than `localeCompare` so a saved file's key order cannot depend on the machine's
locale. `kind` is pinned by key and not by `mode === 'fixed'`, because `fixed` is a general mode
that `kind` merely happens to be the only instance of today.

One consequence worth knowing, because it is not obvious from the rule: **the write loop runs in
this order too.** Where two writers on the same object interact, the alphabetically later key is
applied second and wins. For a connection that pair is `points` (which forces
`routing: 'manual'`) and `routing` — so a document that edits both now ends with the routing the
user typed rather than the one `points` implied. §4.1 is the same inversion, on the load path,
where it fixes a real bug.

### 3.2 The footer's floor is measured, and the user's wish is stored separately from it

Three numbers, not one:

| Name          | What it is                                                        |
| ------------- | ----------------------------------------------------------------- |
| `docsContent` | measured — what the text needs at this pane width and font        |
| `docsWanted`  | stored — the last size the user dragged to                        |
| `docsHeight`  | `min(max(docsWanted, docsFloor), docsMax)` — what the footer gets |

Keeping the wish separate is not bookkeeping; it is what stops the floor from **ratcheting**.
Clamping the stored number up to each new floor would mean that selecting one long documentation
string permanently enlarged the footer for every short one after it. Storing it below the floor
instead lets a short doc shrink back while a deliberate enlargement survives.

The measurement comes from a new inner `.doc` block that carries the footer's padding. Two
properties make it correct, and both are load-bearing:

- A plain block inside an `overflow-y: auto` box is laid out at its natural height however short
  the box is — so the floor stays measurable in the one case that matters, the case where the
  text does **not** fit.
- Because the padding moved onto it, its `clientHeight` is exactly the height the footer needs.
  Left on the footer, the measurement would have understated the requirement by 16px.

A drag re-bases off `docsHeight` rather than `docsWanted`, so it is 1:1 from the first pixel even
when the wish is currently being overridden by the floor. That, in turn, is what let the old
`$effect(() => { if (docsHeight > docsMax) docsHeight = docsMax })` be deleted outright: it
existed only so the next drag would not start from a number that was not on screen.

`scrollbar-gutter: stable` is the defence against the one way a measure-then-resize loop here
could fail to settle — a scrollbar appearing, narrowing the column, reflowing the text taller.
macOS overlay scrollbars take no layout width, so it is inert on this machine and necessary
anywhere else.

### 3.3 A handle now says what dragging it means

Moving a connection's end is not a resize. `ShapeOps.resize` is pure in the shape, and nothing
pure in a connection can answer "which block is under the cursor" — only the tool can see the
rest of the scene. So the handle record grew a `role`:

| Role                | The tool's move                                             |
| ------------------- | ----------------------------------------------------------- |
| `reshape` (default) | `resize(s, id, p, mods)` — geometry, as before              |
| `rebind`            | resolve `anchorHitTest` first, then `rebind(s, id, target)` |

The alternative was to let `SelectTool` recognise `'end:from'`. That would have put the first
`switch` on a kind's private vocabulary into the one file that had stayed generic through four
iterations. A `role` is data; the tool routes on it without knowing what `end:to` means.

This is the fifth entry for iter-4 §2's table of gaps in the shape contract: a handle could say
where it is, how to hit it and whether to draw it, but not that dragging it re-attaches this
shape to a different one — so every drag went to `resize`. `role` is optional on the handle and
`rebind` is optional on `ShapeOps`, so the additive-and-optional property of that table holds.

### 3.4 `rebind` changes the binding and nothing else

It rewrites `from`/`fromAnchor` or `to`/`toAnchor` and leaves `points` alone. The geometry
follows because `reroute` already owns it and both callers already run it — `SelectTool` over its
preview, `commit` over the result. Writing a route here as well would give the two a chance to
disagree, which is exactly the failure `makeConnection` exists to prevent between the tool and
the router.

It also leaves `routing` alone. A hand-drawn route survives its ends being moved; that is the
case `patchStart` / `patchEnd` were written for.

Two drops are refused by returning `s` **by reference**, which renders as the bead simply not
following the cursor:

- **Over nothing.** A connection has no representable free end, so there is nothing to show.
- **Over the block at the other end.** Letting this through would preview a route the router
  would drive straight through the block — it does no obstacle avoidance — and then
  `normalize` would return null on release and the whole drag would silently revert. Refusing
  early turns a disappearing gesture into one that visibly does not take.

### 3.5 The beads are the connect tool's bead

Same radius, same two colours, and for the same reason: both mean "this is where the line
attaches". They can never be on screen together — `setTool` runs the connect tool's `#reset`,
which drops its hover — so there is no ambiguity to resolve.

They are drawn by `connOps.draw`, not by the select tool's overlay, which paints a square at
`Handle.pos` for every `visible` handle. Both ends go into one path, so the pair costs two
canvas primitives whatever the route looks like: a selected connection is six, an unselected one
still two.

---

## 4. Defects this iteration, and what they teach

### 4.1 Every saved `auto` connection was loading back as `manual`

`hydrateShape` walks `props` in order. Under the declaration order that was `routing` (index 5)
then `points` (index 6) — and the `points` writer forces `routing: 'manual'`. So
`serializeScene(deserializeScene(doc))` did not round-trip for a connection: every auto route in
a saved file came back pinned, silently, and the next block move would patch its ends instead of
re-routing it.

Nothing caught it. `verify/properties.mjs`'s round-trip assertion is over a scene of blocks, and
`deserializeScene` has no call site in `src/` at all — it is reached only from the checks.

The reorder fixes it as a side effect, because `points` < `routing`. That is a coincidence, and
coincidences are not a test, so the fix is now pinned by an assertion in the connections suite
that hydrates a real connection and asserts the routing it recorded. Confirmed by making
`orderProps` a no-op and watching it fail.

**What it teaches:** a writer with a side effect on another property is order-dependent by
construction, and a round trip asserted over one shape kind is not asserted at all.

### 4.2 The splitter reported a minimum above its maximum

`aria-valuemin` was `docsFloor` unclamped. Where the documentation cannot fit at all — a short
pane, or a user who has scaled their fonts up — the floor exceeds the ceiling, and the separator
published `min > max` with `now` below both. Fixed by capping the reported floor at `docsMax`,
and pinned with an assertion that drives the root font to 40px and checks
`valuemin <= valuenow <= valuemax`.

That assertion also surfaced a second, smaller divergence: the footer's CSS cap was
`calc(100% - 5rem)` where `MIN_EDITOR` is the pixel constant `80`. Identical at a 16px root and
not otherwise, which made the rendered height stop disagreeing with the height the script had
computed and published. Both are now `80px`.

### 4.3 The beads inherited their line width from the block above them

The bead path never set `ctx.lineWidth`; it worked only because the segment-knob loop
immediately above it sets one inside the same `if`. Extract or reorder that loop and the rings
would silently fatten to the route's own stroke width. Now set explicitly.

The beads also re-project and re-align their centres against the ring's width instead of reusing
`dev`, which is aligned against the much thicker route stroke — at dpr 2 that is an odd width
against an even one, so the ring landed on half pixels and read as soft. Half a device pixel of
offset from the line's end is not visible; a blurred ring is.

### 4.4 A browser check that imports a module by URL may get a second copy of it

The first draft of the handle assertions did
`await import('/src/lib/scene/registry.ts')` and got `no ShapeOps registered for kind: conn`.
Vite appends `?t=` to a module's URL once it has been invalidated, so the app was holding a
different instance of the same file — with the populated registry — and the bare specifier
minted an empty one.

The shape of the trap: it only bites modules with **module-level state**, and only after an edit
during the session, so it passes on a cold server and fails later. `serialize.ts` has no such
state, which is why the existing round-trip check has never hit it.

Fixed by exposing `window.__handles(name)` from the DEV block, reached through the session, in
the same spirit as `__anchor` and `__grid`. Worth exposing anyway: the **order** of that list is
load-bearing — `hitTest` takes the first match, which is what puts an end bead ahead of the
segment leaving it — and nothing else could assert it.

---

## 5. Flagged for future work

- **An endpoint dragged deep into a block jumps to a face midpoint.** `anchorAt` collapses to
  the midpoint past `ANCHOR_BAND_PX` on purpose: nearest-face is ambiguous and jumpy in there,
  and it makes "drop it on that block" a stable gesture. As a drag it is visible as a jump. It
  is the right default; a modifier to keep the current face would be the refinement.
- **Re-binding a manual route stretches it rather than redrawing it.** `patchStart`/`patchEnd`
  are rectilinear by construction for any route of three or more points, so the fallback
  re-route never fires and the hand-drawn shape survives as a long dog-leg to the new block.
  Correct by the iter-4 rule that a pinned route is the user's, but it may be worth offering to
  re-route on a cross-block rebind specifically.
- **`docsWanted` is still capped at the current `docsMax` on write**, so a drag performed inside
  a temporarily short pane lowers the stored preference for good. Arguably right — the user did
  drag — but it is the one place the wish is not purely the user's.
- **The panel has no per-kind ordering escape hatch.** If some future kind wants a curated order,
  `propSchema` is the one place to add one.

---

## 6. Conventions and gotchas

- **Put a new property anywhere in the array.** `propSchema` sorts it. The array's order is a
  reading convenience now, nothing more.
- **A writer that touches another property is order-dependent.** Say so in its `doc` string —
  which is user-facing panel text, not a comment — and remember the alphabetically later key
  wins.
- **`rebind` and `reroute` share the return-`s`-by-reference contract**, for the same reason:
  `commit` decides whether to record history by comparing array identity, and `SelectTool`
  decides whether to commit at all by comparing fingerprints.
- **Count `arc`, not `rect`, when asserting on connection beads.** `CanvasRenderingContext2D`'s
  prototype is shared with the dot grid's strip cache and the timeline, both of which call
  `rect`. Nothing else on the diagram canvas calls `arc`.
- **Do not run `npm run verify` while anything under `src/` is being written.** An HMR full
  reload mid-suite wipes the scene the suite built, and the failure looks like a product bug.
- **`npm run verify` cannot vouch for `verify/production.mjs`.** It needs
  `npm run build && npm run preview` on :4183, and it is the only check that asserts the panel's
  row order against the shipped bundle.

---

## 7. How iteration 4.1 was verified

`npm run check` clean — 477 files, 0 errors, 0 warnings. `npm run verify` is 247 assertions
across six suites, all passing: grid 61, input 9, properties 38, connections 77, docking 18,
trace 44. `npm run build` then `verify/production.mjs` on the preview server: 15 passing.
`npx prettier --check src verify README.md history` clean.

New assertions, and what each is there to stop:

| Assertion                                                    | The regression it catches                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| the saved record's key array (connections)                   | the canonical order silently reverting to declaration order       |
| the panel's row order against the production bundle          | the same, in the one place `npm run verify` cannot see            |
| a scene with connections round-trips exactly                 | §4.1, in general                                                  |
| an auto route comes back auto                                | §4.1, specifically — the assertion that fails if the order moves  |
| documentation is sized to its text unasked                   | the floor being dropped back to a constant                        |
| it cannot be dragged shorter than its text                   | the floor being applied only on selection, not on drag            |
| a size the user asked for survives a shorter string          | someone "simplifying" the two numbers back into one               |
| but a floor does not ratchet                                 | the same simplification, from the other direction                 |
| documentation with nowhere to fit scrolls                    | the floor winning over the ceiling and starving the tree          |
| the splitter reports a range AT can act on                   | §4.2                                                              |
| one rebind handle per end, ahead of every segment handle     | the beads being appended and losing the hit test at the anchors   |
| the beads sit exactly on the anchors                         | drawing them somewhere the drag cannot start                      |
| dragging a bead slides the anchor, without pinning the route | the press landing on the segment handle underneath instead        |
| dragging an end onto the other end's block is refused        | §3.4 — the disappearing gesture                                   |
| dropping one in open space commits nothing                   | a null target being written through as an unbound end             |
| dragging it onto another block moves the arrowhead           | the whole feature                                                 |
| exactly two beads when selected, none when not               | the affordance appearing on unselected connections, or not at all |
