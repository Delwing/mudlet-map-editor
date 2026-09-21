// Client for the session-save Web Worker. Offloads map serialization + the
// IndexedDB write to a worker so auto-save never blocks the UI thread. If the
// worker can't be created or fails (e.g. when the library build is consumed in
// an environment that can't resolve the worker), it transparently falls back to
// saving on the main thread — same behaviour as before, just not off-thread.
import type { MudletMap } from '../mapIO';
import type { Command } from './types';
import { saveSession } from './session';
import type { SaveSessionRequest, SaveSessionResponse } from './sessionWorker';
// Inline worker: Vite embeds the compiled worker as a blob and gives us a
// ready-made constructor. This avoids emitting a separate worker chunk that the
// main bundle would reference via `new Worker(new URL('…', import.meta.url))`.
// That URL pattern breaks for library consumers: a consumer's Vite pre-bundles
// our package through esbuild (optimizeDeps), which neither rewrites the worker
// URL nor copies the chunk, so `import.meta.url` resolves into `.vite/deps/…`
// and the worker 404s. Inlining sidesteps the asset-resolution problem entirely.
import SessionWorker from './sessionWorker?worker&inline';

export interface SaveSessionArgs {
  fileName: string;
  map: MudletMap;
  undoStack: Command[];
  currentAreaId: number | null;
  currentZ: number;
  existingId?: string;
  pixmapPool?: Record<string, Uint8Array>;
}

type Pending = { resolve: (id: string) => void; reject: (err: Error) => void };

let worker: Worker | null = null;
let workerDisabled = false;
let nextReqId = 1;
const pending = new Map<number, Pending>();

function failAllPending(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerDisabled) return null;
  if (worker) return worker;
  try {
    worker = new SessionWorker();
    worker.onmessage = (e: MessageEvent<SaveSessionResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      if ('error' in msg) p.reject(new Error(msg.error));
      else p.resolve(msg.id);
    };
    worker.onerror = (e: ErrorEvent) => {
      // Worker failed to load or threw at the top level — disable it for the
      // rest of the session so callers fall back to the main thread. Preserve
      // the ErrorEvent's real details (message/source/line) — otherwise the
      // fallback warning is an opaque "session worker error" with no clue why.
      workerDisabled = true;
      const detail = e?.message
        ? `${e.message}${e.filename ? ` (${e.filename}:${e.lineno ?? 0})` : ''}`
        : 'worker failed to load';
      failAllPending(new Error(`session worker error: ${detail}`));
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    workerDisabled = true;
    return null;
  }
}

function saveOnMainThread(args: SaveSessionArgs): Promise<string> {
  return saveSession(args.fileName, args.map, args.undoStack, args.currentAreaId, args.currentZ, args.existingId, args.pixmapPool);
}

// --- Autosave scheduling ------------------------------------------------------
//
// A save costs a structured clone of the whole map into the worker plus a full
// serialize there — on a large map that is tens of MB of garbage per save. Saving
// ~1.5s after every edit kept the tab hundreds of MB above its live size during
// steady editing, so saves now wait for a pause in editing *and* start at most
// once per interval. What a crash can lose is bounded by that interval; hiding
// the tab flushes immediately.

const SAVE_IDLE_MS = 1500;
const SAVE_MIN_INTERVAL_MS = 10_000;

type ScheduledSave = { get: () => SaveSessionArgs | null; done: (id: string) => void };
let scheduled: ScheduledSave | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastStartedAt = -Infinity;
let dirtySince: number | null = null;

/**
 * Ask for a session save. `get` runs when the save actually starts, so it reads
 * the state as it is then, not as it was when the edit happened.
 */
export function scheduleSessionSave(get: ScheduledSave['get'], done: ScheduledSave['done']): void {
  const now = Date.now();
  scheduled = { get, done };
  dirtySince ??= now;
  // Wait for a pause and for the interval, but don't let a long unbroken run of
  // edits keep pushing the save back past one interval.
  const fireAt = Math.min(
    Math.max(now + SAVE_IDLE_MS, lastStartedAt + SAVE_MIN_INTERVAL_MS),
    Math.max(dirtySince + SAVE_MIN_INTERVAL_MS, now + SAVE_IDLE_MS),
  );
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSessionSave, fireAt - now);
}

/** Start any scheduled save now — e.g. when the tab is being hidden. */
export function flushSessionSave(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  const s = scheduled;
  scheduled = null;
  dirtySince = null;
  if (!s) return;
  const args = s.get();
  if (!args) return;
  lastStartedAt = Date.now();
  saveSessionAsync(args).then(s.done, console.error);
}

// One save at a time. Each save clones the whole map (and undo stack) into the
// worker, and a save of a large map outlasts the caller's debounce — so without
// this, steady editing queues clone after clone in the worker faster than it
// drains them, until the tab runs out of memory. A save requested while one is
// running replaces any older waiting request: only the newest state matters.
let inFlight: Promise<string> | null = null;
let queued: { args: SaveSessionArgs; waiters: Pending[] } | null = null;

export function saveSessionAsync(args: SaveSessionArgs): Promise<string> {
  if (!inFlight) return start(args);
  return new Promise<string>((resolve, reject) => {
    if (queued) queued.args = args;
    else queued = { args, waiters: [] };
    queued.waiters.push({ resolve, reject });
  });
}

function start(args: SaveSessionArgs): Promise<string> {
  const run = saveNow(args);
  inFlight = run;
  const next = (id: string | undefined) => {
    inFlight = null;
    const q = queued;
    queued = null;
    if (!q) return;
    // A request queued before the first save came back has no id yet; reuse
    // the one just assigned rather than creating a second session record.
    const followUp = start({ ...q.args, existingId: q.args.existingId ?? id });
    followUp.then((v) => q.waiters.forEach((w) => w.resolve(v)), (e) => q.waiters.forEach((w) => w.reject(e)));
  };
  run.then(next, () => next(args.existingId));
  return run;
}

async function saveNow(args: SaveSessionArgs): Promise<string> {
  const w = getWorker();
  if (w) {
    const reqId = nextReqId++;
    try {
      return await new Promise<string>((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        try {
          const req: SaveSessionRequest = { reqId, ...args };
          w.postMessage(req);
        } catch (err) {
          // Synchronous postMessage failure (e.g. a non-cloneable value).
          pending.delete(reqId);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    } catch (err) {
      // Any worker-path failure: disable the worker and fall back so a save
      // still happens. The same map fails the same way every time, so there's
      // no point retrying the worker.
      workerDisabled = true;
      worker?.terminate();
      worker = null;
      console.warn('Session worker save failed; falling back to main thread:', err);
    }
  }
  return saveOnMainThread(args);
}
