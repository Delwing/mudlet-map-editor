import type { MudletMap, MudletRoom } from '../mapIO';
import type { Direction } from './types';
import { CARDINAL_DIRECTIONS, OPPOSITE } from './types';

export function nextAreaId(map: MudletMap): number {
  const ids = Object.keys(map.areas).map(Number);
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

export function nextRoomId(map: MudletMap): number {
  let max = 0;
  for (const k of Object.keys(map.rooms)) {
    const id = Number(k);
    if (id > max) max = id;
  }
  return max + 1;
}

export function createDefaultRoom(id: number, areaId: number, x: number, y: number, z: number): MudletRoom {
  return {
    area: areaId,
    x, y, z,
    north: -1, northeast: -1, east: -1, southeast: -1,
    south: -1, southwest: -1, west: -1, northwest: -1,
    up: -1, down: -1, in: -1, out: -1,
    environment: -1,
    weight: 1,
    name: `Room ${id}`,
    isLocked: false,
    mSpecialExits: {},
    mSpecialExitLocks: [],
    symbol: '',
    userData: {},
    customLines: {},
    customLinesArrow: {},
    customLinesColor: {},
    customLinesStyle: {},
    exitLocks: [],
    stubs: [],
    exitWeights: {},
    doors: {},
  };
}

export function inferDirection(
  sx: number, sy: number,
  tx: number, ty: number,
): Direction {
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return 'north';
  const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  if (deg < 22.5 || deg >= 337.5) return 'east';
  if (deg < 67.5) return 'southeast';
  if (deg < 112.5) return 'south';
  if (deg < 157.5) return 'southwest';
  if (deg < 202.5) return 'west';
  if (deg < 247.5) return 'northwest';
  if (deg < 292.5) return 'north';
  return 'northeast';
}

export function getExit(room: MudletRoom, dir: string): number {
  return (room as any)[dir] as number ?? room.mSpecialExits[dir] ?? undefined;
}

export function setExit(room: MudletRoom, dir: Direction, value: number): void {
  (room as any)[dir] = value;
}

/** Returns all incoming cardinal-exit references to `targetId` from any room in the map. */
export function findNeighborsPointingAt(
  map: MudletMap,
  targetId: number,
): Array<{ roomId: number; dir: Direction }> {
  const out: Array<{ roomId: number; dir: Direction }> = [];
  for (const idStr of Object.keys(map.rooms)) {
    const id = Number(idStr);
    if (id === targetId) continue;
    const room = map.rooms[id];
    for (const dir of CARDINAL_DIRECTIONS) {
      if (getExit(room, dir) === targetId) {
        out.push({ roomId: id, dir });
      }
    }
  }
  return out;
}

/** Cardinals that use 2D map geometry (not up/down/in/out). */
export function is2DCardinal(dir: Direction): boolean {
  return dir !== 'up' && dir !== 'down' && dir !== 'in' && dir !== 'out';
}

export { OPPOSITE };
