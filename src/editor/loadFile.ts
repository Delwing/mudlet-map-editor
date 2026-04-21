import { readMapFromBytes } from '../mapIO';
import { store } from './store';

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
