import { writeMapToBytes, readMapFromBytes, type MudletMap } from '../mapIO';
import type { Command } from './types';

const DB_NAME = 'mudlet-map-editor';
const STORE_NAME = 'sessions';
const DB_VERSION = 2;

export interface SessionData {
  id: string;
  fileName: string;
  mapBytes: ArrayBuffer;
  imageSrcs: Record<string, string>;
  undoStack: Command[];
  currentAreaId: number | null;
  currentZ: number;
  savedAt: number;
  roomCount: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function collectImageSrcs(map: MudletMap): Record<string, string> {
  const result: Record<string, string> = {};
  for (const labels of Object.values(map.labels)) {
    for (const label of labels as any[]) {
      if (label.imageSrc) result[String(label.id)] = label.imageSrc;
    }
  }
  return result;
}

export async function saveSession(
  fileName: string,
  map: MudletMap,
  undoStack: Command[],
  currentAreaId: number | null,
  currentZ: number,
  existingId?: string,
): Promise<string> {
  const bytes = writeMapToBytes(map);
  const mapBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const id = existingId ?? crypto.randomUUID();
  const record: SessionData = {
    id,
    fileName,
    mapBytes,
    imageSrcs: collectImageSrcs(map),
    undoStack,
    currentAreaId,
    currentZ,
    savedAt: Date.now(),
    roomCount: Object.keys(map.rooms).length,
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => { db.close(); resolve(id); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function listSessions(): Promise<SessionData[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      db.close();
      const sessions = (req.result as SessionData[]).sort((a, b) => b.savedAt - a.savedAt);
      resolve(sessions);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function clearAllSessions(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function clearSession(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Reconstruct a MudletMap from a SessionData, re-applying editor-only fields (imageSrc). */
export function restoreMapFromSession(session: SessionData): MudletMap {
  const map = readMapFromBytes(session.mapBytes);
  if (Object.keys(session.imageSrcs).length > 0) {
    for (const labels of Object.values(map.labels)) {
      for (const label of labels as any[]) {
        const src = session.imageSrcs[String(label.id)];
        if (src) label.imageSrc = src;
      }
    }
  }
  return map;
}
