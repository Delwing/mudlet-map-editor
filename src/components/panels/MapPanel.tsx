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
  | { kind: 'selfLinkRoom'; roomId: number; dirs: string[] };

function collectWarnings(sceneRef: { current: SceneHandle | null }, map: MudletMap): MapWarning[] {
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

  // Self-linking rooms
  const CARDINAL_DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'up', 'down', 'in', 'out'] as const;
  for (const [idStr, room] of Object.entries(map.rooms)) {
    if (!room) continue;
    const id = Number(idStr);
    const selfDirs: string[] = [];
    for (const dir of CARDINAL_DIRS) {
      if ((room as any)[dir] === id) selfDirs.push(dir);
    }
    for (const [exitName, targetId] of Object.entries(room.mSpecialExits ?? {})) {
      if (targetId === id) selfDirs.push(exitName);
    }
    if (selfDirs.length > 0) {
      warnings.push({ kind: 'selfLinkRoom', roomId: id, dirs: selfDirs });
    }
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

function goToRoom(w: Extract<MapWarning, { kind: 'selfLinkRoom' }>) {
  const s = store.getState();
  const room = s.map?.rooms[w.roomId];
  if (!room) return;
  const areaChanged = room.area !== s.currentAreaId;
  const zChanged = room.z !== s.currentZ;
  if (areaChanged || zChanged) {
    store.setState({
      selection: { kind: 'room', ids: [w.roomId] },
      currentAreaId: room.area,
      currentZ: room.z,
      navigateTo: { mapX: room.x, mapY: -room.y },
      sidebarTab: 'selection',
    });
    store.bumpStructure();
  } else {
    store.setState({
      selection: { kind: 'room', ids: [w.roomId] },
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
                  <div key={`room-${w.roomId}`} className="warning-row">
                    <span className="warning-icon">⚠</span>
                    <span className="warning-text">
                      <strong>Self-linking room</strong>
                      <span className="warning-detail">#{w.roomId} · {w.dirs.join(', ')}</span>
                    </span>
                    <button type="button" className="warning-go-btn" onClick={() => goToRoom(w)}>Go</button>
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
