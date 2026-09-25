<script lang="ts">
  import CanvasSurface from '../components/CanvasSurface.svelte';
  import CanvasTooltip from '../components/CanvasTooltip.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import Toolbar from '../components/Toolbar.svelte';
  import { useSession } from '../lib/session.svelte';

  // A pure view over the shared session. Owning none of it is what lets this be re-mounted by
  // the dock (maximize, float, tab switch) without the diagram going with it.
  const { scene, view, host, renderer } = useSession();

  // Everything a diagram frame reads, besides the canvas size the surface tracks itself.
  const track = (): void => {
    void scene.shapes;
    void scene.selection;
    void scene.draft;
    void view.camX;
    void view.camY;
    void view.z;
    void host.overlayVersion;
  };
</script>

<!-- Self-contained and sized by its container, so any dock pane can hold it. It never assumes
     it owns the window. -->
<div class="flex h-full min-h-0 w-full flex-col">
  <Toolbar {scene} {view} {host} />
  <div class="min-h-0 flex-1">
    <CanvasSurface {view} {host} {renderer} {track}>
      <CanvasTooltip tip={host.hover} stageW={view.cssW} stageH={view.cssH} />
    </CanvasSurface>
  </div>
  <StatusBar {scene} {view} {host} />
</div>
