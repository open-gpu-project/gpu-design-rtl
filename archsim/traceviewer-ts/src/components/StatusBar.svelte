<script lang="ts">
  import type { ViewController } from '../lib/canvas/view.svelte';
  import { GRID } from '../lib/grid';
  import { opsFor } from '../lib/scene/registry';
  import type { SceneStore } from '../lib/scene/scene.svelte';
  import type { ToolHost } from '../lib/tools/host.svelte';
  import { tip } from '../lib/ui/tooltip.svelte';

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

  /**
   * What the selected sub-part is, when there is one.
   *
   * Asked of the shape rather than formatted here, so the status bar never learns that a
   * connection's sub-parts are called waypoints -- the shape supplies the noun along with the
   * count and the position.
   */
  const subPartLabel = $derived.by(() => {
    const cur = host.subPart;
    if (cur === null) return null;
    // Only while its shape is the sole selection. The pointer tool re-checks that on every read
    // of its own copy, but ⌘A, the marquee and the object tree change the selection without
    // going through it, and would otherwise leave a stale "waypoint 2 / 3" here.
    if (scene.selection.size !== 1 || !scene.selection.has(cur.shape)) return null;
    const s = scene.shapes.find((x) => x.name === cur.shape);
    if (s === undefined) return null;
    const part = opsFor(s).subPart?.(s, cur.index) ?? null;
    if (part === null) return null;
    return `${part.noun} ${part.ordinal} / ${part.count} · ${round(part.pos.x)}, ${round(part.pos.y)}`;
  });

  /*
    Through `bounds`, not through a `kind` check. This was the one place left in the app that
    switched on a shape's kind, and iteration 6 added two more draft-producing tools -- so the
    switch would have had to grow, silently, every time a kind learned to be drawn. `bounds` is
    already the per-kind answer to "how big is this", and it is defined for every kind.
  */
  const draftLabel = $derived.by(() => {
    const d = scene.draft;
    if (d === null) return null;
    const b = opsFor(d).bounds(d);
    return `${Math.round(Math.abs(b.w) / GRID)} x ${Math.round(Math.abs(b.h) / GRID)} cells`;
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

  {#if subPartLabel !== null}
    <span class="text-[var(--color-accent)] tabular-nums">{subPartLabel}</span>
  {/if}

  <span class="ml-auto tabular-nums">
    {#if host.pointer !== null}
      x {round(host.pointer.x)} &nbsp; y {round(host.pointer.y)}
    {:else}
      &mdash;
    {/if}
  </span>
  <span class="tabular-nums">{scene.shapes.length} objects</span>
  <span class="tabular-nums">{scene.selection.size} selected</span>
  <span class="tabular-nums" {@attach tip('World bounds (x,y w x h)')}>world {worldLabel}</span>
  <span class="tabular-nums" {@attach tip('Device pixel ratio')}>dpr {view.dpr}</span>
</div>
