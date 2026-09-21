import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  // Relative base so dist/ can be served from any subpath. Not file:// though -- module
  // scripts are blocked by CORS there; use `npm run preview` or any static server.
  base: './',
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5183, strictPort: true },
  // 4183 because `verify/production.mjs` and the docs both name it; vite's own default is 4173.
  preview: { port: 4183, strictPort: true },
});
