import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';

const fsStub = fileURLToPath(new URL('./src/shims/fs-stub.ts', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'events', 'stream', 'process', 'util'],
      globals: { Buffer: true, process: true },
    }),
  ],
  resolve: {
    alias: {
      fs: fsStub,
      'vite-plugin-node-polyfills/shims/buffer': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js', import.meta.url)
      ),
      'vite-plugin-node-polyfills/shims/process': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js', import.meta.url)
      ),
      'vite-plugin-node-polyfills/shims/global': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/global/dist/index.js', import.meta.url)
      ),
    },
    dedupe: ['konva', 'react', 'react-dom'],
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles'
    },
    outDir: 'dist-lib',
    copyPublicDir: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', /^konva(\/|$)/, 'mudlet-map-renderer', 'mudlet-map-binary-reader'],
    },
  },
  optimizeDeps: {
    include: [
      'mudlet-map-binary-reader',
      'mudlet-map-binary-reader/dist/map-operations',
    ],
  },
});
