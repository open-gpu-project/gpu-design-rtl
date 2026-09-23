# Iteration 5-4 — what the canvas still says when you zoom out

Reported as four things found by using the app: shortcut hints that spell out `Shift/Cmd/Opt/Ctrl`
instead of showing `⇧⌘⌥^`, a toolbar that does not separate tools from shapes and has "Select" and
"Marquee select" the wrong way round, block text that "disappears way too early when zooming out",
and arrowheads that overlap the blocks they connect once the blocks get small. Two more arrived
after the first four landed, both about the same text: that the padding around it was excessive,
and that on tall narrow blocks it looked vertically stretched.

A follow-up to [iter-5-ux-polish](iter-5-ux-polish.md), which added the inset subtitle this one
now has to shrink, and to [iter-5-3](iter-5-3-chrome-tooltips.md), whose §3.4 put the toolbar's
parenthesised shortcut in the registry — the seam every hint in change 1 now goes through.

---

## 1. Scope

Three of the four are the same sentence: **a decoration sized in screen pixels stops making sense
once the thing it decorates is smaller than it is.** A 13px label in a 20px block, a 9px arrowhead
in a 4px gap. The existing answer was a threshold and then nothing, which is why zooming out blanks
a diagram all at once rather than gradually.

**Changed.**

- A new [keys.ts](../src/lib/keys.ts): shortcut hints as Mac symbols, from one table, in Apple's
  canonical modifier order. Nineteen literals across
  [Toolbar.svelte](../src/components/Toolbar.svelte), [TraceView.svelte](../src/views/TraceView.svelte),
  [rect.props.ts](../src/lib/scene/shapes/rect.props.ts) and
  [marquee-tool.ts](../src/lib/tools/marquee-tool.ts) become calls. §3.1.
- The toolbar splits into two clusters with a rule between them, and the arrow tool becomes
  **Pointer** while the band tool becomes **Select** — both label and id.
  [registry.ts](../src/lib/tools/registry.ts) grows `group` and `order`, and now _assigns_ the
  digit rather than reading a declared one. §3.2.
- A block's inset label and subtitle shrink with the block instead of vanishing at 44 CSS px, down
  to a readability floor, subtitle first. Height and width are answered separately and by different
  means: the height is a budget spent on type (`insetType`, pure, in
  [rect.ts](../src/lib/scene/shapes/rect.ts), §3.3), the width is **measured** rather than handed
  to `fillText`'s condensing `maxWidth` (`fitFontPx` in
  [text.ts](../src/lib/canvas/text.ts) and `fitInsetLine` in `rect.ts`, §3.4).
- A connection drops its arrowhead when the head would be drawn on top of either block it joins,
  and draws the bare line. Needs one new thing on `DrawContext`. §3.5, §3.6.

**Deliberately not changed.**

- The **tabbed label path** — `drawTab`, `tabRect`, every `TAB_*` constant. Asked for by name: it
  already reads well at every zoom and neither §3.3 nor §3.4 touches it. A tabbed block still draws
  no subtitle on the canvas at all. Its `fitText` ellipsis is reused by §3.4, not modified.
- **No platform detection.** §3.1.
- `svelte-jsoneditor`'s own menus, which say `Ctrl+…` and now disagree with the rest of the app.
  Their string table, not ours. §5.
- `ARROW_LEN_PX` is still 9 CSS px and still does not scale with zoom. The fix is about when the
  head is drawn, not how big it is.

**Verification surface.** 347 → **381 assertions across eight suites**: a new
[verify/labels.mjs](../verify/labels.mjs) with 23, six more in `verify/connections.mjs`, five more
in `verify/input.mjs`. `verify/production.mjs` stays at 16. Renumbering the tools touched the three
shared gesture helpers in `verify/harness.mjs`, so every suite moved.

## 2. Decisions that came from the user

- **Mac symbols only.** The first ask was for hints that adapt to the platform; on seeing the plan
  it became "just display the Mac shortcuts — that way we don't have to create and maintain extra
  logic for this detection." One table, no branch. §3.1.
- **Tool ids renamed too**, not just the labels, so `setTool('select')` means the tool the toolbar
  calls Select. The cost is the one rename a compiler cannot catch (§6).
- **A readability floor of 8 CSS px**, chosen from a table of what each floor would show at each
  block height. 6px keeps text alive further out; 8px was preferred as the point below which it
  stops being worth reading.
- **Only the two blocks a connection joins** are considered when deciding whether the arrowhead
  fits — not every block the head happens to pass over.
- **"A few-pixel padding just to separate the text from the border"**, after the first version of
  §3.3 shipped and still looked over-padded. Three pixels, on all four sides. §3.3.
- **Text on tall blocks must not look stretched.** Reported as a second follow-up; it is the same
  text and the opposite axis. §3.4.

## 3. Load-bearing decisions

### 3.1 One symbol table, because there is no second platform to be wrong about

Detection would be two string tables, of which the developer only ever sees one rendered. The
branch cannot be checked by looking, only asserted — and an assertion about a table nobody reads is
how `title` attributes went uncaught for two iterations (iter-5-3 §2).

So `keys.ts` is a map and a sort. What it is _for_ is not abstraction over a branch — there is
none — it is that nineteen `Cmd+…` literals become nineteen calls against one table, so the
twentieth cannot come out as `Cmd`. The sort matters for the same reason: `keys('cmd', 'shift',
'z')` and `keys('shift', 'cmd', 'z')` both produce `⇧⌘Z`, because `⌘⇧Z` is the kind of wrong that
looks right until it is next to a system menu.

`⌫` (U+232B) and not `⌦` (U+2326): both keys already delete the selection and always have, but
`⌫` is the one every Mac keyboard has. Esc, Home and End stay as words — their glyphs are not
printed on the keys and read as puzzles. The arrows do not.

### 3.2 The digit is assigned by position, not declared

`ToolDescriptor` previously carried `shortcut: '1'`. Having asked for the numbering to run left to
right, the obvious change is to renumber those four literals — and the obvious change is wrong for
the reason the `shortcut` field was moved into `registry.ts` in the first place (its comment, from
iteration 5-3): a declared order is a second place the order is written down, and two places
disagree. Insert a tool, renumber the neighbours you happen to be looking at, and the toolbar reads
1, 2, 4, 3.

So `registerTool` now takes a `ToolDeclaration` with `group` and `order`, and `allTools()` returns
`ToolDescriptor`s with `shortcut` filled in from the sorted position. The keys count across the
toolbar by construction. Past the ninth there is no digit left and a tool simply gets none, which
is the branch `toolTipText` already had and `verify/input.mjs` already covered.

`group` rather than relying on import order in `register.ts`: which side of the rule a tool belongs
on is a fact about the tool, and putting it in the markup would make the answer depend on a file the
tool's author is not editing.

### 3.3 Height is a budget, not a gate

This shipped once as a ramp — `fit = min(1, min(w, h) / 44)`, label `13 · fit` — and the reply was
that the padding around block text was excessive. It was. The 44 in that expression is a reference
square, so a 30 CSS px block got `13 · 30/44 = 8.9px` type with 11.7px of nothing above and below
it: **22% of the block inked**, and the type small for no reason visible on screen.

The rewrite spends the height rather than comparing against it. A line of N px type paints a
measured `INSET_INK_H · N` of actual ink, so the block's height, less a margin, converts directly
into a font size:

```
availH   = h - 2 · INSET_MARGIN_PX            // 3px per side, on all four sides, unscaled
label    = min(13, availH / INSET_INK_H)
room     = (availH - INSET_INK_H · 13 - INSET_LEAD_PX) / INSET_INK_H
subtitle = min(10, room)                      // and dropped below the floor
```

At a 176px-wide block with a subtitle:

| block height | before           | after    | height inked |
| ------------ | ---------------- | -------- | ------------ |
| ≥ 44         | 13 + 10          | 13 + 10  | unchanged    |
| 36           | 10.6 + 8.2       | 13 + 10  | 51% → 69%    |
| 31           | 9.2, no subtitle | 13 + 10  | 28% → 74%    |
| 30           | 8.9, no subtitle | 13 + 9.2 | 22% → 80%    |
| 24           | blank            | 13       | 51%          |
| 16           | blank            | 10.5     | 63%          |
| 13           | blank            | blank    | —            |

`INSET_INK_H = 0.95` is the load-bearing number and it is **measured, not assumed**. `textBaseline`
is `'middle'`, which centres the em box — a box with slack at the top and bottom that no glyph ever
reaches into — so budgeting against the font size reserves about a third more than the text can
use. Ink about that origin measures 0.400 above / 0.337 below for uppercase and 0.4248 / 0.5059
worst-case over printable ASCII; `INSET_INK_ABOVE = 0.43` and `INSET_INK_BELOW = 0.52` are the
latter plus a pixel of antialias spill. `INSET_LEAD_PX` is then derived, not chosen: it is whatever
is left of the old `INSET_LINE_GAP_PX` once both lines' ink is subtracted, which is what keeps a
block at ordinary zoom spaced exactly as it was.

Three properties fall out, none of them tuned:

- **Full size arrives at 31 CSS px, where it used to need 44.** Everything from 31 upward is
  byte-identical to what it always drew.
- **The subtitle still goes first**, but for a different reason than before: it is paid for out of
  `room`, what the label did not need, rather than by being the smaller font against a shared
  floor. 13.6px of block buys a label and 28.9 buys the pair, so a subtitle can never appear under
  no label — and the gap between those two numbers is much wider than the old rule's.
- **The margin is a minimum, not a target.** Above 18.35 CSS px the label is pinned at its 13px
  ceiling and the leftover height is centring space, so a 28px block is 43% inked and correctly so.
  Fill is therefore _not_ monotone in height: it peaks near 80% around 30px, dips to 43% just below
  the subtitle threshold, and climbs again. That is an artefact of the "shrink only, never grow"
  ceiling the user asked for, and it cannot be removed without letting type grow past full size.

Horizontal padding, which is what the report named, turned out not to be the problem at all: it was
already 2.7px per side at a 30px block. It is now a flat 3px, the same as the vertical margin, and
`INSET_PAD_X_PX` (8) and `INSET_FULL_PX` (44) are both gone.

`LABEL_MIN_PX` was doing two unrelated jobs — the block gate, and the shortest connection run worth
a label — so it is now `CONN_LABEL_MIN_RUN_PX`, which is what it always meant at its one remaining
call site. `SUBTITLE_MIN_PX` is gone.

### 3.4 Width is measured, not condensed

The next report was that text on blocks whose height far exceeds their width looked **vertically
stretched** when zoomed out. It was not stretched; it was squeezed on the other axis.
`fillText(text, x, y, maxWidth)` does not truncate and does not scale uniformly — it **condenses**,
compressing the glyph run horizontally and leaving the em height untouched. Measured on a 70×260
block labelled `MEMORY`: 81% of natural width at z=0.75, 65% at z=0.50.

The `min(w, h)` in the old ramp existed to prevent exactly this, and could not. It is a proxy for
"does this string fit?", and a poor one: for a five-character caps label `13 · w/44` still overflows
`w − 8` for any block under about 109 CSS px wide. So it shrank the type of every tall block whether
or not the label actually overflowed, _and_ let it condense anyway. Width is now out of the ramp
entirely, and `insetType` is a function of height alone.

`fitFontPx` binary-searches for the largest whole device pixel size in `[floor, ceiling]` whose
string measures under the budget; `fitInsetLine` wraps it and falls back to `fitText`'s ellipsis
only once shrinking has bottomed out at the 8px floor. Neither `fillText` is passed a `maxWidth`
any more, and that is the whole correctness argument.

Four things here are easy to get wrong:

- **Shrink before cut.** These labels are short hardware identifiers. `XBN_ARB` and `XBN_MUX` both
  truncate to `XBN_…`, and `XU0`/`XU1`/`XU2` all truncate to `X…`; a 9px whole word carries
  strictly more information than a 13px stub. Cutting first renders five of eight blocks in a rank
  of 50px-wide blocks as stubs _at 100% zoom_.
- **Never extrapolate a size.** Text width is not linear in font size — advances are grid-fitted at
  small sizes, so the same string measures up to 10.6% more per pixel at the bottom of this range
  than at the top — and the error runs the wrong way, so a size solved for in closed form comes out
  too big and overflows again. The straight-line model places the search's first split and does
  nothing else: every size returned was measured at that exact size.
- **Feed the fit the _unaligned_ box.** The outline is snapped to whole device pixels and so jitters
  by one as the block is panned. Those snapped coordinates are what the text must be centred on, but
  a width budget that inherited the jitter would step the type size — or gain a letter — while the
  user did nothing but drag the block sideways.
- **The subtitle's ceiling needs clamping at both ends.** Once width can shrink the label
  independently, a short subtitle under a long one comes out _larger_ than the label:
  `REGFILE` / `bank0` at z=0.70 gives 21 and 20 device px, and the hierarchy inverts. Clamping to
  the label's final size alone then drops `bank0` off a 42×156 block with room to spare. It is
  `max(floor, min(ownBudget, label · 10/13))`.

Cost is a mean of 2.8 `measureText` calls per block — one, when the ceiling already fits, which is
every block at ordinary zoom. No cache, deliberately.

The trade, stated plainly: type size now depends on string length, so a rank of identical boxes can
show several sizes; and where the old code froze at 13px and smeared, this steps through about ten
one-pixel sizes across an octave of zoom. Continuous reflow replaces a frozen distortion. That is
the one thing here a user might notice as _new_ rather than as fixed.

### 3.5 `DrawContext.boundsOf`, and nothing wider

`ShapeOps.draw` had no way to see another shape, by design: "every method is pure … or read
anything global" is what makes undo a matter of swapping array references. But the arrowhead
question — _at this zoom, would the head land inside a block I am attached to?_ — cannot be answered
from the connection alone, and cannot be precomputed either: `reroute` runs on commit, so a
pinch-zoom would never refresh it, and forcing a commit to refresh it would push undo entries.

`boundsOf(name): Rect | null` is the least that answers it. A `shapeByName` would hand `conn.ts` a
`RectShape` to read fields off and a `draw` to re-enter, and the purity contract would stop being
enforceable by construction. The renderer backs it with a `Map` built on first ask and thrown away
with the frame — lazy because a scene with no connections in view never asks, per-frame because a
cache that outlived the frame would index shapes that had since moved. It indexes _every_ shape,
not just the culled-in ones: a wire can be on screen while the block it points at is not, which is
exactly when its head is deciding.

Null is normal rather than exceptional — the connect tool's ghost is bound to nothing at its loose
end.

### 3.6 The tolerance is axial, and deflating the block would have been wrong

The tip sits exactly on the target's outline by construction, and `alignStroke` rounds it by up to a
device pixel while the projected block corner is not rounded at all. A plain `rectsIntersect` —
which is inclusive — would therefore suppress every arrowhead in the scene, at every zoom.

The obvious fix is to shrink the block before testing. It is wrong for precisely the case this
exists to catch: zoomed far enough out a block is two or three device pixels across, and a deflated
version of it has no area left to test. So the discount is taken out of the _head_, along the
arrow's own axis, by `ARROW_TIP_TOL_PX = 1.5` CSS px — about a sixth of the head, and comfortably
more than the disagreement it is absorbing.

`arrowBox` returns the box around the triangle rather than the triangle. It over-reports slightly in
the two corners behind the barbs, which is the safe direction, and reports exactly for the case that
actually arises: routes are rectilinear and anchors sit on faces, so the last run always meets its
face square on.

## 4. What looking at it caught that the suites did not

- **`⌫` at 13px reads as a small box.** The first toolbar screenshot looked like tofu. It is not —
  rendered at 60px it is plainly the pentagon-with-an-× — but a glyph check by eye at tooltip size
  cannot tell the two apart. The probe worth keeping is measuring the glyph's advance width against
  U+FFFF's, which is the only version of this question a suite can ask.
- **Blocks between 35 and 58 CSS px tall gained a subtitle they never had.** The old gate was 58,
  and the new one is "is it still readable". A 120×56 block now shows both lines at full size where
  yesterday it showed one. Intended, in the spirit of the request, and not something the request
  asked for — visible immediately in a screenshot and in none of the assertions.
- **An arrowhead in a gap exactly its own length is kept.** At 30% zoom, two blocks 30 world units
  apart have a 9px gap and a 9px head, so the head fits by the rule and looks cramped by eye. That
  is the rule behaving, not failing, but it is where the line is.
- **The padding complaint was not about padding.** Horizontal clearance was already 2.7px per side
  at a 30px block; what read as padding was the type being undersized by the reference square in
  the ramp. Measuring it first is what stopped a fix aimed at the wrong axis — reducing
  `INSET_PAD_X_PX` would have changed almost nothing visible.
- **"Vertically stretched" was horizontally condensed.** Same text, opposite axis. Worth recording
  because the report is accurate about what it looks like and misleading about what to change:
  nothing in the code touches the vertical scale of a glyph.
- **The worst realised margin is 3.50 CSS px**, measured over 55 block × zoom samples against a 3px
  target. The gap is `Math.floor` on the device font size being conservative, which is the right
  direction for it to be wrong in.

## 5. Flagged for future work

- **The property editor still says `Ctrl`.** `svelte-jsoneditor` normalises every platform to
  `Ctrl+…` in its own menus, so the app now reads `⌘` everywhere except inside the JSON tree.
- **Mac-only notation is a decision, not an oversight.** If this ever runs on Windows in earnest,
  `keys.ts` is the one file to change, and its `KeyToken` names (`cmd`, `opt`) already read as the
  abstract roles they would need to become.
- **A tall narrow block still ends in a stub.** Below the 8px floor there is nowhere left to
  shrink, so the label ellipsizes: a 70-wide block at 35% zoom shows `ME…`, and `MEMORY` and
  `MEM_CTL` would look the same. Refusing to cut below two surviving characters would help, and was
  not done — that is a second tuned threshold, and `theme.ts` argues hard against those.
- **Nothing caches a measurement.** 2.8 `measureText` calls per block per frame is about 0.1ms at
  200 two-line blocks, 0.6% of a 16.6ms budget, so a cache would be speculative. The place it would
  go is `fitInsetLine`, keyed on string and size.
- **Fill is not monotone in block height** (§3.3), dipping to 43% just under the subtitle
  threshold. Unfixable while 13px is a hard ceiling. If "shrink only" is ever relaxed, this is the
  reason to revisit.
- **`boundsOf` will be asked to do more.** Culling a connection's label against a neighbouring
  block is the next thing that wants it, and the temptation each time will be to widen it to the
  shape. §3.5 is the argument against.

## 6. Conventions and gotchas

- **A colour-matched pixel probe must account for the selection colour.** The connect tool leaves
  the wire it just drew selected, and a selected wire strokes amber, not grey. A probe counting
  `connStroke` pixels reported zero ink on a wire that was plainly on screen.
- **Renaming a tool id is the one rename the compiler cannot catch.** `ToolId` is
  `'pointer' | 'rect' | (string & {})`, so moving the string `'select'` onto a _different_ tool
  leaves every `setTool('select')` type-checking while activating the wrong one. Do it in two
  passes — rename the old owner out of the way first — and grep for the literal, not the symbol.
- **A gate expressed in the units a ramp scales is not a gate.** `h ≥ 58 · fit` where `fit ∝ h`
  reduces to `44 ≥ 58` and is false at every size. If both sides scale, the threshold does nothing.
  This is why the subtitle's old gate had to be replaced rather than scaled.
- **`fillText`'s fourth argument condenses.** It is neither a truncation nor a uniform scale: it
  squashes the glyph run horizontally and leaves the height alone. If text has to fit a width,
  measure it — `fitFontPx` to shrink, `fitText` to cut.
- **Do not size type from `fontBoundingBox`.** Chrome rounds its ascent and descent to whole
  pixels, so the ratio moves by 5% across 8–16px and in one place the ascent _falls_ as the size
  rises. `actualBoundingBox` over the same range is stable to four decimals.
- **Round a solved font size down.** The budget in §3.3 is solved to fill the height exactly, so
  rounding the device size up spends margin that has already been allocated — a whole CSS pixel out
  of three at dpr 1.
- **A pixel probe reading a band _around_ a block catches grid dots**, which are drawn outside it
  and pass a brightness test. One reading a scene with _overlapping_ blocks catches the neighbour's
  label. Both showed up while measuring margins, as a 0px margin on a block whose text was 21px
  from that edge — the probe was right and the scratch scene was wrong.
- **A new suite is three edits, not one**: the file, `package.json`'s `verify` script, and the
  assertion count in `README.md`.
- Screen-sized decorations still have to fit inside `CULL_MARGIN_PX` (iter-5-ux-polish §3.7).
  Nothing here grew, and `arrowBox` is strictly inside the head it describes.

## 7. How iteration 5-4 was verified

`npm run verify` is **381 assertions across eight suites**, up from 347.

| Assertion                                                              | The regression it catches                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| shortcuts render as Mac symbols, in Apple order however written        | `⌘⇧Z`, and any literal that escaped conversion                          |
| the toolbar shows them, rather than spelling the modifiers out         | a formatter that is right and wired to nothing                          |
| Backspace and Delete both take the selection out of the scene          | the unadvertised key quietly dying now that only `⌫` is named           |
| and undo puts it back, both times                                      | a delete key that took more than it was asked to                        |
| the two selection tools and the two shapes are separate clusters       | a tool declaring the wrong `group` — a rule in the right place, wrongly |
| and the four of them are the four tools, with their keys               | the numbering not running left to right                                 |
| a block with height to spare gets exactly the type it always got       | the budget changing anything at ordinary zoom                           |
| full-size type arrives at 31 CSS px, where it used to need 44          | the padding fix, stated as a number                                     |
| a block too short for two lines still gets one, at full size           | a height gate creeping back in below the pair’s threshold               |
| the label never shrinks as the block grows, nor grows past full size   | a non-monotone budget: a block that blanks halfway through a zoom       |
| shrinking a block loses the subtitle strictly before the label         | the ordering §3.3 is built on                                           |
| the two lines and their margins always add up to less than the block   | the failure mode of spending the height: text crossing the outline      |
| a block too short for full-size type gets everything but the margin    | the complaint that started it — 11.7px of dead space per side           |
| no block anywhere gets less type than the rule this replaced gave it   | buying bigger type at small sizes at the cost of a band elsewhere       |
| a fitted line is never wider than the budget it was given              | condensation at its root: 1194 string × width samples                   |
| widening a block never shrinks the type in it                          | type that flickers between two sizes as a block is resized              |
| a line that will not fit is shrunk whole before it is ever cut         | `XBN_ARB` and `XBN_MUX` both reading `XBN_…` at full size               |
| and one that cuts down to nothing but an ellipsis is dropped           | three dots alone in a block, for an octave of zoom                      |
| blocks under the old gate draw text, where they drew nothing at all    | the original feature: 31, 24 and 16 CSS px used to be blank             |
| a block at the new threshold draws as much as one 4× its height        | the budget still binding where it should no longer                      |
| and below it there is less ink the smaller the block gets              | type that is drawn but not scaled                                       |
| a tall narrow block draws its label at its natural width at every zoom | the stretch bug, against a fresh measurement of the string drawn        |
| and shrinks the type to do it rather than keeping the size             | a fix that stopped condensing by truncating instead                     |
| zooming out shrinks a block's text with it instead of blanking it      | the same thing arrived at the way a user meets it                       |
| the arrowhead's box is the head, less the tip on the outline           | the axial discount of §3.6, exactly                                     |
| with room either side, both wires draw their head                      | a rule that suppresses everything — the failure a naive intersect gives |
| zoomed out until the head would land inside the source block           | the feature                                                             |
| but the line is still there                                            | dropping the run along with the head                                    |
| and a wire with room at the same zoom keeps its head                   | zoom being used as the test instead of the geometry                     |
| zooming back in brings it back                                         | a decision cached across frames                                         |

Also run: `npm run check` (484 files, 0 errors), `npm run build`, `node verify/production.mjs`
against `vite preview` (16 passed), and `npx prettier --check src verify README.md history`. The
`page errors:` line was read on every suite and is absent from all of them. Screenshots were taken
at 100%, 70%, 50% and 35% zoom, and of the toolbar with a tooltip raised; §4 is what they said.

One thing was measured rather than asserted, because it belongs to no single function: the realised
distance from text ink to the block outline, over eight blocks × nine zoom levels. The worst is
3.50 CSS px against a 3px target, and the assertion in the suite covers the arithmetic that
produces it.
