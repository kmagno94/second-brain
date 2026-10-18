import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same setup as Speak to Prompt. The app's source lives in app/.
// GitHub Pages serves it at /second-brain/, so the deploy workflow passes
// that in BASE_PATH; locally it stays "/".
export default defineConfig({
  root: path.join(here, 'app'),
  envDir: here,
  base: process.env.BASE_PATH || '/',
  plugins: [svelte()],
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, target: 'safari16' }
});
