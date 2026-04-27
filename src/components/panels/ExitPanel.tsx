import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { store } from '../../editor/store';
import { pushCommand } from '../../editor/commands';
import type { Direction } from '../../editor/types';
import type { SceneHandle } from '../../editor/scene';
import type { MudletMap } from '../../mapIO';
import { RoomLink } from '../panelShared';

export function ExitPanel({ selection, map, sceneRef }: {
  selection: { kind: 'exit'; fromId: number; toId: number; dir: Direction };
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
}) {
  const { t } = useTranslation('panels');
  const fromRoom = map.rooms[selection.fromId];
  const toRoom = map.rooms[selection.toId];
  const OPPOSITE: Record<string, string> = {
    north:'south',south:'north',east:'west',west:'east',
    northeast:'southwest',southwest:'northeast',northwest:'southeast',southeast:'northwest',
    up:'down',down:'up',in:'out',out:'in',
  };
  const ALL_DIRS = Object.keys(OPPOSITE) as Direction[];
  const reverseDir = toRoom
    ? (ALL_DIRS.find(d => (toRoom as any)[d] === selection.fromId) ?? OPPOSITE[selection.dir])
    : OPPOSITE[selection.dir];
  const isBidirectional = toRoom && ALL_DIRS.some(d => (toRoom as any)[d] === selection.fromId);

  const removeExit = (which: 'both' | 'forward' | 'reverse') => {
    const reverse = (isBidirectional && which !== 'forward')
      ? { fromId: selection.toId, dir: reverseDir as Direction, was: selection.fromId }
      : null;
    if (which === 'reverse') {
      pushCommand({
        kind: 'removeExit',
        fromId: selection.toId,
        dir: reverseDir as Direction,
        was: selection.fromId,
        reverse: null,
      }, sceneRef.current);
    } else {
      pushCommand({
        kind: 'removeExit',
        fromId: selection.fromId,
        dir: selection.dir,
        was: selection.toId,
        reverse,
      }, sceneRef.current);
    }
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ selection: null, status: i18n.t('editor:status.removedExit', { from: selection.fromId, to: selection.toId }) });
  };

  return (
    <>
      <h3>{t('exit.heading')}</h3>
      <div className="exit-flow">
        <RoomLink id={selection.fromId} name={fromRoom?.name} />
        <div className="exit-flow-center">
          <span className="exit-dir-label">{selection.dir}</span>
          <button type="button" className="link-delete-inline" title={`Remove ${selection.dir} exit`} onClick={() => removeExit('forward')}>✕</button>
          <span className="exit-dir-arrow">{isBidirectional ? '↔' : '→'}</span>
          {isBidirectional && (
            <button type="button" className="link-delete-inline" title={`Remove ${reverseDir} exit`} onClick={() => removeExit('reverse')}>✕</button>
          )}
          {isBidirectional && <span className="exit-dir-label">{reverseDir}</span>}
        </div>
        <RoomLink id={selection.toId} name={toRoom?.name} />
      </div>
      {isBidirectional && (
        <button type="button" className="link-delete-btn link-delete-btn--both" onClick={() => removeExit('both')}>
          {t('exit.removeBothDirections')}
        </button>
      )}
    </>
  );
}
