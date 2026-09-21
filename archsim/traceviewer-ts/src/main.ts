import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
// Side-effect registrations (shapes, tools, panels) must all have run before anything looks
// one up -- the dock shell resolves a saved layout's pane ids against the panel registry the
// moment it initialises.
import './lib/register';

const target = document.getElementById('app');
if (target === null) throw new Error('missing #app mount point');

export default mount(App, { target });
