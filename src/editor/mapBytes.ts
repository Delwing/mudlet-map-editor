import { store } from './store';
import { writeMapToBytes } from '../mapIO';

export function getMapBytes(): Uint8Array | null {
    const { map } = store.getState();
    if (!map) return null;
    return writeMapToBytes(map);
}
