// Client for the session-save Web Worker. Offloads map serialization + the
// IndexedDB write to a worker so auto-save never blocks the UI thread. If the
// worker can't be created or fails (e.g. when the library build is consumed in
// an environment that can't resolve the worker), it transparently falls back to
// saving on the main thread — same behaviour as before, just not off-thread.
import type { MudletMap } from '../mapIO';
import type { Command } from './types';
import { saveSession } from './session';
import type { SaveSessionRequest, SaveSessionResponse } from './sessionWorker';

export interface SaveSessionArgs {
  fileName: string;
  map: MudletMap;
  undoStack: Command[];
  currentAreaId: number | null;
  currentZ: number;
  existingId?: string;
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
    // Separate worker chunk (not inlined). The lib build uses base: './' so this
    // emits a *relative* import.meta.url reference that a consumer's bundler can
    // resolve and re-emit; an absolute "/assets/…" path would 404 for consumers.
    worker = new Worker(new URL('./sessionWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SaveSessionResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      if ('error' in msg) p.reject(new Error(msg.error));
      else p.resolve(msg.id);
    };
    worker.onerror = () => {
      // Worker failed to load or threw at the top level — disable it for the
      // rest of the session so callers fall back to the main thread.
      workerDisabled = true;
      failAllPending(new Error('session worker error'));
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
  return saveSession(args.fileName, args.map, args.undoStack, args.currentAreaId, args.currentZ, args.existingId);
}

export async function saveSessionAsync(args: SaveSessionArgs): Promise<string> {
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
