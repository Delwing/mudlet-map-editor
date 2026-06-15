// Web Worker: serializes the map (writeMapToBytes) and writes the session to
// IndexedDB off the main thread. The full map serialize is the expensive,
// blocking step in saveSession — running it here keeps the editor responsive
// while large maps are persisted. See sessionSaver.ts for the client side.
//
// Must be first: defines `process`/`global` in worker scope before the binary
// reader's bundled stream code (which reads bare `process` at top level) runs.
import './workerPolyfills';
import { saveSession } from './session';
import type { MudletMap } from '../mapIO';
import type { Command } from './types';

export interface SaveSessionRequest {
  reqId: number;
  fileName: string;
  map: MudletMap;
  undoStack: Command[];
  currentAreaId: number | null;
  currentZ: number;
  existingId?: string;
}

export type SaveSessionResponse =
  | { reqId: number; id: string }
  | { reqId: number; error: string };

// Narrow cast instead of pulling in the WebWorker lib (not enabled in tsconfig).
const ctx = self as unknown as {
  postMessage(message: SaveSessionResponse): void;
  onmessage: ((ev: MessageEvent<SaveSessionRequest>) => void) | null;
};

ctx.onmessage = async (ev) => {
  const { reqId, fileName, map, undoStack, currentAreaId, currentZ, existingId } = ev.data;
  try {
    const id = await saveSession(fileName, map, undoStack, currentAreaId, currentZ, existingId);
    ctx.postMessage({ reqId, id });
  } catch (err) {
    ctx.postMessage({ reqId, error: err instanceof Error ? err.message : String(err) });
  }
};
