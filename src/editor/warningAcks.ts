import type { MudletMap } from '../mapIO';

const PREFIX = 'mudlet-warning-acks-';

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
