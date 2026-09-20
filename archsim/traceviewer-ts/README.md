# traceviewer-ts

Client-only web app for viewing `archsim` traces. This directory is a standalone npm project and
is deliberately **not** wired into the CMake build.

Today it contains one view: the **architecture diagram** canvas, where the hardware design is laid
out as blocks. Selecting an entity will eventually show its properties and traced values in a side
panel. Waveforms will live in a separate view.

## Running

Uses whatever Node is on your PATH (>= 22; Homebrew's is fine). No version manager.

```fish
npm install
npm run dev        # http://localhost:5183
npm run check      # svelte-check + tsc
npm run build      # check, then a static bundle in dist/
```

## Controls

| Gesture | Action |
| --- | --- |
| Drag empty space / middle-drag / space+drag | Pan |
| Two-finger scroll (trackpad) | Pan |
| Mouse wheel, trackpad pinch | Zoom at the cursor |
| `Cmd`+wheel / `Shift`+wheel | Force zoom / force horizontal pan |
| `1` / `2` | Select tool / Rectangle tool |
| Drag with the rectangle tool | Draw a block, snapped to the grid |
| Click a block, then drag its body or handles | Move or resize |
| `Shift`+click | Add to or remove from the selection |
| `Delete` | Delete the selection |
| `Cmd+Z` / `Shift+Cmd+Z` | Undo / redo |
| `Cmd+]` `Cmd+[` `Shift+Cmd+]` `Shift+Cmd+[` | To front / to back / forward / backward |
| `Cmd+0` / `Cmd+1` | Reset zoom / zoom to fit |
| `Esc` | Cancel the current gesture, then clear the selection |

There are no scrollbars anywhere. The canvas is driven by a virtual camera clamped to the content
bounding box plus a buffer, so panning hard-stops rather than running off into empty space.

## Layout

```
src/lib/geom/      Vec2, Rect, and the small amount of geometry everything else shares
src/lib/canvas/    Camera, renderer, dot grid, hit testing, wheel/trackpad input, theme
src/lib/scene/     The document: shapes, z-order, bounds, history, serialization
src/lib/tools/     Tool contract, registry, pointer plumbing, and the two tools
src/components/    Canvas surface plus the toolbar and status bar
src/views/         DiagramView: self-contained and container-sized, ready to host in a pane
```

### Adding a shape kind

Write `src/lib/scene/shapes/<kind>.ts` implementing `ShapeOps`, call `registerShape` at the bottom
of it, widen the `Shape` union in `shape.ts`, and add the import to `src/lib/register.ts`. Nothing
else switches on `kind`.

Connections between entities are the next thing to build. `ShapeOps` already reserves
`dependsOn`, `reroute` and `anchors` for them, and `SceneStore.commit` already calls through to
those hooks, so a connection kind should not need changes to any existing mutation path.

### Adding a tool

Write `src/lib/tools/<name>-tool.ts` implementing `Tool`, call `registerTool` at the bottom, and
add the import to `src/lib/register.ts`. The toolbar renders from the registry, so the button
appears on its own.
