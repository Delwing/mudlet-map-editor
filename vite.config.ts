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
    },
    // Keep Konva singleton even when mudlet-map-renderer is `npm link`ed (so
    // the linked renderer and the editor both use the editor's copy rather
    // than pulling a second Konva from the renderer's own node_modules).
    dedupe: ['konva', 'react', 'react-dom'],
  },
  // Vite skips `optimizeDeps` scanning for symlinked packages by default, so
  // the linked `mudlet-map-binary-reader` (CJS) lands in the browser as raw
  // CJS — breaks ESM named imports. Include it explicitly to force pre-bundle.
  optimizeDeps: {
    include: [
      'mudlet-map-binary-reader',
      // Deep-import workaround for Vite 8's oxc dropping `Object.defineProperty`
      // named exports from the binary reader's top-level entry — see mapIO.ts.
      'mudlet-map-binary-reader/dist/map-operations',
    ],
  },
});
