import ObjectsView from '../../views/ObjectsView.svelte';
import { OBJECTS_PANEL } from '../session.svelte';
import { registerPanel } from './registry';

/*
  No `minSize`. The dock-wide floor of 200 already holds this pane's width in the row it shares
  with the canvas and Properties, and a tree of names is readable at that.
*/
registerPanel({ id: OBJECTS_PANEL, title: 'Objects', component: ObjectsView });
