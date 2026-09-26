# Open items

Everything flagged as unfinished that still holds in the code, grouped by area, then the seams that
exist for future work; each tagged with the iteration that raised it.

## Verification

- **No unit suite.** `verify/` is Playwright against a running app. The pure pieces are the first
  things a Vitest suite should cover: `tickTiers` (reached today only through `window.__tickTiers`)
  and the grid's geometry — `level`, `minorStep`, `minorAlpha`, the strip's column positions. See
  [conventions.md](conventions.md) for the `environment: 'node'` trap. (iteration 1, iteration 3)
- **Unverifiable without real hardware:** whether a physical mouse wheel on macOS produces deltas
  large enough to classify as zoom rather than pan, and whether Safari's `gesturechange` pinch
  double-applies. Synthetic events cannot settle either; the `⌘`/`⇧` overrides always work.
  (iteration 1)
- **`report` does not fail on page errors.** Only a few groups assert that nothing threw. Worth
  making it fail by default, with the known upstream dock error (`reading 'id'`) filtered explicitly
  where it occurs. (iteration 4)
- **7.0 has had no real-Safari pass.** The manual checks (toolbar centring, the ⇧ hold from every
  tool, ⌘-click and ⌘-band, tree reveal and keyboard) were run in Edge at dpr 2 only.
  (iteration 7)
- **Dock auto-hide is enabled but untested.** Float, maximise and tabs are covered; the edge-strip
  fly-out is not. (iteration 2)

## Measuring Safari

- **The Properties panel's repaint while visually static is unexplained.** In the Safari measurement
  three quarters of all painting landed in that panel, and why WebKit escalates a status-bar text
  change into repainting every JSON tree row could not be reproduced in Playwright's WebKit. The
  readouts that dirtied the document at input frequency have since been fixed; whether anything
  remains needs a real Safari recording. (iteration 3) (unconfirmed)

## Canvas and text

- **No position affordance.** With no scrollbars nothing shows where the viewport sits in the world;
  the status bar readout and `⌘1` are the mitigations. If orientation suffers on a large diagram,
  add a canvas-drawn minimap — not scrollbars. (iteration 1)
- **`BUFFER` (1024) caps reach.** You can only pan to empty space within 1024 units of content, so
  placing a block far away means working outward in steps. (iteration 1)
- **The major→minor hand-off pops at `z = 0.5`.** The same dots change size and colour across the
  boundary; the minor tier's own fade is continuous, the hand-off is not. A true cross-fade needs a
  three-tier scheme; probably not worth it. (iteration 1, iteration 3)
- **A dot whose centre falls just off the top or left edge is dropped, while one just off the bottom
  or right is drawn clipped.** The row and column origins start at `≥ 0` but end at `< devH`/`devW`.
  A real asymmetry, deliberately never fixed in a change that needed a clean pixel diff.
  (iteration 3)
- **A stale `Renderer.dispose()` loses a frame.** The dock may mount the new pane before the old
  one's cleanup; the stale dispose runs `FrameLoop.cancel()`, dropping a pending frame until the
  next state change. The grid survives it by design; the frame loss is untouched. (iteration 3)
- **Hit-testing is linear** over all shapes on every `pointermove`, and `shapesInRect` is linear per
  marquee move. When a design gets large, add a bounds broadphase inside `hitTest` (its signature
  need not change); the marquee and the renderer's cull loop want the same index. (iteration 1,
  iteration 5)
- **`zoomToFit` pads in world units** (`pad = 64`), so it cannot guarantee room for screen-sized
  decoration such as a label tab. One line, if a cropped tab ever annoys anyone. (iteration 5)
- **A tall narrow block ends in a stub.** Below the 8 px floor the label ellipsizes, so `MEMORY` and
  `MEM_CTL` both read `ME…` on a 70-wide block at 35 %. Refusing to cut below two surviving
  characters would help; it is a second tuned threshold, which `theme.ts` argues against.
  (iteration 5)
- **Label fill is not monotone in block height**, dipping to about 43 % just under the subtitle
  threshold. Unfixable while 13 px is a hard ceiling; revisit if "shrink only" is ever relaxed.
  (iteration 5)
- **`boundsOf` will be asked to do more.** Culling a connection's label against a neighbouring block
  is the next thing that wants it; resist widening it to return the whole shape. (iteration 5)
- **The timeline's `fitText` calls are uncached** — the flag label fit in `timeline/renderer.ts` and
  `fitSignalName`, which does its own probing. Different surface from the diagram's width cache.
  (iteration 6)
- **On a selected `tabbed_left` block the tab and the `nw` resize handle overlap.** Both stay
  hittable (handles win, and are tested), but it is visually tight. (iteration 5)
- **Selection shows without handles while a create tool is active**, because handles belong to the
  pointer tool's overlay. Correct, arguably inconsistent; cosmetic. (iteration 1)

## Document model and commit path

- **Undo is snapshot-based, capacity 200.** If shape counts reach tens of thousands, swap in patches
  behind the same `History` interface; nothing outside `history.svelte.ts` changes. (iteration 1)
- **The object tree is read-only.** It lists every object topmost first and selects from a click,
  but has no drag-to-reorder, no rename in place, no type-ahead and no ⇧-range selection; the four
  restack commands are still the only way to change z-order. (iteration 1, iteration 7)
- **`size` allows values below `GRID`.** The schema floor is 1 (the user asked for "positive
  non-zero"), and property edits bypass `normalize()`, so a 1×1 block is effectively unclickable and
  the panel is the only way back. Raising the floor is one line in `sizeProp` (`props/common.ts`).
  (iteration 2)
- **`name` has no character-set constraint**, only `minLength: 1`. If names are ever emitted as RTL
  identifiers, an identifier pattern is one line in `nameProp`. (iteration 2)
- **A refusal quotes the property's whole `doc`.** `applyDocument` composes
  `` `${how}. ${d.doc}` ``, which for a long doc buries the one sentence the user needs. Worth a
  short `insteadDo` the refusal uses on its own. (iteration 4)
- **`fixed` has two populations** — `kind`, which the loader has already acted on, and the geometry,
  which has a writer. A third kind of `fixed` property deserves a hard look before it is added.
  (iteration 4)
- **`propSchema` has no per-kind ordering escape hatch.** If a kind ever wants a curated order, that
  is the one place to add it. (iteration 4)
- **A `trace` key beside `shapes` in the saved file.** The format is shaped for it (`parseSceneDoc`
  tests only that `shapes` is an array); nothing reads it yet. (iteration 6)

## Connections and routing

- **No obstacle avoidance, rectilinear or curved.** A route between distant blocks crosses a third;
  a curve's `autoWaypoints` knows only its two anchors, and an inward link's automatic bow inside a
  crossbar has more to hit. The user hand-routes, which pins the route — the bargain that makes the
  three-segment cap defensible. The single largest gap. (iteration 4, iteration 6)
- **Self-connections between blocks are refused outright.** With no obstacle avoidance a same-block
  route would cut through the block; supporting it means one dedicated loop case in the router.
  (iteration 4)
- **Two connections with identical anchor pairs are indistinguishable**, and only the topmost is
  selectable on the canvas. (iteration 4)
- **Head-to-head anchors facing away** get a route that leaves along the face rather than across it
  — correct and rectilinear, not what a person draws. The fix is a five-segment U, beyond
  `ROUTE_MAX_SEGMENTS`. (iteration 4)
- **A pinned route can fall back to a full re-route** when patching its ends would leave it
  non-rectilinear, silently discarding that edit (it keeps `manual`). For routes of three or more
  points `patchStart`/`patchEnd` stay rectilinear by construction, so this is now the short-route
  case. (iteration 4)
- **Re-binding a manual route to another block stretches it rather than redrawing it** — a long
  dog-leg to the new block. Correct by the rule that a pinned route is the user's; offering a
  re-route on a cross-block rebind may still be worth it. (iteration 4)
- **An endpoint dragged deep into a block jumps to a face midpoint.** `anchorAt` collapses to the
  midpoint past `ANCHOR_BAND_PX` on purpose; a modifier to keep the current face would be the
  refinement. (iteration 4)
- **Nothing on the canvas hands a pinned route back to the router.** The panel's `routing` does; a
  **Re-route** command over the selection would be the discoverable version, and
  `replaceShape(c, { ...c, routing: 'auto' })` already does the work. (iteration 4)
- **Corridor insertion is O(n) per run.** Irrelevant below a few thousand corridors; `CorridorQuery`
  is the seam for a bucketed replacement. (iteration 4)
- **A pasted `auto` connection may not route like its original.** Corridors accumulate over
  everything below in the array and paste appends, so a pasted wire can bundle onto the original's
  run — most visible one cell away. An `auto` route's saved `points` are advisory. (iteration 5)
- **A curve's label sits at the arc midpoint with no minimum-length test**, unlike the rectilinear
  branch's `CONN_LABEL_MIN_RUN_PX`. Since links run straight wherever they can, nearly every bus
  label rides a diagonal chord, and a very short link crowds. (iteration 6)

## Components

- **Interfaces do not avoid each other when dragged.** `freeOffset` applies only when the count
  grows, so two ports can be dragged onto one spot; and its scan step is the interface length, so on
  a crowded face it can miss an unaligned gap and overlap sooner than it must. (iteration 6)
- **`MAX_CELLS` (1024) is a drawing limit, not a hardware one.** A deeper queue has to be drawn
  unbounded. (iteration 6)
- **A minimum-size unbounded queue's gap is 8 units** (half the pitch). It reads as a break because
  both borders are dashed, but it is the tightest the 1-gap-3 shape has been drawn. (iteration 6)

## Tools and input

- **Trackpad two-finger pan is unavailable to mouse users, and wheel zoom to trackpad users**, by
  construction; `⇧`+wheel and `⌘`+wheel cover both. (iteration 1)
- **No duplicate command.** `⌘D` is free, and would be copy-then-paste with a fixed offset.
  (iteration 5)
- **Paste reads the in-memory clipboard only.** Copy mirrors the JSON to the system clipboard
  best-effort, but nothing can be pasted in from another window or app;
  `navigator.clipboard.readText()` is async and focus-gated. (iteration 5)
- **The marquee has no keyboard equivalent, and the canvas hover tooltip is not keyboard-reachable**
  (hover-only, `pointer-events: none`). Selecting a block and pressing a key should probably raise
  it. Toolbar tooltips do show on keyboard focus. (iteration 5)
- **Mac-only key notation is a decision.** If this ever runs on Windows in earnest, `keys.ts` is the
  one file to change; its `KeyToken` names (`cmd`, `opt`) already read as abstract roles.
  (iteration 5)
- **`aria-keyshortcuts` is not set** on any tool button, though it is the semantically correct home
  for a tool's key. (iteration 5)
- **A ⇧-press on a corner handle bands instead of resizing square.** The hold engages at the press,
  so the square constraint is reached only by pressing ⇧ after the corner drag has started.
  (iteration 7)
- **A Shift-first ⇧⌘ chord flips the toolbar to Select while it is held.** Shift pressed alone
  starts the hold before ⌘ arrives; the chord itself still works, and the release puts the tool
  back. ⌘ first is a chord and never flips. `⇧`+wheel, the forced horizontal pan, shows the same
  flip. (iteration 7)

## Panels and the dock

- **Only one diagram pane and one trace pane may exist.** The session owns a single `ViewController`
  and a single `TimelineView`; two panes would fight over `attach()`. Enforced only by
  `closable: false` and by never minting a second pane. (iteration 2, iteration 3)
- **A second diagram needs more than a second `DiagramEntry`.** The object tree already renders a
  root per entry, but keys pressed in the tree go to the one diagram `acceptsKeys` names, there is
  no rule for a selection spanning two diagrams, and selecting in the tree does not activate the
  pane that shows it. (iteration 7)
- **The right column has only the dock-wide width floor.** `minSize` binds along a pane's direct
  parent split, and Objects and Properties now share a column, so Properties' 280 floors its
  height and nothing but the dock's 200 floors the column's width. (iteration 7)
- **The toolbar needs 711 CSS px.** In a narrower diagram pane the View zone runs off the right
  edge and the Tools zone is no longer centred. The single left-packed row it replaced needed the
  same width and clipped the same way. (iteration 7)
- **A tree selection made during a pending connection reaches Properties only when that gesture
  ends.** The canvas and the tree show it at once; the property push is deferred while
  `isGesturing()`, as it is for every selection. (iteration 7)
- **Pop-out is disabled** until `CanvasSurface` reads `devicePixelRatio` and `matchMedia` from the
  document it is actually in. (iteration 2)
- **Bundle size.** `svelte-jsoneditor` statically imports `TextMode`, so CodeMirror ships though
  only tree mode is used. Code-splitting the Properties panel behind a dynamic `import()` would keep
  the canvas's first paint cheap; worth doing before a third heavy panel. (iteration 2)
- **The validator is one push behind on a kind switch.** It is still a `$derived` of `shownSpec`,
  which the synchronous render re-reads mid-push. The fix is a stable function that dispatches
  through a plain `let`, the way `onClassName` does. (iteration 4)
- **`docsWanted` is capped at the current `docsMax` on write**, so a drag inside a temporarily short
  pane lowers the stored preference for good. Arguably right, but it is the one place the wish is
  not purely the user's. (iteration 4)
- **The property editor still says `Ctrl`.** `svelte-jsoneditor` normalises every platform to
  `Ctrl+…` in its own menus, so the app reads `⌘` everywhere except inside the JSON tree.
  (iteration 5)
- **The status bar's `world` and `dpr` tooltips are attached to plain `<span>`s** with no accessible
  name, so the description is attached to nothing. Better as `<abbr>` or labelled readouts.
  (iteration 5)
- **No warm window between toolbar tooltips.** Moving between controls always pays the full dwell
  again; most toolbars make the next tooltip instant for a moment. Left out because it trades a
  testable single rule for a stateful one — the most likely thing to want next. (iteration 5)
- **Native tooltips remain in the dock and the JSON editor.** If they matter on another machine, the
  discriminating test is manual: hover one control, a second, then the first again; a dead third
  hover is AppKit's tooltip string cache under an always-on-top window. (iteration 5)
- **The trace canvas has no hover tooltips.** Its control strip uses `tip()`, but a signal name
  truncated by `fitSignalName` in the gutter is the obvious next caller of `CanvasTooltip`.
  (iteration 5)
- **No status-bar severity.** A failed load reports as ordinary hint text; severity needs a danger
  colour token and a second field on `ToolHost`. The message clears on the next save or load.
  (iteration 6)

## Trace panel

- **No `ARCHTRC` reader.** It goes behind `TraceDoc` with no consumer change, and needs a BEVE
  decoder plus a port of `reinterpret_to_json` driven by the `x-beve-order` / `x-beve-enum` sidecar.
  The body's 8-byte record framing is deliberately not BEVE so a reader can skip values it does not
  understand, and a trace whose producer crashed has a valid header but no `ARCHEND` trailer, which
  the reader must tolerate. (iteration 3)
- **No trace is loadable from disk.** `loadTrace()` exists and only the synthetic fixture calls it.
  (iteration 3)
- **Rows are fixed-height and not virtualised beyond the visible window.** Per-frame cost is already
  bounded by `first`/`last`. (iteration 3)
- **`MAX_SCAN_PER_ROW` striding drops records at extreme zoom-out.** Visually indistinguishable, but
  a density strip would be more honest than a sample. (iteration 3)

## Seams left for future work

These are in the code, unused or under-used, so the next change is additive. Do not remove them as
dead code.

- **Value-span lanes.** `TraceSignal.display` already discriminates `'event' | 'value'`, the fixture
  contains `'value'` signals, and `TraceStore.load` is the one place that filters them out of
  `rows`. (iteration 3)
- **Row order is `TraceStore.rows`**, a plain array of ids; grouping, filtering and drag-reorder all
  hang off that one field. (iteration 3)
- **`CorridorQuery` is an interface, not the class**, so `CorridorIndex` can be replaced by a
  bucketed implementation without touching any shape. (iteration 4)
- **`RouteContext` is a record with one field** (`corridors`), so routing inputs can be added
  additively. (iteration 4)
- **`ROUTE_MAX_SEGMENTS` is a named constant the cost function reads**, so raising the cap is one
  edit plus new candidate generators. (iteration 4)
- **`appendRoutePath` is split out of `connOps.draw`** so a future renderer layer can batch every
  unselected connection into one `beginPath`/`stroke`. The layer is not built. (iteration 4)
- **`ShapeOps.subPartOf` / `subPart` / `removeSubPart`** are named for sub-parts in general, not
  waypoints; a curve is the only kind with any. (iteration 6)
- **`Handle.glyph` has one value (`'plus'`).** A second kind of action handle would want a second.
  (iteration 6)
- **A third panel** is one view, a three-line `registerPanel` file and one line in `register.ts`;
  `panelFor` returning `undefined` keeps a saved layout naming a missing panel loadable.
  (iteration 2)
