<script lang="ts">
  import { closeViolations, violations } from '../lib/ui/violations.svelte';

  /*
    One layer, at the app root, `position: fixed`.

    `ChromeTooltip` documents why anything rendered near the canvas paints underneath it, and
    the same reasoning applies here: the dock's panes establish stacking contexts, so a popup
    mounted inside one cannot rise above its neighbours. The difference from that layer is
    `pointer-events: auto` — this one is clicked and its text is worth selecting.
  */
  const W = 320;
  const GAP = 12;
  const MARGIN = 8;

  const at = $derived.by(() => {
    const v = violations.current;
    if (v === null) return null;
    // Clamped to the viewport so a badge near an edge does not push the panel off-screen. The
    // height is unknown before layout, so only the left edge is solved and the top is nudged.
    const left = Math.min(Math.max(MARGIN, v.x - W / 2), window.innerWidth - W - MARGIN);
    return { left, top: v.y + GAP };
  });

  function onWindowKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeViolations();
  }
</script>

<svelte:window
  onkeydown={onWindowKey}
  onresize={closeViolations}
  onblur={closeViolations}
  onscrollcapture={closeViolations}
/>
<svelte:document onvisibilitychange={closeViolations} />

{#if violations.current !== null && at !== null}
  <!-- A backdrop, so a click anywhere else dismisses without every other surface needing to
       know this exists. Transparent, and below the panel. -->
  <div class="fixed inset-0 z-[10000]" role="presentation" onpointerdown={closeViolations}></div>
  <div
    class="fixed z-[10001] rounded-md border border-[var(--color-panel-border)]
           bg-[var(--color-panel)] px-3 py-2 text-xs shadow-lg"
    style="left: {at.left}px; top: {at.top}px; width: {W}px;"
    role="dialog"
    aria-label="Connection violations"
  >
    <div class="mb-1 font-medium text-[var(--color-ink)]">{violations.current.title}</div>
    <ul class="list-disc space-y-1 pl-4 text-[var(--color-ink-dim)]">
      {#each violations.current.lines as line (line)}
        <li>{line}</li>
      {/each}
    </ul>
  </div>
{/if}
