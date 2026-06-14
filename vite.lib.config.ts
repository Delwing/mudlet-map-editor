import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';
import prefixSelector from 'postcss-prefix-selector';

const fsStub = fileURLToPath(new URL('./src/shims/fs-stub.ts', import.meta.url));

/** Class added to the editor's root <div> at runtime (see App.tsx). Every CSS
 *  selector in the bundled stylesheet is prefixed with this class at build time
 *  so the editor's styles only match elements inside its own subtree — letting
 *  consumers embed the editor without bare-selector collisions with their app's
 *  own .toolbar / .app / input[type=checkbox] / * rules. */
const EDITOR_ROOT_CLASS = '.mudlet-editor-root';

export default defineConfig({
  // Relative base so emitted assets — the session-save worker chunk, the
  // codicon font, etc. — are referenced via relative `import.meta.url` URLs
  // instead of absolute `/assets/…` paths. Absolute paths resolve against the
  // consumer's site root (where the files aren't served) and 404; relative ones
  // can be resolved and re-emitted by the consumer's bundler.
  base: './',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'events', 'stream', 'process', 'util'],
      globals: { Buffer: true, process: true },
    }),
  ],
  // The session-save worker pulls in the binary reader (Buffer, stream, …) just
  // like the main bundle, so it needs the same polyfills injected. In library
  // consumers that can't resolve the emitted worker chunk, sessionSaver falls
  // back to saving on the main thread.
  worker: {
    format: 'es',
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
            // The editor's single page-reset block targets html/body/#root —
            // when prefixed naively (`.root html`, `.root body`, `.root #root`)
            // none would match anything inside the embedded subtree. Map the
            // whole comma-list onto the root itself so its color/background/
            // font-family land on the wrapper and cascade as intended.
            if (/^(html|body|#root)$/.test(selector)) return prefix;
            // `:root` carries CSS-var definitions that need to live on the
            // documentElement so they're visible across the whole subtree
            // (and to any consumer code reading the same vars). Leave it
            // unchanged rather than scoping it under the editor.
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
      external: ['react', 'react-dom', 'react/jsx-runtime', /^konva(\/|$)/, 'mudlet-map-renderer', 'mudlet-map-binary-reader', 'i18next', 'react-i18next'],
    },
  },
  optimizeDeps: {
    include: [
      'mudlet-map-binary-reader',
      'mudlet-map-binary-reader/dist/map-operations',
    ],
  },
});
