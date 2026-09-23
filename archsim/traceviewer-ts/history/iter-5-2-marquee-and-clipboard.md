# Iteration 5-2 — selecting a group, and copying one

2026-09-23. Complete. Two features that turn out to be one: a marquee makes a multi-selection
worth having, and a clipboard is the first thing you want once you have one.

Read [iter-4-connections.md](./iter-4-connections.md) §1 for why a connection's identity is its
endpoints' names, and [iter-5-ux-polish.md](./iter-5-ux-polish.md) §3.2 for the seam-not-switch
rule this iteration applies twice more.

---

## 1. Scope

Four of the six things asked for already existed, and saying so is half the iteration:
`ToolDescriptor.shortcut` already drove the digit keys off the declaration, `Toolbar.svelte`
already rendered `label (shortcut)` as its `title`, the select tool already dragged a whole
multi-selection, and `Shift`+click already toggled. What was missing was a way to _make_ a
multi-selection without clicking every member, and any way at all to duplicate one.

**Changed.**

- A fourth tool, `marquee` on `4` ([tools/marquee-tool.ts](../src/lib/tools/marquee-tool.ts)).
  §3.1.
- A new `ShapeOps.intersects` seam, with `shapesInRect` beside `unionBounds`
  ([scene/bounds.ts](../src/lib/scene/bounds.ts)). §3.2.
- `segmentIntersectsRect` in [geom/math.ts](../src/lib/geom/math.ts), Liang–Barsky.
- A clipboard whose payload is a real `SceneDoc`
  ([scene/fragment.ts](../src/lib/scene/fragment.ts)), with `copySelection` / `cutSelection` /
  `paste` on `ToolHost` bound to `Cmd+C` / `Cmd+X` / `Cmd+V`. §3.3–§3.6.
- `nextFreeIndexedName` in [scene/names.ts](../src/lib/scene/names.ts), so a copy is named for
  the series it came from. §3.4.
- `deleteSelection` splits into `#deleteIds(ids, label)`, so cut and delete differ only in the
  word the undo menu shows.
- Two `Theme` keys, `marqueeStroke` and `marqueeFill`.

**Deliberately not changed.** `SceneDoc.version` is still `2` — nothing about the format moved,
which is the point of reusing it. No property was added, so the canonical key order did not
shift and `verify/production.mjs` needed no edit. `Ctrl`/`Cmd`+click was asked for and then
withdrawn: `Shift`+click already does it, and a second modifier for one behaviour is a thing to
explain rather than a thing to learn. The arrow tool is untouched, so dragging empty space
still pans.

**Verification surface.** 290 → 317 assertions, in a new seventh suite `verify/selection.mjs`,
plus one harness helper `marqueeSelect` and three DEV hooks (`__fragment`, `__names`,
`__bounds`) so the rename rules can be driven without a pointer.

---

## 2. Decisions that came from the user

- **The marquee is its own tool, not a gesture on the arrow.** Offered both; this one was
  chosen, and it is the reason nothing about panning had to change. §3.1.
- **Paste centres under the pointer**, falling back to a cascading grid step when the pointer
  is elsewhere.
- **A connection is copied only when both of its blocks are**, and is re-pointed at the copies.
- **A copy fills the gaps in its own numbering** — `block0, block2, block4, block6` pastes as
  `block1, block3, block5, block7`. Asked for by example, which turned out to be worth more
  than a rule would have been: the example is now the assertion. §3.4.
- **`Ctrl`/`Cmd`+click was withdrawn** once it was clear `Shift` already did it.

---

## 3. Load-bearing decisions

### 3.1 A region tool cannot share a gesture with panning

On this canvas, dragging empty space pans. That is the primary pan gesture, documented in the
controls table and relied on by every existing suite — not a fallback behind a modifier. A
marquee wants exactly the same gesture, and there is no way to give it to both.

Making the band a separate tool is what makes the question disappear rather than be decided.
The arrow tool keeps every gesture it had, and the marquee owns press-drag-release
unconditionally: it does not hit-test on the way down, because a region tool treats a press on
a block exactly like a press on empty space.

The registration is three lines and the toolbar button, the `4` key and the `Marquee select (4)`
tooltip all followed with no further wiring — which is the claim README's "Adding a tool" makes,
collected. The one non-obvious part: `allTools()` returns registry insertion order, so the
button's position in the toolbar is decided by where the import sits in `register.ts`.

Two departures from house style, both deliberate:

- **The band is built from `p.world`, not `p.snapped`.** Every other gesture snaps because it
  commits geometry. A selection region commits none, and snapping it would make the band jump a
  whole cell at low zoom while the shapes it is meant to catch stay exactly where they are.
- **Releasing commits nothing.** Selection is not history anywhere in this app — `selectAll`
  and `toggleSelected` push no entry either — so the band has nothing to commit on pointer-up.

`isGesturing()` is still true while banding, so undo, redo and delete are refused mid-band like
every other gesture, and `Escape` restores the selection the press found rather than leaving a
half-swept one behind.

### 3.2 A bounding box is the wrong shape for a wire

The obvious `shapesInRect` tests each shape's `bounds`. For a block that is exact. For a
connection it is badly wrong: `connOps.bounds` is the box around the whole route, so an
L-shaped wire's box is mostly empty, and a band dropped in the empty corner would select a wire
it visibly never crossed.

So `intersects` is an optional `ShapeOps` seam with a `bounds` fallback, and `conn` implements
it by testing the band against each run. This is iteration 5 §3.2's reasoning a second time —
the question "does this shape overlap that box" is per-kind, so it is a seam, and nothing
outside a shape's own file learns what a `conn` is.

The primitive underneath is `segmentIntersectsRect`, Liang–Barsky slab clipping rather than four
edge-vs-edge tests: it needs no special case for a segment lying entirely inside the rectangle,
and it degenerates correctly to a point-in-rect test when the two endpoints coincide.

**Overlap, not containment.** The word used in the request was "within", and this is the one
place the implementation does not take it literally. A connection is a few pixels thick; a band
that had to _enclose_ one would have to enclose its whole bounding box, which for the L-shaped
case is most of the diagram. Intersect is also what every comparable editor does. One line in
`shapesInRect` if that judgement is ever wrong.

The tab is excluded from `rectOps.intersects`, for the same reason `bounds` excludes it: the tab
is screen-sized, and this signature has no `worldPerPx`, so including it would make the band's
answer depend on the zoom it happened to be drawn at.

### 3.3 The clipboard is the file format, and paste is "load, then rename"

`serializeScene` already produces a `SceneDoc` and `deserializeScene` already reads one. The
clipboard holds exactly that — there is no second format, and the thing you copy is the thing
the file format describes.

Copy is one predicate: keep the selected shapes, then `pruneOrphans`. A connection whose block
was not selected is simply absent from the sub-array, so it _is_ an orphan — the rule the user
asked for falls out of a function that already existed, settles cascades to a fixed point, and
stays kind-agnostic.

Paste had a choice worth recording. The endpoints of a connection are stored on disk as
`source: [block, anchor]` and `target: [block, anchor]`, which are conn-specific keys. Rewriting
those in the serialized records before loading would have meant declaring, per kind, which keys
hold names — a second reference seam, expressed over the serialized form, free to drift from the
`renameRef` one that already exists.

So paste deserializes **first**, under the fragment's original names, and renames afterwards
through `renameRef`. That works because `deserializeScene`'s `PropContext` holds only the
records already loaded, so a connection naming a block from its own fragment finds it — even
when that name is also taken in the live scene. Paste is then literally "load, then N renames",
which is what `SceneStore.replaceShape` has always done for one.

**The trap, stated because it is the obvious one-line fix:** do not teach `deserializeScene` to
seed its `taken` set with the live names. The blocks would load renamed while the connection
bags still named the old ones, `checkEndpoint` would fail, the write would be skipped, and every
pasted wire would vanish — through all three swallow layers, with nothing raised anywhere.

### 3.4 A copy should be named for the series it came from

`uniqueName` could not do what was asked, and the reason is a regex: `SUFFIXED` is
`/^(.*?)_(\d+)$/`, so it only recognises an underscore-separated counter. `block0` does not
parse as `block` + `0`, and a copy would have been `block0_2`.

`nextFreeIndexedName` is a second function rather than a smarter first one — the same call the
enum dropdown made in iteration 5 §6. They answer different questions: `uniqueName` repairs a
duplicate _inside_ one document, this one names a copy.

The rule is "the lowest free number at or above the copied one". The discarded alternative was
"the lowest free number for that prefix", which reproduces the worked example just as well and
then fails badly on a real scene: with `block0` and `block999` present, a copy of `block999`
becomes **`block1`** — free, lowest, and a completely different block as far as anyone reading
the diagram is concerned. Probing upward from the copied number is one character of difference
and is the whole of the correctness.

Two consequences worth knowing. Membership is tested on the formatted _string_, never on the
number, so zero padding stays cosmetic and `block7` and `block07` cannot collide —
`block007` copies to `block008`. And a digit run too long to be a safe integer falls back to
`uniqueName`, because `n + 1` on a float past 2^53 is `n` and the loop would never terminate;
names come off disk, so that is reachable.

The rule improves the generated names for free: `block_2` parses as `block_` + `2`, so a copy is
`block_4` rather than `block_2_2`.

### 3.5 The rename that wires both ends to one block

This is the defect this iteration existed to not ship, and it is silent in every layer that
would normally catch something.

Mint names against the live scene only. Copy `block0` and `block1` from a scene where only
`block0` is still present. `block0` collides, so it mints `block1` — free in the _scene_, and
also the name of the other, still-unrenamed shape in the same fragment. Then apply the map
through `renameRef` one entry at a time:

1. `block0 → block1` rewrites the connection's `from` to `block1`.
2. `block1 → block2` then matches **both** ends and rewrites the one just written.

The result is `from === to === block2`. `pruneOrphans` cannot help: both dependencies resolve,
because that block genuinely exists. `rerouteAll` happily routes a self-connection. The scene
ends up holding a shape `connOps.normalize` explicitly says cannot exist, and nothing anywhere
throws.

The fix is in the minting, not the renaming. Reserve `live ∪ every original name in the
fragment` before minting, and skip minting entirely for a shape whose name is not live. No
minted name can then equal an un-renamed original, so the sequential sweep is order-independent
and `renameRef` stays exactly as it was.

Skipping the mint for a free name is not just an optimisation: it is what makes paste into an
unrelated document preserve its names, and what makes cut-then-paste restore the originals
exactly — the cut names are no longer live, so the fragment keeps them. Both are asserted.

**The general rule:** a rename map applied one entry at a time is only safe if its values are
disjoint from its un-renamed keys. Any future bulk rename needs the same reservation.

### 3.6 One vector for the whole fragment

Paste centres the fragment's `unionBounds` under the pointer, and the **delta** is what gets
snapped — never the shapes afterwards.

Snapping each shape after translating would move different shapes by different amounts and
shear the fragment. The visible casualty is a `manual` route: its `points` would no longer sit
on its own blocks' anchors, so `patchStart`/`patchEnd` would drag the first and last runs to
compensate and the route would arrive bent. With one integer delta for everything, the new
anchor is `old + d` and `points[0]` is `old + d`, both patches hit their `samePoint` early-outs,
and `reroute` returns the shape by reference. A pasted manual route is congruent to its
original, and `verify/selection.mjs` asserts exactly that — every point differing by the same
vector.

The cascade for repeat pastes is keyed on the pointer position rather than applied every time:
two pastes at two different places should each land where they were asked to, and it is only a
repeat at one unmoved pointer that would otherwise stack an exact, invisible overlap.

`host.pointer` is already snapped and is null off-canvas, before the first move, and after
`onPointerLeave`. All three mean "no anchor to centre on", which is the fallback branch.

---

## 4. What looking at it caught that the suites did not

**4.1 An assertion that could not fail.** The first cut check read
`scene.history.undoLabel` _after_ the paste that followed it, so it could only ever see
`paste` — and it was written as `typeof label === 'string'`, which is true of `'paste'`. It
passed, and it was checking nothing. Reading the label immediately after the cut, and comparing
it to `'cut'`, is the difference between a check and a shrug. Same lesson as iteration 5 §4.2,
from the other direction: there, a real signal was being loosened into a tolerance; here, a
check had already been loosened into a tautology.

**4.2 Three assertions that were testing the camera, not the feature.** The first band group
swept hard-coded canvas coordinates — the same ones the blocks had been drawn at. Every group
opens with `zoomToFit`, which moves the pan _and_ the zoom, so by the time the band was swept
the blocks were somewhere else and it caught one of the two it was aimed at. The fix is
`bandOver(indices)`, which projects the live shapes through the live camera. Iteration 5 §4.3
said to reset the camera at the head of a group; the other half of that rule is that anything
computed _before_ the reset is stale, and a drawn-at coordinate is exactly that.

**4.3 A guarantee asserted in the wrong place.** A check that a document with its wire ahead of
its blocks "still loses nothing" failed, correctly: `readFragment` does not repair record order,
by design, because reordering raw bags needs the kind knowledge §3.3 exists to avoid. The
guarantee actually made is that `copyFragment` _emits_ dependency order, so the assertion now
copies from a deliberately inverted array and checks the emitted document. The failing test was
right that something was unproven; it was wrong about which function owed the proof.

---

## 5. Flagged for future work

- **`deserializeScene` is order-sensitive, and that is a latent bug in the file path too.**
  `Cmd+]` on a block puts it after its wires; `__dump()` then round-trips to a document that
  silently loses those wires. Paste is safe because `copyFragment` sorts, but the loader is not.
  The fix is a two-pass `deserializeScene` — load the records with no dependencies, then the
  rest — which would also let paste preserve exact z-order instead of lowering blocks below
  wires. Deliberately not bundled here.
- **Paste reads the in-memory doc only.** Copy mirrors the JSON to the system clipboard
  best-effort, so a fragment can be read out of the app, but nothing can be pasted _in_ from
  another window or another app. `navigator.clipboard.readText()` is async and focus-gated,
  which is the whole reason the in-memory slot is the source of truth.
- **A pasted `auto` connection may not route like its original.** `corridors` accumulates over
  everything below in the final array and paste appends, so a pasted wire can bundle onto the
  original's run. Most visible when the copy lands one cell away. The corollary is that an
  `auto` route's saved `points` are advisory.
- **No duplicate command.** `Cmd+D` is free and is copy-then-paste with a fixed offset.
- **The marquee has no keyboard equivalent**, and neither did the tooltip (iteration 5 §5).
- **`shapesInRect` is linear per move.** Fine at the current scene sizes; if it ever is not, the
  answer is the same bounds index the renderer's cull loop would want.

---

## 6. Conventions and gotchas

- **A rename map applied one entry at a time is only safe when its values are disjoint from its
  un-renamed keys.** §3.5. Reserve the whole namespace before minting any of it.
- **A pasted connection that loses an endpoint disappears in silence**, through three separate
  layers: `normalize` rejects an empty `from`, `hydrateShape` skips a failed write, and
  `pruneOrphans` deletes it on the commit that added it. Assert the pasted _count_, never just
  that paste did not throw.
- **`deserializeScene` is single-pass**, so a record must follow everything it depends on.
  Anything that builds a document by hand owes that order.
- **Do not seed the loader's `taken` with live names to "fix" paste.** §3.3. It type-checks,
  reads correctly, and loses every wire.
- **A selection region is not geometry**, so it is built from `p.world`. The snapped-point rule
  applies to things that get committed.
- **Snap the paste delta, never the pasted shapes.** §3.6. Per-shape snapping shears the
  fragment and bends manual routes.
- **A band's drawn box and its hit box come from one `#rect()`.** The fourth instance of the
  rule (after `visibleFlags`, `tabRect`, `cursorFlagBox`); iteration 5 §6 predicted it.
- **Anything computed before a group's `zoomToFit` is stale.** §4.2. Project live shapes through
  the live camera rather than reusing the coordinates they were drawn at.
- **Read a history label at the moment it is written.** §4.1. Read later it is some other
  action's, and a `typeof` check on it passes regardless.

---

## 7. How iteration 5-2 was verified

`npm run check` clean — 481 files, 0 errors, 0 warnings. `npm run verify` 317 assertions across
seven suites, all passing: grid 63, input 20, properties 44, connections 96, docking 18,
trace 49, selection 27. `npm run build` then `verify/production.mjs` against the preview
server: 15 passing, including the canonical key-order row — no property was added, so it did not
move. `npx prettier --check` clean.

No suite printed a page error.

New assertions, and what each is there to stop:

| Assertion                                                           | The regression it catches                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `block0,2,4,6` copied onto itself gives `block1,3,5,7`              | §3.4, as the user's own example rather than a paraphrase of it  |
| a copy of `block999` beside `block0` is `block1000`                 | the lowest-free-for-the-prefix rule, which passes the row above |
| `block1` copies to `block2`, never `block0`                         | the number running backwards                                    |
| `block007` copies to `block008`                                     | padding treated as arithmetic rather than formatting            |
| `alu` still copies to `alu_2`                                       | the `uniqueName` fallback being dropped                         |
| a 20-digit name falls back instead of hanging                       | `n + 1` past 2^53 never changing the candidate                  |
| a free name is returned untouched                                   | paste into a fresh document renaming everything                 |
| a minted name never lands on an un-renamed fragment name            | §3.5 — the self-connection, which nothing else catches          |
| a fragment sharing no names keeps all of them                       | the reservation over-firing                                     |
| a copy from an inverted z-order still emits blocks first            | §3.3 — the single-pass loader dropping every wire               |
| a band takes exactly the shapes under it, not the one beyond        | the marquee itself                                              |
| `Shift`+drag unions instead of replacing                            | the base selection being dropped                                |
| a press that never travels is a click                               | `DRAG_SLOP_PX` not applied, so a click clears via a 1px band    |
| `Escape` mid-band restores the prior selection                      | a half-swept selection left behind                              |
| a band inside a wire's bbox but off every run misses it             | §3.2 — `intersects` collapsing back to a bounds test            |
| a band across an actual run catches it                              | the seam over-tightened into containment                        |
| dragging one of three selected blocks moves all three by one vector | group move, which shipped in iteration 1 and was never asserted |
| pasting a wired pair yields a second wired pair                     | the whole rename path                                           |
| and the pasted wire joins the copies, not the originals             | `renameRef` not folded across the fragment                      |
| copying one end of a wire pastes the block and no wire              | the orphan rule                                                 |
| paste is one entry and undo removes exactly it                      | the commit splitting, or a no-op entry on an empty fragment     |
| cut empties the scene as one entry labelled `cut`                   | §4.1, and `#deleteIds` losing its label parameter               |
| pasting a cut back restores the very same names                     | the free-name skip in §3.5                                      |
| a pasted manual route is congruent to its original                  | §3.6 — the delta snapped per shape                              |
| a freshly drawn block never takes a name a paste already used       | `nextName` ever trusting its counter over the live scan         |

The two to keep are the eighth and the twenty-fourth. The eighth is the only thing standing
between this feature and a connection with both ends on one block, and it fails without an
error, a warning, or a visibly wrong diagram until something moves. The twenty-fourth is the
only assertion holding the paste offset to a single vector; a rewrite that snapped each shape
would look tidier, pass every other row on this list, and quietly bend every manual route that
was ever copied.
