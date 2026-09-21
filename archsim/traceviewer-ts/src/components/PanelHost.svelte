<script lang="ts">
  import { panelFor } from '../lib/panels/registry';
  import { useSession, type PanelId } from '../lib/session.svelte';

  interface Props {
    id: PanelId;
  }

  const { id }: Props = $props();
  const session = useSession();
  const descriptor = $derived(panelFor(id));
</script>

<!--
  Two jobs: resolve the pane id to a registered panel, and record which panel owns the keyboard.

  Focus tracking is ours because SvDockManager's own `setFocus` only fires on tab activation and
  `api.focus()` -- it never observes focus moving inside a pane's content. Both listeners are
  capture-phase so a widget that stops propagation (the JSON tree does, while editing a value)
  cannot hide the interaction from us.
-->
<div
  class="panel-host"
  data-panel-id={id}
  onpointerdowncapture={() => session.focusPanel(id)}
  onfocusincapture={() => session.focusPanel(id)}
>
  {#if descriptor !== undefined}
    {@const Panel = descriptor.component}
    <Panel />
  {:else}
    <div class="missing">
      <p class="title">Unknown panel</p>
      <p class="detail">
        This layout refers to a panel called <code>{id}</code>, which this build does not have.
      </p>
    </div>
  {/if}
</div>

<style>
  /*
    `contain: strict` needs an explicit size, and the dock's `.sv-dock__content` is a flex item
    whose height flexbox resolves -- so 100% is definite here. `overflow: hidden` is the belt to
    the braces in app.css: nothing in this app scrolls except a panel's own inner content.
  */
  .panel-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .missing {
    display: flex;
    height: 100%;
    flex-direction: column;
    justify-content: center;
    gap: 0.25rem;
    padding: 1rem;
    text-align: center;
    color: var(--color-ink-dim);
  }

  .title {
    margin: 0;
    color: var(--color-ink);
    font-size: 0.875rem;
  }

  .detail {
    margin: 0;
    font-size: 0.75rem;
  }

  code {
    color: var(--color-accent);
  }
</style>
