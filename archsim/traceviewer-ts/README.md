# traceviewer-ts

Client-only web app for viewing `archsim` traces. This directory is a standalone npm project and
is deliberately **not** wired into the CMake build.

The app is a dockable workspace: panels can be split, tabbed, dragged onto one another, floated
into windows, or collapsed to an edge. Three panels exist so far.

- **Diagram** — the architecture canvas, where the hardware design is laid out as blocks.
- **Properties** — an editable tree view of the selected block, validated live against a JSON
  Schema generated from that object kind's property declaration, with a footer documenting
  whichever key is selected. Drag the divider above that footer (or focus it and use the arrow
  keys, `Shift` for a coarser step) to trade tree height for documentation height; the split is
  remembered. Right-click a property for the eight actions a property bag has: the two edit
  buttons, cut/copy/paste, insert before/after, and remove. It also shows a selected trace
  event, read-only.
- **Trace** — signals down the left, time across the right. An event is drawn as a flag: a stem
  at its exact tick with a labelled body on the upper half of the row. Records sharing a tick
  merge into one flag reading `N events`. A yellow cursor snaps to whole ticks; the tick field
  in the toolbar is editable and follows it.

**Selection is global.** Selecting a trace row or a flag clears the block selection and vice
versa, so the Properties panel always describes one thing. Selecting a flag puts the cursor on
it; moving the cursor onto a flag of the selected row selects that flag. Trace rows will
eventually select the matching diagram block — the seam is `EditorSession.signalToShape`.

Value-change signals are in the data model but are not drawn yet; they get span lanes later.
The layout is saved to `localStorage`; `window.__resetLayout()` restores the default.

## Running

Uses whatever Node is on your PATH (>= 22; Homebrew's is fine). No version manager.

```fish
npm install
npm run dev        # http://localhost:5183
npm run check      # svelte-check + tsc
npm run build      # check, then a static bundle in dist/
npm run verify     # browser checks, against a running dev server
```

`npm run check` passing means very little here; see the conventions section of the latest
iteration document. `npm run verify` is 158 assertions across five suites. Anything touching the canvas, the camera, DPI, or the property round trip
has to be run in a real browser at `deviceScaleFactor: 2`. `verify/` is what does that.

## Controls

| Gesture                                      | Action                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| Drag empty space / middle-drag / space+drag  | Pan                                                  |
| Two-finger scroll (trackpad)                 | Pan                                                  |
| Mouse wheel, trackpad pinch                  | Zoom at the cursor                                   |
| `Cmd`+wheel / `Shift`+wheel                  | Force zoom / force horizontal pan                    |
| `1` / `2`                                    | Select tool / Rectangle tool                         |
| Drag with the rectangle tool                 | Draw a block, snapped to the grid                    |
| Click a block, then drag its body or handles | Move or resize                                       |
| `Shift`+click                                | Add to or remove from the selection                  |
| `Delete`                                     | Delete the selection                                 |
| `Cmd+Z` / `Shift+Cmd+Z`                      | Undo / redo                                          |
| `Cmd+]` `Cmd+[` `Shift+Cmd+]` `Shift+Cmd+[`  | To front / to back / forward / backward              |
| `Cmd+0` / `Cmd+1`                            | Reset zoom / zoom to fit                             |
| `Esc`                                        | Cancel the current gesture, then clear the selection |

In the trace panel:

| Gesture                                        | Action                                        |
| ---------------------------------------------- | --------------------------------------------- |
| Trackpad pinch, `Ctrl`+wheel, `Cmd`+wheel      | Zoom the time axis at the cursor              |
| `Shift`+wheel, horizontal trackpad scroll      | Pan time                                      |
| Wheel, two-finger vertical scroll              | Scroll the rows                               |
| Middle-drag / space+drag                       | Pan both axes                                 |
| Click the timescale, or drag the yellow handle | Move the time cursor, snapped to a whole tick |
| Click a row, or its name in the gutter         | Select that trace                             |
| Click a flag or its stem                       | Select the event, and move the cursor to it   |
| `←` / `→`                                      | Previous / next event on the selected trace   |
| `Shift`+`←` / `→`                              | Move the cursor one tick                      |
| `Home` / `End`                                 | First / last event on the selected trace      |
| `Cmd+1`, `+` / `-`                             | Fit the whole trace, zoom in / out            |
| Drag the gutter's right edge                   | Resize the name column                        |

Shortcuts only fire while their panel owns the keyboard, so `Delete` in the property editor
removes a JSON node rather than a block, and `←` in the trace panel does not reach the canvas.

There are no scrollbars anywhere. The canvas is driven by a virtual camera clamped to the content
bounding box plus a buffer, so panning hard-stops rather than running off into empty space.

## Layout

```
src/lib/geom/      Vec2, Rect, and the small amount of geometry everything else shares
src/lib/canvas/    Camera, renderer, dot grid, hit testing, wheel/trackpad input, theme
src/lib/scene/     The document: shapes, z-order, bounds, history, serialization
src/lib/props/     Property declarations, the JSON Schema generator, projection, validation,
                   and the property editor's context menu
src/lib/tools/     Tool contract, registry, pointer plumbing, and the two tools
src/lib/trace/     The trace document: model, queries, the synthetic fixture, and the store
src/lib/timeline/  The trace panel's canvas: camera, tick ladder, flag layout, renderer, hit
                   testing, input host, and its theme
src/lib/panels/    Panel registry and one registration file per panel
src/lib/dock/      Default workspace, and layout persistence with its fallbacks
src/lib/session.svelte.ts   Scene, camera, tool host and renderer -- owned by the app, not a panel
src/components/    Dock shell, panel host, canvas surface, toolbar, status bar
src/views/         One component per panel: DiagramView, PropertiesView, TraceView
verify/            Playwright checks against a real browser at deviceScaleFactor 2
```

The session is deliberately **not** owned by the canvas panel: the dock re-mounts a pane's content
when it is maximized, floated or popped out, and the document must not be able to die with it.

### Adding a shape kind

Write `src/lib/scene/shapes/<kind>.ts` implementing `ShapeOps` and `<kind>.props.ts` declaring its
properties, call `registerShape` at the bottom, widen the `Shape` union in `shape.ts`, and add the
import to `src/lib/register.ts`. Nothing else switches on `kind`.

### Adding a property

One entry in that kind's `props` array. The generated JSON Schema, the live validation, the row in
the property editor, the footer documentation and the saved file format all follow from it — a
property's `doc` string is user-facing documentation, not a code comment.

Properties are flat by construction: the value grammar has no object case, only scalars,
fixed-length tuples of scalars, and lists of either. A polyline is `list[tuple[int, int]]`.

### Adding a panel

Write `src/views/<Name>View.svelte` reading the session from `useSession()`, add a three-line
`src/lib/panels/<name>-panel.ts` calling `registerPanel`, and add the import to
`src/lib/register.ts`. The dock resolves pane ids through the registry.

Connections between entities are the next thing to build. `ShapeOps` already reserves
`dependsOn`, `reroute` and `anchors` for them, and `SceneStore.commit` already calls through to
those hooks, so a connection kind should not need changes to any existing mutation path.

### Adding a tool

Write `src/lib/tools/<name>-tool.ts` implementing `Tool`, call `registerTool` at the bottom, and
add the import to `src/lib/register.ts`. The toolbar renders from the registry, so the button
appears on its own.

## Iteration history

`history/` records each revision: what was decided and why, what scaffolding was left for the next
one, and what is flagged as unfinished. Read the latest before making structural changes —
particularly the conventions section, since several of the defects found so far compile and
type-check cleanly and only fail at runtime.

- [iter-1-canvas-foundation.md](history/iter-1-canvas-foundation.md) — the canvas, camera, grid,
  tools, undo, and z-order. Nine post-type-check bugs and the seams reserved for connections.
- [iter-2-docking-and-properties.md](history/iter-2-docking-and-properties.md) — the dock shell,
  the panel registry, and the schema-driven property editor. Why a shape's identity is its
  `name`, how the editor round trip avoids a feedback loop, and one upstream dock bug.
- [iter-3-trace-panel.md](history/iter-3-trace-panel.md) — the trace panel: the data model taken
  from the real `ARCHTRC` producer, flags, the tick ladder, the time cursor, and global
  selection. Why the selected flag is derived rather than stored.
- [iter-3-1-render-performance.md](history/iter-3-1-render-performance.md) — why the canvas gets
  slower the larger the window, and the four defects behind it. Why `createPattern` is the wrong
  answer. Supporting measurements in
  [safari-performance-report-1.md](history/safari-performance-report-1.md) (it is the dot geometry,
  not the pixels) and
  [safari-performance-report-2.md](history/safari-performance-report-2.md) (the cost is a step
  discontinuity at each level-of-detail boundary, paid out of process).
- [iter-3-2-measurement.md](history/iter-3-2-measurement.md) — **in progress.** The dot grid as
  cached row strips: 31× fewer primitives at the worst zoom, pixel-identical, and flat in canvas
  area. Safari's pinch folded into the rAF accumulator, and two readouts that dirtied the document
  at input frequency. Holds the protocol for the one measurement only real Safari can make, and
  the results sheet it fills in.
