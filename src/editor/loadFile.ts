import { readMapFromBytes } from '../mapIO';
import { store } from './store';

export async function loadUrlIntoStore(url: string, onProgress?: (pct: number | null) => void): Promise<void> {
  try {
    store.setState({ status: 'Fetching…' });
    const resp = await fetch(url);
    if (!resp.ok) {
      store.setState({ status: `Failed to load URL: HTTP ${resp.status} ${resp.statusText}` });
      return;
    }
    const reader = resp.body!.getReader();
    const total = Number(resp.headers.get('content-length')) || 0;
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const pct = total > 0 ? Math.round((received / total) * 100) : null;
      if (onProgress) onProgress(pct);
      else if (pct != null) store.setState({ status: `Fetching… ${pct}%` });
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    const fileName = url.split('/').pop()?.split('?')[0] || 'map.dat';
    const map = readMapFromBytes(merged.buffer);
    const firstAreaId = Number(Object.keys(map.areaNames)[0] ?? -1);
    const resolvedArea = Number.isNaN(firstAreaId) ? null : firstAreaId;
    store.setState({
      map,
      loaded: { fileName },
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
    store.setState({ status: `Failed to load URL: ${(err as Error).message}` });
  }
}

export async function loadFileIntoStore(file: File): Promise<void> {
  try {
    store.setState({ status: `Reading ${file.name}…` });
    const bytes = await file.arrayBuffer();
    const map = readMapFromBytes(bytes);
    const firstAreaId = Number(Object.keys(map.areaNames)[0] ?? -1);
    const resolvedArea = Number.isNaN(firstAreaId) ? null : firstAreaId;
    store.setState({
      map,
      loaded: { fileName: file.name },
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
    store.setState({ status: `Failed to read file: ${(err as Error).message}` });
    console.error(err);
  }
}
