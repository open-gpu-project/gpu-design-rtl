# traceviewer-ts

Client-only web app for viewing `archsim` traces. This directory is a standalone npm project and
is deliberately **not** wired into the CMake build.

The app is a dockable workspace: panels can be split, tabbed, dragged onto one another, floated
into windows, or collapsed to an edge. Three panels exist so far.

- **Diagram** — the architecture canvas, where the hardware design is laid out as blocks. A
  block carries a label and a subtitle, and `labelMode` decides how they are shown: `inset`
  centres the label in the block with the subtitle beneath it, while `tabbed_left` and
  `tabbed_right` put the label in a small folder tab above a top corner and leave the body
  empty. Hovering a block or a wire raises a tooltip — a block's description, a wire's name and
  description, and in the tabbed modes the subtitle too, since that is the only place it
  appears. Drag a band with the select tool to select several at once, and copy, cut and paste
  them as a group -- a connection comes along when both of its blocks do, and a pasted copy
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
iteration document. `npm run verify` is 381 assertions across eight suites. Anything touching
the canvas, the camera, DPI, or the property round trip has to be run in a real browser at
`deviceScaleFactor: 2`. `verify/` is what does that.

## Controls

| Gesture                                        | Action                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| Drag empty space / middle-drag / space+drag    | Pan                                                  |
| Two-finger scroll (trackpad)                   | Pan                                                  |
| Mouse wheel, trackpad pinch                    | Zoom at the cursor                                   |
| `⌘`+wheel / `⇧`+wheel                          | Force zoom / force horizontal pan                    |
| `1` / `2` / `3` / `4`                          | Pointer / Select / Rectangle / Connection            |
| Drag with the select tool                      | Select everything the band touches                   |
| `⇧`+drag with the select tool                  | Add the band's contents to the selection             |
| Drag with the rectangle tool                   | Draw a block, snapped to the grid                    |
| Click two block edges with the connection tool | Draw an arrow between them                           |
| Drag a segment of a selected connection        | Reshape its route, pinning it to manual routing      |
| Drag a round bead on a selected connection     | Slide that end along its edge, or onto another block |
| Click a block, then drag its body or handles   | Move or resize                                       |
| Hold the pointer still over a block or wire    | Show its description as a tooltip                    |
| Hold the pointer still over a toolbar button   | Show its name and keyboard shortcut                  |
| `⇧`+click                                      | Add to or remove from the selection                  |
| `⌫`                                            | Delete the selection                                 |
| `⌘C` / `⌘X` / `⌘V`                             | Copy / cut / paste the selection                     |
| `⌘Z` / `⇧⌘Z`                                   | Undo / redo                                          |
| `⌘]` `⌘[` `⇧⌘]` `⇧⌘[`                          | To front / to back / forward / backward              |
| `⌘0` / `⌘1`                                    | Reset zoom / zoom to fit                             |
| `Esc`                                          | Cancel the current gesture, then clear the selection |

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
src/lib/canvas/    Camera, renderer, dot grid, hit testing, wheel/trackpad input, text, theme
src/lib/scene/     The document: shapes, z-order, bounds, history, serialization
src/lib/props/     Property declarations, the JSON Schema generator, projection, validation,
                   and the property editor's context menu
src/lib/tools/     Tool contract, registry, pointer plumbing, and the four tools
src/lib/trace/     The trace document: model, queries, the synthetic fixture, and the store
src/lib/timeline/  The trace panel's canvas: camera, tick ladder, flag layout, renderer, hit
                   testing, input host, and its theme
src/lib/panels/    Panel registry and one registration file per panel
src/lib/dock/      Default workspace, and layout persistence with its fallbacks
src/lib/ui/        Hover tooltips for DOM chrome: one layer, opted into per element
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

Connections landed in iteration 4 and were the test of that claim: no existing mutation path
changed. What the kind needed beyond the reserved seams was `anchorAt` / `resolveAnchor`, for
picking a point on a perimeter, and `corridors`, for saying which of its runs other connections
may bundle onto. Iteration 4.1 added one more, `rebind`, for re-attaching an end to whatever the
tool found under the cursor — together with a `role` on the handle record, so the pointer tool can
route a drag without knowing what `end:to` means. Iteration 4.2 then made the three properties
that say where a connection runs read-only: they are one value, the gestures that change them
keep them consistent, and a tree editor cannot. `routing` stays editable, because it says who
maintains the route rather than what it is — and the canvas can only ever pin a route, never
hand it back.

### Adding a tool

Write `src/lib/tools/<name>-tool.ts` implementing `Tool`, call `registerTool` at the bottom, and
add the import to `src/lib/register.ts`. The toolbar renders from the registry, so the button
appears on its own.

The declaration says which cluster it belongs in (`group`: `tool` for something you do to what is
already there, `shape` for something that adds) and where it sits inside that cluster (`order`).
Its digit is not declared: the registry hands out `1`…`9` by toolbar position, so the keys always
count left to right and inserting a tool renumbers its neighbours for you.

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
- [iter-4-connections.md](history/iter-4-connections.md) — directed rectilinear connections: the
  scoring router and why it bundles, sliding perimeter anchors, the reroute fold, and the
  identity guard that stops a dependency pass from making every commit undoable.
- [iter-4-1-panel-and-endpoints.md](history/iter-4-1-panel-and-endpoints.md) — three follow-ups:
  one canonical property key order, a documentation footer that sizes itself to its text, and
  draggable connection endpoints. Why the handle record grew a `role`, and the round-trip bug
  the key order quietly fixed.
- [iter-4-2-read-only-geometry.md](history/iter-4-2-read-only-geometry.md) — a connection's
  route and endpoints become read-only in the panel, and `routing` deliberately does not. What
  `fixed` means once a read-only property is also real saved state, why a writer must not set a
  sibling key, and two defects in the panel: a read-only marking one selection behind, and the
  self-invalidating effect that the obvious fix for it produces.
- [iter-5-2-marquee-and-clipboard.md](history/iter-5-2-marquee-and-clipboard.md) — rubber-band
  selection and a clipboard whose payload is the file format. Why the band is a tool of its own
  rather than a gesture on the arrow, why a copy fills the gaps in its own numbering, and the
  rename ordering bug that wires a pasted connection to one block at both ends.
- [iter-5-3-chrome-tooltips.md](history/iter-5-3-chrome-tooltips.md) — the toolbar's tooltips
  never appeared, and could never have been tested. Why Chromium's macOS tooltip is AppKit
  chrome armed by a faked mouse-enter that a synthetic pointer cannot trigger, why a tooltip
  rendered next to the toolbar paints underneath the canvas, and the twenty-one `title`
  attributes that became one layer the suite can see.
- [iter-5-4-zoomed-out.md](history/iter-5-4-zoomed-out.md) — six more papercuts: shortcut hints
  in the Mac symbols, a toolbar split into tools and shapes, block text that shrinks with its
  block rather than vanishing at 44px, an arrowhead that stands down when it would be drawn on
  top of a block, and then the same text again twice — its padding, and a tall block condensing
  it. Why a block's height is a budget rather than a gate, why `fillText`'s `maxWidth` is never
  the answer to text that does not fit, and the one thing a `draw` is now allowed to know about
  the rest of the scene.
- [iter-5-ux-polish.md](history/iter-5-ux-polish.md) — five papercuts found by using the app:
  block subtitles and label tabs, hover tooltips, the trace cursor as a flag, a connection
  label you can nudge, enum dropdowns, and five minor grid dots instead of four. Why a wider
  grab target turned a rounding error into a bug, why the second level-of-detail boundary left
  the reachable zoom range, and a crash that no assertion caught.
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
