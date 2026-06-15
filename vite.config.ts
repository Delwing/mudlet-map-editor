import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';
import prefixSelector from 'postcss-prefix-selector';

const fsStub = fileURLToPath(new URL('./src/shims/fs-stub.ts', import.meta.url));

// Same scoping the library build applies (see vite.lib.config.ts) — kept in
// sync so the standalone app and the published library share one stylesheet
// surface, and the root-wrapper class added in App.tsx is the only thing the
// CSS needs to match.
const EDITOR_ROOT_CLASS = '.mudlet-editor-root';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'events', 'stream', 'process', 'util'],
      globals: { Buffer: true, process: true },
    }),
  ],
  // The session-save worker pulls in the binary reader (Buffer, stream, …) just
  // like the main bundle, so it needs the same polyfills injected. `iife`
  // (classic worker) not `es` — the inlined worker is self-contained, so a
  // module worker buys nothing but isn't universally supported (older Firefox),
  // where it fails to load and forces the main-thread fallback. Kept in sync
  // with vite.lib.config.ts.
  worker: {
    format: 'iife',
    plugins: () => [
      nodePolyfills({
        include: ['buffer', 'events', 'stream', 'process', 'util'],
        globals: { Buffer: true, process: true },
      }),
    ],
  },
  css: {
    postcss: {
      plugins: [
        prefixSelector({
          prefix: EDITOR_ROOT_CLASS,
          transform(prefix, selector, prefixedSelector) {
            if (/^(html|body|#root)$/.test(selector)) return prefix;
            if (selector === ':root') return selector;
            return prefixedSelector;
          },
        }),
      ],
    },
  },
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
