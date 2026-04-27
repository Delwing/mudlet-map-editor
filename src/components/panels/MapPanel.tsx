import { useState, useEffect } from 'react';
import { useEditorState, store } from '../../editor/store';
import { pushCommand } from '../../editor/commands';
import { UserDataEditor } from '../panelShared';
import type { SceneHandle } from '../../editor/scene';
import { loadAcks, saveAcks, mapAckKey } from '../../editor/warningAcks';
import { type MapWarning, warningKey } from '../../editor/warnings';

export type { MapWarning };
export { warningKey };

interface MapPanelProps {
  sceneRef: { current: SceneHandle | null };
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
  const allWarnings = useEditorState((s) => s.warnings);

  const [ackedKeys, setAckedKeys] = useState<Set<string>>(new Set());
  const [showAcked, setShowAcked] = useState(false);

  // Recomputed each render; changes only when areas are added/removed.
  const mapKey = map ? mapAckKey(map) : null;
  useEffect(() => {
    setAckedKeys(mapKey ? loadAcks(mapKey) : new Set());
    setShowAcked(false);
  }, [mapKey]);

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

  const activeWarnings = allWarnings.filter((w) => !ackedKeys.has(warningKey(w)));
  const ackedWarnings = allWarnings.filter((w) => ackedKeys.has(warningKey(w)));

  function ackWarning(w: MapWarning) {
    if (!mapKey) return;
    const next = new Set(ackedKeys);
    next.add(warningKey(w));
    setAckedKeys(next);
    saveAcks(mapKey, next);
    store.bumpAckVersion();
  }

  function unackWarning(w: MapWarning) {
    if (!mapKey) return;
    const next = new Set(ackedKeys);
    next.delete(warningKey(w));
    setAckedKeys(next);
    saveAcks(mapKey, next);
    store.bumpAckVersion();
  }

  function renderWarningContent(w: MapWarning) {
    if (w.kind === 'zeroSizeLabel') return (
      <span className="warning-text">
        <strong>Zero-size label</strong>
        <span className="warning-detail">{w.text ? `"${w.text}"` : `#${w.labelId}`} · {w.areaName}{w.z !== 0 ? ` z=${w.z}` : ''}</span>
      </span>
    );
    if (w.kind === 'selfLinkRoom') return (
      <span className="warning-text">
        <strong>Self-linking room</strong>
        <span className="warning-detail">#{w.roomId} · {w.dirs.join(', ')}</span>
      </span>
    );
    if (w.kind === 'orphanRoom') return (
      <span className="warning-text">
        <strong>Orphan room</strong>
        <span className="warning-detail">#{w.roomId} · {w.areaName}</span>
      </span>
    );
    if (w.kind === 'danglingExit') return (
      <span className="warning-text">
        <strong>Dangling exit</strong>
        <span className="warning-detail">#{w.roomId} {w.dir} → missing #{w.targetId} · {w.areaName}</span>
      </span>
    );
    if (w.kind === 'duplicateCoord') return (
      <span className="warning-text">
        <strong>Duplicate coords</strong>
        <span className="warning-detail">{w.areaName} ({w.x}, {w.y}, {w.z}) · {w.roomIds.map((id) => `#${id}`).join(', ')}</span>
      </span>
    );
    if (w.kind === 'coordMismatch') return (
      <span className="warning-text">
        <strong>Direction mismatch</strong>
        <span className="warning-detail">#{w.roomId} {w.dir} → #{w.targetId} · {w.areaName}</span>
      </span>
    );
    if (w.kind === 'plugin') return (
      <span className="warning-text">
        <strong>{w.message}</strong>
        {w.detail && <span className="warning-detail">{w.detail}</span>}
      </span>
    );
  }

  function goBtn(w: MapWarning) {
    if (w.kind === 'zeroSizeLabel') return <button type="button" className="warning-go-btn" onClick={() => goToLabel(w)}>Go</button>;
    if (w.kind === 'duplicateCoord') return <button type="button" className="warning-go-btn" onClick={() => goToRoom(w.roomIds[0])}>Go</button>;
    if (w.kind === 'plugin') return w.roomId != null ? <button type="button" className="warning-go-btn" onClick={() => goToRoom(w.roomId!)}>Go</button> : null;
    return <button type="button" className="warning-go-btn" onClick={() => goToRoom((w as any).roomId)}>Go</button>;
  }

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

      {allWarnings.length > 0 && (
        <>
          <h4>
            Warnings{' '}
            {activeWarnings.length > 0 && <span className="tab-badge tab-badge--warn">{activeWarnings.length}</span>}
          </h4>
          {activeWarnings.length > 0 && (
            <div className="warnings-list">
              {activeWarnings.map((w) => (
                <div key={warningKey(w)} className="warning-row">
                  <span className="warning-icon">⚠</span>
                  {renderWarningContent(w)}
                  {goBtn(w)}
                  <button type="button" className="warning-ack-btn" onClick={() => ackWarning(w)}>Ack</button>
                </div>
              ))}
            </div>
          )}
          {ackedWarnings.length > 0 && (
            <div className="warnings-acked-section">
              <button type="button" className="warnings-acked-toggle" onClick={() => setShowAcked((p) => !p)}>
                {showAcked ? '▾' : '▸'} {ackedWarnings.length} acknowledged
              </button>
              {showAcked && (
                <div className="warnings-list warnings-list--acked">
                  {ackedWarnings.map((w) => (
                    <div key={warningKey(w)} className="warning-row warning-row--acked">
                      <span className="warning-icon">✓</span>
                      {renderWarningContent(w)}
                      <button type="button" className="warning-ack-btn warning-ack-btn--unack" onClick={() => unackWarning(w)}>Unack</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
