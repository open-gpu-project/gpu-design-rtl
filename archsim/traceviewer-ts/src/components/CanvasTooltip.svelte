<script lang="ts">
  import type { HoverTip } from '../lib/tools/host.svelte';

  interface Props {
    tip: HoverTip | null;
    /** Stage size in CSS pixels. The tooltip is clamped inside it. */
    stageW: number;
    stageH: number;
  }

  const { tip, stageW, stageH }: Props = $props();

  /** Gap between the pointer and the corner of the tooltip, in CSS pixels. */
  const OFFSET = 14;
  /** Kept away from the stage edge by this much, so it never looks welded to the border. */
  const MARGIN = 6;

  // `null`, not `undefined`: Svelte nulls a `bind:this` when the element is torn down, which
  // here happens every time the tooltip hides. Typing it as optional and testing for
  // `undefined` instead reads fine and throws on the very first dismissal.
  let boxEl = $state<HTMLDivElement | null>(null);
  let boxW = $state(0);
  let boxH = $state(0);

  /**
   * Measure after layout, then place.
   *
   * The size is not knowable before the text is in the DOM -- it depends on wrapping -- and the
   * placement needs it to decide which side of the pointer to sit on. So the first frame draws
   * at the unflipped position and the measurement corrects it. One frame of the tooltip being
   * 14px off is invisible; reserving a fixed size for prose of unknown length is not.
   */
  $effect(() => {
    void tip;
    const el = boxEl;
    if (el === null) return;
    boxW = el.offsetWidth;
    boxH = el.offsetHeight;
  });

  /**
   * `.stage` is `overflow: hidden; contain: strict`, so anything hanging off the edge is simply
   * cut. Flip to the other side of the pointer when there is no room, then clamp -- the clamp
   * is what covers a pane too small for either side.
   */
  const pos = $derived.by(() => {
    if (tip === null) return { x: 0, y: 0 };
    const x = tip.x + OFFSET + boxW + MARGIN > stageW ? tip.x - OFFSET - boxW : tip.x + OFFSET;
    const y = tip.y + OFFSET + boxH + MARGIN > stageH ? tip.y - OFFSET - boxH : tip.y + OFFSET;
    return {
      x: Math.max(MARGIN, Math.min(x, stageW - boxW - MARGIN)),
      y: Math.max(MARGIN, Math.min(y, stageH - boxH - MARGIN)),
    };
  });
</script>

{#if tip !== null}
  <div
    bind:this={boxEl}
    class="tip"
    role="tooltip"
    data-testid="canvas-tooltip"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
  >
    <div class="title">{tip.title}</div>
    {#each tip.lines as line (line)}
      <p class="line">{line}</p>
    {/each}
  </div>
{/if}

<style>
  .tip {
    position: absolute;
    z-index: 20;
    max-width: 22rem;
    border: 1px solid var(--color-panel-border, #262c38);
    border-radius: 4px;
    background: var(--color-panel, #161a22);
    padding: 6px 8px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 45%);
    /* The pointer is by definition on top of this; letting it take a hit would flicker. */
    pointer-events: none;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-ink, #dbe3ef);
  }

  .line {
    margin: 3px 0 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-ink-dim, #8a94a6);
  }

  .line:first-of-type {
    margin-top: 4px;
  }
</style>
