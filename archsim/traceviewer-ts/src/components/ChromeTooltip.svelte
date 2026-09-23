<script lang="ts">
  import { CHROME_TIP_ID, chromeTip, dismissChromeTip } from '../lib/ui/tooltip.svelte';

  /** Gap between the anchor and the tooltip, in CSS pixels. */
  const GAP = 6;
  /** Kept this far inside the viewport, so it never looks welded to an edge. */
  const MARGIN = 6;

  // `null`, not `undefined`: Svelte nulls a `bind:this` when the element is torn down, which
  // here happens every time the tooltip hides. Same reasoning as `CanvasTooltip`.
  let boxEl = $state<HTMLDivElement | null>(null);
  let boxW = $state(0);
  let boxH = $state(0);

  const tip = $derived(chromeTip.current);
  /*
    Read here, in the layer's own render, which is the whole point of `ChromeTip.read`: a
    derived tooltip tracks its source without the anchor's attachment having to re-run.
  */
  const text = $derived(tip === null ? null : tip.read());

  /** Measure after layout, then place -- the size depends on wrapping and is not knowable before. */
  $effect(() => {
    // `text`, not just `tip`: the tooltip can change width without the anchor changing, and a
    // stale `boxW` would place the new text using the old one's size.
    void text;
    const el = boxEl;
    if (el === null) return;
    boxW = el.offsetWidth;
    boxH = el.offsetHeight;
  });

  /*
    Anything that can move an anchor dismisses the tooltip rather than re-measuring it.

    `scroll` is captured, because the panes that hold these controls scroll their own content
    and a scroll event from one of them does not bubble to the window. The same set
    `CanvasSurface` listens to for its own layout shifts, for the same reason.
  */
  $effect(() => {
    const drop = (): void => dismissChromeTip();
    /*
      Escape dismisses it without moving the pointer, which is WCAG 1.4.13's "dismissible" and
      the one part of that criterion this tooltip can honour -- it is `pointer-events: none`, so
      it cannot be hovered to keep it open.

      Deliberately not `preventDefault`ed and deliberately not `capture`: Escape already cancels
      the current gesture and then clears the selection, and a tooltip must not eat that. This
      only ever removes something the user can see.
    */
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissChromeTip();
    };
    window.addEventListener('resize', drop);
    window.addEventListener('scroll', drop, true);
    window.addEventListener('blur', drop);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', drop);
    return () => {
      window.removeEventListener('resize', drop);
      window.removeEventListener('scroll', drop, true);
      window.removeEventListener('blur', drop);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', drop);
    };
  });

  /*
    Below the anchor by default, flipped above when there is no room, then clamped into the
    viewport on both axes -- the clamp is what covers a control near a corner.

    `innerWidth` / `innerHeight` are read untracked on purpose: a resize dismisses the tooltip
    outright, so there is never a visible tooltip whose viewport has changed under it.
  */
  const pos = $derived.by(() => {
    if (tip === null) return { x: 0, y: 0 };
    const r = tip.rect;
    const below = r.bottom + GAP;
    const y = below + boxH + MARGIN > window.innerHeight ? r.top - GAP - boxH : below;
    const x = r.left + r.width / 2 - boxW / 2;
    return {
      x: Math.max(MARGIN, Math.min(x, window.innerWidth - boxW - MARGIN)),
      y: Math.max(MARGIN, Math.min(y, window.innerHeight - boxH - MARGIN)),
    };
  });
</script>

{#if tip !== null}
  <div
    bind:this={boxEl}
    id={CHROME_TIP_ID}
    class="tip"
    role="tooltip"
    data-testid="chrome-tooltip"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
  >
    {text}
  </div>
{/if}

<!--
  Mounted once at the app root, and that is load-bearing rather than tidy.

  A tooltip rendered next to the control it describes paints UNDERNEATH the canvas. `.stage` in
  `CanvasSurface` is `contain: strict`, which makes it a stacking context, and it is a LATER
  sibling of the toolbar inside `DiagramView` -- so the toolbar's positioned descendants and the
  stage both paint at the same level, in tree order, and the stage wins. Measured against the
  running app: a fixed box appended to a tool button is not the top element at its own
  coordinates, and the same box at `<main>` is. Winning that with a `z-index` would mean picking
  a number that has to beat the dock's, the property editor's popup layer's, and whatever ships
  next; one layer outside all of them has no such fight to pick.

  `position: fixed` rather than absolute for the same reason `app.css` gives for
  `.jse-absolute-popup`: `PanelHost` is `overflow: hidden` and the dock adds three more clip
  rects, and a fixed box's containing block is the viewport, so none of them apply. Verified at
  all three anchor sites that no ancestor establishes a containing block for fixed positioning.
-->

<style>
  .tip {
    position: fixed;
    /* The number, and why it is that number, are in `app.css` beside the dock's other rules. */
    z-index: var(--z-chrome-tip, 10001);
    max-width: 20rem;
    border: 1px solid var(--color-panel-border, #262c38);
    border-radius: 4px;
    background: var(--color-panel, #161a22);
    padding: 3px 7px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 45%);
    color: var(--color-ink, #dbe3ef);
    font-size: 11px;
    line-height: 1.5;
    /* The pointer is by definition next to this; letting it take a hit would flicker. */
    pointer-events: none;
  }
</style>
