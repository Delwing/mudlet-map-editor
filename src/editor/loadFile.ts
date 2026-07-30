import { store } from './store';
import { pickFormatForFile } from './formats';

/** Upper bound on a paint yield — see {@link yieldToPaint}. */
const PAINT_YIELD_TIMEOUT_MS = 120;

/**
 * Hand the browser two frames so a pending store update actually reaches the
 * screen before we start the next long synchronous block.
 *
 * One frame is not enough: the first rAF callback runs *before* the paint of the
 * commit it triggered, so blocking there would freeze the UI showing the
 * previous state. Waiting for a second frame means the overlay is visibly on
 * screen when the block begins.
 *
 * The timer is not a nicety: a hidden or backgrounded tab never runs rAF
 * callbacks at all, so waiting on frames alone would stall the load until the
 * user came back to the tab. The frames are the fast path when visible; the
 * timeout is what guarantees the load always proceeds.
 */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve(); };
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    if (visible && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
    setTimeout(finish, PAINT_YIELD_TIMEOUT_MS);
  });
}

/**
 * Reveal a phase, let it paint, then run the blocking work. Phases are labelled
 * for what dominates them: parsing the binary, then building the editor model +
 * renderer scene (the larger of the two on big maps — see App's scene effect).
 */
async function enterPhase(phase: 'fetching' | 'parsing' | 'preparing', fileName: string, pct: number | null = null): Promise<void> {
  store.setState({ loading: { phase, fileName, pct } });
  await yieldToPaint();
}

export async function loadUrlIntoStore(url: string, onProgress?: (pct: number | null) => void): Promise<void> {
  const fileName = url.split('/').pop()?.split('?')[0] || 'map.dat';
  try {
    store.setState({ status: 'Fetching…' });
    // A caller passing onProgress renders its own download progress (UrlLoadModal),
    // so don't put a second bar on screen for the fetch.
    if (!onProgress) await enterPhase('fetching', fileName, 0);
    const resp = await fetch(url);
    if (!resp.ok) {
      store.setState({ status: `Failed to load URL: HTTP ${resp.status} ${resp.statusText}`, loading: null });
      return;
    }
    const reader = resp.body!.getReader();
    const total = Number(resp.headers.get('content-length')) || 0;
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastPct = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const pct = total > 0 ? Math.round((received / total) * 100) : null;
      if (onProgress) onProgress(pct);
      else if (pct != null && pct !== lastPct) {
        // Only on a whole-percent change: a store write per chunk would re-render
        // every subscriber for progress nobody can see.
        lastPct = pct;
        store.setState({ status: `Fetching… ${pct}%`, loading: { phase: 'fetching', fileName, pct } });
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    const format = pickFormatForFile(fileName);
    await enterPhase('parsing', fileName);
    const map = await format.parse(merged.buffer, { fileName });
    await enterPhase('preparing', fileName);
    const firstAreaId = Number(Object.keys(map.areaNames)[0] ?? -1);
    const resolvedArea = Number.isNaN(firstAreaId) ? null : firstAreaId;
    store.setState({
      map,
      loaded: { fileName },
      formatId: format.id,
      currentAreaId: resolvedArea,
      currentZ: 0,
      selection: null,
      hover: null,
      pending: null,
      undo: [],
      redo: [],
      savedUndoLength: 0,
      status: `Loaded ${fileName} · ${Object.keys(map.rooms).length} rooms · ${Object.keys(map.areaNames).length} areas`,
      sessionId: null,
    });
    store.bumpStructure();
  } catch (err) {
    store.setState({ status: `Failed to load URL: ${(err as Error).message}`, loading: null });
  }
}

export async function loadFileIntoStore(file: File): Promise<void> {
  try {
    store.setState({ status: `Reading ${file.name}…` });
    const bytes = await file.arrayBuffer();
    const format = pickFormatForFile(file.name);
    await enterPhase('parsing', file.name);
    const map = await format.parse(bytes, { fileName: file.name });
    await enterPhase('preparing', file.name);
    const firstAreaId = Number(Object.keys(map.areaNames)[0] ?? -1);
    const resolvedArea = Number.isNaN(firstAreaId) ? null : firstAreaId;
    store.setState({
      map,
      loaded: { fileName: file.name },
      formatId: format.id,
      currentAreaId: resolvedArea,
      currentZ: 0,
      selection: null,
      hover: null,
      pending: null,
      undo: [],
      redo: [],
      savedUndoLength: 0,
      status: `Loaded ${file.name} · ${Object.keys(map.rooms).length} rooms · ${Object.keys(map.areaNames).length} areas`,
      sessionId: null,
    });
    store.bumpStructure();
  } catch (err) {
    store.setState({ status: `Failed to read file: ${(err as Error).message}`, loading: null });
    console.error(err);
  }
}
