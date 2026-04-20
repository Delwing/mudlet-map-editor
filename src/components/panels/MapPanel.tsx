import { useEditorState, store } from '../../editor/store';
import { pushCommand } from '../../editor/commands';
import { UserDataEditor } from '../panelShared';
import type { SceneHandle } from '../../editor/scene';

interface MapPanelProps {
  sceneRef: { current: SceneHandle | null };
}

export function MapPanel({ sceneRef }: MapPanelProps) {
  const map = useEditorState((s) => s.map);

  if (!map) {
    return (
      <div className="panel-content">
        <h3>No map loaded</h3>
        <p className="hint">Open a .dat file to see map info.</p>
      </div>
    );
  }

  const roomCount = Object.keys(map.rooms).length;
  const areaCount = Object.keys(map.areas).length;
  const envCount = Object.keys(map.mCustomEnvColors).length;

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
    </div>
  );
}
