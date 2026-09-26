import ObjectsView from '../../views/ObjectsView.svelte';
import { OBJECTS_PANEL } from '../session.svelte';
import { registerPanel } from './registry';

/*
  No `minSize`. The dock honours a pane's floor only along its direct parent split, which for
  this pane is the column it shares with Properties -- and the width of that column is already
  held by the dock-wide floor of 200, which binds before any per-pane one would.
*/
registerPanel({ id: OBJECTS_PANEL, title: 'Objects', component: ObjectsView });
