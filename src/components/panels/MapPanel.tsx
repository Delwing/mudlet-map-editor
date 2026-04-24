import { useEditorState, store } from '../../editor/store';
import { pushCommand } from '../../editor/commands';
import { UserDataEditor } from '../panelShared';
import type { SceneHandle } from '../../editor/scene';
import type { MudletMap } from '../../mapIO';

interface MapPanelProps {
  sceneRef: { current: SceneHandle | null };
}

type MapWarning =
  | { kind: 'zeroSizeLabel'; labelId: number; areaId: number; areaName: string; z: number; text: string; x: number; y: number }
  | { kind: 'selfLinkRoom'; roomId: number; dirs: string[] }
  | { kind: 'orphanRoom'; roomId: number; areaName: string }
  | { kind: 'danglingExit'; roomId: number; dir: string; targetId: number; areaName: string }
  | { kind: 'duplicateCoord'; roomIds: number[]; areaId: number; areaName: string; x: number; y: number; z: number };

const CARDINAL_DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'up', 'down', 'in', 'out'] as const;

export function collectWarnings(sceneRef: { current: SceneHandle | null }, map: MudletMap): MapWarning[] {
  const warnings: MapWarning[] = [];

  // Zero-size labels
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

  // Single-pass scan: inbound counts, self-links, dangling exits.
  const inbound = new Map<number, number>();
  const coordBuckets = new Map<string, number[]>();
  const roomIds = new Set<number>();
  for (const idStr of Object.keys(map.rooms)) roomIds.add(Number(idStr));

  const danglingWarnings: Extract<MapWarning, { kind: 'danglingExit' }>[] = [];

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

  // Orphan rooms: no outgoing exits AND no inbound references.
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

  // Duplicate coordinates within area.
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

function goToLabel(w: Extract<MapWarning, { kind: 'zeroSizeLabel' }>) {
  const s = store.getState();
  const areaChanged = w.areaId !== s.currentAreaId;
  const zChanged = w.z !== s.currentZ;
  const mapX = w.x;
  const mapY = -w.y;
  if (areaChanged || zChanged) {
    store.setState({
      selection: { kind: 'label', id: w.labelId, areaId: w.areaId },
      currentAreaId: w.areaId,
      currentZ: w.z,
      navigateTo: { mapX, mapY },
      sidebarTab: 'selection',
    });
    store.bumpStructure();
  } else {
    store.setState({
      selection: { kind: 'label', id: w.labelId, areaId: w.areaId },
      panRequest: { mapX, mapY },
      sidebarTab: 'selection',
    });
  }
}

function goToRoom(roomId: number) {
  const s = store.getState();
  const room = s.map?.rooms[roomId];
  if (!room) return;
  const areaChanged = room.area !== s.currentAreaId;
  const zChanged = room.z !== s.currentZ;
  if (areaChanged || zChanged) {
    store.setState({
      selection: { kind: 'room', ids: [roomId] },
      currentAreaId: room.area,
      currentZ: room.z,
      navigateTo: { mapX: room.x, mapY: -room.y },
      sidebarTab: 'selection',
    });
    store.bumpStructure();
  } else {
    store.setState({
      selection: { kind: 'room', ids: [roomId] },
      panRequest: { mapX: room.x, mapY: -room.y },
      sidebarTab: 'selection',
    });
  }
}

export function MapPanel({ sceneRef }: MapPanelProps) {
  const map = useEditorState((s) => s.map);
  useEditorState((s) => s.structureVersion);
  useEditorState((s) => s.dataVersion);

  if (!map) {
    return (
      <div className="panel-content">
        <h3>No map loaded</h3>
        <p className="hint">Drag a .dat file in or load from toolbar.</p>
      </div>
    );
  }

  const roomCount = Object.keys(map.rooms).length;
  const areaCount = Object.keys(map.areas).length;
  const envCount = Object.keys(map.mCustomEnvColors).length;

  const warnings = collectWarnings(sceneRef, map);

  return (
    <div className="panel-content">
      <h4>Map Info</h4>
      <div className="map-stats">
        <div className="map-stat-row"><span className="map-stat-label">Version</span><span className="map-stat-value">{map.version}</span></div>
        <div className="map-stat-row"><span className="map-stat-label">Rooms</span><span className="map-stat-value">{roomCount}</span></div>
        <div className="map-stat-row"><span className="map-stat-label">Areas</span><span className="map-stat-value">{areaCount}</span></div>
        <div className="map-stat-row"><span className="map-stat-label">Custom envs</span><span className="map-stat-value">{envCount}</span></div>
      </div>

      <h4>User Data</h4>
      <UserDataEditor
        data={map.mUserData ?? {}}
        onCommit={(key, from, to) => {
          pushCommand({ kind: 'setMapUserDataEntry', key, from, to }, sceneRef.current);
          store.bumpData();
        }}
      />

      {warnings.length > 0 && (
        <>
          <h4>Warnings <span className="tab-badge">{warnings.length}</span></h4>
          <div className="warnings-list">
            {warnings.map((w) => {
              if (w.kind === 'zeroSizeLabel') {
                return (
                  <div key={`label-${w.areaId}-${w.labelId}`} className="warning-row">
                    <span className="warning-icon">⚠</span>
                    <span className="warning-text">
                      <strong>Zero-size label</strong>
                      <span className="warning-detail">{w.text ? `"${w.text}"` : `#${w.labelId}`} · {w.areaName}{w.z !== 0 ? ` z=${w.z}` : ''}</span>
                    </span>
                    <button type="button" className="warning-go-btn" onClick={() => goToLabel(w)}>Go</button>
                  </div>
                );
              }
              if (w.kind === 'selfLinkRoom') {
                return (
                  <div key={`selflink-${w.roomId}`} className="warning-row">
                    <span className="warning-icon">⚠</span>
                    <span className="warning-text">
                      <strong>Self-linking room</strong>
                      <span className="warning-detail">#{w.roomId} · {w.dirs.join(', ')}</span>
                    </span>
                    <button type="button" className="warning-go-btn" onClick={() => goToRoom(w.roomId)}>Go</button>
                  </div>
                );
              }
              if (w.kind === 'orphanRoom') {
                return (
                  <div key={`orphan-${w.roomId}`} className="warning-row">
                    <span className="warning-icon">⚠</span>
                    <span className="warning-text">
                      <strong>Orphan room</strong>
                      <span className="warning-detail">#{w.roomId} · {w.areaName}</span>
                    </span>
                    <button type="button" className="warning-go-btn" onClick={() => goToRoom(w.roomId)}>Go</button>
                  </div>
                );
              }
              if (w.kind === 'danglingExit') {
                return (
                  <div key={`dangling-${w.roomId}-${w.dir}`} className="warning-row">
                    <span className="warning-icon">⚠</span>
                    <span className="warning-text">
                      <strong>Dangling exit</strong>
                      <span className="warning-detail">#{w.roomId} {w.dir} → missing #{w.targetId} · {w.areaName}</span>
                    </span>
                    <button type="button" className="warning-go-btn" onClick={() => goToRoom(w.roomId)}>Go</button>
                  </div>
                );
              }
              if (w.kind === 'duplicateCoord') {
                return (
                  <div key={`dup-${w.areaId}-${w.x}-${w.y}-${w.z}`} className="warning-row">
                    <span className="warning-icon">⚠</span>
                    <span className="warning-text">
                      <strong>Duplicate coords</strong>
                      <span className="warning-detail">{w.areaName} ({w.x}, {w.y}, {w.z}) · {w.roomIds.map((id) => `#${id}`).join(', ')}</span>
                    </span>
                    <button type="button" className="warning-go-btn" onClick={() => goToRoom(w.roomIds[0])}>Go</button>
                  </div>
                );
              }
            })}
          </div>
        </>
      )}
    </div>
  );
}
