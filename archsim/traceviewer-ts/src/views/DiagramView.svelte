<script lang="ts">
  import CanvasSurface from '../components/CanvasSurface.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import Toolbar from '../components/Toolbar.svelte';
  import { useSession } from '../lib/session.svelte';

  // A pure view over the shared session. Owning none of it is what lets this be re-mounted by
  // the dock (maximize, float, tab switch) without the diagram going with it.
  const { scene, view, host, renderer } = useSession();
</script>

<!-- Self-contained and sized by its container, so this drops into a pane when the tab strip
     and split views land. It never assumes it owns the window. -->
<div class="flex h-full min-h-0 w-full flex-col">
  <Toolbar {scene} {view} {host} />
  <div class="min-h-0 flex-1">
    <CanvasSurface {scene} {view} {host} {renderer} />
  </div>
  <StatusBar {scene} {view} {host} />
</div>
