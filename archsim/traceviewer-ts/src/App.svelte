<script lang="ts">
  import WorkspaceShell from './components/WorkspaceShell.svelte';
  import { clearWorkspace } from './lib/dock/layout';
  import { serializeScene } from './lib/scene/serialize';
  import { EditorSession, provideSession } from './lib/session.svelte';
  import { tickTiers } from './lib/timeline/ticks';

  // Constructed here, not in the canvas panel: a docked pane is remounted when it is maximized,
  // floated, or popped out, and the document must not be able to die with it.
  const session = new EditorSession();
  provideSession(session);

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __session: session,
      __scene: session.scene,
      __view: session.view,
      __host: session.host,
      __trace: session.trace,
      __timeline: session.timeline,
      __timelineHost: session.timelineHost,
      // Pure, and the one part of the timeline a browser check cannot reach through the DOM.
      __tickTiers: tickTiers,
      __dump: () => serializeScene(session.scene.shapes),
      __resetLayout: () => {
        clearWorkspace();
        location.reload();
      },
    });
  }
</script>

<main class="h-full w-full">
  <WorkspaceShell />
</main>
