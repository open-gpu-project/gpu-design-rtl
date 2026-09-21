import DiagramView from '../../views/DiagramView.svelte';
import { DIAGRAM_PANEL } from '../session.svelte';
import { registerPanel } from './registry';

/**
 * Not closable, and only ever instantiated once: the session owns a single `ViewController`
 * and `Renderer`, and a second canvas pane would fight over `view.attach()`.
 */
registerPanel({
  id: DIAGRAM_PANEL,
  title: 'Diagram',
  component: DiagramView,
  closable: false,
  minSize: 360,
});
