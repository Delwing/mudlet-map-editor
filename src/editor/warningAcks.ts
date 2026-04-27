import type { MudletMap } from '../mapIO';

const PREFIX = 'mudlet-warning-acks-';
const USERDATA_PREF_PREFIX = 'mudlet-ack-in-userdata-';

export const ACKS_USERDATA_KEY = 'mme_acks';

/**
 * Fingerprint based on sorted area IDs. Stable across filename changes;
 * invalidates when areas are added or removed.
 */
export function mapAckKey(map: MudletMap): string {
  return Object.keys(map.areas).map(Number).sort((a, b) => a - b).join(',');
}

export function loadAcks(mapKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(PREFIX + mapKey);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

export function saveAcks(mapKey: string, acks: Set<string>): void {
  try {
    localStorage.setItem(PREFIX + mapKey, JSON.stringify([...acks]));
  } catch {}
}

export function loadAckInUserdata(mapKey: string): boolean {
  try {
    return localStorage.getItem(USERDATA_PREF_PREFIX + mapKey) === 'true';
  } catch {}
  return false;
}

export function saveAckInUserdata(mapKey: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(USERDATA_PREF_PREFIX + mapKey, 'true');
    } else {
      localStorage.removeItem(USERDATA_PREF_PREFIX + mapKey);
    }
  } catch {}
}
