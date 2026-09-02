import { store } from './store';
import { getMapFormat, defaultMapFormat } from './formats';

/**
 * Serialize the current map to bytes, in `formatId` when given and in the
 * format the save button last used otherwise.
 *
 * Plugins that push the bytes to a destination expecting one specific format —
 * a remote sync target, an upload endpoint — should always pass an explicit
 * `formatId`. Exporting once through the save split-button makes that format
 * the active one, so an unpinned call would quietly serialize to it instead.
 *
 * Async because a format's `serialize` may be async. Returns `null` when no map
 * is loaded.
 */
export async function getMapBytes(formatId?: string): Promise<Uint8Array | null> {
  const state = store.getState();
  if (!state.map) return null;
  const format = getMapFormat(formatId ?? state.formatId) ?? defaultMapFormat();
  return await format.serialize(state.map);
}
