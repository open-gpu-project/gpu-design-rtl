# traceviewer-ts

Client-only web app for viewing `archsim` traces. This directory is a standalone npm project and
is deliberately **not** wired into the CMake build.

The app is a dockable workspace: panels can be split, tabbed, dragged onto one another, floated
into windows, or collapsed to an edge. Three panels exist so far.

- **Diagram** — the architecture canvas, where the hardware design is laid out. Alongside plain
  blocks it carries **queues**, drawn as a run of cells whose length is the cell count times the
  divider pitch (set the count to `-1` for an unbounded queue, drawn as one cell, a stretchable
  gap and three more), and **fabrics**, which carry **network interfaces** on their borders. An
  interface is a first-class object with its own name, protocol and modport, but it is not drawn
  from the toolbar: you set how many a fabric or a block carries and drag them into place. A
  link drawn between two interfaces is a **curve** rather than a rectilinear wire — a straight
  run unless a straight line would leave one port backwards or arrive at the other from behind,
  in which case it bows out along both normals, and bent through waypoints you insert. Every
  box kind carries a label and a subtitle, and `labelMode` decides how they are shown: `inset`
  centres the label in the block with the subtitle beneath it, while `tabbed_left` and
  `tabbed_right` put the label in a small folder tab above a top corner and leave the body
  empty. A subtitle may hold several lines: type a newline into it and each line is drawn in
  turn, all at one size chosen so the widest of them fits, with lines dropped from the bottom
  when the block is too short for all of them. A diagram saves to and opens from a JSON file,
  byte-for-byte the same record `⌘C` writes to the system clipboard — one format, two transports,
  which is why the read pipeline is shared. The transport is a Blob download and an
  `<input type="file">` rather than the File System Access API, which Safari does not implement.
  Hovering a block or a wire raises a tooltip — a block's description, a wire's name and
  description, and in the tabbed modes the subtitle too, since that is the only place it appears,
  one paragraph per line. Drag a band with the select tool to select several at once, and copy,
  cut and paste them as a group -- a connection comes along when both of its blocks do, and a pasted copy
  fills the gaps in its own numbering, so copies of `block0, block2` arrive as `block1, block3`.
- **Properties** — an editable tree view of the selected block, validated live against a JSON
  Schema generated from that object kind's property declaration, with a footer documenting
  whichever key is selected. Keys are ordered `kind`, then the ones you can edit, then the ones
  the app derives, each group alphabetical. Rows the app owns rather than you — the draw
  order, and a connection's route and two endpoints, which the canvas sets — are greyed and
  refuse to be typed into; the footer says which, and a refusal says where to change it
  instead. The footer is never shorter than the text in it;
  drag the divider above it (or focus it and use the arrow keys, `⇧` for a coarser step) to
  give it more room than that, and the extra is remembered. Right-click a property for the eight
  actions a property bag has: the two edit buttons, cut/copy/paste, insert before/after, and
  remove. It also shows a selected trace event, read-only.
- **Trace** — signals down the left, time across the right. An event is drawn as a flag: a stem
  at its exact tick with a labelled body on the upper half of the row. Records sharing a tick
  merge into one flag reading `N events`. The time cursor is a flag of the same kind: a
  full-height stem with a yellow body at the top holding the tick, flying left instead of right
  when it would run off the end. It snaps to whole ticks, and the tick field in the toolbar is
  editable and follows it.

**Selection is global.** Selecting a trace row or a flag clears the block selection and vice
versa, so the Properties panel always describes one thing. Selecting a flag puts the cursor on
it; moving the cursor onto a flag of the selected row selects that flag.

Value-change signals are in the data model but are not drawn yet; they get span lanes later.
The layout is saved to `localStorage`; in a dev build, `window.__resetLayout()` restores the
default.

## Running

Uses whatever Node is on your PATH (>= 22; Homebrew's is fine). No version manager.

```fish
npm install
npm run dev        # http://localhost:5183
npm run check      # svelte-check + tsc
npm run build      # check, then a static bundle in dist/
npm run verify     # browser checks, against a running dev server
```

`npm run check` passing means very little here; see
[history/conventions.md](history/conventions.md). `npm run verify` is 569 assertions across eleven
suites, and `verify/production.mjs` adds 16 against the built bundle. Anything touching
the canvas, the camera, DPI, or the property round trip has to be run in a real browser at
`deviceScaleFactor: 2`. `verify/` is what does that.

## Controls

| Gesture                                               | Action                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Drag empty space / middle-drag / space+drag           | Pan                                                        |
| Two-finger scroll (trackpad)                          | Pan                                                        |
| Mouse wheel, trackpad pinch                           | Zoom at the cursor                                         |
| `⌘`+wheel / `⇧`+wheel                                 | Force zoom / force horizontal pan                          |
| `1` / `2` / `3` / `4` / `5` / `6`                     | Pointer / Select / Rectangle / Connection / Queue / Fabric |
| Drag with the select tool                             | Select everything the band touches                         |
| `⇧`+drag with the select tool                         | Add the band's contents to the selection                   |
| Drag with the rectangle tool                          | Draw a block, snapped to the grid                          |
| Drag with the queue or fabric tool                    | Draw a FIFO or a switch fabric                             |
| Drag a network interface                              | Slide it along its parent's border, or onto another        |
| Click two network interfaces with the connection tool | Draw a bus link between them, straight where it can be     |
| Click the `+` on a selected curve                     | Insert a waypoint there                                    |
| Click a waypoint, then `⌫`                            | Remove just that waypoint                                  |
| Click two block edges with the connection tool        | Draw an arrow between them                                 |
| Drag a segment of a selected connection               | Reshape its route, pinning it to manual routing            |
| Drag a round bead on a selected connection            | Slide that end along its edge, or onto another block       |
| Click a block, then drag its body or handles          | Move or resize                                             |
| Hold the pointer still over a block or wire           | Show its description as a tooltip                          |
| Hold the pointer still over a toolbar button          | Show its name and keyboard shortcut                        |
| `⇧`+click                                             | Add to or remove from the selection                        |
| `⌫`                                                   | Delete the selection                                       |
| `⌘C` / `⌘X` / `⌘V`                                    | Copy / cut / paste the selection                           |
| `⌘S` / `⌘O`                                           | Save the diagram to a file / open one                      |
| `⌘Z` / `⇧⌘Z`                                          | Undo / redo                                                |
| `⌘]` `⌘[` `⇧⌘]` `⇧⌘[`                                 | To front / to back / forward / backward                    |
| `⌘0` / `⌘1`                                           | Reset zoom / zoom to fit                                   |
| `Esc`                                                 | Cancel the current gesture, then clear the selection       |

In the trace panel:

| Gesture                                        | Action                                        |
| ---------------------------------------------- | --------------------------------------------- |
| Trackpad pinch, `^`+wheel, `⌘`+wheel           | Zoom the time axis at the cursor              |
| `⇧`+wheel, horizontal trackpad scroll          | Pan time                                      |
| Wheel, two-finger vertical scroll              | Scroll the rows                               |
| Middle-drag / space+drag                       | Pan both axes                                 |
| Click the timescale, or drag the cursor's flag | Move the time cursor, snapped to a whole tick |
| Click a row, or its name in the gutter         | Select that trace                             |
| Click a flag or its stem                       | Select the event, and move the cursor to it   |
| `←` / `→`                                      | Previous / next event on the selected trace   |
| `⇧`+`←` / `→`                                  | Move the cursor one tick                      |
| `Home` / `End`                                 | First / last event on the selected trace      |
| `⌘1`, `+` / `-`                                | Fit the whole trace, zoom in / out            |
| Drag the gutter's right edge                   | Resize the name column                        |

Shortcuts only fire while their panel owns the keyboard, so `⌫` in the property editor
removes a JSON node rather than a block, and `←` in the trace panel does not reach the canvas.

There are no scrollbars anywhere. The canvas is driven by a virtual camera clamped to the content
bounding box plus a buffer, so panning hard-stops rather than running off into empty space.

## Layout

```
src/lib/geom/      Vec2, Rect, and the small amount of geometry everything else shares
src/lib/canvas/    Camera, renderer, dot grid, hit testing, wheel/trackpad input, text, theme,
                   and what both canvases share: the viewport base, the frame loop, and the
                   surface contract
src/lib/scene/     The document: shapes, z-order, bounds, history, serialization
src/lib/props/     Property declarations, the JSON Schema generator, projection, validation,
                   and the property editor's context menu
src/lib/tools/     Tool contract, registry, pointer plumbing, and the six tools (three of them
                   one drag-to-create tool, `create-tool.ts`)
src/lib/trace/     The trace document: model, queries, the synthetic fixture, and the store
src/lib/timeline/  The trace panel's canvas: camera, tick ladder, flag layout, renderer, hit
                   testing, input host, and its theme
src/lib/panels/    Panel registry and one registration file per panel
src/lib/dock/      Default workspace, and layout persistence with its fallbacks
src/lib/ui/        Hover tooltips for DOM chrome (one layer, opted into per element), and the
                   file transport: download and file picker
src/lib/session.svelte.ts   Scene, camera, tool host and renderer -- owned by the app, not a panel
src/components/    Dock shell, panel host, canvas surface, toolbar, status bar, tooltips
src/views/         One component per panel: DiagramView, PropertiesView, TraceView
verify/            Playwright checks against a real browser at deviceScaleFactor 2
```

The session is deliberately **not** owned by the canvas panel: the dock re-mounts a pane's content
when it is maximized, floated or popped out, and the document must not be able to die with it.

### Adding a shape kind

Write `src/lib/scene/shapes/<kind>.ts` implementing `ShapeOps` and `<kind>.props.ts` declaring its
properties, call `registerShape` at the bottom, widen the `Shape` union in `shape.ts`, and add the
import to `src/lib/register.ts`. Nothing else switches on `kind`.

**If the props file needs anything from the kind file, put it in a third module.** The kind file
is what `register.ts` imports, so `<kind>.props.ts` importing back from `<kind>.ts` closes a
cycle — and because the props module consumes those values while it is still evaluating its
top-level array, they land in the temporal dead zone and the app dies at load with
`Cannot access '…' before initialization`. `fifo-geom.ts` and `nif-geom.ts` are that third
module; `rect` and `conn` never needed one because their props files ask for nothing back.

A kind that is nothing but a headed box carrying interfaces is one `plainBoxOps` call in
`shapes/plain-box.ts` — that is all `rect` and `fabric` are. Any other kind that draws an
axis-aligned box should delegate to `shapes/box.ts` for its handles, resize arithmetic, perimeter
anchors and body, to `shapes/heading.ts` for its label, and to
`props/common.ts` for the nine properties every box repeats.

### Adding a property

One entry in that kind's `props` array. The generated JSON Schema, the live validation, the row in
the property editor, the footer documentation and the saved file format all follow from it — a
property's `doc` string is user-facing documentation, not a code comment.

Where you put it in the array does not matter. `propSchema` sorts every declaration into one
canonical order — `kind`, then the editable keys, then the generated ones, each group
alphabetical — and that order is what the panel, the schema and the saved file all use.

A property whose type is an `enum` renders as a dropdown offering exactly the declared values —
but only while it is editable, since a dropdown on a read-only key would look like a choice and
be refused whichever way it was moved.

A property's `mode` says who owns it, not how permanent it is. `edit` is yours; `fixed` is
saved and restored but set by some other part of the app; `computed` is re-derived and never
written to the file. A `fixed` property still needs its `write` — that is what the loader puts
the saved value back with.

Properties are flat by construction: the value grammar has no object case, only scalars,
fixed-length tuples of scalars, and lists of either. A polyline is `list[tuple[int, int]]`.

### Adding a panel

Write `src/views/<Name>View.svelte` reading the session from `useSession()`, add a three-line
`src/lib/panels/<name>-panel.ts` calling `registerPanel`, and add the import to
`src/lib/register.ts`. The dock resolves pane ids through the registry.

### Adding a tool

Write `src/lib/tools/<name>-tool.ts` implementing `Tool`, call `registerTool` at the bottom, and
add the import to `src/lib/register.ts`. The toolbar renders from the registry, so the button
appears on its own. A tool that creates a shape by dragging out its two corners is not a new file
at all: it is one `registerCreateTool` call in `tools/create-tool.ts`.

The declaration says which cluster it belongs in (`group`: `tool` for something you do to what is
already there, `shape` for something that adds) and where it sits inside that cluster (`order`).
Its digit is not declared: the registry hands out `1`…`9` by toolbar position, so the keys always
count left to right and inserting a tool renumbers its neighbours for you.

`icon` is a [Lucide](https://lucide.dev) component, deep-imported one module per icon
(`import Spline from '@lucide/svelte/icons/spline'`) so the 1600-icon package contributes only
what is used. Never hand-write SVG path data for a toolbar button, and never pass a `title` prop:
tooltips come from the `tip()` attachment, and the checks assert that no control in either pane
carries a native one. `aria-label` is the checks' selector for every button here, so changing
one is changing a test fixture.

## Iteration history

`history/` records each iteration: what was decided, by whom, and why, and what went wrong on
the way. Two living documents come first, and are the ones to read before a structural change —
several of the defects found so far compile and type-check cleanly and only fail at runtime.

- [conventions.md](history/conventions.md) — every rule the code relies on that the type checker
  cannot enforce, grouped by area: verification, measuring Safari, Svelte and reactivity, canvas
  and text, the document model and commit path, tools and input, panels and the dock, the repo.
- [open-items.md](history/open-items.md) — everything flagged and not yet done, and the seams
  that exist for future work, each tagged with the iteration that raised it.
- [iter-1-canvas-foundation.md](history/iter-1-canvas-foundation.md) — the canvas, camera, grid,
  tools, undo and z-order, and the post-type-check bugs that set how this project is verified.
- [iter-2-docking-and-properties.md](history/iter-2-docking-and-properties.md) — the dock shell,
  the panel registry and the schema-driven property editor. Why a shape's identity is its
  `name`, how the editor round trip avoids a feedback loop, and one upstream dock bug.
- [iter-3-trace-panel.md](history/iter-3-trace-panel.md) — the trace panel (the data model taken
  from the real `ARCHTRC` producer, flags, the tick ladder, the time cursor, global selection),
  and render performance: why the dot grid cost Safari O(area), and the row strips that made it
  O(perimeter) and pixel-identical.
- [iter-4-connections.md](history/iter-4-connections.md) — directed rectilinear connections: the
  scoring router and why it bundles, sliding perimeter anchors, the reroute fold, the identity
  guard that keeps a dependency pass out of the undo history, the canonical key order, draggable
  endpoints, and what `fixed` means for state the panel shows but the canvas owns.
- [iter-5-ux-polish.md](history/iter-5-ux-polish.md) — papercuts found by using the app:
  subtitles and label tabs, hover and toolbar tooltips, marquee selection and the clipboard, and
  block text that spends a shrinking block's height as a budget instead of vanishing.
- [iter-6-components.md](history/iter-6-components.md) — queues, network interfaces, fabrics and
  curved bus links; the dependency fold that settles; saving and opening a diagram; multi-line
  subtitles; and the text width cache, the shape-count half of the Safari slowdown.

The unabridged notes for each sub-iteration, and the two Safari measurement reports, are in git
at commit `e56a67d`.
