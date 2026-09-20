<script lang="ts">
  import type { SceneStore } from '../lib/scene/scene.svelte';
  import type { ToolHost } from '../lib/tools/host.svelte';
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
  <!-- Driven by the tool registry, so a new tool appears here just by registering itself. -->
  <div class={group}>
    {#each host.tools as tool (tool.id)}
      <button
        class="{btn} {host.activeToolId === tool.id ? active : ''}"
        title="{tool.label}{tool.shortcut ? ` (${tool.shortcut})` : ''}"
        aria-label={tool.label}
        aria-pressed={host.activeToolId === tool.id}
        onclick={() => host.setTool(tool.id)}
      >
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor"><path d={tool.icon} /></svg>
      </button>
    {/each}
  </div>

  <div class={divider}></div>

  <div class={group}>
    <button
      class={btn}
      title="Undo{scene.history.undoLabel ? `: ${scene.history.undoLabel}` : ''} (Cmd+Z)"
      aria-label="Undo"
      disabled={!scene.history.canUndo}
      onclick={() => host.undo()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-1" />
      </svg>
    </button>
    <button
      class={btn}
      title="Redo{scene.history.redoLabel ? `: ${scene.history.redoLabel}` : ''} (Shift+Cmd+Z)"
      aria-label="Redo"
      disabled={!scene.history.canRedo}
      onclick={() => host.redo()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h1" />
      </svg>
    </button>
  </div>

  <div class={divider}></div>

  <div class={group}>
    <button
      class={btn}
      title="Bring to front (Cmd+])"
      aria-label="Bring to front"
      disabled={!hasSelection}
      onclick={() => host.bringToFront()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="12" height="12" /><rect
          x="9"
          y="9"
          width="12"
          height="12"
          fill="currentColor"
        />
      </svg>
    </button>
    <button
      class={btn}
      title="Bring forward (Shift+Cmd+])"
      aria-label="Bring forward"
      disabled={!hasSelection}
      onclick={() => host.bringForward()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 4v12M7 9l5-5 5 5M5 20h14" />
      </svg>
    </button>
    <button
      class={btn}
      title="Send backward (Shift+Cmd+[)"
      aria-label="Send backward"
      disabled={!hasSelection}
      onclick={() => host.sendBackward()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20V8M7 15l5 5 5-5M5 4h14" />
      </svg>
    </button>
    <button
      class={btn}
      title="Send to back (Cmd+[)"
      aria-label="Send to back"
      disabled={!hasSelection}
      onclick={() => host.sendToBack()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="12" height="12" fill="currentColor" /><rect
          x="9"
          y="9"
          width="12"
          height="12"
        />
      </svg>
    </button>
    <button
      class={btn}
      title="Delete (Del)"
      aria-label="Delete"
      disabled={!hasSelection}
      onclick={() => host.deleteSelection()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      </svg>
    </button>
  </div>

  <div class="ml-auto flex items-center gap-1 px-2">
    <button class={btn} title="Zoom out" aria-label="Zoom out" onclick={() => host.zoomByStep(-1)}>
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" /><path d="M8 11h6M16 16l4 4" />
      </svg>
    </button>
    <button
      class="min-w-14 rounded px-2 py-1 text-xs text-[var(--color-ink-dim)] tabular-nums hover:bg-white/5"
      title="Reset zoom to 100% (Cmd+0)"
      onclick={() => host.resetZoom()}
    >
      {Math.round(view.z * 100)}%
    </button>
    <button class={btn} title="Zoom in" aria-label="Zoom in" onclick={() => host.zoomByStep(1)}>
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M16 16l4 4" />
      </svg>
    </button>
    <button
      class={btn}
      title="Zoom to fit (Cmd+1)"
      aria-label="Zoom to fit"
      onclick={() => host.zoomToFit()}
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      </svg>
    </button>
  </div>
</div>
