import { store } from '../../editor/store';
import { pushCommand } from '../../editor/commands';
import type { Direction } from '../../editor/types';
import type { SceneHandle } from '../../editor/scene';
import type { MudletMap } from '../../mapIO';
import { RoomLink } from '../panelShared';

export function StubPanel({ selection, map, sceneRef }: {
  selection: { kind: 'stub'; roomId: number; dir: Direction };
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
}) {
  const room = map.rooms[selection.roomId];

  const removeStub = () => {
    pushCommand(
      { kind: 'setStub', roomId: selection.roomId, dir: selection.dir, stub: false },
      sceneRef.current,
    );
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ selection: null, status: `Removed stub ${selection.dir} on room ${selection.roomId}` });
  };

  return (
    <>
      <h3>Stub</h3>
      <div className="exit-flow">
        <RoomLink id={selection.roomId} name={room?.name} />
        <div className="exit-flow-center">
          <span className="exit-dir-label">{selection.dir}</span>
          <span className="exit-dir-arrow">→</span>
        </div>
      </div>
      <button type="button" className="link-delete-btn link-delete-btn--both" onClick={removeStub}>
        ✕ Remove stub
      </button>
    </>
  );
}
