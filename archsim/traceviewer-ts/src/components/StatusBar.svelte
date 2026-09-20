<script lang="ts">
  import type { ViewController } from '../lib/canvas/view.svelte';
  import { GRID } from '../lib/grid';
  import type { SceneStore } from '../lib/scene/scene.svelte';
  import type { ToolHost } from '../lib/tools/host.svelte';

  interface Props {
    scene: SceneStore;
    view: ViewController;
    host: ToolHost;
  }

  const { scene, view, host }: Props = $props();

  const round = (n: number): string => Math.round(n).toString();

  /** With no scrollbars there is no position affordance, so the world rect is shown instead. */
  const worldLabel = $derived(
    `${round(view.world.x)},${round(view.world.y)} ${round(view.world.w)}x${round(view.world.h)}`,
  );

  const draftLabel = $derived.by(() => {
    const d = scene.draft;
    if (d === null || d.kind !== 'rect') return null;
    return `${Math.round(Math.abs(d.w) / GRID)} x ${Math.round(Math.abs(d.h) / GRID)} cells`;
  });
</script>

<div
  class="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--color-panel-border)]
         bg-[var(--color-panel)] px-3 text-xs text-[var(--color-ink-dim)] select-none"
>
  <span class="text-[var(--color-ink)]">{host.hint}</span>

  {#if draftLabel !== null}
    <span class="text-[var(--color-accent)] tabular-nums">{draftLabel}</span>
  {/if}

  <span class="ml-auto tabular-nums">
    {#if host.pointer !== null}
      x {round(host.pointer.snapped.x)} &nbsp; y {round(host.pointer.snapped.y)}
    {:else}
      &mdash;
    {/if}
  </span>
  <span class="tabular-nums">{scene.shapes.length} blocks</span>
  <span class="tabular-nums">{scene.selection.size} selected</span>
  <span class="tabular-nums" title="World bounds (x,y w x h)">world {worldLabel}</span>
  <span class="tabular-nums" title="Device pixel ratio">dpr {view.dpr}</span>
</div>
