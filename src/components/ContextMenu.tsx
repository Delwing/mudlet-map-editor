import { useEffect, useRef, useState } from 'react';
import { store, useEditorState } from '../editor/store';
import { pushCommand, buildDeleteNeighborEdits, pushBatch } from '../editor/commands';
import type { SceneHandle } from '../editor/scene';

interface ContextMenuProps {
  sceneRef: { current: SceneHandle | null };
}

interface MoveToState {
  areaId: number;
  x: string;
  y: string;
  z: string;
}

export function ContextMenu({ sceneRef }: ContextMenuProps) {
  const menu = useEditorState((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement | null>(null);
  const [moveToDialog, setMoveToDialog] = useState<MoveToState | null>(null);

  useEffect(() => {
    if (!menu) {
      setMoveToDialog(null);
      return;
    }
    const close = () => store.setState({ contextMenu: null });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [menu]);

  if (!menu) return null;

  const close = () => store.setState({ contextMenu: null });

  // ── Custom line waypoint menu ──────────────────────────────────────────────

  const deletePoint = () => {
    if (menu.kind !== 'customLinePoint') return;
    const s = store.getState();
    if (!s.map) return close();
    const rawRoom = s.map.rooms[menu.roomId];
    const current = rawRoom?.customLines?.[menu.exitName];
    if (!rawRoom || !current) return close();
    if (menu.pointIndex < 0 || menu.pointIndex >= current.length) return close();
    const color = rawRoom.customLinesColor?.[menu.exitName] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
    const style = rawRoom.customLinesStyle?.[menu.exitName] ?? 1;
    const arrow = rawRoom.customLinesArrow?.[menu.exitName] ?? false;
    const newPoints = current.filter((_, i) => i !== menu.pointIndex);
    pushCommand({
      kind: 'setCustomLine',
      roomId: menu.roomId,
      exitName: menu.exitName,
      data: { points: newPoints, color, style, arrow },
      previous: { points: [...current] as [number, number][], color, style, arrow },
    }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({
      selection: { kind: 'customLine', roomId: menu.roomId, exitName: menu.exitName },
      contextMenu: null,
      status: `Removed waypoint from '${menu.exitName}' on room ${menu.roomId}`,
    });
  };

  if (menu.kind === 'customLinePoint') {
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: menu.screenX, top: menu.screenY }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button type="button" className="context-menu-item danger" onClick={deletePoint}>
          Delete waypoint
        </button>
      </div>
    );
  }

  // ── Room context menu ──────────────────────────────────────────────────────

  if (menu.kind !== 'room') return null;

  const s = store.getState();
  const raw = s.map?.rooms[menu.roomId];
  const areaNames = s.map?.areaNames ?? {};
  const sel = s.selection;
  const multiIds = sel?.kind === 'room' && sel.ids.length > 1 && sel.ids.includes(menu.roomId) ? sel.ids : null;

  const openMoveTo = () => {
    if (!raw) return;
    setMoveToDialog({
      areaId: raw.area,
      x: String(raw.x),
      y: String(raw.y),
      z: String(raw.z),
    });
  };

  const deleteRoom = () => {
    const st = store.getState();
    if (!st.map) return close();
    const rawRoom = st.map.rooms[menu.roomId];
    if (!rawRoom) return close();
    const snapshot = { ...rawRoom };
    const neighborEdits = buildDeleteNeighborEdits(st.map, menu.roomId);
    pushCommand({
      kind: 'deleteRoom',
      id: menu.roomId,
      room: snapshot,
      areaId: rawRoom.area,
      neighborEdits,
    }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpStructure();
    const sel = store.getState().selection;
    if (sel?.kind === 'room' && sel.ids.includes(menu.roomId)) {
      store.setState({ selection: null });
    }
    store.setState({ status: `Deleted room ${menu.roomId}`, contextMenu: null });
  };

  const submitMoveTo = () => {
    if (!moveToDialog || !raw || !s.map) return;
    const newX = parseInt(moveToDialog.x, 10);
    const newY = parseInt(moveToDialog.y, 10);
    const newZ = parseInt(moveToDialog.z, 10);
    if (isNaN(newX) || isNaN(newY) || isNaN(newZ)) return;

    const cmds = [];

    if (multiIds) {
      const dx = newX - raw.x;
      const dy = newY - raw.y;
      const dz = newZ - raw.z;
      if (moveToDialog.areaId !== raw.area) {
        cmds.push({
          kind: 'moveRoomsToArea' as const,
          roomIds: multiIds,
          fromAreaId: raw.area,
          toAreaId: moveToDialog.areaId,
        });
      }
      for (const id of multiIds) {
        const room = s.map.rooms[id];
        if (!room) continue;
        const toX = room.x + dx;
        const toY = room.y + dy;
        const toZ = room.z + dz;
        if (toX !== room.x || toY !== room.y || toZ !== room.z) {
          cmds.push({
            kind: 'moveRoom' as const,
            id,
            from: { x: room.x, y: room.y, z: room.z },
            to: { x: toX, y: toY, z: toZ },
          });
        }
      }
    } else {
      if (moveToDialog.areaId !== raw.area) {
        cmds.push({
          kind: 'moveRoomsToArea' as const,
          roomIds: [menu.roomId],
          fromAreaId: raw.area,
          toAreaId: moveToDialog.areaId,
        });
      }
      if (newX !== raw.x || newY !== raw.y || newZ !== raw.z) {
        cmds.push({
          kind: 'moveRoom' as const,
          id: menu.roomId,
          from: { x: raw.x, y: raw.y, z: raw.z },
          to: { x: newX, y: newY, z: newZ },
        });
      }
    }

    if (cmds.length > 0) {
      pushBatch(cmds, sceneRef.current);
      sceneRef.current?.refresh();
      store.bumpStructure();
      store.setState({
        status: multiIds
          ? `Moved ${multiIds.length} rooms to area ${moveToDialog.areaId} (${newX}, ${newY}, ${newZ})`
          : `Moved room ${menu.roomId} to area ${moveToDialog.areaId} (${newX}, ${newY}, ${newZ})`,
      });
    }

    const areaChanged = moveToDialog.areaId !== (s.currentAreaId ?? raw.area);
    const zChanged = newZ !== s.currentZ;
    store.setState({
      contextMenu: null,
      currentAreaId: moveToDialog.areaId,
      currentZ: newZ,
      navigateTo: (areaChanged || zChanged) ? { mapX: newX, mapY: -newY } : null,
    });
  };

  const areaOptions = Object.entries(areaNames)
    .map(([id, name]) => ({ id: Number(id), name: name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (moveToDialog) {
    return (
      <div
        ref={ref}
        className="context-menu context-menu-form"
        style={{ left: menu.screenX, top: menu.screenY }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-menu-title">{multiIds ? `Move ${multiIds.length} rooms to` : `Move room ${menu.roomId} to`}</div>
        <div className="context-menu-field">
          <label>Area</label>
          <select
            value={moveToDialog.areaId}
            onChange={(e) => setMoveToDialog((d) => d && { ...d, areaId: Number(e.target.value) })}
          >
            {areaOptions.map(({ id, name }) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        <div className="context-menu-coords">
          <div className="context-menu-field">
            <label>X</label>
            <input
              type="number"
              value={moveToDialog.x}
              onChange={(e) => setMoveToDialog((d) => d && { ...d, x: e.target.value })}
            />
          </div>
          <div className="context-menu-field">
            <label>Y</label>
            <input
              type="number"
              value={moveToDialog.y}
              onChange={(e) => setMoveToDialog((d) => d && { ...d, y: e.target.value })}
            />
          </div>
          <div className="context-menu-field">
            <label>Z</label>
            <input
              type="number"
              value={moveToDialog.z}
              onChange={(e) => setMoveToDialog((d) => d && { ...d, z: e.target.value })}
            />
          </div>
        </div>
        <div className="context-menu-actions">
          <button type="button" className="context-menu-btn" onClick={() => setMoveToDialog(null)}>
            Back
          </button>
          <button type="button" className="context-menu-btn primary" onClick={submitMoveTo}>
            Move
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: menu.screenX, top: menu.screenY }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu-title">Room {menu.roomId}</div>
      <button type="button" className="context-menu-item" onClick={openMoveTo}>
        Move to&hellip;
      </button>
      <button type="button" className="context-menu-item danger" onClick={deleteRoom}>
        Delete room
      </button>
    </div>
  );
}
