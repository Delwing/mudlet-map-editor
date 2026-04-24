import { store, useEditorState } from '../../editor/store';
import { undoOnce, redoOnce } from '../../editor/commands';
import type { Command } from '../../editor/types';
import type { SceneHandle } from '../../editor/scene';

export function commandLabel(cmd: Command): string {
  switch (cmd.kind) {
    case 'moveRoom': return `Move room #${cmd.id}`;
    case 'addRoom': return `Add room #${cmd.id}`;
    case 'deleteRoom': return `Delete room #${cmd.id}`;
    case 'addExit': return `Add exit #${cmd.fromId} ${cmd.dir} ${cmd.reverse ? '↔' : '→'} #${cmd.toId}`;
    case 'removeExit': return `Remove exit #${cmd.fromId} ${cmd.dir}`;
    case 'removeAllExits': return `Remove all exits from #${cmd.roomId}`;
    case 'setRoomField': return `Set ${cmd.field} on #${cmd.id}`;
    case 'setRoomHash': return cmd.to === null ? `Clear hash on #${cmd.id}` : `Set hash on #${cmd.id}`;
    case 'addArea': return `Add area "${cmd.name}"`;
    case 'deleteArea': return `Delete area "${cmd.name}"`;
    case 'deleteAreaWithRooms': return `Delete area "${cmd.areaName}" + rooms`;
    case 'renameArea': return `Rename area → "${cmd.to}"`;
    case 'setCustomEnvColor': return `Set env #${cmd.envId} color`;
    case 'addSpecialExit': return `Add special exit "${cmd.name}" on #${cmd.roomId}`;
    case 'removeSpecialExit': return `Remove special exit "${cmd.name}" on #${cmd.roomId}`;
    case 'setCustomLine': return `Set custom line "${cmd.exitName}" on #${cmd.roomId}`;
    case 'removeCustomLine': return `Remove custom line "${cmd.exitName}"`;
    case 'moveRoomsToArea': return `Move ${cmd.roomIds.length} room${cmd.roomIds.length === 1 ? '' : 's'} to area`;
    case 'setRoomLock': return `${cmd.lock ? 'Lock' : 'Unlock'} room #${cmd.id}`;
    case 'setDoor': return `Set door on #${cmd.roomId} ${cmd.dir}`;
    case 'setExitWeight': return `Set exit weight on #${cmd.roomId} ${cmd.dir}`;
    case 'setExitLock': return `${cmd.lock ? 'Lock' : 'Unlock'} exit on #${cmd.roomId} ${cmd.dir}`;
    case 'setStub': return `${cmd.stub ? 'Add' : 'Remove'} stub on #${cmd.roomId} ${cmd.dir}`;
    case 'setUserDataEntry': return cmd.from === null ? `Add user data "${cmd.key}" on #${cmd.roomId}` : cmd.to === null ? `Remove user data "${cmd.key}" on #${cmd.roomId}` : `Edit user data "${cmd.key}" on #${cmd.roomId}`;
    case 'setAreaUserDataEntry': return cmd.from === null ? `Add area user data "${cmd.key}" on area #${cmd.areaId}` : cmd.to === null ? `Remove area user data "${cmd.key}" on area #${cmd.areaId}` : `Edit area user data "${cmd.key}" on area #${cmd.areaId}`;
    case 'setMapUserDataEntry': return cmd.from === null ? `Add map user data "${cmd.key}"` : cmd.to === null ? `Remove map user data "${cmd.key}"` : `Edit map user data "${cmd.key}"`;

    case 'setSpecialExitDoor': return `Set door on special exit "${cmd.name}"`;
    case 'setSpecialExitWeight': return `Set weight on special exit "${cmd.name}"`;
    case 'addLabel': return `Add label #${cmd.label.id}`;
    case 'deleteLabel': return `Delete label #${cmd.label.id}`;
    case 'moveLabel': return `Move label #${cmd.id}`;
    case 'setLabelText': return `Set label #${cmd.id} text`;
    case 'setLabelSize': return `Resize label #${cmd.id}`;
    case 'setLabelColors': return `Set label #${cmd.id} colors`;
    case 'setLabelFont': return `Set font on label #${cmd.id}`;
    case 'setLabelOutlineColor': return `Set outline color on label #${cmd.id}`;
    case 'setLabelPixmap': return `Update pixmap on label #${cmd.id}`;
    case 'setLabelImageSrc': return `Set image source on label #${cmd.id}`;
    case 'setLabelNoScaling': return `${cmd.to ? 'Disable' : 'Enable'} zoom scaling on label #${cmd.id}`;
    case 'setLabelShowOnTop': return `Set label #${cmd.id} ${cmd.to ? 'foreground' : 'background'}`;
    case 'resizeLabel': return `Resize label #${cmd.id}`;
    case 'batch': return commandLabel(cmd.cmds[0]);
  }
}

function HistoryEntry({ cmd, className, onClick, title }: {
  cmd: Command;
  className: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button type="button" className={className} onClick={onClick} title={title}>
      <span className="history-label">{commandLabel(cmd)}</span>
      {cmd.kind === 'batch' && cmd.cmds.slice(1).map((sub, i) => (
        <span key={i} className="history-sub">{commandLabel(sub)}</span>
      ))}
    </button>
  );
}

export function HistoryPanel({ sceneRef }: { sceneRef: { current: SceneHandle | null } }) {
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
    store.setState({ status: undoSteps > 0 ? `Undone ${undoSteps}×` : `Redone ${redoSteps}×` });
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
            title={`Redo ${redo.length - i} step${redo.length - i === 1 ? '' : 's'}`}
          />
        ))}
        <div className="history-item history-current">
          <span className="history-marker">▶</span>
          <span className="history-label">Current state</span>
        </div>
        {undoReversed.map((cmd, i) => (
          <HistoryEntry
            key={i}
            cmd={cmd}
            className="history-item history-done"
            onClick={() => jumpTo(i + 1, 0)}
            title={`Undo ${i + 1} step${i === 0 ? '' : 's'}`}
          />
        ))}
        {undo.length === 0 && redo.length === 0 && (
          <p className="hint" style={{ marginTop: 8 }}>No history yet.</p>
        )}
      </div>
    </div>
  );
}
