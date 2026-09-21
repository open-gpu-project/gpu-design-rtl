import PropertiesView from '../../views/PropertiesView.svelte';
import { registerPanel } from './registry';

registerPanel({
  id: 'properties',
  title: 'Properties',
  component: PropertiesView,
  minSize: 280,
});
