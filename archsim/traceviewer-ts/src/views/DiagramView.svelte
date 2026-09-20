<script lang="ts">
  import CanvasSurface from '../components/CanvasSurface.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import Toolbar from '../components/Toolbar.svelte';
  import { Renderer } from '../lib/canvas/renderer';
  import { darkTheme } from '../lib/canvas/theme';
  import { ViewController } from '../lib/canvas/view.svelte';
  import '../lib/register';
  import { computeWorldBounds } from '../lib/scene/bounds';
  import { SceneStore } from '../lib/scene/scene.svelte';
  import { serializeScene } from '../lib/scene/serialize';
  import { ToolHost } from '../lib/tools/host.svelte';

  const scene = new SceneStore();
  const view = new ViewController();

  // `renderer` is only read from inside these closures, which run well after both are built.
  const host = new ToolHost(scene, view, () => renderer.requestFrame());
  const renderer = new Renderer(view, darkTheme, () => ({
    shapes: scene.shapes,
    selection: scene.selection,
    draft: scene.draft,
    overlay: (dc) => host.drawOverlay(dc),
  }));

  // Synchronous, not an `$effect`: an effect would let the browser paint one frame with the
  // world already changed but the camera not yet re-clamped.
  scene.onCommit = () => {
    view.setWorld(computeWorldBounds(scene.contentBounds));
  };

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __scene: scene,
      __view: view,
      __dump: () => serializeScene(scene.shapes),
    });
  }
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
