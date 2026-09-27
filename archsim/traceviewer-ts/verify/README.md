# Browser checks

Stopgap verification scripts, not a test suite. They exist because iteration 1's most useful
finding was that **a green `svelte-check` means almost nothing in this project** — three of its
nine bugs were invisible at `devicePixelRatio` 1, and the primary machine is a Retina Mac — and
its biggest regret was that the scripts which found those bugs were throwaway and no longer
exist. These are kept so the next change has something to run.

They drive a real browser at `deviceScaleFactor: 2` through Playwright, using the Edge already
installed on the machine (`channel: 'msedge'`), so no browser download is needed. They assert on
`getImageData` pixels and on live state exposed in DEV through the hooks in the DEV block of
`App.svelte`, plus `__workspace`. The production build carries none of them, and
`production.mjs` asserts that.

```bash
npm run dev                 # terminal 1, port 5183
node verify/grid.mjs        # terminal 2
node verify/input.mjs
node verify/file.mjs
node verify/properties.mjs
node verify/connections.mjs
node verify/labels.mjs
node verify/components.mjs
node verify/network.mjs
node verify/docking.mjs
node verify/trace.mjs
node verify/selection.mjs
node verify/objects.mjs
node verify/groups.mjs
node verify/align.mjs

npm run build && npm run preview   # port 4183
node verify/production.mjs
```

`npm run verify` runs all fourteen dev suites against an already-running dev server (the count is
in the top-level README). `production.mjs` is not among them: it needs `vite preview` on a
different port — which also makes it the one suite a green `npm run verify` cannot vouch for, so
run it whenever the property panel changes.

Restart `npm run dev` before a run. After a hot reload, a module a check imports by URL can load
as a second copy with none of the app's state in it; the suites reach the app's own modules
through `window.__ops`, `__doc` and the other hooks for that reason. Shared helpers — buttons,
drags, world-to-canvas points, and the in-page op and mutation counters — are in `harness.mjs`.

`grid.mjs` is the odd one out and deliberately so. It checks the dot grid's row strips against a
per-dot reference renderer defined in the suite, pixel for pixel, in canvases it creates itself
rather than the live one — that is `{ desynchronized: true }`, and low-latency canvases have a
history of returning unflushed content. It also never asserts a frame time: canvas rasterization
happens after `draw()` returns, in Safari's GPU process, so `performance.now()` around a draw
measures nothing and this browser understates the real magnitude by ~3.5×. It asserts primitive
counts instead — see [history/iter-3-trace-panel.md](../history/iter-3-trace-panel.md).

## What is deliberately not covered

- Anything needing real hardware: whether a physical mouse wheel on macOS produces deltas large
  enough to classify as zoom, and whether Safari's `gesturechange` pinch double-applies.
  Synthetic events cannot settle either (iteration 1).
- Drag-to-dock onto a _centre_ zone. The gesture works, but hitting the centre chip rather than
  an edge zone is fiddly to script; `docking.mjs` sets the tabbed layout through
  `window.__workspace` instead and tests the `keepAlive` contract that way.

## Known upstream failure

`docking.mjs` filters one page error. `@svgrid/grid@3.0.5`'s `SvDockManager.svelte:793` calls
`commit(...)` and then reads `leaf.id` in the same click handler; `commit` reassigns the
workspace, Svelte tears the snippet down, and the trailing `emit(...)` dereferences a nulled
`leaf`. Restore-from-maximize therefore throws a `TypeError` _after_ correctly applying the
state change. Cosmetic, third-party, and unfixable from here without forking.
