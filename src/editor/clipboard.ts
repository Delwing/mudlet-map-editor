import type { MudletMap, MudletRoom } from '../mapIO';
import i18n from '../i18n';
import { store, type RoomClipboard } from './store';
import { pushCommand } from './commands';
import { nextRoomId } from './mapHelpers';
import { CARDINAL_DIRECTIONS, DIR_INDEX, DIR_SHORT } from './types';
import type { Command } from './types';
import type { SceneHandle } from './scene';

function cloneRoom(room: MudletRoom): MudletRoom {
  const out: MudletRoom = {
    ...room,
    mSpecialExits: { ...room.mSpecialExits },
    mSpecialExitLocks: [...(room.mSpecialExitLocks ?? [])],
    userData: { ...(room.userData ?? {}) },
    customLines: Object.fromEntries(Object.entries(room.customLines ?? {}).map(([k, v]) => [k, v.map(p => [...p] as [number, number])])),
    // Colors are objects — copy them, or the clone shares them with the source room.
    customLinesColor: Object.fromEntries(Object.entries(room.customLinesColor ?? {}).map(([k, c]) => [k, { ...c }])),
    customLinesStyle: { ...(room.customLinesStyle ?? {}) },
    customLinesArrow: { ...(room.customLinesArrow ?? {}) },
    exitLocks: [...(room.exitLocks ?? [])],
    stubs: [...(room.stubs ?? [])],
    exitWeights: { ...(room.exitWeights ?? {}) },
    doors: { ...(room.doors ?? {}) },
  };
  // `rawSpecialExits` is the packed on-disk form of mSpecialExits, keyed by the
  // *source* room ids. The writer regenerates it for every room from
  // mSpecialExits/mSpecialExitLocks, so a copy would only ever be stale.
  delete out.rawSpecialExits;
  return out;
}

/** Every room hash already spoken for in `map` — a pasted room may not reuse one.
 *  `room.hash` is the source of truth (the writer rebuilds the index from it), but
 *  index keys count too: they reserve a hash even if their room is gone. */
function collectTakenHashes(map: MudletMap): Set<string> {
  const taken = new Set<string>();
  for (const room of Object.values(map.rooms)) {
    if (room?.hash) taken.add(room.hash);
  }
  for (const hash of Object.keys(map.mpRoomDbHashToRoomId ?? {})) taken.add(hash);
  return taken;
}

/** Snapshot rooms + centroid origin without touching store state. The result is
 *  plain-object only, so it survives structured clone (cross-tab transfer). */
export function buildRoomClipboard(map: MudletMap, ids: number[]): RoomClipboard | null {
  const rooms: RoomClipboard['rooms'] = [];
  let cx = 0, cy = 0, cz = 0;
  for (const id of ids) {
    const room = map.rooms[id];
    if (!room) continue;
    rooms.push({ origId: id, room: cloneRoom(room) });
    cx += room.x; cy += room.y; cz += room.z;
  }
  if (rooms.length === 0) return null;
  const n = rooms.length;
  return { rooms, origin: { x: Math.round(cx / n), y: Math.round(cy / n), z: Math.round(cz / n) } };
}

export function copyRoomsToClipboard(map: MudletMap, ids: number[]): number {
  const clipboard = buildRoomClipboard(map, ids);
  if (!clipboard) return 0;
  store.setState({ clipboard });
  return clipboard.rooms.length;
}

/**
 * Produce a fresh room snapshot with exits remapped:
 *  - exits whose target is in `idMap` (another copied room) → new id
 *  - exits whose target is external → cleared and the direction is marked as a stub
 * Also drops external special exits / external custom lines since they'd point to
 * rooms not included in the paste.
 *
 * Every other field (name, symbol, environment, weight, isLocked, userData, doors…)
 * is carried over verbatim. `hash` is left alone here — the caller decides whether
 * it can be kept, since that depends on the destination map.
 */
function remapRoom(
  src: MudletRoom,
  newAreaId: number,
  newCoords: { x: number; y: number; z: number },
  idMap: Map<number, number>,
): MudletRoom {
  const out = cloneRoom(src);
  out.area = newAreaId;
  out.x = newCoords.x;
  out.y = newCoords.y;
  out.z = newCoords.z;

  const stubSet = new Set<number>(out.stubs);
  const lockSet = new Set<number>(out.exitLocks);
  for (const dir of CARDINAL_DIRECTIONS) {
    const target = (out as any)[dir] as number;
    if (target == null || target === -1) continue;
    const remapped = idMap.get(target);
    if (remapped != null) {
      (out as any)[dir] = remapped;
    } else {
      (out as any)[dir] = -1;
      stubSet.add(DIR_INDEX[dir]);
      // No exit left to lock or weight. `doors` stay — Mudlet allows a door on a stub.
      lockSet.delete(DIR_INDEX[dir]);
      delete out.exitWeights[DIR_SHORT[dir]];
    }
  }
  out.stubs = Array.from(stubSet).sort((a, b) => a - b);
  out.exitLocks = Array.from(lockSet).sort((a, b) => a - b);

  // Special exits: remap internals, drop externals (plus their metadata).
  // `mSpecialExitLocks` holds *destination room ids*, not indexes, so it has to be
  // remapped in step with mSpecialExits or the locks are silently lost — and, when
  // pasting into another map, a stale id can even collide with a freshly minted one.
  const srcLocks = new Set<number>(out.mSpecialExitLocks);
  const newSpecial: Record<string, number> = {};
  const newLocks = new Set<number>();
  for (const [name, target] of Object.entries(out.mSpecialExits)) {
    const remapped = idMap.get(target as number);
    if (remapped != null) {
      newSpecial[name] = remapped;
      if (srcLocks.has(target as number)) newLocks.add(remapped);
    } else {
      delete out.doors[name];
      delete out.exitWeights[name];
      delete out.customLines[name];
      delete out.customLinesColor[name];
      delete out.customLinesStyle[name];
      delete out.customLinesArrow[name];
    }
  }
  out.mSpecialExits = newSpecial;
  out.mSpecialExitLocks = Array.from(newLocks).sort((a, b) => a - b);

  // Cardinal custom lines: keep only when the underlying exit survived (now points to a remapped room).
  for (const dir of CARDINAL_DIRECTIONS) {
    const key = DIR_SHORT[dir];
    if (!(key in out.customLines)) continue;
    if ((out as any)[dir] === -1) {
      delete out.customLines[key];
      delete out.customLinesColor[key];
      delete out.customLinesStyle[key];
      delete out.customLinesArrow[key];
    }
  }

  return out;
}

/** Raw-Mudlet-space offset applied to every clipboard room's customLine waypoints. */
function translateCustomLines(room: MudletRoom, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const key of Object.keys(room.customLines)) {
    room.customLines[key] = room.customLines[key].map(([px, py]) => [px + dx, py + dy] as [number, number]);
  }
}

export type PasteResult = {
  count: number;
  newIds: number[];
  externalExitsStubbed: number;
  externalSpecialExitsDropped: number;
  /** Rooms whose hash the destination map already had, so the copy went in without one. */
  hashesDropped: number;
};

export function buildPasteStatus(
  verbKey: string,
  result: { count: number; externalExitsStubbed: number; externalSpecialExitsDropped: number; hashesDropped: number },
): string {
  const t = i18n.t.bind(i18n);
  const parts = [t(`editor:status.${verbKey}`, { count: result.count })];
  if (result.externalExitsStubbed > 0) {
    parts.push(t('editor:status.externalExitsStubbed', { count: result.externalExitsStubbed }));
  }
  if (result.externalSpecialExitsDropped > 0) {
    parts.push(t('editor:status.specialExitsDropped', { count: result.externalSpecialExitsDropped }));
  }
  if (result.hashesDropped > 0) {
    parts.push(t('editor:status.hashesDropped', { count: result.hashesDropped }));
  }
  return parts.join(' · ');
}

export function pasteClipboard(
  clipboard: RoomClipboard,
  target: { x: number; y: number; z: number; areaId: number },
  scene: SceneHandle | null,
): PasteResult | null {
  const map = store.getState().map;
  if (!map || clipboard.rooms.length === 0) return null;

  // Allocate new IDs up front so internal exit remaps can resolve.
  let nextId = nextRoomId(map);
  const idMap = new Map<number, number>();
  for (const { origId } of clipboard.rooms) {
    idMap.set(origId, nextId);
    nextId += 1;
  }

  const dx = target.x - clipboard.origin.x;
  const dy = target.y - clipboard.origin.y;
  const dz = target.z - clipboard.origin.z;

  let externalExits = 0;
  let externalSpecial = 0;
  let hashesDropped = 0;
  // A room hash is Mudlet's content identity for a room. Duplicating it inside one
  // map would make the on-disk index ambiguous (the writer warns and keeps only the
  // last room), so a colliding hash is dropped. Pasting into a *different* map —
  // the cross-tab case — keeps it, since that is exactly what lets Mudlet recognise
  // the transferred rooms.
  const takenHashes = collectTakenHashes(map);
  const cmds: Command[] = [];
  for (const { origId, room } of clipboard.rooms) {
    const newId = idMap.get(origId)!;
    // Count externals for status reporting — compare clone before remap.
    for (const dir of CARDINAL_DIRECTIONS) {
      const t = (room as any)[dir] as number;
      if (t != null && t !== -1 && !idMap.has(t)) externalExits += 1;
    }
    for (const t of Object.values(room.mSpecialExits)) {
      if (!idMap.has(t as number)) externalSpecial += 1;
    }
    const remapped = remapRoom(room, target.areaId, {
      x: room.x + dx,
      y: room.y + dy,
      z: room.z + dz,
    }, idMap);
    translateCustomLines(remapped, dx, dy);
    if (remapped.hash) {
      if (takenHashes.has(remapped.hash)) {
        delete remapped.hash;
        hashesDropped += 1;
      } else {
        takenHashes.add(remapped.hash);
      }
    }
    cmds.push({ kind: 'addRoom', id: newId, room: remapped, areaId: target.areaId });
  }

  const batch: Command = cmds.length === 1 ? cmds[0] : { kind: 'batch', cmds };
  pushCommand(batch, scene);

  const newIds = Array.from(idMap.values());
  return {
    count: newIds.length,
    newIds,
    externalExitsStubbed: externalExits,
    externalSpecialExitsDropped: externalSpecial,
    hashesDropped,
  };
}

/** Copy → paste-at-offset in one step, without touching the user's clipboard.
 *  Z-neutral: each duplicate keeps its source room's z, so cross-level selections
 *  preserve their vertical relations. */
export function duplicateRooms(
  map: MudletMap,
  ids: number[],
  offset: { dx: number; dy: number },
  target: { areaId: number },
  scene: SceneHandle | null,
): PasteResult | null {
  const rooms: RoomClipboard['rooms'] = [];
  let cx = 0, cy = 0;
  for (const id of ids) {
    const room = map.rooms[id];
    if (!room) continue;
    rooms.push({ origId: id, room: cloneRoom(room) });
    cx += room.x; cy += room.y;
  }
  if (rooms.length === 0) return null;
  const origin = {
    x: Math.round(cx / rooms.length),
    y: Math.round(cy / rooms.length),
    z: rooms[0].room.z,
  };
  return pasteClipboard(
    { rooms, origin },
    { x: origin.x + offset.dx, y: origin.y + offset.dy, z: origin.z, areaId: target.areaId },
    scene,
  );
}
