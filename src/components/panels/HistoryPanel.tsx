import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState } from '../../editor/store';
import { undoOnce, redoOnce } from '../../editor/commands';
import type { Command } from '../../editor/types';
import type { SceneHandle } from '../../editor/scene';

type CmdT = (key: string, opts?: Record<string, unknown>) => string;

const COLLAPSED_SUBS = 5;

export function commandLabel(cmd: Command, t: CmdT): string {
  switch (cmd.kind) {
    case 'moveRoom': return t('history.cmd.moveRoom', { id: cmd.id });
    case 'addRoom': return t('history.cmd.addRoom', { id: cmd.id });
    case 'deleteRoom': return t('history.cmd.deleteRoom', { id: cmd.id });
    case 'renameRoomId': return t('history.cmd.renameRoomId', { from: cmd.fromId, to: cmd.toId });
    case 'addExit': return cmd.reverse
      ? t('history.cmd.addExitBidi', { from: cmd.fromId, dir: cmd.dir, to: cmd.toId })
      : t('history.cmd.addExitUni', { from: cmd.fromId, dir: cmd.dir, to: cmd.toId });
    case 'removeExit': return t('history.cmd.removeExit', { from: cmd.fromId, dir: cmd.dir });
    case 'removeAllExits': return t('history.cmd.removeAllExits', { id: cmd.roomId });
    case 'setRoomField': return t('history.cmd.setField', { field: cmd.field, id: cmd.id });
    case 'setRoomHash': return cmd.to === null
      ? t('history.cmd.clearHash', { id: cmd.id })
      : t('history.cmd.setHash', { id: cmd.id });
    case 'addArea': return t('history.cmd.addArea', { name: cmd.name });
    case 'deleteArea': return t('history.cmd.deleteArea', { name: cmd.name });
    case 'deleteAreaWithRooms': return t('history.cmd.deleteAreaWithRooms', { name: cmd.areaName });
    case 'renameArea': return t('history.cmd.renameArea', { name: cmd.to });
    case 'setCustomEnvColor': return t('history.cmd.setEnvColor', { id: cmd.envId });
    case 'addSpecialExit': return t('history.cmd.addSpecialExit', { name: cmd.name, id: cmd.roomId });
    case 'removeSpecialExit': return t('history.cmd.removeSpecialExit', { name: cmd.name, id: cmd.roomId });
    case 'setCustomLine': return t('history.cmd.setCustomLine', { name: cmd.exitName, id: cmd.roomId });
    case 'removeCustomLine': return t('history.cmd.removeCustomLine', { name: cmd.exitName });
    case 'moveRoomsToArea': return t('history.cmd.moveRoomsToArea', { count: cmd.roomIds.length });
    case 'setRoomLock': return cmd.lock
      ? t('history.cmd.lockRoom', { id: cmd.id })
      : t('history.cmd.unlockRoom', { id: cmd.id });
    case 'setDoor': return t('history.cmd.setDoor', { id: cmd.roomId, dir: cmd.dir });
    case 'setExitWeight': return t('history.cmd.setExitWeight', { id: cmd.roomId, dir: cmd.dir });
    case 'setExitLock': return cmd.lock
      ? t('history.cmd.lockExit', { id: cmd.roomId, dir: cmd.dir })
      : t('history.cmd.unlockExit', { id: cmd.roomId, dir: cmd.dir });
    case 'setStub': return cmd.stub
      ? t('history.cmd.addStub', { id: cmd.roomId, dir: cmd.dir })
      : t('history.cmd.removeStub', { id: cmd.roomId, dir: cmd.dir });
    case 'setUserDataEntry': return cmd.from === null
      ? t('history.cmd.addUserData', { key: cmd.key, id: cmd.roomId })
      : cmd.to === null
        ? t('history.cmd.removeUserData', { key: cmd.key, id: cmd.roomId })
        : t('history.cmd.editUserData', { key: cmd.key, id: cmd.roomId });
    case 'setAreaUserDataEntry': return cmd.from === null
      ? t('history.cmd.addAreaUserData', { key: cmd.key, id: cmd.areaId })
      : cmd.to === null
        ? t('history.cmd.removeAreaUserData', { key: cmd.key, id: cmd.areaId })
        : t('history.cmd.editAreaUserData', { key: cmd.key, id: cmd.areaId });
    case 'setMapUserDataEntry': return cmd.from === null
      ? t('history.cmd.addMapUserData', { key: cmd.key })
      : cmd.to === null
        ? t('history.cmd.removeMapUserData', { key: cmd.key })
        : t('history.cmd.editMapUserData', { key: cmd.key });
    case 'setSpecialExitDoor': return t('history.cmd.setSpecialDoor', { name: cmd.name });
    case 'setSpecialExitWeight': return t('history.cmd.setSpecialWeight', { name: cmd.name });
    case 'addLabel': return t('history.cmd.addLabel', { id: cmd.label.id });
    case 'deleteLabel': return t('history.cmd.deleteLabel', { id: cmd.label.id });
    case 'moveLabel': return t('history.cmd.moveLabel', { id: cmd.id });
    case 'setLabelText': return t('history.cmd.setLabelText', { id: cmd.id });
    case 'setLabelSize': return t('history.cmd.setLabelSize', { id: cmd.id });
    case 'setLabelColors': return t('history.cmd.setLabelColors', { id: cmd.id });
    case 'setLabelFont': return t('history.cmd.setLabelFont', { id: cmd.id });
    case 'setLabelOutlineColor': return t('history.cmd.setLabelOutlineColor', { id: cmd.id });
    case 'setLabelPixmap': return t('history.cmd.setLabelPixmap', { id: cmd.id });
    case 'setLabelImageSrc': return t('history.cmd.setLabelImageSrc', { id: cmd.id });
    case 'setLabelNoScaling': return cmd.to
      ? t('history.cmd.disableZoomScaling', { id: cmd.id })
      : t('history.cmd.enableZoomScaling', { id: cmd.id });
    case 'setLabelShowOnTop': return cmd.to
      ? t('history.cmd.setLabelForeground', { id: cmd.id })
      : t('history.cmd.setLabelBackground', { id: cmd.id });
    case 'resizeLabel': return t('history.cmd.resizeLabel', { id: cmd.id });
    case 'batch': return commandLabel(cmd.cmds[0], t);
  }
}

function HistoryEntry({ cmd, className, onClick, title, t }: {
  cmd: Command;
  className: string;
  onClick: () => void;
  title: string;
  t: CmdT;
}) {
  const [expanded, setExpanded] = useState(false);
  const subs = cmd.kind === 'batch' ? cmd.cmds.slice(1) : [];
  const showToggle = subs.length > COLLAPSED_SUBS;
  const visibleSubs = expanded || !showToggle ? subs : subs.slice(0, COLLAPSED_SUBS);
  const hiddenCount = subs.length - visibleSubs.length;

  return (
    <div
      className={className}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      title={title}
      role="button"
      tabIndex={0}
    >
      <span className="history-label">{commandLabel(cmd, t)}</span>
      {visibleSubs.map((sub, i) => (
        <span key={i} className="history-sub">{commandLabel(sub, t)}</span>
      ))}
      {showToggle && (
        <button
          type="button"
          className="history-expand"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          title={expanded ? t('history.collapse') : t('history.showMore', { count: hiddenCount })}
        >
          {expanded ? `− ${t('history.collapse')}` : t('history.showMore', { count: hiddenCount })}
        </button>
      )}
    </div>
  );
}

export function HistoryPanel({ sceneRef }: { sceneRef: { current: SceneHandle | null } }) {
  const { t } = useTranslation('panels');
  const undo = useEditorState((s) => s.undo);
  const redo = useEditorState((s) => s.redo);

  const jumpTo = (undoSteps: number, redoSteps: number) => {
    const scene = sceneRef.current;
    let structural = false;
    for (let i = 0; i < undoSteps; i++) {
      const r = undoOnce(scene);
      if (!r.changed) break;
      if (r.structural) structural = true;
    }
    for (let i = 0; i < redoSteps; i++) {
      const r = redoOnce(scene);
      if (!r.changed) break;
      if (r.structural) structural = true;
    }
    scene?.refresh();
    if (structural) store.bumpStructure();
    else store.bumpData();
    store.setState({ status: undoSteps > 0 ? t('history.undoneCount', { count: undoSteps }) : t('history.redoneCoutn', { count: redoSteps }) });
  };

  const undoReversed = [...undo].reverse();

  return (
    <div className="panel-content">
      <div className="history-list">
        {redo.map((cmd, i) => (
          <HistoryEntry
            key={i}
            cmd={cmd}
            className="history-item history-undone"
            onClick={() => jumpTo(0, redo.length - i)}
            title={redo.length - i === 1 ? t('history.redoStep', { count: redo.length - i }) : t('history.redoSteps', { count: redo.length - i })}
            t={t}
          />
        ))}
        <div className="history-item history-current">
          <span className="history-marker">▶</span>
          <span className="history-label">{t('history.currentState')}</span>
        </div>
        {undoReversed.map((cmd, i) => (
          <HistoryEntry
            key={i}
            cmd={cmd}
            className="history-item history-done"
            onClick={() => jumpTo(i + 1, 0)}
            title={i === 0 ? t('history.undoStep', { count: i + 1 }) : t('history.undoSteps', { count: i + 1 })}
            t={t}
          />
        ))}
        {undo.length === 0 && redo.length === 0 && (
          <p className="hint" style={{ marginTop: 8 }}>{t('history.noHistory')}</p>
        )}
      </div>
    </div>
  );
}
