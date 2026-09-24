<script lang="ts">
  /*
    Deep-imported one module per icon, which is what keeps a 7 MB, 1600-icon package down to
    what is used. Never a `title` prop: iteration 5.3 removed every native tooltip in favour of
    the `tip()` attachment, and the checks assert no control in this pane carries one.
  */
  import LayerArrowDown from '@lucide/svelte/icons/layer-arrow-down';
  import LayerArrowUp from '@lucide/svelte/icons/layer-arrow-up';
  import LayersArrowDown from '@lucide/svelte/icons/layers-arrow-down';
  import LayersArrowUp from '@lucide/svelte/icons/layers-arrow-up';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Redo from '@lucide/svelte/icons/redo';
  import Trash from '@lucide/svelte/icons/trash';
  import Undo from '@lucide/svelte/icons/undo';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import type { SceneStore } from '../lib/scene/scene.svelte';
  import type { ToolHost } from '../lib/tools/host.svelte';
  import { hint, keys } from '../lib/keys';
  import { toolTipText } from '../lib/tools/registry';
  import { tip } from '../lib/ui/tooltip.svelte';
  import type { ViewController } from '../lib/canvas/view.svelte';

  interface Props {
    scene: SceneStore;
    view: ViewController;
    host: ToolHost;
  }

  const { scene, view, host }: Props = $props();

  const group = 'flex items-center gap-1 px-2';
  const divider = 'h-5 w-px bg-[var(--color-panel-border)]';
  const btn =
    'flex h-7 w-7 items-center justify-center rounded text-[var(--color-ink-dim)] ' +
    'hover:bg-white/5 hover:text-[var(--color-ink)] disabled:opacity-30 ' +
    'disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-dim)]';
  const active = 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]';

  const hasSelection = $derived(scene.selection.size > 0);
</script>

<div
  class="flex h-10 shrink-0 items-center border-b border-[var(--color-panel-border)]
         bg-[var(--color-panel)] text-sm select-none"
>
  <!--
    Driven by the tool registry, so a new tool appears here just by registering itself -- in
    its own cluster, because which side of the rule it belongs on is something the tool
    declares rather than something this markup decides.
  -->
  {#each host.toolGroups as cluster, i (i)}
    {#if i > 0}
      <div class={divider}></div>
    {/if}
    <div class={group}>
      {#each cluster as tool (tool.id)}
        <button
          class="{btn} {host.activeToolId === tool.id ? active : ''}"
          aria-label={tool.label}
          aria-pressed={host.activeToolId === tool.id}
          onclick={() => host.setTool(tool.id)}
          {@attach tip(toolTipText(tool))}
        >
          <tool.icon class="h-4 w-4" />
        </button>
      {/each}
    </div>
  {/each}

  <div class={divider}></div>

  <div class={group}>
    <button
      class={btn}
      aria-label="Undo"
      {@attach tip(
        () =>
          `Undo${scene.history.undoLabel ? `: ${scene.history.undoLabel}` : ''} (${keys('cmd', 'z')})`,
      )}
      disabled={!scene.history.canUndo}
      onclick={() => host.undo()}
    >
      <Undo class="h-4 w-4" />
    </button>
    <button
      class={btn}
      aria-label="Redo"
      {@attach tip(
        () =>
          `Redo${scene.history.redoLabel ? `: ${scene.history.redoLabel}` : ''} (${keys('shift', 'cmd', 'z')})`,
      )}
      disabled={!scene.history.canRedo}
      onclick={() => host.redo()}
    >
      <Redo class="h-4 w-4" />
    </button>
  </div>

  <div class={divider}></div>

  <div class={group}>
    <button
      class={btn}
      aria-label="Bring to front"
      {@attach tip(hint('Bring to front', 'cmd', ']'))}
      disabled={!hasSelection}
      onclick={() => host.bringToFront()}
    >
      <LayerArrowUp class="h-4 w-4" />
    </button>
    <button
      class={btn}
      aria-label="Bring forward"
      {@attach tip(hint('Bring forward', 'shift', 'cmd', ']'))}
      disabled={!hasSelection}
      onclick={() => host.bringForward()}
    >
      <LayersArrowUp class="h-4 w-4" />
    </button>
    <button
      class={btn}
      aria-label="Send backward"
      {@attach tip(hint('Send backward', 'shift', 'cmd', '['))}
      disabled={!hasSelection}
      onclick={() => host.sendBackward()}
    >
      <LayersArrowDown class="h-4 w-4" />
    </button>
    <button
      class={btn}
      aria-label="Send to back"
      {@attach tip(hint('Send to back', 'cmd', '['))}
      disabled={!hasSelection}
      onclick={() => host.sendToBack()}
    >
      <LayerArrowDown class="h-4 w-4" />
    </button>
    <button
      class={btn}
      aria-label="Delete"
      {@attach tip(hint('Delete', 'del'))}
      disabled={!hasSelection}
      onclick={() => host.deleteSelection()}
    >
      <Trash class="h-4 w-4" />
    </button>
  </div>

  <div class="ml-auto flex items-center gap-1 px-2">
    <button
      class={btn}
      aria-label="Zoom out"
      onclick={() => host.zoomByStep(-1)}
      {@attach tip('Zoom out')}
    >
      <ZoomOut class="h-4 w-4" />
    </button>
    <button
      class="min-w-14 rounded px-2 py-1 text-xs text-[var(--color-ink-dim)] tabular-nums hover:bg-white/5"
      onclick={() => host.resetZoom()}
      {@attach tip(hint('Reset zoom to 100%', 'cmd', '0'))}
    >
      {Math.round(view.z * 100)}%
    </button>
    <button
      class={btn}
      aria-label="Zoom in"
      onclick={() => host.zoomByStep(1)}
      {@attach tip('Zoom in')}
    >
      <ZoomIn class="h-4 w-4" />
    </button>
    <button
      class={btn}
      aria-label="Zoom to fit"
      onclick={() => host.zoomToFit()}
      {@attach tip(hint('Zoom to fit', 'cmd', '1'))}
    >
      <Maximize class="h-4 w-4" />
    </button>
  </div>
</div>
