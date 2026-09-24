# Iteration 6.1 — the queue's ghost, the interface as a port, and one icon set

2026-09-24. Complete. Three commits, `npm run verify` from 495 assertions across ten suites to
529, plus `verify/production.mjs`'s 16 against the built bundle.

Iteration 6 landed four component kinds. Using them turned up three things that had been
specified too loosely the first time — none of them new features, all of them a case of the code
promising something it did not deliver.

## 1. Scope

- **The FIFO's creation ghost** now draws its dividers and takes its cell count from the drag,
  so the preview is the shape that gets committed.
- **The network interface becomes a port**: flush inside its parent's border, two anchors named
  by edge rather than by compass point, an opaque box with the modport as its border colour, the
  label inside it, and an inward edge on a fabric's ports.
- **One icon set**, from Lucide, replacing hand-written SVG path data in two incompatible styles.

## 2. Decisions that came from the user

| Question           | Decision                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| Lucide delivery    | `@lucide/svelte` (1.48.0, ISC, no transitive deps), deep-imported one module per icon |
| The modport marker | Drop the tick; the **border colour** says master or slave, the inside holds the label |
| The FIFO drag      | `cells` follows the drag, so the ghost is exactly the shape that gets committed       |

## 3. Load-bearing decisions

### 3.1 A ghost draws its body, not its text

`drawBoxBody` gated both `inner` and `drawHeading` behind `if (!flags.ghost)`. That one `if` is
the whole reason a queue's preview was a blank dashed rectangle: the dividers are its entire
visual identity and they only appeared on release.

`inner` now runs unconditionally and the heading stays suppressed. The two other kinds were
already doing exactly this — `nif` ghosts its fill but not its label, `conn` its line but not its
badge — so the rule was already the convention; it just had not been written down anywhere but in
the placement of one keyword.

### 3.2 A derived extent means the ghost must derive it too

A bounded queue's length is `cells * spacing`, so `makeFifo`'s hard-coded `cells: 4` discarded
the dragged length on the flow axis entirely. The drag picked the orientation and then had no
further effect on that axis.

`cells` is derived from the dragged extent now: `round`, so the nearest whole queue wins rather
than the drag always growing one, floored at 1 because `cells: 0` is refused by the schema, and
capped at `MAX_CELLS`, the same ceiling the property writer holds. The general shape of this:
**whenever a stored field is ignored in favour of a derived one, every writer of that field has
to derive it the same way** — including the one that runs during a gesture.

### 3.3 An interface is inside its parent, not straddling its border

Straddling read as a pin glued to the outside of a box. A bus port is part of the thing, the way
a connector is part of a chip package. The outward edge is coincident with the border line now
and the whole box is in the body.

Two things follow that the old geometry could not have:

- **The label has somewhere to go.** It is drawn inside, centred, and turned a quarter turn on
  `e` and `w` so it runs along the border. It used to be dropped outright on those two sides.
- **"Inward" means something.** The far edge faces the parent's interior, which is where a
  crossbar's internal routing has to land.

`depth` has to be clamped now. Half of an over-deep box used to hang outside, where there was
always room; the whole of one has nowhere to go and would punch through the far border.

The consequence to accept and write down: `hitTest` is `pointInRect` over the box, so a port eats
a depth-deep band of the parent's _interior_ for body presses, and `childCovers` punches a
matching hole in the parent's edge-resize zone. That was already true at half the depth. It is
the right trade — the port is the thing you want to grab there.

### 3.4 An anchor id must not name something that can change

`resolveAnchor` used to redirect only the face directly OPPOSITE the outward one, so dragging a
port from the top border to the right-hand one left its wire attached to the short end of the box,
running along the border instead of away from it.

The ids are `'out'` and `'in'` now. An id that does not name a side cannot go stale when the side
changes — the defect is unrepresentable rather than handled. Everything unrecognised resolves to
the outward edge: a legacy `n:16` from a file written before this, an `in` on a port with no
inward edge, plain nonsense. A wire that cannot find its end would otherwise vanish.

All three seams — `anchors`, `anchorAt`, `resolveAnchor` — are built from one `nifAnchors`, so
they cannot drift. `anchors` has no call sites; it is implemented anyway, because the contract
says a kind lists its anchors and the next thing that wants them should not find a lie.

### 3.5 A pure seam that needs the parent gets its answer cached by `reroute`

`interfaceInward` is asked of the PARENT, like `interfaceSides`, so a `nif` never switches on its
parent's kind. But `anchorAt`, `resolveAnchor` and `anchors` are pure functions of one shape and
cannot see the parent.

So the answer is cached on the child, written by `reroute` — which does have the parent — exactly
the way the box is. This is the second field to take that route, after `pending`, and it is worth
naming as a pattern: **a per-shape seam whose answer belongs to the parent is resolved in
`reroute` and stored `computed`.**

The tax is that `inward` must join `reroute`'s unchanged-comparison. A field that participates in
the returned object but not in the guard makes every commit allocate, and `commit` compares by
identity, so each one records an undo entry that undoes nothing. Iteration 6 §4.3 and §8 say this
about property writers; it applies to `reroute` in exactly the same way.

### 3.6 Selection colour and semantic colour cannot be the same hue

The modport moved from a tick inside the box to the box's border, which meant it had to stop
being amber: `shapeStrokeSelected` is amber too, so a selected slave would have looked exactly
like an unselected master. `nifMarkMaster` is violet now.

Worth noticing that the tick it replaces was already lying. Both branches computed the same two
endpoints in the opposite order, so master and slave differed only in colour anyway — despite the
comment in `nif.ts` and the prop doc in `nif.props.ts` both claiming it pointed out or in. A
decoration nothing asserts on can be wrong for a whole iteration.

### 3.7 An icon is a component, not a string

Path data carries no style. The toolbar drew registry icons `fill="currentColor"` with no stroke
and every hand-written button `fill="none" stroke-width="2"`, and `fifo` and `fabric` were
authored as stroke data under the fill rule — rendering as thin filled slivers. Nothing could
catch that, because the declaration and the renderer agreed on the type and disagreed on the
meaning.

`ToolDeclaration.icon` is a `LucideIcon` now. There is one kind of icon, and the mismatch is
unrepresentable.

## 4. Defects found while building

### 4.1 `resolveAnchor`'s redirect only covered one of three ways an id goes stale

See §3.4. The old rule handled the opposite face and nothing else, which is the case you think of
when the interface is a pin on one border and the wire is on the other. Dragging to a
perpendicular border is the case you meet.

### 4.2 Two check groups had encoded the straddling geometry

`components.mjs` tested "is this interface on the border" by comparing the box's MIDPOINT to the
border line. That is the outward EDGE now. The test passed for the wrong reason for as long as the
box was centred, and failed honestly the moment it was not.

### 4.3 Six 48-unit interfaces do not fit a 336-unit face

Growing the default length from 32 to 48 made an existing group's premise false: with four already
placed at the four-way spread positions, the remaining gaps are all narrower than one interface, so
`freeOffset` does the documented thing and overlaps. The group asks for five now, and says why. The
lesson is narrow but real — **a check that asserts "a free slot is found" has to stay clear of the
case where there genuinely is none**, or it is asserting something the code explicitly refuses to
promise.

## 5. Flagged for future work

- **`rerouteAll` snapshots the shape map on entry**, so a shape whose geometry is computed in the
  same pass is read stale by anything depending on it. Visible on a fresh load: interfaces get
  their boxes in pass one, and a wire attached to one is routed from the 0,0 it had on entry,
  settling only on the next commit. Pre-existing — it is a property of `byId` being built from the
  input array, not of anything in this iteration — and not addressed here.
- **An inward link's automatic bow is not obstacle-aware**, the same caveat iteration 6 §7 records
  for curves generally. Inside a crossbar there is more to hit.
- **Interfaces still do not avoid each other when dragged.** `freeOffset` applies only when the
  count grows.
- **`freeOffset`'s scan step is the interface length**, so on a crowded face it can miss a gap that
  is not aligned to that step. It falls back to an overlap, which is the documented behaviour, but
  it will overlap sooner than it strictly must.

## 6. Conventions and gotchas

Everything in iteration 6 §8 still holds. Added by this one:

- **A ghost draws its body but not its text.** `inner` runs, the heading does not.
- **A theme fill drawn over a shape rather than over the background must be opaque.** This is the
  second time — `theme.shapeFill` set the same trap for the FIFO's label plate. One translucent
  fill looks almost right and fails exactly where something is drawn behind it.
- **A semantic colour must not share a hue with `shapeStrokeSelected`.** Selection wins on the
  canvas, so anything else amber is invisible while selected.
- **`fitText` bounds width alone.** Anything drawn inside a box needs a floor on the box's
  projected DEPTH as well, or it overflows when zoomed out.
- **Every field in `reroute`'s returned object must appear in its unchanged-comparison.**
- **An anchor id must not name anything that can change under it.** Name the edge, not the side.
- **Toolbar icons are Lucide components, deep-imported per icon.** Never hand-written path data,
  never a `title` prop, and never touch an `aria-label` — they are the checks' selectors.

## 7. How iteration 6.1 was verified

```
npm run dev                          # terminal 1, port 5183
npm run verify                       # 529 assertions across ten suites
npm run check                        # 504 files, 0 errors
npm run build && npm run preview     # port 4183
node verify/production.mjs           # 16 assertions — NOT in `npm run verify`
npx prettier --check src verify README.md history
```

New coverage, 34 assertions across the two component suites:

- **The creation ghost** — nothing asserted on a shape-tool ghost before. The drag is held open
  mid-gesture and `window.__scene.draft` read: the count grows with the drag, the box tracks the
  cursor to within the rounding on the flow axis and exactly across it, a pixel probe down the
  flow axis confirms the dividers are lit, and what lands on release is what was previewed.
- **The interface's box** — contained by its parent on every border, the outward edge coincident
  with the border line, the depth clamped by a parent shallower than it.
- **The anchors** — one on a block's port and two on a fabric's, the normals shared references out
  of `NORMALS`, the outward fallback for a legacy id and for nonsense, and the same id following a
  port dragged to another border.
- **The edge rule** — outward-to-outward and inward-to-inward clean, one of each a violation, an
  unavailable `in` judged as the outward edge it is drawn on, a plain arrow still never checked.
- **The label** — bright ink inside the box and none past the outward edge, present on an `e`-side
  port where there was none before, and dropped entirely when the box is too shallow on screen.
- **The inward cache** — set on a fabric's port, not on a block's, and `reroute` returning by
  reference when nothing changed.

Manual pass on the Retina display, at fit, 100% and 200%: a fabric with ports on three borders,
one internal link between two inward edges, one external link, and one badged violation. Port
borders stay crisp hairlines, the labels sit inside, and the rotated `e`/`w` label reads
bottom-to-top. Both toolbars screenshotted to confirm every icon is optically the same weight.
