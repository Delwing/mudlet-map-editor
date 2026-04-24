import type { MudletMap, MudletRoom } from '../mapIO';
import { store, type RoomClipboard } from './store';
import { pushCommand } from './commands';
import { nextRoomId } from './mapHelpers';
import { CARDINAL_DIRECTIONS, DIR_INDEX, DIR_SHORT } from './types';
import type { Command } from './types';
import type { SceneHandle } from './scene';

function cloneRoom(room: MudletRoom): MudletRoom {
  return {
    ...room,
    mSpecialExits: { ...room.mSpecialExits },
    mSpecialExitLocks: [...(room.mSpecialExitLocks ?? [])],
    userData: { ...(room.userData ?? {}) },
    customLines: Object.fromEntries(Object.entries(room.customLines ?? {}).map(([k, v]) => [k, v.map(p => [...p] as [number, number])])),
    customLinesColor: { ...(room.customLinesColor ?? {}) },
    customLinesStyle: { ...(room.customLinesStyle ?? {}) },
    customLinesArrow: { ...(room.customLinesArrow ?? {}) },
    exitLocks: [...(room.exitLocks ?? [])],
    stubs: [...(room.stubs ?? [])],
    exitWeights: { ...(room.exitWeights ?? {}) },
    doors: { ...(room.doors ?? {}) },
  };
}

export function copyRoomsToClipboard(map: MudletMap, ids: number[]): number {
  const rooms: RoomClipboard['rooms'] = [];
  let cx = 0, cy = 0, cz = 0;
  for (const id of ids) {
    const room = map.rooms[id];
    if (!room) continue;
    rooms.push({ origId: id, room: cloneRoom(room) });
    cx += room.x; cy += room.y; cz += room.z;
  }
  if (rooms.length === 0) return 0;
  const n = rooms.length;
  const origin = { x: Math.round(cx / n), y: Math.round(cy / n), z: Math.round(cz / n) };
  store.setState({ clipboard: { rooms, origin } });
  return n;
}

/**
 * Produce a fresh room snapshot with exits remapped:
 *  - exits whose target is in `idMap` (another copied room) → new id
 *  - exits whose target is external → cleared and the direction is marked as a stub
 * Also drops external special exits / external custom lines since they'd point to
 * rooms not included in the paste.
 */
function remapRoom(
  src: MudletRoom,
  newId: number,
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
  for (const dir of CARDINAL_DIRECTIONS) {
    const target = (out as any)[dir] as number;
    if (target == null || target === -1) continue;
    const remapped = idMap.get(target);
    if (remapped != null) {
      (out as any)[dir] = remapped;
    } else {
      (out as any)[dir] = -1;
      stubSet.add(DIR_INDEX[dir]);
    }
  }
  out.stubs = Array.from(stubSet).sort((a, b) => a - b);

  // Special exits: remap internals, drop externals (plus their metadata).
  const newSpecial: Record<string, number> = {};
  for (const [name, target] of Object.entries(out.mSpecialExits)) {
    const remapped = idMap.get(target as number);
    if (remapped != null) {
      newSpecial[name] = remapped;
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

  // Hash is a Mudlet-side identity; new rooms shouldn't inherit it.
  if ('hash' in out) delete (out as any).hash;
  // Give the pasted room a default name so duplicates aren't instantly indistinguishable.
  out.name = `Room ${newId}`;
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
};

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
    const remapped = remapRoom(room, newId, target.areaId, {
      x: room.x + dx,
      y: room.y + dy,
      z: room.z + dz,
    }, idMap);
    translateCustomLines(remapped, dx, dy);
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
  };
}

/** Copy → paste-at-offset in one step, without touching the user's clipboard. */
export function duplicateRooms(
  map: MudletMap,
  ids: number[],
  offset: { dx: number; dy: number },
  target: { areaId: number; z: number },
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
    { x: origin.x + offset.dx, y: origin.y + offset.dy, z: target.z, areaId: target.areaId },
    scene,
  );
}
