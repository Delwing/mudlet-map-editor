import type { SceneHandle } from './scene';
import type { MudletMap } from '../mapIO';
import { DIR_SHORT } from './types';

export type MapWarning =
  | { kind: 'zeroSizeLabel'; labelId: number; areaId: number; areaName: string; z: number; text: string; x: number; y: number }
  | { kind: 'selfLinkRoom'; roomId: number; dirs: string[] }
  | { kind: 'orphanRoom'; roomId: number; areaName: string }
  | { kind: 'danglingExit'; roomId: number; dir: string; targetId: number; areaName: string }
  | { kind: 'duplicateCoord'; roomIds: number[]; areaId: number; areaName: string; x: number; y: number; z: number }
  | { kind: 'coordMismatch'; roomId: number; dir: string; targetId: number; areaName: string };

export function warningKey(w: MapWarning): string {
  switch (w.kind) {
    case 'zeroSizeLabel':  return `zeroSizeLabel:${w.areaId}:${w.labelId}`;
    case 'selfLinkRoom':   return `selfLinkRoom:${w.roomId}`;
    case 'orphanRoom':     return `orphanRoom:${w.roomId}`;
    case 'danglingExit':   return `danglingExit:${w.roomId}:${w.dir}`;
    case 'duplicateCoord': return `duplicateCoord:${w.areaId}:${w.x}:${w.y}:${w.z}`;
    case 'coordMismatch':  return `coordMismatch:${w.roomId}:${w.dir}`;
  }
}

const CARDINAL_DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'up', 'down', 'in', 'out'] as const;

const DIR_COORD_OK: Partial<Record<string, (sx: number, sy: number, sz: number, tx: number, ty: number, tz: number) => boolean>> = {
  north:     (_sx, sy, _sz, _tx, ty) => ty > sy,
  south:     (_sx, sy, _sz, _tx, ty) => ty < sy,
  east:      (sx, _sy, _sz, tx)     => tx > sx,
  west:      (sx, _sy, _sz, tx)     => tx < sx,
  northeast: (sx, sy, _sz, tx, ty)  => tx > sx && ty > sy,
  southeast: (sx, sy, _sz, tx, ty)  => tx > sx && ty < sy,
  northwest: (sx, sy, _sz, tx, ty)  => tx < sx && ty > sy,
  southwest: (sx, sy, _sz, tx, ty)  => tx < sx && ty < sy,
};

export function collectWarnings(sceneRef: { current: SceneHandle | null }, map: MudletMap): MapWarning[] {
  const warnings: MapWarning[] = [];

  const reader = sceneRef.current?.reader;
  if (reader) {
    for (const area of reader.getAreas()) {
      const areaId = area.getAreaId();
      const areaName = area.getAreaName();
      for (const plane of area.getPlanes()) {
        for (const label of plane.getLabels()) {
          if (label.Width <= 0 || label.Height <= 0) {
            warnings.push({
              kind: 'zeroSizeLabel',
              labelId: label.labelId ?? label.id,
              areaId,
              areaName,
              z: label.Z ?? 0,
              text: label.Text ?? '',
              x: label.X,
              y: label.Y,
            });
          }
        }
      }
    }
  }

  const inbound = new Map<number, number>();
  const coordBuckets = new Map<string, number[]>();
  const roomIds = new Set<number>();
  for (const idStr of Object.keys(map.rooms)) roomIds.add(Number(idStr));

  const danglingWarnings: Extract<MapWarning, { kind: 'danglingExit' }>[] = [];
  const coordMismatchWarnings: Extract<MapWarning, { kind: 'coordMismatch' }>[] = [];

  for (const [idStr, room] of Object.entries(map.rooms)) {
    if (!room) continue;
    const id = Number(idStr);
    const areaName = map.areaNames[room.area] ?? `Area ${room.area}`;
    const selfDirs: string[] = [];

    for (const dir of CARDINAL_DIRS) {
      const target = (room as any)[dir] as number;
      if (target === id) selfDirs.push(dir);
      if (target > 0) {
        if (roomIds.has(target)) {
          inbound.set(target, (inbound.get(target) ?? 0) + 1);
          const check = DIR_COORD_OK[dir];
          if (check) {
            const shortKey = DIR_SHORT[dir as keyof typeof DIR_SHORT];
            const hasCustomLine = shortKey && (room as any).customLines?.[shortKey];
            if (!hasCustomLine) {
              const targetRoom = map.rooms[target];
              if (targetRoom && targetRoom.area === room.area &&
                  !check(room.x, room.y, room.z, targetRoom.x, targetRoom.y, targetRoom.z)) {
                coordMismatchWarnings.push({ kind: 'coordMismatch', roomId: id, dir, targetId: target, areaName });
              }
            }
          }
        } else {
          danglingWarnings.push({ kind: 'danglingExit', roomId: id, dir, targetId: target, areaName });
        }
      }
    }
    for (const [exitName, targetId] of Object.entries(room.mSpecialExits ?? {})) {
      if (targetId === id) selfDirs.push(exitName);
      if (targetId > 0) {
        if (roomIds.has(targetId)) {
          inbound.set(targetId, (inbound.get(targetId) ?? 0) + 1);
        } else {
          danglingWarnings.push({ kind: 'danglingExit', roomId: id, dir: exitName, targetId, areaName });
        }
      }
    }

    if (selfDirs.length > 0) {
      warnings.push({ kind: 'selfLinkRoom', roomId: id, dirs: selfDirs });
    }

    const coordKey = `${room.area}|${room.x}|${room.y}|${room.z}`;
    const bucket = coordBuckets.get(coordKey);
    if (bucket) bucket.push(id);
    else coordBuckets.set(coordKey, [id]);
  }

  for (const [idStr, room] of Object.entries(map.rooms)) {
    if (!room) continue;
    const id = Number(idStr);
    if ((inbound.get(id) ?? 0) > 0) continue;
    let hasOutgoing = false;
    for (const dir of CARDINAL_DIRS) {
      if ((room as any)[dir] > 0) { hasOutgoing = true; break; }
    }
    if (!hasOutgoing) {
      for (const target of Object.values(room.mSpecialExits ?? {})) {
        if ((target as number) > 0) { hasOutgoing = true; break; }
      }
    }
    if (!hasOutgoing) {
      warnings.push({ kind: 'orphanRoom', roomId: id, areaName: map.areaNames[room.area] ?? `Area ${room.area}` });
    }
  }

  warnings.push(...danglingWarnings);
  warnings.push(...coordMismatchWarnings);

  for (const [key, ids] of coordBuckets) {
    if (ids.length < 2) continue;
    const [areaStr, xStr, yStr, zStr] = key.split('|');
    const areaId = Number(areaStr);
    warnings.push({
      kind: 'duplicateCoord',
      roomIds: ids,
      areaId,
      areaName: map.areaNames[areaId] ?? `Area ${areaId}`,
      x: Number(xStr),
      y: Number(yStr),
      z: Number(zStr),
    });
  }

  return warnings;
}
