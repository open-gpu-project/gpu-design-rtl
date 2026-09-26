<script lang="ts">
  /*
    Deep-imported one module per icon, which is what keeps a 7 MB, 1600-icon package down to
    what is used. Never a `title` prop: iteration 5 removed every native tooltip in favour of
    the `tip()` attachment, and the checks assert no control in this pane carries one.
  */
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import LayerArrowDown from '@lucide/svelte/icons/layer-arrow-down';
  import LayerArrowUp from '@lucide/svelte/icons/layer-arrow-up';
  import LayersArrowDown from '@lucide/svelte/icons/layers-arrow-down';
  import LayersArrowUp from '@lucide/svelte/icons/layers-arrow-up';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Redo from '@lucide/svelte/icons/redo';
  import Save from '@lucide/svelte/icons/save';
  import Trash from '@lucide/svelte/icons/trash';
  import Undo from '@lucide/svelte/icons/undo';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import type { SceneStore } from '../lib/scene/scene.svelte';
  import { useSession } from '../lib/session.svelte';
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

  /*
    Read from context rather than taken as a fourth prop.

    A document lives across the whole app, not inside the diagram pane, so the file commands sit
    on `EditorSession` -- and `DiagramView` deliberately destructures only what its children
    need, so threading a `session` prop down would put the session in the one place that had
    managed without it. `TraceView` and `PropertiesView` already reach for it this way.
  */
  const session = useSession();

  const group = 'flex items-center gap-1 px-2';
  const divider = 'h-5 w-px bg-[var(--color-panel-border)]';
  const btn =
    'flex h-7 w-7 items-center justify-center rounded text-[var(--color-ink-dim)] ' +
    'hover:bg-white/5 hover:text-[var(--color-ink)] disabled:opacity-30 ' +
    'disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-dim)]';
  const active = 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]';

  const hasSelection = $derived(scene.selection.size > 0);
</script>

<!--
  Three zones on a `1fr auto 1fr` grid, so the middle one sits on the bar's true centre whatever
  the two sides hold. Document on the left: the commands that act on the file and its history.
  Tools in the middle: everything you do on the canvas -- the registry's tool clusters, then the
  arrange and delete commands, after the tools so the digits still read 1-6 left to right (they
  come from registry order, never from here). View on the right. Each zone is a labelled group,
  which is what `verify/input.mjs` reads the layout back through.
-->
<div
  class="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b
         border-[var(--color-panel-border)] bg-[var(--color-panel)] text-sm select-none"
>
  <div role="group" aria-label="Document" class="flex items-center justify-self-start">
    <div class={group}>
      <button
        class={btn}
        aria-label="Open diagram"
        {@attach tip(hint('Open diagram', 'cmd', 'o'))}
        onclick={() => void session.openDocument()}
      >
        <FolderOpen class="h-4 w-4" />
      </button>
      <!--
        Never disabled on an empty scene. Saving an empty diagram is a legitimate thing to want --
        it is how you clear a file you no longer need the contents of -- and a greyed button with
        no explanation is a worse answer than a file with no shapes in it.
      -->
      <button
        class={btn}
        aria-label="Save diagram"
        {@attach tip(hint('Save diagram', 'cmd', 's'))}
        onclick={() => session.saveDocument()}
      >
        <Save class="h-4 w-4" />
      </button>
    </div>

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
  </div>

  <div role="group" aria-label="Tools" class="flex items-center">
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
  </div>

  <div role="group" aria-label="View" class="{group} justify-self-end">
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
