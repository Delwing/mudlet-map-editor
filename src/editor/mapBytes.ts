import { store } from './store';
import { getMapFormat, defaultMapFormat } from './formats';

/**
 * Serialize the current map to bytes using the active format.
 *
 * Async because a format's `serialize` may be async. Returns `null` when no map
 * is loaded. Used by plugins (e.g. remote sync) that push the file elsewhere.
 */
export async function getMapBytes(): Promise<Uint8Array | null> {
  const { map, formatId } = store.getState();
  if (!map) return null;
  const format = getMapFormat(formatId) ?? defaultMapFormat();
  return await format.serialize(map);
}
