import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** monaco-editor does not import DOMPurify from npm. It vendors a prebuilt copy
 *  at `esm/vs/base/browser/dompurify/dompurify.js` and imports *that* from
 *  `domSanitize.js`, so the copy is frozen at whatever DOMPurify release the
 *  monaco release was cut against and no dependency bump can reach it —
 *  npm `overrides`, yarn `resolutions` and friends all resolve the `dompurify`
 *  package, which monaco's ESM build never loads.
 *
 *  monaco-editor@0.56.0 vendors 3.4.8, which four advisories cover
 *  (GHSA-vxr8-fq34-vvx9, GHSA-cmwh-pvxp-8882, GHSA-c2j3-45gr-mqc4,
 *  GHSA-55q2-fjhq-7xh7). The last two sit in the `addHook`/`sanitize` path
 *  `domSanitize.js` actually exercises when it renders markdown hovers and
 *  suggestion docs, and because the editor is published as a prebuilt bundle
 *  (`dist-lib`), the stale copy ships to every consumer rather than being
 *  something they could dedupe on their own.
 *
 *  So redirect that one module to the `dompurify` version this package pins.
 *  The vendored file is byte-identical to the matching npm release's
 *  `dist/purify.es.mjs` apart from its license banner — same default-exported
 *  DOMPurify instance — and monaco only touches `sanitize`, `addHook` and
 *  `removeAllHooks`, all unchanged across the 3.4.x line.
 *
 *  Revisit when monaco refreshes its vendored copy: if it ever passes the
 *  version this pins, the redirect starts *downgrading* it and should go. */
export function monacoDompurify(): Plugin {
  const replacement = fileURLToPath(
    new URL('./node_modules/dompurify/dist/purify.es.mjs', import.meta.url)
  );
  let redirected = false;
  return {
    name: 'monaco-dompurify',
    // Ahead of Vite's own resolver, which would otherwise settle the relative
    // specifier onto the vendored file before this hook ever sees it.
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('dompurify/dompurify.js')) return null;
      if (!importer.split(sep).join('/').includes('/monaco-editor/')) return null;
      redirected = true;
      return replacement;
    },
    buildEnd() {
      // A monaco upgrade that renames or inlines the vendored module would make
      // the hook silently stop matching and quietly restore the stale copy.
      if (!redirected) {
        this.warn(
          "monaco-dompurify: monaco's vendored DOMPurify was never resolved — " +
            'the redirect no longer matches and monaco may be bundling its own copy.'
        );
      }
    },
  };
}
