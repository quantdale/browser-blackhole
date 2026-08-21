/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    // three/webgpu is a large single module; the default 500 kB warning is noise for this app.
    chunkSizeWarningLimit: 2000
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts']
  }
});
