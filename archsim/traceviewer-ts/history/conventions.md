# Conventions and gotchas

These are the rules the code relies on that the type checker cannot enforce. Most of them were
learned from a defect that compiled, type-checked and built cleanly and then failed at runtime, at
dpr 2, after a hot reload, or only in a combination no single module can see. Read this before any
structural change; each item names the iteration where the rule came from, and that iteration's doc
has the full story.

## Verification

- **A green type-check means almost nothing here; run it in a real browser at
  `deviceScaleFactor: 2`.** Three of iteration 1's nine bugs were invisible at dpr 1 and the primary
  machine is a Retina Mac, and the one that threw on first load had compiled and type-checked.
  Compiling is not running. (iteration 1)
- **Restart `npm run dev` before a verify run, and never run one while anything in the project is
  being written -- the docs included.** An HMR full reload mid-suite wipes the scene the suite
  built, and the failure looks like a product bug; after any hot update a module imported by URL
  can also load as a second copy (next item). Tailwind's scanner reads every file in the project,
  so editing a markdown file under `history/` reloads the page too: in 7.2 that emptied the scene
  under `input.mjs` twice, once as a crash and once as three unrelated failures. (iteration 4,
  iteration 7)
- **Never import `scene/registry.ts` by URL inside `page.evaluate` — use `window.__ops` and
  `window.__doc`.** After an HMR update the app's copy sits behind a versioned `?t=` URL, so a bare
  specifier mints a second, empty registry and every `opsFor` throws; it passes on a cold server and
  fails later. Only modules with no module-level state are safe to import that way (`curve.ts`,
  `fifo-geom.ts`, `nif-geom.ts`, `timeline/layout.ts`); note `canvas/text.ts` holds the width cache,
  so a URL import of it measures against a separate cache. (iteration 4, restated in iteration 6)
- **`npm run verify` cannot vouch for `verify/production.mjs`.** It needs
  `npm run build && npm run preview` on :4183, and it is the only check that asserts the property
  panel's row order against the shipped bundle, and that the bundle carries no `window.__*` hook.
  Run it whenever the property panel or any declaration's `mode` changes. (iteration 4)
- **Adding an `edit` property, or changing a property's `mode`, reorders the document.** Rank is
  `kind` → editable → everything else, so the key moves in the panel, the schema and the saved file,
  and `production.mjs`'s row-order assertion fails. (iteration 4, again in iterations 5 and 6)
- **A green `npm run verify` does not mean the page did not throw.** `report` prints page errors and
  passes; only a few groups (in `connections.mjs`, `input.mjs`, `properties.mjs`, and
  `production.mjs`) assert on them. Read the output. (iteration 4)
- **Scope every canvas locator by panel: `diagramCanvas(page)` / `traceCanvas(page)`.** The trace
  panel's canvas made every bare `locator('canvas')` a strict-mode violation. (iteration 3)
- **Never hard-code canvas coordinates in a check; derive them from the live canvas box.** Use
  `emptySpot(box)` and `toCanvas`. A fixed `y + 600` became the trace panel when the pane shrank
  (iteration 3), this was broken again in iteration 4, and a `y + 620` in iteration 6 drew a FIFO
  onto the trace panel, silently patched the previous group's queue and moved the time cursor.
  (iteration 3)
- **Count `arc`, not `rect`, when asserting on connection beads.** `__count` wraps the shared
  `CanvasRenderingContext2D` prototype, and the dot grid's strip builder and the timeline both call
  `rect`. (iteration 4)
- **After `editValue` the caret is in the JSON tree, so click the canvas before the next canvas
  gesture.** `ToolHost.#globalKey` ignores keys aimed at an editable element, so a following
  `drawBlock` presses `Digit3` into the tree and then drags with whatever tool was active. It fails
  three groups downstream of the edit that caused it. (iteration 4)
- **A refused edit stays in the editor; assert a successful edit before a refusal, not after.**
  `handleChange` leaves the user's text on screen and does not re-push, so the next edit is
  validated against a document still carrying the refused value and is refused too. Re-select to
  clear it. (iteration 4)
- **An enum property is a `<select>`: drive it with `selectValue`, not `editValue`.** Two helpers on
  purpose — one that sniffed the DOM would pass just as happily against a dropdown that had silently
  reverted to a text box. (iteration 5)
- **Reset the camera at the head of a new verify group with `zoomToFit`, not `resetZoom`.**
  `resetZoom` keeps the pan, and a group inherits wherever the last one left the camera — culled
  connections, flags 24 000 px off screen. (iteration 5)
- **Anything computed before a `zoomToFit` is stale.** Project live shapes through the live camera
  rather than reusing the coordinates they were drawn at. (iteration 5)
- **A regression test for a floating-point bug must be run against the bug.** Revert the fix and
  watch the check fail; the first one written passed both ways, and a fix that makes a failure
  improbable looks exactly like one that makes it impossible. (iteration 5)
- **Reading an attribute is not testing a feature.** The `title` attributes were right the whole
  time and the tooltips never appeared; if a behaviour's only evidence is markup, it is not covered.
  (iteration 5)
- **Read a history label at the moment it is written, and compare it to a value.** Read later it is
  some other action's, and a `typeof` check passes regardless. (iteration 5)
- **Assert a pasted _count_, never just that paste did not throw.** A pasted connection that loses
  an endpoint disappears in silence through three layers: `normalize` rejects an empty `from`,
  `hydrateShape` skips a failed write, and `pruneOrphans` deletes it in the commit that added it.
  (iteration 5)
- **A colour-matched pixel probe must allow for the selection colour.** The connect tool leaves the
  wire it drew selected, and a selected wire strokes amber, so a probe counting `connStroke` pixels
  reads zero ink on a visible wire. (iteration 5)
- **A pixel probe reading a band _around_ a block catches grid dots; one over _overlapping_ blocks
  catches the neighbour's label.** Both reported a 0 px margin on text that was 21 px from the edge
  — the probe was right, the scratch scene was wrong. (iteration 5)
- **A check that asserts "a free slot is found" must stay clear of the case where there is none.**
  `freeOffset` documents that it overlaps when no gap fits; a group that crowds a face is asserting
  something the code refuses to promise. (iteration 6)
- **A window-capture listener registered after the app's observes its `preventDefault`.** That is
  how `verify/file.mjs` proves the browser's own Save/Open dialogs are suppressed; a bubble listener
  would not fire at all from the property panel. (iteration 6)
- **A new suite is four edits:** the file, `package.json`'s `verify` script, the run list and suite
  count in `verify/README.md`, and the assertion count in `README.md`. (iteration 5, iteration 7)
- **Checks select some class names page-wide, unscoped:** `.footer`, `.grip`, `.veil`, `.editor`,
  `.alert`, `.doc` and `[data-path]`. Two more are unscoped within one pane: `.banner` in
  Properties, and the token `text-[var(--color-ink)]`, taken with `.first()` in the diagram pane
  by `file.mjs` to find the status-bar hint. A new component must not reuse any of them, and the
  toolbar must not use that token. `ObjectsView` prefixes every class with `tree-` for this reason.
  (iteration 7)
- **A check's cleanup must undo only what the check did.** An unconditional `undo()` after a
  gesture that committed nothing undoes the seed instead, and every later step then fails for that
  reason. Undo when the label says the gesture committed. (iteration 7)
- **In a gesture check, press on a grid point.** A move's delta is measured from the snapped press,
  so a press half-way between two grid points -- the centre of an 80-wide block -- leaves the start
  cell to sub-pixel rounding of the pointer, and the landing to that. (iteration 7)
- **If a Vitest suite is ever added, never run rune code under `environment: 'node'`.**
  `vite-plugin-svelte` then compiles in server mode, where `$state` is a plain field and `$derived`
  a one-shot memo: the suite passes while testing nothing. Use `happy-dom` with
  `resolve.conditions: ['browser']`, and keep a canary asserting a `$derived` recomputes.
  (iteration 1)

## Measuring Safari

- **`performance.now()` around `draw()` measures nothing.** Canvas rasterization happens after
  `draw()` returns, in Safari's GPU process. Use rAF-to-rAF intervals over a sustained gesture, or
  count primitives — which is why `verify/grid.mjs` asserts counts and never a frame time; its
  browser also understates Safari's magnitude by about 3.5×. (iteration 3)
- **Turn the Web Inspector Screenshots instrument off.** It captures a full-page image per frame and
  puts a ~42 ms floor under every frame, so frame durations are unusable with it on; `Composite`
  durations stay clean either way. Record Script / Layout & Rendering / CPU only. (iteration 3)
- **A recorded screenshot shows the canvas one frame behind the toolbar's zoom readout.** Map each
  frame to the zoom at composite _start_, or several 200 ms frames appear to happen at a cheap zoom
  and rect count looks irrelevant. (iteration 3)
- **Record in a clean profile, extensions disabled, Inspector closed, maximised on the large
  monitor, and report `cssW × cssH`, `dpr` and `z` beside every number.** Grid cost scales with
  canvas area; a laptop-sized window sits below the knee and does not contain the bug. (iteration 3)
- **Measure the sweep across the level-of-detail boundary, not a point — and measure just above
  `z = 0.5` (0.512), not at `z = 1`.** At 0.512 the minor tier is back at 8 CSS px spacing, four
  times the dot density of 100 %; a benchmark at 100 % under-reports the worst case by about 4×.
  (iteration 3)
- **For a pixel diff that isolates the major tier, use `z = 0.5001`, not 0.512.** At 0.5001
  `minorAlpha` rounds to a paint alpha of 0; at 0.512 it is already 8. (iteration 3)
- **Draw a realistic scene first: about two dozen blocks with two-line subtitles.** Grid cost is
  independent of shape count and text-fitting cost is not. Carry the fixture into the `preview`
  build with `⌘S`/`⌘O`; `__dump()` is DEV-only. (iteration 6)
- **Do not spend time on script time, context attributes (`desynchronized`, `alpha`), bitmap size or
  the zoom readout's width.** Each was ruled out with a controlled comparison: 66 ms of JS in 20 s,
  and the readout is already `min-w-14 tabular-nums`. (iteration 3)

## Svelte and reactivity

- **Any file using a rune must be named `*.svelte.ts`.** Svelte declares the runes as ambient
  globals, so they type-check anywhere and throw `rune_outside_svelte` at load. The rune files are
  `session`, `canvas/view`, `canvas/viewport`, `scene/scene`, `scene/history`, `tools/host`,
  `timeline/view`, `timeline/host`, `trace/store` and `ui/tooltip`. (iteration 1)
- **Nothing draws inside an `$effect`.** `CanvasSurface`'s effect reads an explicit dependency list
  and calls `renderer.requestFrame()`; the draw runs in `FrameLoop`, untracked, at most once per
  frame. Drawing in an effect makes every value the renderer reads a tracked dependency and flushes
  per microtask. (iteration 1)
- **Scene data is `$state.raw` with immutable shapes and whole-array replacement.** Deep `$state`
  would proxy every shape — slow for a renderer that reads every field every frame, and a proxied
  shape is not `===` the raw one, so identity checks on hit results fail. (iteration 1)
- **A `bind:this` is `null` when the element is gone, never `undefined`.** Guarding for the wrong
  one type-checks, reads fine, and throws on the first teardown. (iteration 5)
- **What a synchronous third-party render reads must be current before the render, and must not be
  `$state`.** Writing a signal and reading it back within one effect run is a self-invalidating
  effect (`Cannot read properties of null (reading 'schedule')`). A plain `let` is how a value
  reaches a component without the reactivity graph knowing; `PropertiesView` has several, and the
  schema `onClassName` answers from is one. (iteration 4)
- **Never pass a `$derived` as the JSON editor's `content` prop.** The component assigns to its own
  `content`, and a reactive parent expression fights it and reverts keystrokes. Drive it through
  `update()`/`set()`. (iteration 2)
- **Nothing handed to the editor may be derived from the selection.** The push is deferred while a
  canvas gesture runs, so the validator, `readOnly`, row classes, footer, veil and banner all
  describe the document actually pushed (`shownSpec`, `shownSignal`), not the one coming.
  (iteration 2)
- **`editor.set()` re-creates the tree and the new instance inherits the caret.** Its mount expands
  that path against the incoming document and throws if the path is gone, so clear the selection
  first whenever the keys are about to change. `update()` does not have this problem. (iteration 2)
- **Hand the editor a `validator` whose identity is stable per kind.** Validators are compiled once
  per kind and cached (`props/validate.ts`), and only the uniqueness closure is rebuilt; a fresh
  identity makes the editor re-validate continuously. The cache is keyed on `kind`, so a hot-swapped
  schema would keep the old validator — moot today only because the props files force a full reload.
  (iteration 2, iteration 6)
- **An effect that follows the canvas selection defers while gesturing and acts only on a new Set,
  or on a seen one whose object now has different ancestors.** It tracks `scene.selection` and
  `host.gestureVersion` and nothing else, bails while `isGesturing()` (the marquee writes the
  selection on every move), and remembers the last Set and ancestor chain in a plain `let`.
  Collapsing or panning then never re-opens what the user closed, and dragging a selected block
  into a closed group still opens it: that drag keeps the same Set. (iteration 7)
- **The session is owned by the app, not by a panel.** The dock re-mounts a pane's content when it
  is maximised, floated or popped out, so the document, the trace and the cameras live in
  `EditorSession`. (iteration 2)

## Canvas and text

- **Never trust `devicePixelContentBoxSize` for CSS size.** Chromium reports CSS px under an
  emulated scale factor. Use `contentRect` and derive the bitmap from `cssSize * dpr`. (iteration 1)
- **Device-pixel space is a contract: reset the transform before drawing in it.** `DotGrid` and
  `DrawContext.toDeviceSpace()` emit coordinates already multiplied by `dpr`; a missing reset is
  invisible at dpr 1 and doubles everything at dpr 2. (iteration 1)
- **`dpr` is capped at 2 (`MAX_DPR` in `canvas/viewport.svelte.ts`), and is not only 1 or 2.** A 3×
  bitmap costs 2.25× the fill for nothing visible; below the cap, browser zoom yields 1.25, 1.5,
  1.75, where dot sizes change and `cssW * dpr` is fractional. (iteration 1, iteration 3)
- **`canvas.width`/`height` truncate a fractional assignment, and any assignment resets all context
  state.** Only assign on a real size change — the idiom `syncCanvasSize` uses. (iteration 3)
- **Key the grid's strip cache on `camX`, never on `x0`.** Hole positions depend on
  `mod(i0, skipEvery)`, which is independent of `x0`: panning by exactly one step leaves `x0`
  bit-identical while moving which columns are punched out. (iteration 3)
- **Never refactor the strip's column loop to `x0 + k * stepDev`.** The pixel coordinate is
  accumulated (`x += stepDev`) and only the index is exact; the tidy-up silently voids pixel
  identity with the reference renderer in `verify/grid.mjs`. (iteration 3)
- **Grid rows never overlap, which is what makes one blit per row safe.** A visible minor tier needs
  `minorStep·z > 8`, so `stepDev > 8·dpr` against a dot of `round(1.5·dpr)`; the major tier has
  `stepDev ≥ 48·dpr` against `round(2.5·dpr)`. The `stepDev < 2` bail does not mean small steps are
  expected. (iteration 3)
- **The grid's `dispose()` only drops its cache.** `Renderer.dispose()` can fire against a live
  renderer when the dock mounts the new pane before cleaning up the old, so the grid must never
  enter a state that stops drawing. (iteration 3)
- **`bounds` must cover everything `draw` paints in world units, and anything screen-sized must fit
  inside `CULL_MARGIN_PX` (96).** The renderer culls on `bounds` expanded by that margin. A property
  that can push a decoration out (a label offset) must be range-checked in its writer against the
  constant. (iteration 4, iteration 5)
- **A horizontal connection has a zero-height bounding box, and that is fine.** `rectsIntersect`
  compares inclusively; do not "fix" the degenerate rect. (iteration 4)
- **Restore every context property a `draw` touches — `lineJoin` above all.** `connOps.draw` sets it
  to `'round'`, and a box body strokes with `strokeRect`, whose corners honour it; leaving it
  softens every block drawn afterwards, with no local symptom. (iteration 4)
- **A drawn box and a clickable box come from one function.** `visibleFlags`, `cursorFlagBox`,
  `tabRect`, and the marquee's `#rect()`; the hit test passes the same measurer as the draw. Assume
  the next instance is coming. (iteration 3, iteration 5)
- **Tick tiers must be whole numbers and must divide each other, and ticks are walked by index
  (`i * step`), never by adding `step`.** The `tick % coarser === 0` test that stops a tier drawing
  over a coarser one has to stay exact. Same rule for the grid's major test. (iteration 3)
- **The trace lane is clipped; the gutter is not painted over the top of it.** (iteration 3)
- **Measure and draw text in the same coordinate space, with one font string.** The label tab is
  drawn in CSS space so `tabRect`'s measurement and `fillText`'s output agree; `cachedTextWidth`
  assigns the font it measures with. (iteration 5, iteration 6)
- **Never re-derive a screen-pixel budget from a world-unit value — carry it.** The round trip is
  exact at zoom 1 and loses a bit everywhere else, so the bug hides in exactly the configuration you
  test. `tabRect` returns the CSS-pixel budget alongside the rectangle for that reason.
  (iteration 5)
- **`fillText`'s fourth argument condenses; it neither truncates nor scales.** If text must fit a
  width, measure it: `fitFontPx` to shrink, `fitText` to cut. (iteration 5)
- **Do not size type from `fontBoundingBox`.** Chrome rounds its ascent and descent to whole pixels,
  so the ratio moves 5 % across 8–16 px and in one place falls as the size rises;
  `actualBoundingBox` is stable to four decimals. (iteration 5)
- **Round a solved font size down.** The height budget is solved to fill exactly, so rounding up
  spends margin already allocated — a whole CSS pixel of three at dpr 1. (iteration 5)
- **A gate expressed in the units a ramp scales is not a gate.** `h ≥ 58 · fit` with `fit ∝ h`
  reduces to a constant comparison and is false at every size; if both sides scale, the threshold
  does nothing. (iteration 5)
- **`fitText` bounds width alone.** Anything drawn inside a box also needs a floor on the box's
  projected depth, or it overflows when zoomed out. (iteration 6)
- **`flagMeasurer` is deliberately not cached.** Flag labels are record values, an unbounded key
  space that changes as the cursor scrolls, so caching them would churn the table and evict the
  diagram's entries that repeat every frame. It measures directly, and falls back to
  `FLAG_EST_CHAR_PX` with no context. (iteration 6)
- **The text width cache is cleared whole at one global cap — never per frame, on a dpr change or on
  a theme change.** Surviving between frames is the point, the dpr is inside the font shorthand key,
  and colour is not a metric. `cachedTextWidth` always assigns `ctx.font`, hit or miss, so callers
  can rely on the font it leaves behind. Adding a web font means clearing on `document.fonts.ready`.
  (iteration 6)
- **A ghost draws its body but not its text.** `inner` runs; the heading does not. (iteration 6)
- **The tool overlay is drawn after the draft ghost.** The create tool's alignment guide runs down
  the ghost's own aligned edge, and drawn first it was dashed over by the ghost's outline.
  (iteration 7)
- **A theme fill drawn over a shape rather than the background must be opaque.** `theme.shapeFill`
  is translucent, so an opaque plate the colour of a box body is two fills: `background`, then
  `shapeFill`. One fill composites and looks almost right, and fails exactly where something is
  drawn behind it. (iteration 6)
- **A semantic colour must not share a hue with `shapeStrokeSelected`.** Selection wins on the
  canvas, so anything else amber is invisible while selected. (iteration 6)
- **An axis-aligned box is not a rotated shape.** It answers "where is this", not "does this overlap
  that" — which is why `headIsClear` tests the arrowhead's base point rather than a box around the
  head. (iteration 6)

## Document model and commit path

- **`SceneStore.commit()` is the only thing that pushes history; tools preview mid-gesture and
  commit once on release.** `previewShapes()` touches no bounds, history or camera, so a whole drag
  is exactly one undo entry with no debouncing. Camera state is deliberately not in history.
  (iteration 1)
- **Document mutations must be gated on `isGesturing()`** (see `deleteSelection`, `#restack`).
  Committing underneath a tool's uncommitted preview corrupts history. (iteration 1)
- **Resize and move always recompute from the pre-drag snapshot, never incrementally.** Otherwise
  snap error accumulates and the shape drifts away from the cursor. (iteration 1)
- **Every selection write in `SceneStore` goes through `#setSelection`.** Assigning `selection`
  directly bypasses the global selection rule, and undo/redo are exactly the paths that used to.
  (iteration 3)
- **Array identity is the history signal: anything `commit` calls returns its input by reference
  when nothing changed.** That covers `reroute`, `rebind`, every property writer and every function
  in `route.ts` (`collapseRoute` builds into a scratch array and discards it on a match). A
  `reroute` that always allocates is a correctness bug, and a writer whose `read` cannot reproduce
  what was typed is called on every later commit, each allocation an undo entry that undoes nothing.
  (iteration 4, iteration 6)
- **Every field in `reroute`'s returned object must appear in its unchanged-comparison.** A field
  left out either allocates every time or silently drops a change. (iteration 6)
- **`reroute` must be idempotent, not merely identity-preserving:
  `reroute(reroute(s)) === reroute(s)`.** The fold sweeps until nothing moves. (iteration 6)
- **The corridor index lives for one sweep and is thrown away between sweeps.** A run must not
  outlive the connection that drew it, which is why `reroute` receives a query-only `CorridorQuery`.
  (iteration 6)
- **Nothing switches on `kind`.** A new kind is its `ShapeOps`, its props file, a widened `Shape`
  union and one line in `register.ts`; if it needs a change to an existing mutation path, that is a
  design bug to fix rather than work around. (iteration 1)
- **A `<kind>.props.ts` must not import from its `<kind>.ts`.** `register.ts` imports the kind file,
  so the pair forms a cycle, and the props array consumes the values while still evaluating — a
  temporal-dead-zone crash at load. Put anything shared in `<kind>-geom.ts` (`fifo-geom.ts`,
  `nif-geom.ts`). (iteration 6)
- **A box kind delegates:** `shapes/box.ts` for handles, resize, anchors and body,
  `shapes/heading.ts` for the label, `props/common.ts` for the repeated properties. Each takes the
  body rectangle as a parameter rather than reading `x/y/w/h`, because a FIFO's drawn box is derived
  and its stored `w` is not the answer. (iteration 6)
- **`shapes` array order is the z-order**, index 0 at the bottom. (iteration 1)
- **The hierarchy is derived, never stored.** `hierarchyOf(shapes)` works every parent out from
  where things are; nothing on a shape records one, so undo, load and paste need nothing. Adding a
  field that caches a parent would give the document two answers. (iteration 7)
- **No half-built or later-mutated array may reach `hierarchyOf`.** It is memoised on array
  identity. `deserializeScene` fills its array in place while hydrating, so no property's `write`
  may call it; a finished array, including the one `deserializeScene` returns, is fine.
  (iteration 7)
- **A shape's role in the hierarchy is read off `childOf` and `dependsOn`; `adopts` is the only
  seam autogrouping added.** Owned if its kind has `childOf`, a link if it has dependencies and
  no `childOf`, placed by its bounds otherwise. A kind with `childOf` is never a link, even with
  no valid owner, and a wire between one shape's own interfaces is that shape's, adopting or not.
  A new kind decides only whether it adopts. (iteration 7)
- **Ownership is one level deep.** `hierarchyOf` ignores an owner that is itself owned, the rule
  `expandChildren` already enforces by never emitting a child's child. It is what makes the
  hierarchy a forest over any input, a malformed one included. (iteration 7)
- **Every commit seats the array by the hierarchy, and a restack emits through the same pass.**
  `seatByHierarchy` puts each child above its parent, with interfaces straight after their owner.
  A reorder that ignores it is put back by the next commit, after recording an undo entry for a
  move that did not happen; `restackTree` applies a transform per sibling list for that reason.
  (iteration 7)
- **Put a new property anywhere in its array; `propSchema` sorts it.** The canonical order is
  `kind`, then editable keys, then the rest, each alphabetical. (iteration 4)
- **A property's `doc` string is user-facing panel text, and a default it does not state is one a
  user cannot discover.** (iteration 4, iteration 6)
- **Do not let a writer set a sibling key.** It makes declaration order load-bearing on the load
  path, where the record already carries both answers. If a gesture needs two keys moved together,
  move them in the gesture. (iteration 4)
- **A read-only (`fixed`) property still needs its `write`** — it is what the loader restores it
  with. Only `computed` properties, absent from the file, legitimately have none. (iteration 4)
- **Put a numeric ceiling in the schema _and_ the writer.** The writer is what refuses the commit;
  ajv is advisory in this editor but is what tells the user, and a value big enough to hang the
  renderer must be refused before it is committed. (iteration 5, iteration 6)
- **Uniqueness of `name` is checked twice on purpose:** in the validator for the live red
  annotation, and in the `name` writer, which is what actually refuses. The editor delivers invalid
  documents to `onChange` regardless of the validator. (iteration 2)
- **Generated JSON Schema must be draft-07.** `createAjvValidator` uses the draft-07 `Ajv` with ajv
  8's `strict: true`, which throws on an unknown keyword when the panel mounts. Tuples are
  `items: [...]` + `additionalItems: false` + `minItems`/`maxItems`, never `prefixItems`.
  (iteration 2)
- **Properties are flat.** The value grammar has scalars, fixed-length tuples of scalars and lists
  of either, never an object; a polyline is `list[tuple[int, int]]`. (iteration 2)
- **Removing a property needs no migration and no version bump.** `hydrateShape` iterates the schema
  and skips unknown keys, so old files load; `applyDocument` is the one strict path and rejects
  unknown keys. Bumping `SceneDoc.version` would tell a reader to refuse a file it can read.
  (iteration 6)
- **A geometric constant that is also a saved property changes nothing about existing documents.**
  Say what a scene of mixed vintages looks like, and make code that packs, measures or compares
  shapes read each one's own value. (iteration 6)
- **A constant that is secretly a ratio of another constant must be written as the ratio.**
  (iteration 6)
- **An anchor id must not name anything that can change under it.** Name the edge (`out`/`in`), not
  the side. (iteration 6)
- **A rename map applied one entry at a time is only safe when its values are disjoint from its
  un-renamed keys.** Reserve the whole namespace (live names _and_ the fragment's own) before
  minting any of it, as `readFragment` does. (iteration 5)
- **Do not seed the loader's `taken` with live names to "fix" paste.** It type-checks, reads
  correctly, and loses every wire: the fragment loads under its own names first so its connections
  resolve, and only then is renamed. (iteration 5)
- **Snap the paste delta, never the pasted shapes.** Per-shape snapping shears the fragment and
  bends manual routes (`centringDelta`). (iteration 5)
- **A selection region is not geometry, so it is built from `p.world`.** The snapped-point rule is
  for things that get committed. (iteration 5)
- **Nothing under `scene/`, `props/` or `geom/` touches the DOM.** It is what lets `verify/` drive
  them as pure calls; file work splits into `scene/file.ts` (format, name) and
  `ui/file-transport.ts` (Blob, object URL, picker). (iteration 6)
- **Keep `serializeScene` away from BEVE.** The scene document is editor state; BEVE is the trace
  input. One serializer must not serve both. (iteration 1)

## Tools and input

- **Tool instances are cached for the session.** A tool holding state across pointer-up must clear
  it in `onActivate`, `onDeactivate` and `onPointerCancel` (which also fires on window blur and
  `visibilitychange`); `ConnectTool` funnels all of them into one `#reset()`. (iteration 4)
- **A tool that blocks a command must provide its cancel path.** `isGesturing()` spanning two clicks
  correctly refuses undo, delete and restack, which makes `⌘Z` a dead key, so the connect tool
  intercepts it and cancels instead. (iteration 4)
- **Digit shortcuts come from toolbar position, so a new tool goes after the existing ones in its
  group unless renumbering is intended.** The registry derives `ToolDescriptor.shortcut` from
  `group` and `order`; inserting renumbers everything to its right, including the literal
  `Digit3`/`Digit4` other suites press. Hints name a tool's key through `shortcutFor`/`pressTo`,
  never a literal. (iteration 4, iteration 6)
- **Renaming a tool id is the one rename the compiler cannot catch.** `ToolId` is
  `'pointer' | 'rect' | (string & {})`, so moving `'select'` onto a different tool leaves every
  `setTool('select')` type-checking and activating the wrong tool. Rename the old owner out of the
  way first, and grep for the literal, not the symbol. (iteration 5)
- **`TimelineView.zoomAt`/`pan` are `WheelTarget`'s interface.** Changing either signature silently
  breaks wheel input; the target is structural, so there is no compile error. (iteration 3)
- **Each canvas panel needs its `acceptsKeys`.** Keyboard listeners are on `window`, so without it
  both panels' arrow keys fire at once; `isEditableTarget` covers inputs but not the JSON tree's
  tabindex divs, which is why there are three filters. The Objects panel deliberately shares the
  diagram's, and handles only the keys it moves with. (iteration 3, iteration 7)
- **`setTool` is an explicit choice; the Shift hold switches through `#activate`.** Every caller of
  `setTool` — the toolbar, a digit, a tool's Escape-to-pointer, a check's `__host.setTool` — ends a
  hold and wins until Shift comes up. Code that switches tools on the hold's behalf must call
  `#activate`, or it cancels the hold it is serving. (iteration 7)
- **Only a bare ⇧ keydown or a ⇧ canvas press may start a hold, and `#reconcileHold` runs on every
  path that ends a gesture.** Anything showing Shift up may clear it; nothing else may set it. A new
  way for a gesture to end that skips reconcile leaves the hold waiting for an event that already
  happened. (iteration 7)
- **A gesture that ends without a pointer event must still bump `gestureVersion`.** Escape on a
  pending connection, Escape mid-band and a tool switch mid-drag all end one; `ToolHost`'s
  `#noteGestureEnd` catches them by comparing `isGesturing()` either side of `onKeyDown` and
  `setTool`. A new ending path outside those two needs the same, or whatever deferred on
  `isGesturing()` waits for the next drag. (iteration 7)
- **Alignment may choose only a position the grid-only gesture could produce.** A grid multiple for
  a move's delta, a grid point for a resize's or a create's pointer. It picks among those
  (`magnet`), never solves for an exact one, so it cannot make a fractional position or leave the
  grid. (iteration 7)
- **A move's raw coordinate is `p.world - drag.start`, where `start` is the snapped press.**
  Rounding it is then exactly the grid-only `p.snapped - start`. Measured from the raw press, an
  aligned landing would sit on the press's grid and every other one on the world's. (iteration 7)
- **A snap distance of half a grid step or less, in world units, never moves a landing.** Every
  grid point but the nearest is at least that far from the pointer. `ALIGN_SNAP_PX` is 10 so that
  it pulls below z = 1.25, 100 % included. (iteration 7)
- **Alignment guides are read off the real geometry at the answer, never off the candidate.** A
  kind may put its edge somewhere other than the pointer -- a FIFO rounding its cells, an unbounded
  one at its minimum length, a ⇧ corner squaring -- so every candidate is checked through the
  gesture's own `geometryAt`, and the guides come from the bounds it settles on. (iteration 7)
- **Whether a press adds to the selection is `addsToSelection(mods)`, never `mods.shift`.** Shift
  holds the Select tool, so by the time a tool sees a ⇧-press it is already a Select-tool press.
  (iteration 7)
- **The wheel listener is `{ passive: false }` and calls `preventDefault()` on every event.**
  Otherwise macOS rubber-bands the page and Chrome can back-navigate on horizontal deltas. Deltas
  are accumulated and applied once per frame, Safari's `gesturechange` pinch included. (iteration 1,
  iteration 3)
- **Widening a grab target can expose a latent snap.** Anything that sets a value from a raw pointer
  coordinate needs a grab offset the moment its hit zone is bigger than the slop. (iteration 5)
- **Do not hit-test on `pointermove` for a hover tooltip.** Pointer moves only restart the dwell
  timer; the hit test runs once when it expires. (iteration 5)
- **Use `pointerenter`/`pointerleave`, not `pointerover`/`pointerout`, for anything hover-triggered
  on a control containing an icon.** (iteration 5)
- **`⌘S`/`⌘O` are window listeners in the capture phase, not tool bindings.** They must fire from
  the property panel and pre-empt the browser's own dialog; they match on `e.code` like
  `#globalKey`. (iteration 6)

## Panels and the dock

- **`keepAlive` on `SvDockManager` is required.** Without it `DockNodeView` wraps pane content in
  `{#key active.id}` and rebuilds the canvas on every tab switch. (iteration 2)
- **Run `dedupeManagerNodeIds` on every restored layout.** The library mints node ids from a
  module-scoped counter that resets on reload, so a restored tree collides with fresh nodes and
  breaks a keyed `{#each}`. (iteration 2)
- **A pane's `minSize` binds only along its direct parent split.** Nested two splits deep, it
  floors the inner axis and says nothing about the outer one; only the dock-wide `minSize` does.
  (iteration 7)
- **Never `scrollIntoView`, or `focus()` without `{ preventScroll: true }`, inside a pane.** Both
  scroll the dock's `overflow: hidden` wrappers, which have no scrollbar to scroll back with. Scroll
  the pane's own box by setting its `scrollTop`. (iteration 7)
- **A check that means one pane looks inside that pane's leaf; it never takes the page's first or
  last splitter, Maximize or Float.** Which pane owns the first of each changes whenever the default
  layout does: moving the tree left of the canvas made both of the canvas checks' "first" the
  tree's. (iteration 7)
- **A diagram's panel id contains neither `:` nor `/`.** Object tree rows are keyed `${id}`,
  `${id}:${name}` and `${id}/wires:${name}`, and a name may contain anything, so the id's alphabet
  is all that keeps them apart. (iteration 7)
- **`panelFor` returns `undefined` rather than throwing**, so a saved layout naming a deleted panel
  falls back instead of bricking the app. (iteration 2)
- **Override dock styles as `#app .sv-dock__content`.** The library's rule is scoped (specificity
  0,2,0), so a `:global()` override loses; this wins without `!important`. (iteration 2)
- **A library that positions overlays inside its own subtree needs `position: fixed` to escape the
  pane.** `#app .jse-absolute-popup` does it for the JSON editor against three `overflow: hidden`
  ancestors; `ChromeTooltip` renders at the root for the same reason. (iteration 2)
- **`.jse-main` ships `min-height: 150px`; `PropertiesView` overrides it to `0`.** Below that the
  editor overflows its box instead of shrinking. (iteration 2)
- **A native tooltip is an OS window, so CSS cannot explain it.** Clipping, stacking and containment
  hypotheses are category errors against it — and all live again for a `<div>` tooltip.
  (iteration 5)
- **Measure paint order; do not reason about it.** "The toolbar comes first in the DOM, so its popup
  is above the canvas" is false here, and a three-line probe says so. (iteration 5)
- **Chrome tooltips come from the `tip()` attachment, never a `title` attribute.** The checks assert
  that no control in either pane carries a native one. (iteration 5)
- **A kind's icon is declared once, as `ShapeOps.icon`.** The object tree shows it and the tool that
  draws the kind reads it from the kind's ops, so the two cannot disagree. (iteration 7)
- **Toolbar icons are Lucide components, deep-imported per icon; never hand-written path data, and
  never change an `aria-label`.** Every button's `aria-label` is the checks' selector, so changing
  one is changing a test fixture. (iteration 6)
- **Every `window.__*` hook lives in the DEV block (`App.svelte`, plus `__workspace` in
  `WorkspaceShell`).** The production bundle carries none, and `production.mjs` asserts it.
  (iteration 1)
- **Pop-out stays disabled (`allowPopout={false}`).** A popped-out canvas renders into a second
  `document` while `CanvasSurface` reads `devicePixelRatio` and `matchMedia` from the opener.
  (iteration 2)

## Repo

- **Prettier is 2-space**, deliberately against the repo's 3-space C++/Python convention; see
  `.prettierrc` and `.vscode/settings.json`. (iteration 1)
- **Prettier collapses a signature onto one line whenever it fits in 100 columns.** A scripted edit
  that matches a multi-line signature will find none after a format pass. (iteration 6)
- **The project is standalone npm and is not wired into CMake.** Keep it that way. (iteration 1)
- **`dist/` cannot be opened over `file://`** — ES module scripts are CORS-blocked there. Use
  `npm run preview` or any static server. (iteration 1)
- **The shape, tool and panel registries replace instead of throwing on a duplicate in DEV.** HMR
  re-runs module side effects, and a hard throw would wedge the dev server on every edit; they still
  throw in production. (iteration 1)
