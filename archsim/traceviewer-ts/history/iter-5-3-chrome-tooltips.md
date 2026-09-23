# Iteration 5-3 — the toolbar tooltip the browser was never going to draw

Reported as: _"The tooltips on the toolbar isn't showing when hovering over the tools."_

This is a follow-up to [iter-5-2](iter-5-2-marquee-and-clipboard.md), which claimed the
toolbar tooltip already worked. It did not, and the way that claim was made is the more
interesting half of this iteration: what had been checked was the `title` **attribute**, read
out of the DOM with `page.evaluate`. The attribute was correct. The attribute is not the
feature.

## 1. Scope

- Replace the native `title` attribute on every control this app draws — twenty-one of them,
  across the diagram toolbar, the status bar and the trace panel's control strip — with a
  tooltip the app owns, on the same 450ms dwell as the canvas tooltip.
- Give the toolbar the Playwright coverage it never had.

Not in scope, and deliberately: the `title` attributes belonging to `@svgrid/grid` and
`svelte-jsoneditor`. Twelve remain in the DOM and all twelve are theirs.

## 2. Why the native tooltip did not appear

The app was not at fault, and this was established rather than assumed. Under a pointer resting
on a tool button, measured against the running dev server:

- the toolbar subtree receives **zero** DOM mutations over 2.5s (with a positive control: a tool
  switch produces four), so nothing re-renders the button out from under a pending tooltip;
- the app schedules **zero** animation frames — `Renderer.requestFrame` is strictly on demand
  and its frame body touches only the bitmap;
- `document.elementsFromPoint` at the button centre returns `path > svg > button`, all
  `pointer-events: auto`, so there is no overlay and the button is genuinely hovered;
- no ancestor from the button to `<html>` has `transform`, `filter`, `contain`, `will-change` or
  `isolation`;
- the attribute resolves: `Accessibility.getPartialAXTree` reports
  `{role: button, name: "Rectangle", description: "Rectangle (2)"}`.

The obvious suspect — that the innermost hovered node is a `<path>` two levels below the element
carrying the attribute — is **false**, and falsifiable from Chromium's source rather than by
taste. `SVGElement::title()` (`core/svg/svg_element.cc`) returns a _null_ `String`, not an empty
one, when there is no `<title>` child, and `HitTestResult::Title` tests `!title.IsNull()`, so the
ancestor walk continues past `<path>` and `<svg>` and finds the `<button>`.

What is actually going on is below Blink. On macOS Chromium does not draw the tooltip at all:

1. `ChromeClientImpl::UpdateTooltipUnderCursor` sends the string to the browser process, which
   reaches `ToolTipBaseView -setToolTipAtMousePoint:` (`ui/base/cocoa/tool_tip_base_view.mm`).
2. That registers an `NSToolTipRect` and then **fakes an `NSEventTypeMouseEntered`** so AppKit's
   `NSToolTipManager` runs its own dwell. AppKit draws it, not Chromium.
3. `_sendToolTipMouseEntered` refuses to send that fake event when
   `[NSWindow windowNumberAtPoint:NSEvent.mouseLocation belowWindowWithWindowNumber:0]` is not
   the browser's window — a guard against an overlapping window (crbug 40092440). The cursor
   position it consults is the **real window-server cursor**.
4. `setToolTipAtMousePoint:` caches the last string and early-returns when handed an identical
   one. So when step 3 drops the fake enter, the cache has _already_ been updated, and hovering
   that same button again sends nothing at all — until some different title is hovered in
   between.

Steps 3 and 4 together describe the report exactly: a toolbar whose tooltips are dead, stickily,
while the rest of the browser still has them. Anything floating an always-on-top panel over the
window triggers step 3 — and this machine has one (a mouse jiggler, window layer 980).

Which trigger fired on the reporter's screen is not something this repo can observe, and that is
the point of §3.

## 3. Load-bearing decisions

### 3.1 The native tooltip is not merely untested, it is untestable

Three independent channels were tried and all three are closed:

- **Synthetic input cannot raise one.** `page.mouse.move` is `Input.dispatchMouseEvent`, which
  never moves the OS cursor, so `NSEvent.mouseLocation` in step 3 above is wherever the user left
  it. Posting a genuine `CGEventMouseMoved` was tried too: the page received zero events, because
  `CGEventPost` needs an Accessibility grant this process does not have.
- **Nothing reports the tooltip.** The word appears twice in Playwright's bundled CDP protocol,
  both in `Overlay.HighlightConfig` — the DevTools inspector badge. All 57 domains were
  enumerated. The only real seam is `RenderWidgetHostViewMac::tooltip_observer_for_testing_`, a
  C++ browser-test hook.
- **No screenshot can contain one.** A page screenshot is a renderer compositor surface; an
  AppKit tooltip is an OS window. `screencapture` is TCC-denied to this process.

So `title=` was a permanent exemption from this project's rule that every behaviour has an
assertion in `verify/`. That exemption is precisely what let iter-5-2 report the feature as
working. An in-app tooltip is not a nicer version of the same thing — it is the only version the
project's own conventions can hold.

### 3.2 One layer, at the app root, because an inline one paints under the canvas

The first instinct is to render the tooltip next to the control it describes. Measured, that is
wrong: a `position: fixed` box appended to a tool button is **not** the topmost element at its
own coordinates, and the identical box appended to `<main>` is.

`.stage` in `CanvasSurface` is `contain: strict`, which makes it a stacking context, and
`DiagramView` puts it _after_ the toolbar. Two stacking contexts at `z-index: auto` paint in tree
order, so the canvas covers anything the toolbar hangs below itself. Recovering from that means
picking a `z-index` that beats the dock's, the JSON editor's popup layer's, and whatever ships
next. One layer outside every pane has no such fight to pick.

`position: fixed` rather than `absolute` for the reason `app.css` already gives for
`.jse-absolute-popup`: `PanelHost` is `overflow: hidden` and the dock adds three more clip rects,
and a fixed box's containing block is the viewport. Verified live at all three anchor sites that
no ancestor establishes a containing block for fixed positioning.

### 3.3 An attachment, not a wrapper component

`{@attach tip('Zoom to fit (Cmd+1)')}` rather than `<Tip text=…><button/></Tip>`. A wrapper would
put a second box in the middle of a flex row, and the twenty-one sites are not all buttons — two
are `<span>`s in the status bar. An attachment also re-runs when the values it reads change,
which is what makes a derived tooltip (`Undo: paste (Cmd+Z)`) need no special handling.

`pointerenter`/`pointerleave`, never the bubbling `pointerover`/`pointerout` pair: every one of
these controls wraps an `<svg>`, and the bubbling pair reports a crossing each time the pointer
passes between a button and its own icon, which would re-arm the dwell mid-hover and mean the
tooltip never appeared for a pointer that never left. That would have been an in-app
reimplementation of the bug.

### 3.4 The parenthesised shortcut comes from the registry

`toolTipText(descriptor)` lives in `tools/registry.ts`, next to `toolForShortcut`. Building the
string beside the lookup that answers to it is what stops the toolbar advertising a key that does
nothing — the same failure the `shortcut` field was moved into that file to end. It is also what
keeps "registering a tool is the only step" true: a lookup table in `Toolbar.svelte` keyed by
tool id would pass almost every assertion in §6 and silently give the next tool no tooltip.

### 3.5 Focus shows it at once; a dwell models an undecided pointer

A `pointerenter`-only tooltip is invisible to a keyboard user, and in this app the tooltip is the
only place a shortcut is written down outside the README. So `focus` shows it — but on
`:focus-visible`, because a click focuses the button too, and pairing "show on focus" with
"dismiss on press" would otherwise make a clicked button flash its own tooltip straight back up
under the pointer.

No dwell on focus: a dwell is a model of pointer indecision and means nothing for a deliberate
Tab.

While visible, the anchor gets `aria-describedby` pointing at the layer. A description and not a
name: every icon button already has an `aria-label`, and what the tooltip adds is the key.

### 3.6 The rect is read once, and anything that can move it dismisses

`ChromeTip.rect` is the anchor's viewport rect at the moment the dwell expired. A resize, a
scroll (captured — pane scrolls do not bubble to the window), a dock rearrangement or the window
losing focus drops the tooltip rather than re-measuring it. Chasing an anchor would be a second
layout dependency for the sake of a case that only arises while the user is doing something else.

## 4. What looking at it caught that the suites did not

**The toolbar had no coverage at all.** Not the tooltips — nothing. Every suite in this repo
reaches the tools by digit key (`page.keyboard.press('Digit2')`) or through `window.__host`, so
`onclick={() => host.setTool(tool.id)}` could have been deleted and `npm run verify` would have
stayed green. `git log -- src/components/Toolbar.svelte` returns only the initial commit: this
has been true for the project's entire life, and iter-5's canvas tooltip only made it visible by
contrast. There is now an assertion that clicking a tool button selects that tool.

**The first sweep assertion measured the wrong thing.** Counting document mutations while
dragging the pointer onto the toolbar reported two, and both were real: arriving from the canvas
nulls `host.pointer`, which blanks the status bar's live readout. The probe now starts from
inside the toolbar, so it measures the toolbar and not `StatusBar`.

**Two defects survived a green suite, and a review pass found them.** Both were reproduced
before being believed, and both now have assertions:

- **A derived tooltip dismissed itself.** `Undo` reads `scene.history.undoLabel`, and an
  attachment re-runs when its _expression's_ dependencies change — so the interpolated string
  tore the attachment down on every commit, and the teardown dismissed the visible tooltip. It
  did not come back: `pointerenter` does not fire again for a pointer that never left. Hover
  Undo, press `Cmd+Z`, and the tooltip vanished for good at the exact moment its text became
  worth reading. `tip()` now takes a thunk and the layer does the reactive read.
- **A floated pane covered it.** The layer shipped at `z-index: 100`; `.sv-dockmgr__window` is
  `101`. Every toolbar tooltip disappeared behind a floating panel. §3.2 argued against a
  `z-index` arms race and then lost one by inattention — the answer is not a bigger number
  picked by feel but a stated relation, which is what `app.css` now records and what
  `verify/docking.mjs` asserts.

## 5. Flagged for future work

- **The status bar's two tooltips are the weakest part of this.** `world` and `dpr` are `<span>`s
  with no accessible name of their own, so their tooltip is a description attached to nothing.
  They would be better as `<abbr>` or as labelled readouts.
- **`aria-keyshortcuts`** is the semantically correct home for a tool's key and is not set.
  Doing it properly means the hardcoded `Cmd+Z` / `Cmd+]` strings in the toolbar's markup have to
  move somewhere declarative first, which is a larger change than this bug warranted.
- **Cross-panel dwell.** Moving between two controls always pays the full dwell again. Most
  toolbars keep a short warm window during which the next tooltip is instant. It was left out
  because it trades a testable single rule for a stateful one, and because the canvas tooltip
  does not do it either — but a toolbar is read by scrubbing across it, and this is the most
  likely thing to want next.
- **The reporter's own machine.** If the native tooltips matter elsewhere (they are still used by
  the dock and the JSON editor), the discriminating test is manual: hover `Select`, then
  `Rectangle`, then `Select` again. If the third hover is dead but the first two worked, that is
  the `_toolTip` string cache in §2 step 4, on top of an overlapping always-on-top window.

## 6. Conventions and gotchas

- **Reading an attribute is not testing a feature.** The attribute was right the whole time. If a
  behaviour's only evidence is markup, the behaviour is not covered.
- **A tooltip is an OS window, so CSS cannot explain it.** Every clipping, stacking and
  containment hypothesis is a category error against a native tooltip — and every one of them is
  live again the moment the tooltip becomes a `<div>`. §3.2 is the one that bit.
- **Measure paint order, do not reason about it.** "The toolbar comes first in the DOM, so its
  popup is above the canvas" is false here, and a three-line probe says so in seconds.
- `pointerenter`/`pointerleave` over `pointerover`/`pointerout` for anything hover-triggered on a
  control containing an icon.

## 7. How iteration 5-3 was verified

`npm run verify` is **347 assertions across seven suites**, up from 317: twenty-six new ones in
`verify/input.mjs`, two in `verify/trace.mjs` and two in `verify/docking.mjs`.
`verify/production.mjs` gains one and is 16.

| Assertion                                                         | The regression it catches                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| nothing appears while the dwell is still running                  | a tooltip wired straight to `pointerenter`, flashing under every sweep |
| holding still over a tool names it and gives its key              | the feature, stated exactly: `Rectangle (2)`                           |
| every registered tool raises the tooltip its declaration asks for | a lookup table keyed by tool id — the next tool would get nothing      |
| a tool with no shortcut gets its label alone                      | `Pan ()` from an unconditional template                                |
| the tooltip is gone once the pointer has left the tool            | a box stranded over the canvas                                         |
| sliding onto the next tool re-runs the dwell                      | one timer left armed across buttons, machine-gunning tooltips          |
| pressing a tool dismisses its tooltip                             | a tooltip sitting over the gesture it just started                     |
| and the click still selects the tool                              | the toolbar having no coverage at all (§4)                             |
| a drag that starts on a tool button never raises one              | the canvas rule, applied to the chrome                                 |
| keyboard focus raises it at once, with no dwell                   | the tooltip, and so the shortcut, being mouse-only                     |
| the focused button points `aria-describedby` at it                | the screen-reader half going missing                                   |
| blurring leaves no dangling `aria-describedby`                    | an id pointing at a torn-down element                                  |
| the layer lives outside every dock pane                           | §3.2 — it paints under the canvas                                      |
| it is fixed, and the rightmost control stays on screen            | the five nested `overflow: hidden` boxes shearing it                   |
| exactly one tooltip exists at a time                              | two triggers each rendering their own                                  |
| sweeping the toolbar mutates the document not at all              | a `$state` write per pointermove                                       |
| a derived tooltip survives its text changing                      | the attachment teardown dismissing a visible tooltip                   |
| and it re-reads the new label                                     | the thunk being resolved at attach time again                          |
| a tooltip outranks a floated pane                                 | `z-index: 100` against the dock window's 101                           |
| no ancestor makes a containing block                              | `position: fixed` silently becoming pane-relative                      |
| a disabled control still says what it is                          | the case `click` suppression could plausibly take with it              |
| Escape dismisses it without moving the pointer                    | WCAG 1.4.13 "dismissible"                                              |
| and Escape still reaches the canvas                               | a tooltip swallowing the key that cancels gestures                     |
| no control carries a native title any more                        | two stacked tooltips, and the untestable attribute returning           |
| a trace control raises the app's tooltip, not one of its own      | a second layer per panel                                               |
| the toolbar tooltip works in the built bundle                     | an attachment reachable in dev and tree-shaken in production           |

Also run: `npm run check` (483 files, 0 errors), `npm run build`, `node verify/production.mjs`
against `vite preview`, and `npx prettier --check src verify README.md history`. The `page
errors:` line was read on every suite and is absent from all of them.
