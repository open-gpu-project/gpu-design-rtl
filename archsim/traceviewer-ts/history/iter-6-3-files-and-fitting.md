# Iteration 6.3 — a diagram in a file, a check withdrawn, a grid that stops stuttering

2026-09-24. Complete. `npm run verify` from 559 assertions across ten suites to **612 across
eleven**, plus `verify/production.mjs`'s 17 against the built bundle.

Five items, and they divide unevenly. Two are withdrawals — a property and a whole validation
subsystem that user testing decided against. One is the first file I/O the editor has ever had.
One is a Safari defect whose fix turned out to be already written and switched off, plus a second
cause nobody had looked for. The last is the UI catching up with something the data model had
always allowed.

## 1. Scope

- **Save and open a diagram**, from the toolbar and from `⌘S` / `⌘O`. The file is the bare
  `SceneDoc` — byte-for-byte what `⌘C` writes to the system clipboard.
- **The network interface loses its `channel` property.** `protocol` and `modport` stay.
- **Connection compatibility checking is deleted entirely**, not disabled: `conn.diagnose`, the
  `ShapeOps.diagnose` seam, `SceneStore.diagnostics`, `RenderFlags.problems`, the red `!` badge,
  its popup layer, and five theme constants.
- **Safari stops stuttering at 50–70% zoom with more than twenty shapes.** Two separate causes,
  one per axis of the report.
- **A subtitle may hold several lines**, which the property editor and the file format have always
  accepted and the canvas silently collapsed into one run.

## 2. Decisions that came from the user

| Question                         | Decision                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| What a load does to the document | Replaces it, as **one undoable step** labelled `load`                |
| A subtitle too long for its box  | Draw the **largest prefix that fits**, dropping from the bottom      |
| How far to go on the grid modes  | Make `strips` the default, **keep** the other three and `__gridMode` |
| What a save is called            | **The name of the last file opened**, `diagram.json` before any      |

The third is the one worth recording as a decision rather than as a result. The fix for the zoom
band was written in iteration 3.2 and left switched off pending a sweep in real Safari that never
happened; the choice was between flipping it on the arithmetic alone, deleting the losers with it,
or measuring first. Flipping without deleting keeps the sweep runnable — see §6.

## 3. Load-bearing decisions

### 3.1 One document format, two transports

The file is `serializeScene`'s output with `JSON.stringify(doc, null, 2)` and a trailing newline,
which is to the byte what `copySelection` puts on the system clipboard. Not a coincidence to
preserve casually: it is what lets the file loader and `readFragment` share a read pipeline, and
what makes the `trace` key that will eventually sit beside `shapes` additive rather than a second
format to keep in step with the first.

It does **not** follow that a saved file can be pasted with `⌘V`. `ToolHost.paste` reads the
in-memory `#clipboard` and deliberately never the system one, because reading that back is
focus-gated and async. The formats agree; the transports do not cross. This was written the wrong
way round in the README and in two comments before it was caught, which is why it is here.

### 3.2 `parseSceneDoc` draws the distinction `deserializeScene` cannot

`deserializeScene` is lenient by design and answers `[]` to both "this is not a diagram" and "this
is an empty diagram". Those need opposite handling: one is a document to load, the other is a file
to refuse **without committing anything**, because loading an unreadable file as an empty document
wipes what the user has open on account of a mis-click in a file list. Undoable, but only if they
notice, and the file they wanted is still unopened either way.

The test is `shapes` being an array and nothing more. Explicitly not `version`: the format is "the
schema's non-computed keys", so a reader of either vintage produces a valid document from a file of
either vintage, and refusing an unrecognised number would break exactly the files that still work.

### 3.3 `readDocument` names a pipeline that already existed in one place

`readFragment` has always done deserialize → `normalize` → `pruneOrphans`. `deserializeScene`
alone does none of the last two, so a file loader built on it would have kept a degenerate rect
that draws as nothing and a connection naming a block the file does not contain. That pipeline is
now `readDocument` in `serialize.ts`, `readFragment` calls it, and the file path cannot drift from
the clipboard path. It also returns a `dropped` count, because a load that silently lost half a
diagram is worse than one that says so.

### 3.4 The load goes through `scene.commit`, which buys three things beyond undo

`commit` is the only whole-array swap path there is. It clears the draft, so a half-drawn rect
cannot outlive the document it was being drawn into. It runs `#expandChildren`, so a file recording
`interfaces: 2` on a fabric with no `nif` records gets them minted **as part of the load** rather
than one unrelated commit later. And it runs `#resolveDependencies`, so every wire reroutes against
the geometry it actually arrived with. All three are asserted.

`host.documentReplaced()` runs after it, and the order is required: `scene.onCommit` re-derives the
world bounds that `zoomToFit` reads, so calling it first frames the old content. A file load is the
**third** funnel that has to clear the sub-part cursor explicitly — the comment above `undo` said
"the two funnels" and now says three.

### 3.5 `⌘S` and `⌘O` are on `window`, in the CAPTURE phase

`ToolHost.#globalKey` is wrong for all three of its own reasons: `onKeyDown` refuses keys unless the
diagram pane owns the keyboard, so `⌘S` would do nothing precisely when the property panel has focus
and Safari's Save Page dialog would answer instead; it refuses again when the target is editable,
same outcome with the caret in the JSON editor; and `CanvasSurface` registers its window listeners
in `onMount`, so they die when the dock remounts that pane. A shortcut for the document cannot be
owned by one view of it.

Capture rather than bubble was **measured, not assumed**. `svelte-jsoneditor`'s editable cell calls
`stopPropagation` on every keydown it sees, so a bubble-phase listener on `window` never fires at
all while the caret is in the panel. A probe confirmed it: with focus in the editor the event
reaches `window` and `document` in capture and never returns. Window capture is the first handler
in the tree, so nothing can swallow it and there is no `defaultPrevented` to consult — these two
chords mean "the document", app-wide, and no widget redefines them. `⇧⌘S` is left unbound for the
browser's Save As.

### 3.6 Removing a property needs no migration, and no version bump

`hydrateShape` iterates the **schema**, not the record, and skips any key not in it — so an old
file's `channel` is ignored rather than carried onto the shape or treated as an error. A fresh
property panel projects from the schema too, so there is no row to disappear. `SceneDoc.version`
stays at 2, and bumping it would be actively wrong: it would tell a future v2-only reader to refuse
a file it can read perfectly.

The one strict path is `applyDocument`, which rejects unknown keys. Reaching a state where it sees
a stale `channel` needs either a hand-typed key — already refused today for any bogus key — or an
HMR update, and `nif.props.ts` has no `import.meta.hot.accept`, so Vite full-reloads instead. Worth
knowing for next time: `props/validate.ts`'s `compiled` Map is keyed on `ps.kind`, so a hot-swapped
schema would keep the old ajv validator. Moot for the same full-reload reason, expensive to
rediscover.

### 3.7 The grid's default flipped; the control did not

`grid-renderer.ts` now ships `strips`. The zoom band is not a tuning accident but a structural
coincidence: the LoD ladder steps `level` at exactly `GRID * z = MIN_DOT_PX`, i.e. `z = 0.5`, so
`minorStep` goes 96 → 16 and the dot count multiplies by 36 — while `minorAlpha` restarts from 0 at
the same instant and reaches 1 only at `z = 0.875`. So `z ∈ (0.5, 0.875)` is where the minor tier is
at its densest _and_ nearly invisible: 14 668 rects a frame at `z = 0.5001` against 3 686 at
`z = 1.0`. `strips` emits 478.

`batch`, `row-fill` and `fill-rect` all stay, and `verify/grid.mjs` still diffs against `batch`
rather than against the shipped mode. That looks backwards and is not: the control has to be the
implementation that is right by construction — one rect per dot, in a loop — because the clever one
is what needs vouching for. Putting `strips` first also collapses the byte-identity claim, since
`row-fill` and `fill-rect` must match `batch` **exactly** where `strips` is allowed one LSB in the
blend band. The diff is symmetric, so nothing is lost by stating it the other way.

What _did_ have to change is every `finally` in that file, which restored `'batch'`. Left alone,
every block after the first would have run against a mode that no longer ships and the suite would
have stayed entirely green while testing the wrong thing.

### 3.8 The shape-count axis was a second defect, and `text.ts` had no cache at all

The grid explains the zoom band. It does not explain ">20 rectangles", because the grid's cost is
independent of shape count — and shape count is the one axis neither Safari triage report varied.

`drawInsetLabel` reaches `measureText` through `fitFontPx`'s binary search, and `fitFontPx` takes
its one-probe fast path only while the label fits at the ceiling. For typical block widths that
stops being true at about `z = 0.48`, and below about `z = 0.46` the fit bottoms out and falls
through to `fitText`'s own `1 + ceil(log2(len))` probes. Two more cliffs land in the same band:
`insetType` switches the subtitle on above 28.89 CSS px of on-screen height, which is `z ≈ 0.45`
for a 64-unit box and `z ≈ 0.60` for a 48-unit one. So a box went from about one measurement a
frame to ten or sixteen, at integer sizes that change every frame during a pinch — two to three
hundred shaping calls a frame at twenty boxes, none of them cached.

The cache is a module-level `Map<fontShorthand, Map<string, number>>`. Module-level because a text
advance is a pure function of `(shorthand, string)` and of nothing per-surface — the dpr is already
inside the shorthand, and the theme decides colour, not metrics — so the failure that made `DotGrid`
a `Renderer`-owned class has no analogue. And because it has to be reachable from callers with no
`DrawContext`: `tabRect` runs from `hitTest` through the bare `HitContext.measure` callback, and
`flagMeasurer` runs in a timeline layout pass. Threading it through `DrawContext` would have left
both on the uncached path.

Measured: a frame of 24 two-line boxes at `z = 0.61` costs 26 `measureText` calls cold and **zero**
on every repeat frame.

### 3.9 `cachedTextWidth` assigns the font; `measureAt` does not

The split is the difference between one font assignment per probe and `n` of them. A multi-line
subtitle measures several strings at **one** size, so the assignment hoists out of the loop —
without that, three lines cost 10 font sets against one line's 4, which a check caught. With it,
both cost 4 and the measurements grow with the lines rather than with lines × probes.

`cachedTextWidth` still assigns unconditionally, hit or miss, so every promise the callers already
document survives — `fitInsetLine`'s "leaves `ctx.font` at the size it chose" in particular, which
`verify/labels.mjs` asserts by measuring the returned string at the font left behind.

### 3.10 The cap is global, and an LRU would have been worse

4096 entries across the whole table, then dropped wholesale. Per-font is **not** a bound: one string
measured at eleven sizes is eleven entries in eleven maps, so a per-map cap of 4096 holds 45 000 of
them — which a check caught at 5052 before it was fixed. An LRU needs a recency list and a touch on
every **hit**, paying on the fast path to optimise a case that does not arise: the live key space is
in the hundreds for any diagram a person draws, and only grows unboundedly through editing.

Three clears that are the obvious instinct and are all wrong, written into the source because each
would quietly undo the fix: not per frame (not surviving between frames _is_ the defect), not on a
dpr change (the dpr is inside the shorthand, so old entries age out), not on a theme change (colour
is not part of a metric). The one that would be needed — `document.fonts.ready` — does not apply,
because every font stack here is system fonts and there is no `@font-face` in `src/` or
`index.html`.

### 3.11 The subtitle budget generalises with the 0- and 1-line answers bit-identical

`insetType(hCss, subtitleLines: number)` replaces `insetType(hCss, hasSubtitle: boolean)`, and
every number the boolean produced is a number the count produces. That is what makes the whole
first part of `verify/labels.mjs` the regression net for the change, and a captured table of the
pre-change values is now pinned in it.

`n` lines cost `n` line-heights **and** `n` leads — one under the label and one between each later
pair — so the per-line room is
`(availH - INSET_INK_H*LABEL_FONT_PX - n*INSET_LEAD_PX) / (n*INSET_INK_H)`, which at `n = 1` is the
old `room` exactly. The largest prefix that fits has a closed form rather than a loop, because that
expression is decreasing in `n`; a brute-force loop is asserted to agree with it at every height.

The prefix rule is the product decision. Under all-or-nothing, typing a second line would have
blanked the subtitle entirely on a block that was already showing one — a feature that deletes text
the user can see. Lines drop from the bottom, where the reader has the gist, and the full text stays
on hover and in the panel.

### 3.12 `Math.trunc`, not `Math.round`, and it is worth the paragraph

The one-line code placed its two baselines at `cy - half` and `cy + half` for
`half = Math.floor(gap * dpr / 2)` — a symmetric floor of the **magnitude**, applied twice.
`insetBaselines` computes signed offsets from the block's centre, and `Math.trunc` of a signed
offset is that same symmetric floor; `Math.round` is not, and is off by one device pixel wherever
`gap * dpr` is odd, which is every size the label has been shrunk to. The check picks a height
whose `gap * dpr` is odd at both dpr 1 and 2 specifically so a `round` implementation fails it.

Plate boundaries go at the **midpoint of consecutive baselines** rather than each plate hugging its
own ink, because two plates sized to their own ink leave a sliver of whatever is underneath showing
between them — on a FIFO, a stub of divider floating between two lines. At one subtitle line that
midpoint is `cy` integer-exactly, so this is the old behaviour generalised rather than changed.

### 3.13 One shared size, chosen by the widest line

One `fitFontPx` over a measurer that maxes across the lines, not `n` independent searches. The
visible reason is that lines at different sizes read as ragged — the same argument `drawInsetLabel`
already made for clamping the subtitle below the label. The other is cost: `n` searches would have
multiplied the probe count by `n`, and a two-line subtitle would then have been a per-frame
regression in exactly the band §3.8 was fixing.

A line that cuts down to nothing but an ellipsis comes back empty but **keeps its slot**. Dropping
it would shift every line below it up, so the text would jump as the box was zoomed past the width
at which that one line stopped fitting.

## 4. Defects found while building

1. **A bubble-phase `⌘S` never fires from the property panel.** §3.5. Found by a check that dwelt
   on exactly that case rather than on the easy one, then diagnosed with a four-phase probe.
2. **Three lines cost more font assignments than one.** The first cache design called
   `cachedTextWidth` per line, re-assigning the same shorthand `n` times. §3.9.
3. **The cache cap was not a cap.** Per-inner-map, so the table reached 5052 entries against a
   stated bound of 4096. §3.10.
4. **`verify/grid.mjs` restored the wrong mode.** Every `finally` reset to `'batch'`, so after the
   default flipped the suite would have gone on testing a mode that does not ship. §3.7.
5. **The README claimed a saved file pastes with `⌘V`.** It does not. §3.1.
6. **`theme.ts`'s marquee comment documented the wrong field.** The badge pair sat between the
   comment and `marqueeStroke`; deleting the pair repaired it for free.
7. **Two stale comments naming the violation badge.** `box.ts`'s `drawBoxBody` ("`conn` its line
   but not its badge") and `curve.ts`'s `curveAt` ("for the label and the badge"). The `insert
badge` references elsewhere are the waypoint `+` handle and a different thing.
8. **`CanvasTooltip` keyed `{#each}` on the line's own text.** Latent until a subtitle could split
   on newlines, at which point `"AW\nAW"` — a thing a person would write — is a duplicate-key
   crash. Now keyed on the index, which is correct because `HoverTip` is `$state.raw` and rebuilt
   per tooltip.
9. **`makeNif`'s `channel` parameter had no caller.** Both call sites passed four arguments; the
   fifth had been vestigial since it was added.

## 5. Designs rejected

- **File System Access API.** `showSaveFilePicker` would give a real save-in-place. Safari
  implements neither half, and Safari is where this app's rendering is measured, so it is not a
  browser to degrade.
- **A fresh `<input type="file">` per open.** Safari needs the input in the document for a
  programmatic `.click()`, and `cancel` is Safari 16.4+ — so a per-call element leaks a node on
  every dismissal. One reused singleton has neither problem, and only one picker can be open at a
  time, so one is not a cache but the whole model.
- **Loading as a fresh document, clearing history.** `History.clear()` exists and is still unused.
  Rejected because replicating `commit`'s `#expandChildren` / `#resolveDependencies` / `onCommit`
  bookkeeping means reaching past three private members, and because `⌘Z` back to what you had is
  worth more than a clean undo stack.
- **A timestamped save name.** Sorts and never collides, and gives up the round trip: open
  `xbn.json`, edit, save, and getting `xbn.json` back is what makes the file feel like the
  document. Accepted cost: Safari accumulates `xbn (1).json` in Downloads.
- **Status-bar severity for a failed load.** Needs a `--color-danger` token and a second field on
  `ToolHost`; the bar has no severity concept today. The message is self-clearing because the next
  save or load overwrites it. Flagged rather than built.
- **Deleting `row-fill` and `fill-rect` now.** §3.7 and §6.
- **An LRU for the width cache**, and **per-frame clearing**. §3.10.
- **Capping the drawn subtitle at two lines.** Bounds the arithmetic and the per-frame fitting cost,
  and ignores what the user typed. The height budget already bounds both.

## 6. Flagged for future work

- **`history/iter-3-2-measurement.md` §5's tables are still blank**, and the four-mode sweep in real
  Safari is still the thing that decides whether `strips`' ~440 lines ship or come out. Its §3
  recorder now also counts `measureText` and the `font` setter, and its §2 says to draw ~24 blocks
  with two-line subtitles first — `⌘S` and `⌘O` are how that fixture reaches the `preview` build,
  since `__dump()` is DEV-gated. Report 2 §6.3's persistence run has to be done **first**, under
  `__gridMode('batch')`.
- **`row-fill` and `fill-rect` come out** once those tables are filled in. `batch` stays as long as
  `grid.mjs`'s pixel-identity assertions are the only guard on this code.
- **The timeline's two `fitText` call sites** are still uncached (`timeline/renderer.ts` and
  `fitSignalName`). Different surface, and `fitSignalName` does its own probing.
- **Status-bar severity**, per §5.
- **A `trace` key beside `shapes`.** The format is shaped for it; nothing reads it yet.

## 7. Conventions and gotchas

- **Nothing under `scene/`, `props/` or `geom/` touches the DOM**, and that is worth keeping: it is
  what lets `verify/` drive them as pure calls. So the file work split in two — `scene/file.ts` for
  the format and the name, `ui/file-transport.ts` for the Blob, the object URL and the picker.
- **`input.value = ''` before every `.click()`**, or re-picking the same file fires no `change`
  event and the second open hangs. Which is exactly the "open, edit the file elsewhere, open it
  again" loop this exists for.
- **`URL.revokeObjectURL` on the next task, not synchronously.** Safari has revoked-too-early bugs
  where the download never starts.
- **A window-capture listener registered _after_ the app's observes its `preventDefault`.** That is
  how `verify/file.mjs` proves the browser's own dialogs are suppressed; a bubble listener would
  not fire at all from the property panel.
- **Prettier collapses a three-parameter signature onto one line** at 100 columns. Two scripted
  edits failed on a multi-line signature that no longer existed.
- **`opsFor(...).diagnose === undefined` is an assertion worth having.** A deletion that leaves a
  seam behind is how the next iteration reintroduces half of it by accident.
- Two `badge` vocabularies now coexist and only one was deleted: the **violation badge** is gone,
  the **insert badge** is the waypoint `+` handle and predates it.

## 8. How iteration 6.3 was verified

`npm run check` and `npx prettier --check .` clean after every task, and after each of the five
steps of the deletion. All eleven dev suites green, plus `production.mjs` against the built bundle:

| suite         | assertions |
| ------------- | ---------: |
| `grid`        |         64 |
| `input`       |         57 |
| `file`        |     **29** |
| `properties`  |         44 |
| `connections` |        102 |
| `labels`      |         47 |
| `components`  |        102 |
| `network`     |         69 |
| `docking`     |         20 |
| `trace`       |         51 |
| `selection`   |         27 |
| **total**     |    **612** |
| `production`  |         17 |

The assertions that carry the iteration, rather than all 53 new ones:

- **`file.mjs`** — Save writes exactly what `__dump` projects; a load is one step labelled `load`
  with nothing selected, no stale sub-part cursor and a re-framed camera; one `⌘Z` restores the
  previous document byte-identically; a non-diagram file leaves the document **and the history**
  untouched and says so through the StatusBar DOM; a fabric loaded without its interfaces gets them
  minted by the load itself; `readDocument` drops a wire a bare `deserializeScene` keeps; `⌘S` saves
  with the caret in the property editor and suppresses the browser dialog; `⌘O` reaches the document
  from the trace panel.
- **`grid.mjs`** — the shipped default is `strips`, asserted before anything in the file can set it.
  **`production.mjs`** asserts the same against the built bundle, which is the only place the
  un-gated handle can be proved un-gated.
- **`labels.mjs`** — a frame of 24 two-line boxes at `z = 0.61` measures 26 strings cold and **zero**
  on every repeat frame; three lines cost no more font changes than one; the cache is bounded;
  one- and zero-line `insetType` match a table captured before the change; a loop agrees with the
  closed form for the fitting prefix; one subtitle line lands on exactly the two baselines the old
  code drew, at dpr 1 and 2 and at an odd `gap * dpr`; and at a height with room for one line only,
  a two-line subtitle still draws one — the regression the prefix rule exists to avoid.
- **`network.mjs`** — no `diagnose` seam, no `diagnostics` on the store, no badge geometry exported,
  two masters joined by a bus is simply a bus, and no popup can be raised by clicking around a link.
- **`components.mjs`** — a file still carrying `channel: 'aw'` loads, and the key is ignored rather
  than kept on the shape.
- **`input.mjs`** — the file commands are their own cluster _after_ every tool cluster, so the
  registry's digits are unmoved; and two identical subtitle lines do not crash the tooltip.

Not covered, and deliberately: **the Safari measurement itself.** Canvas rasterization happens after
`draw()` returns, in Safari's GPU process, so no assertion in this repo can time it. Counts here,
milliseconds by hand — see §6.
