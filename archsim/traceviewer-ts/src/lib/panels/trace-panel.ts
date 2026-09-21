import TraceView from '../../views/TraceView.svelte';
import { TRACE_PANEL } from '../session.svelte';
import { registerPanel } from './registry';

registerPanel({ id: TRACE_PANEL, title: 'Trace', component: TraceView, minSize: 140 });
