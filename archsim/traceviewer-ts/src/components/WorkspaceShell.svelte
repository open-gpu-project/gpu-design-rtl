<script lang="ts">
  import { SvDockManager, type DockManagerState } from '@svgrid/grid';
  import { loadWorkspace, saveWorkspace } from '../lib/dock/layout';
  import PanelHost from './PanelHost.svelte';

  /*
    `$state.raw`, not `$state`: SvDockManager only ever reassigns the whole workspace (every
    gesture is a pure transform in dock-manager-model returning a new state), so proxying every
    node would cost per-property signals for nothing.
  */
  let workspace = $state.raw<DockManagerState>(loadWorkspace());

  if (import.meta.env.DEV) {
    // Same idea as `window.__scene` / `window.__view`: a handle for driving the thing from a
    // console or a browser test. Arranging panes by hand is otherwise a drag gesture away.
    Object.defineProperty(window, '__workspace', {
      configurable: true,
      get: () => workspace,
      set: (w: DockManagerState) => {
        workspace = w;
      },
    });
  }
</script>

<div class="workspace">
  <SvDockManager
    bind:workspace
    onChange={saveWorkspace}
    keepAlive
    allowPopout={false}
    minSize={200}
  >
    {#snippet pane(p)}
      <PanelHost id={p.id} />
    {/snippet}
  </SvDockManager>
</div>

<!--
  `keepAlive` is required, not a preference. Without it DockNodeView wraps pane content in
  `{#key active.id}` and remounts it on every tab switch, tearing down the canvas's renderer and
  tool-host attachment. With it, an inactive pane is `display:none`, which reaches CanvasSurface
  as a 0x0 ResizeObserver entry -- the case it already guards against.

  `allowPopout={false}` because a popped-out canvas renders into a second document while
  CanvasSurface reads `devicePixelRatio` and `matchMedia` from the opener. Broken by
  construction, so it is not offered. In-app floating windows are fine and stay enabled.
-->

<style>
  /* Sets the svgrid palette from the app's own tokens. Custom properties inherit into the
     library's scoped styles, which is the only supported way to theme it. */
  .workspace {
    height: 100%;
    width: 100%;

    --sg-bg: var(--color-surface);
    --sg-fg: var(--color-ink);
    --sg-muted: var(--color-ink-dim);
    --sg-border: var(--color-panel-border);
    --sg-header-bg: var(--color-panel);
    --sg-row-hover-bg: rgb(255 255 255 / 0.05);
    --sg-accent: var(--color-accent);
    --sg-on-accent: var(--color-surface);
    --sg-focus-ring: var(--color-accent);
    --sg-danger: #f87171;
  }
</style>
