// Worker-scope Node globals shim. MUST be imported before anything that pulls
// in the binary reader (which bundles `readable-stream` + `buffer`). Those
// modules reference bare `process`, `global` and `Buffer` — at module top-level
// (e.g. `process.nextTick`) and at runtime (`writeMapToBuffer` uses `Buffer`).
// In a Web Worker none of these exist, so the worker either fails to load
// (`process is not defined` → onerror) or throws mid-save (`Buffer is not
// defined`), and sessionSaver falls back to the main thread on every save.
//
// vite-plugin-node-polyfills is supposed to inject these globals, but it does
// so via an esbuild `banner`, and Vite 8's oxc transform ignores esbuild
// options (the build logs: "oxc options will be used and esbuild options will
// be ignored ... { banner: undefined }"). So the injection is silently dropped
// and we define the shims here instead. `buffer` is the one real import — its
// module guards its own `global`/`process` lookups with `typeof`, so it's safe
// to evaluate before the assignments below; everything in the binary reader's
// graph is imported *after* this module (see sessionWorker.ts) and so sees all
// three globals already set.
import { Buffer } from 'buffer';

const g = globalThis as unknown as {
  process?: unknown;
  global?: unknown;
  Buffer?: unknown;
};

if (typeof g.process === 'undefined') {
  g.process = {
    env: {},
    browser: true,
    version: '',
    versions: {},
    platform: 'browser',
    cwd: () => '/',
    emitWarning: () => {},
    // readable-stream schedules callbacks via process.nextTick.
    nextTick: (cb: (...a: unknown[]) => void, ...args: unknown[]) => {
      Promise.resolve().then(() => cb(...args));
    },
  };
}

if (typeof g.global === 'undefined') {
  g.global = globalThis;
}

if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}
