# Browser checks

Stopgap verification scripts, not a test suite. They exist because iteration 1's most useful
finding was that **a green `svelte-check` means almost nothing in this project** — three of its
nine bugs were invisible at `devicePixelRatio` 1, and the primary machine is a Retina Mac — and
its biggest regret was that the scripts which found those bugs were throwaway and no longer
exist. These are kept so the next change has something to run.

They drive a real browser at `deviceScaleFactor: 2` through Playwright, using the Edge already
installed on the machine (`channel: 'msedge'`), so no browser download is needed. They assert on
`getImageData` pixels and on live state exposed in DEV via `window.__scene`, `__view`, `__host`
and `__workspace`.

```bash
npm run dev                 # terminal 1, port 5183
node verify/properties.mjs  # terminal 2
node verify/docking.mjs

npm run build && npm run preview   # port 4183
node verify/production.mjs
```

`npm run verify` runs the two dev suites against an already-running dev server.

## What is deliberately not covered

- Anything needing real hardware: whether a physical mouse wheel on macOS produces deltas large
  enough to classify as zoom, and whether Safari's `gesturechange` pinch double-applies.
  Synthetic events cannot settle either (iteration 1, §6.2).
- Drag-to-dock onto a _centre_ zone. The gesture works, but hitting the centre chip rather than
  an edge zone is fiddly to script; `docking.mjs` sets the tabbed layout through
  `window.__workspace` instead and tests the `keepAlive` contract that way.

## Known upstream failure

`docking.mjs` filters one page error. `@svgrid/grid@3.0.5`'s `SvDockManager.svelte:793` calls
`commit(...)` and then reads `leaf.id` in the same click handler; `commit` reassigns the
workspace, Svelte tears the snippet down, and the trailing `emit(...)` dereferences a nulled
`leaf`. Restore-from-maximize therefore throws a `TypeError` _after_ correctly applying the
state change. Cosmetic, third-party, and unfixable from here without forking.
