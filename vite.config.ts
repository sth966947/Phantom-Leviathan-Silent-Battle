import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build so dist/index.html opens straight from disk with no server.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  test: { environment: 'node' },
} as never);
