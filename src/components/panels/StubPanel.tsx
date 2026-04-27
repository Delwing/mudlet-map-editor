import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
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
  const { t } = useTranslation('panels');
  const room = map.rooms[selection.roomId];

  const removeStub = () => {
    pushCommand(
      { kind: 'setStub', roomId: selection.roomId, dir: selection.dir, stub: false },
      sceneRef.current,
    );
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ selection: null, status: i18n.t('editor:status.removedStub', { dir: selection.dir, id: selection.roomId }) });
  };

  return (
    <>
      <h3>{t('stub.heading')}</h3>
      <div className="exit-flow">
        <RoomLink id={selection.roomId} name={room?.name} />
        <div className="exit-flow-center">
          <span className="exit-dir-label">{selection.dir}</span>
          <span className="exit-dir-arrow">→</span>
        </div>
      </div>
      <button type="button" className="link-delete-btn link-delete-btn--both" onClick={removeStub}>
        {t('stub.removeStub')}
      </button>
    </>
  );
}
