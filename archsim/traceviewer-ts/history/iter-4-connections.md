# Iteration 4 — Connections

2026-09-22. Complete, and **extended the same day by
[iteration 4.1](./iter-4-1-panel-and-endpoints.md)**, which makes a connection's endpoints
draggable. That adds a fifth row to §2's table of gaps in the shape contract, and grows
`verify/connections.mjs` from the 64 assertions §9 inventories to 77. The counts here are
iteration 4's; the current ones are in the README.

Adds a second shape kind and a third tool; changes no existing mutation path.

Read [iter-1-canvas-foundation.md](./iter-1-canvas-foundation.md) §5 and
[iter-2-docking-and-properties.md](./iter-2-docking-and-properties.md) §3 first — the shape
contract, the property grammar and the naming-is-identity decision all come from there and are
not repeated here. The performance rules in
[iter-3-1-render-performance.md](./iter-3-1-render-performance.md) §8 still hold in full; §5.2
below is written against them.

---

## 1. Scope

**Changed.** A `conn` shape kind ([conn.ts](../src/lib/scene/shapes/conn.ts),
[conn.props.ts](../src/lib/scene/shapes/conn.props.ts)); a pure router
([route.ts](../src/lib/scene/route.ts)); the dependency pass lifted out of the store
([resolve.ts](../src/lib/scene/resolve.ts)); perimeter anchors on the rect
([rect.ts](../src/lib/scene/shapes/rect.ts)); a connect tool
([connect-tool.ts](../src/lib/tools/connect-tool.ts)); `anchorHitTest`
([hit.ts](../src/lib/canvas/hit.ts)); an `onPointerLeave` hook and registry-driven tool
shortcuts.

**Deliberately not changed.** The file format — `SceneDoc.version` is still `2`, because a
record was always a property bag keyed by `kind`, so a new kind is new data in the same format.
Serialization, the property panel, the JSON Schema generator, `zorder.ts`, the renderer's draw
loop and every existing tool behaviour are untouched.

**Verification surface.** `verify/connections.mjs`, 64 assertions. Suite total 158 → 231 across
six suites. No new dependencies.

---

## 2. The acceptance bar this iteration was set against

iter-1 §5.1 said: _"Adding a connection kind should require no change to any existing mutation
path. If it does, that is a design bug worth fixing rather than working around."_ That held.
`commit`, `previewShapes`, `replaceShape`, `undo`, `redo`, `serializeScene` and `deserializeScene`
are byte-identical.

What the reserved seams did **not** cover, and had to be added:

| Gap                          | Why the original design missed it                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchorAt` / `resolveAnchor` | `anchors()` returns a fixed list. That is enough to _terminate_ on a block but not to _pick_ a point on one, and the four midpoints cannot express "where the user pointed". |
| `corridors`                  | Nothing anticipated bundling, which needs to ask a shape which of its runs are worth joining.                                                                                |
| `RouteContext` on `reroute`  | `reroute(s, deps)` can see its endpoints but not its neighbours, so it could re-route but never bundle.                                                                      |
| `Tool.onPointerLeave`        | No tool had ever drawn hover-only decoration, so nothing needed to know the pointer had left.                                                                                |

All four are additive and optional. The first three are `ShapeOps` methods a kind may omit;
`reroute`'s third argument is safe to make required because nothing implemented it.

---

## 3. Decisions that came from the user

| Decision                                                                | Note                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The router may spend a third segment, but only when it buys something   | The ghost and the common case stay 1–2 segments. §4.1 explains why a strict cap makes bundling impossible rather than merely worse. |
| A hand-edited route is pinned; a later block move patches only its ends | With `routing` exposed as a property, so setting it back to `auto` is the escape hatch.                                             |
| Bundled lines overlap exactly                                           | Rejected: offset lanes. §4.4.                                                                                                       |
| The anchor dot slides along the edge, grid-snapped                      | Rejected: the four fixed midpoints, and a free unsnapped point. §4.3.                                                               |

---

## 4. Load-bearing decisions

### 4.1 A 1–2 segment router cannot bundle, so the cap is 3

An L's corner is at `(B.x, A.y)` or `(A.x, B.y)` — **fully determined by its two endpoints**.
There is no free parameter, so there is nothing to snap onto a corridor, and two lines can only
ever share a run by coincidence. Bundling needs a Z, whose middle coordinate is free.

The second argument is independent of bundling: two anchors facing each other with any vertical
offset have no 2-segment route that both leaves along the source normal and arrives into the
target face. One of the two ends is always entered through the back of the block, with the
arrowhead pointing out of it.

The cap is 3 and not "as many as it takes". A router that may spend segments freely needs
obstacle avoidance to justify them, and that is a much larger algorithm than this iteration is.

### 4.2 The router scores candidates rather than following rules

`routeConnection` generates every straight, L and Z candidate and takes the argmin of a weighted
cost. That is more machinery than a rule ladder, and the reason is that four requirements —
short, few segments, leaves along the face normal, bundled onto its neighbours — are in direct
conflict, and a ladder has to pick a fixed precedence between them. Scoring lets the precedence
fall out of the weights, which can then be _argued about_ rather than tuned.

The weights are chosen so the resulting behaviour is provable. The key observation is that for
two fixed endpoints **every L and every in-span Z has identical Manhattan length**, so length
does not discriminate between them at all and only penalises elbows outside the span. Within the
span the whole contest is `W_SEGMENT` (2) against `BUNDLE_BONUS` (6) against
`W_MIDPREF · |m − mid|` (0.25 per cell). Therefore:

| Situation                                          | Outcome                                          |        Margin |
| -------------------------------------------------- | ------------------------------------------------ | ------------: |
| No corridor nearby                                 | The L wins — routes are 1–2 segments by default  |             2 |
| A corridor within 24 cells of the natural midpoint | The Z wins — lines bundle                        |       up to 4 |
| A corridor far away, or out of span                | Loses on length — no absurd detours              | 2 × overshoot |
| Any route violating a face normal                  | Never wins — bundling cannot buy an ugly arrival |  25 or 10 000 |

`BUNDLE_REACH` is derived from that table rather than picked: past `BUNDLE_BONUS / W_MIDPREF`
cells, a corridor candidate cannot win, so generating it would be waste.

The normal penalty is **two-tiered**, and that is what makes the head-to-head case work. "Through"
(10 000) is the line diving into the block it just left or arriving through the far side of its
target — visibly broken. "Off-axis" (25) is leaving along the face, which is merely ugly. With
one tier, two anchors facing away from each other have no legal route at all and the router picks
arbitrarily; with two, it reliably goes _around_.

`W_INDEX` exists so the argmin is a deterministic function of the input rather than of `Set`
iteration order. Verified by routing the same input twice and comparing element-wise.

### 4.3 An anchor is an edge and an offset, not a point and not a slot

Stored as `<side>:<offset>` — `e:48` — with the offset grid-snapped at pick time and measured
from the face's start corner.

Rejected: **the four midpoints**, because every connection on a side stacks onto one point.
Rejected: **an unsnapped perimeter point**, because anchors that do not land on the grid do not
line up with each other, which quietly undermines bundling at the ends.

Two details are load-bearing. First, the id stores the offset **as authored, clamped only at
resolve time**, so shrinking a block below an anchor and growing it back puts the connection
where the user left it rather than where the small version of the block happened to end. Second,
`anchorAt` collapses to the face midpoint once the cursor is more than `ANCHOR_BAND_PX` inside
the block: near the outline the nearest face is obvious, but deep inside it is ambiguous and a
pixel of drift flips the bead to another side. Collapsing makes "click the middle of the target
block" a stable gesture rather than a lottery.

### 4.4 Bundled lines overlap exactly

Rejected: offset lanes. A lane index has to be stable under insertion _and_ deletion, and with
the z-order fold (§4.5) the index is position-in-fold — so deleting the lowest line of a bundle
re-lanes every line above it, which is visible churn on an unrelated delete.

The honest cost: two connections with _identical_ anchor pairs draw identically, and `hitTest`
returns only the topmost, so the lower one cannot be picked on the canvas. It is still reachable
by name, by marquee and in the property panel. That is a degenerate authoring choice, and lanes
are the principled fix if it ever bites.

### 4.5 The reroute pass is a left fold over the z-order

`rerouteAll` walks bottom-up accumulating a `CorridorIndex`, so **a connection may bundle only
onto runs owned by connections below it**. No shape can observe its own output: the pass is
well-founded, settles in one sweep, and has no order in which two connections can chase each
other's corridors forever.

The alternative — every connection sees every other — is a fixed point with no guarantee of one,
and the failure mode is a scene that re-routes differently on every commit.

The price is that restacking a connection can change its route. That is visible and explainable,
and it is written into the doc comment so nobody "fixes" it by feeding the fold its own results.

`CorridorQuery` is an interface with four query methods and no array, because the index is
mutated _after_ each `reroute` returns. A shape that retained the instance would observe geometry
that did not exist when it was built; query-only makes that impossible to do by accident.

### 4.6 The ghost is a plain field, not `scene.draft`

`RectTool` previews through `scene.setDraft`, and `ConnectTool` deliberately does not.

`draft` is `$state.raw` and the canvas repaint effect reads it, so assigning it per `pointermove`
is a reactive write at input frequency — the exact cost iteration 3.2 measured and removed for
`host.pointer`. Painting from `drawOverlay` instead is visually identical (the overlay runs
immediately before the draft would) and touches no signal.

There is a second, sharper reason. `SceneStore.commit()` nulls `draft` on its way past. Any
commit landing while a connection is pending would erase a ghost the tool still believed it
owned. A plain field cannot desync from the tool's own state machine.

On top of that the tool compares routes before repainting, so with the free end snapped the ghost
is rebuilt roughly once per grid cell crossed rather than once per move.

### 4.7 Connections re-route inside the drag preview

`previewShapes` deliberately skips history, bounds and the camera — and therefore
`#resolveDependencies`. Without an explicit call, every connection would trail a cell behind its
block for the whole drag and snap into place only on release. `SelectTool` now wraps both preview
branches in `rerouteAll`, which early-returns when no kind has dependencies, so a rect-only scene
pays one function call.

This is the one edit to an existing tool, and it is why `resolve.ts` is a pure module rather than
a private method: the select tool needs the reroute half with no commit to hang it off.

---

## 5. Defects this iteration, and what they teach

### 5.1 The dependency pass would have made every commit undoable

`#resolveDependencies` ended in `this.shapes = current.map(...)`, which allocates unconditionally.
It had never run, because `registryHasDependencies()` was false until a kind implemented
`dependsOn`. `commit` decides whether to push a history entry by comparing `this.shapes !== before`.

So **registering the connection kind would have made every commit in the application push an undo
entry — including ones that changed nothing, in a scene containing no connections at all.** The
undo stack would have filled with no-ops and `Cmd+Z` would have appeared to do nothing, in a code
path with no connection anywhere near it.

Three things together fix it: `rerouteAll` copies on first write, `#resolveDependencies` guards
the assignment with `!==`, and `ShapeOps.reroute`'s contract now _requires_ returning `s` by
reference when nothing changed. One assertion exists purely to pin it, and it is the most
important one in the new suite.

The lesson is narrower than "test your code": a seam that has never executed has never been
tested either, and the commit that first executes it is the commit that inherits every latent bug
in it. Scaffolding is not verified by compiling.

### 5.2 Excluding the source block turned a refusal into a silent cancel

The tool originally passed the pending source to `anchorHitTest` as a shape to exclude, so a
self-connection could not be picked. But a click-click tool has to treat a click on nothing as
"never mind" — so excluding the source meant clicking it **cancelled the whole gesture** instead
of refusing, and the explanatory `#finish` check was unreachable.

Fixed by deleting the exclusion entirely: hit-testing reports what is actually under the cursor,
and refusing a self-connection belongs in the tool, at the point where it can say why. The ghost
separately declines to preview a route into the source, so it never advertises something that
will be refused.

The lesson: "prevent the bad state by hiding the input" and "explain why the input is bad" are
different behaviours, and hiding is the one that produces unexplained UI.

### 5.3 Two test defects worth recording, because both would have passed silently

The first draft of `verify/connections.mjs` hard-coded canvas coordinates. Every commit
re-derives the world bounds and re-clamps the camera, so a coordinate written before a commit
points somewhere else after one — which is the rule `verify/README.md` already states. The check
now derives every screen point from live geometry via `view.toScreen`, and searches for a
genuinely empty spot rather than assuming a fraction of the viewport is one.

The second: a cull check injected a hand-made route with `routing: 'manual'`, which `reroute`
promptly re-anchored to the real blocks — so the camera was parked where the connection no longer
was, and the check reported a culling bug that did not exist. Assertions against a scene have to
survive the machinery that owns that scene.

---

## 6. Scaffolding left for future iterations

Do not remove these as dead code.

- **`rectOps.anchors()`** is still unconsumed. It is the discrete sibling of `anchorAt` and is
  what a "show all attachment points" affordance, or a non-rectangular kind, would build on.
- **`appendRoutePath`** is split out of `connOps.draw` so a future renderer layer can batch every
  unselected connection into one `beginPath`/`stroke`. The layer is not built; the seam is.
- **`CorridorQuery`** is an interface, not the class, so `CorridorIndex` can be replaced with a
  bucketed implementation without touching any shape.
- **`RouteContext`** is a record with one field so more routing inputs can be added additively.
- **`snap(v, step)`** still takes its step as a parameter. Per-axis routing grids remain unbuilt.
- **`ROUTE_MAX_SEGMENTS`** is a named constant the cost function reads, so raising the cap is one
  edit plus new candidate generators.

---

## 7. Flagged for future work

Ordered by how likely each is to bite.

1. **Self-connections are refused outright.** The router does no obstacle avoidance, so a
   same-block route would cut straight through the block. Supporting them means one dedicated
   loop case in the router.
2. **No obstacle avoidance at all.** A route between two distant blocks will happily cross a
   third. This is the single largest gap, and the reason the segment cap is defensible: the user
   is expected to hand-route around obstructions, which pins the connection.
3. **Two connections with identical anchor pairs are indistinguishable** and only the topmost is
   selectable on the canvas. §4.4.
4. **Head-to-head anchors facing away** get a route that leaves along the face rather than across
   it — correct and rectilinear, but not what a person would draw. The fix is a ≥5-segment U.
5. **A pinned route falls back to a full re-route** when patching its ends would leave it
   non-rectilinear, which silently discards that edit. It keeps the `manual` flag, so later edits
   survive.
6. **`StatusBar`'s draft readout is rect-only.** Harmless — the connect tool never sets a draft —
   but a connection draft would show no readout if one were ever introduced.
7. **Corridor insertion is O(n) per run.** Irrelevant below a few thousand corridors; §4.5 notes
   the drop-in replacement.

---

## 8. Conventions and gotchas

- **A `reroute` that always allocates is a correctness bug, not a slow path.** §5.1. The same
  applies to anything else `commit` calls: array identity is the history signal.
- **Every function in `route.ts` returns its input reference when nothing changed.** That is the
  property the above relies on, and it is why `collapseRoute` builds into a scratch array and
  then discards it if it matches.
- **`bounds` must cover everything `draw` paints.** The renderer culls on it. The arrowhead and
  knobs are sized in _screen_ pixels and cannot be expressed in `bounds`; they are covered by the
  renderer's existing 16-CSS-px cull margin, which always exceeds them.
- **A horizontal connection has a zero-height bounding box.** `rectsIntersect` compares
  inclusively, so this works — but it is worth knowing before anyone "fixes" a degenerate rect.
- **Restore `lineJoin`.** `connOps.draw` sets it to `'round'`, and `rect.ts` strokes with
  `strokeRect`, whose corners honour it. Leaving it round softens every block drawn afterwards —
  a cross-shape rendering bug with no local symptom.
- **Tool instances are cached for the session.** Any tool holding state across pointer-up must
  clear it in `onActivate`, `onDeactivate` and `onPointerCancel` (which also fires on window blur
  and `visibilitychange`). `ConnectTool` funnels all four into one `#reset()`.
- **`isGesturing()` spanning two clicks disables undo, delete and restack.** That is correct —
  each would commit underneath a half-built connection — but it makes `Cmd+Z` a dead key, so the
  tool intercepts it and cancels instead. A tool that blocks a command should provide the
  cancel path for it.
- **Tool shortcuts now come from `ToolDescriptor.shortcut`**, not a switch in `ToolHost`. The old
  switch meant the toolbar could advertise a key that did nothing.
- **Do not hard-code canvas coordinates in a check.** Restated from iter-3 because this iteration
  broke it again. §5.3.

---

## 9. How iteration 4 was verified

`npm run check` clean. `npm run verify` is 231 assertions across six suites, all passing;
`npm run build` plus `verify/production.mjs` (15 assertions) confirms the kind and tool register
correctly in a production build, where the registries throw on duplicates rather than replacing.

`verify/connections.mjs` is 64 assertions in five groups, split by what they need rather than by
what they cover:

| Group  | Needs                                         | Covers                                                                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R (18) | nothing — pure functions via `window.__route` | 200 seeded-random routes for rectilinearity, endpoint fidelity, no degenerate points and the segment cap; the L/Z choice; bundling in range and _not_ out of range; determinism; corridor filtering; `collapseRoute` identity; segment moves and end patches; head-to-head                                                                          |
| A (9)  | `window.__anchor`                             | side and normal, grid snapping, the deep-inside midpoint collapse, out-of-range null, id round trip, corner determinism, clamp-and-restore under resize                                                                                                                                                                                             |
| S (8)  | the store                                     | the no-op-commit guard, rename propagation, cascade delete restored by one undo, the saved record's keys, format version                                                                                                                                                                                                                            |
| I (24) | a real pointer                                | the shortcut, hover on and off a perimeter, the pending state, the ghost never touching `draft`, refusal of a self-connection, `Cmd+Z` cancelling, ghost-equals-commit, Escape twice, cancel into open space, live reroute during a drag, segment drag pinning to manual with fixed anchors, a no-op drag committing nothing, and `auto` re-routing |
| V (5)  | a real frame                                  | zero `save`/`restore`, one stroke and one fill per connection, no canvas state left behind, and the `bounds` cull with both endpoints off screen                                                                                                                                                                                                    |

Two assertions are worth calling out as the ones that would catch a regression nothing else
would. **"A no-op commit records no history entry"** is §5.1, and it guards code that has nothing
to do with connections. **"The committed route is the ghost, not a second opinion of it"** is what
keeps `ConnectTool` and `reroute` sharing one definition of a route; the day they diverge, the
line will visibly jump on the second click, and this is the only check that would say why.

The moral, extending the series: compiling is not running, running is not looking, looking at the
script is not looking at the frame — and a seam that has never executed has never been tested.
