import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState } from '../editor/store';
import { pushCommand, buildDeleteNeighborEdits, buildDeleteNeighborEditsForMany, pushBatch, buildCustomLineMoveCommands } from '../editor/commands';
import { hitToSelection, hitStatusLabel } from '../editor/tools';
import type { HitItem } from '../editor/types';
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

interface MoveLabelToState {
  x: string;
  y: string;
  z: string;
}

export function ContextMenu({ sceneRef }: ContextMenuProps) {
  const { t } = useTranslation('context');
  const menu = useEditorState((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement | null>(null);
  const [moveToDialog, setMoveToDialog] = useState<MoveToState | null>(null);
  const [moveLabelToDialog, setMoveLabelToDialog] = useState<MoveLabelToState | null>(null);
  void moveLabelToDialog;

  useEffect(() => {
    if (!menu) {
      setMoveToDialog(null);
      setMoveLabelToDialog(null);
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
      status: t('menu.removedWaypoint', { exit: menu.exitName, id: menu.roomId }),
    });
  };

  // ── Disambiguate menu ─────────────────────────────────────────────────────

  if (menu.kind === 'disambiguate') {
    const s = store.getState();
    const selectHit = (hit: HitItem) => {
      if (hit.kind === 'room') {
        store.setState({
          selection: hitToSelection(hit),
          contextMenu: { kind: 'room', roomId: hit.id, screenX: menu.screenX, screenY: menu.screenY },
          sidebarTab: 'selection',
        });
      } else if (hit.kind === 'label') {
        store.setState({
          selection: hitToSelection(hit),
          contextMenu: { kind: 'label', areaId: hit.areaId, labelId: hit.id, screenX: menu.screenX, screenY: menu.screenY },
          sidebarTab: 'selection',
        });
      } else {
        store.setState({
          selection: hitToSelection(hit),
          contextMenu: null,
          sidebarTab: 'selection',
          status: `Selected ${hitStatusLabel(hit)}`,
        });
      }
    };
    const displayLabel = (hit: HitItem): string => {
      if (hit.kind === 'room') {
        const name = s.map?.rooms[hit.id]?.name;
        return name && String(hit.id) !== name ? `Room ${hit.id}: ${name}` : `Room ${hit.id}`;
      }
      if (hit.kind === 'label') {
        const snap = sceneRef.current?.reader.getLabelSnapshot(hit.areaId, hit.id);
        const text = snap?.text?.trim();
        return text ? `Label: "${text.length > 24 ? text.slice(0, 24) + '…' : text}"` : `Label ${hit.id}`;
      }
      return hitStatusLabel(hit);
    };
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: menu.screenX, top: menu.screenY }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-menu-title">{t('menu.select')}</div>
        {menu.hits.map((hit, i) => (
          <button
            key={i}
            type="button"
            className="context-menu-item"
            onClick={() => selectHit(hit)}
          >
            {displayLabel(hit)}
          </button>
        ))}
      </div>
    );
  }

  if (menu.kind === 'customLinePoint') {
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: menu.screenX, top: menu.screenY }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button type="button" className="context-menu-item danger" onClick={deletePoint}>
          {t('menu.deleteWaypoint')}
        </button>
      </div>
    );
  }

  // ── Label context menu ────────────────────────────────────────────────────

  if (menu.kind === 'label') {
    const snap = sceneRef.current?.reader.getLabelSnapshot(menu.areaId, menu.labelId);

    const openLabelMoveTo = () => {
      if (!snap) return;
      setMoveLabelToDialog({ x: String(snap.pos[0]), y: String(snap.pos[1]), z: String(snap.pos[2]) });
    };

    const deleteLabel = () => {
      if (!snap) return close();
      pushCommand({ kind: 'deleteLabel', areaId: menu.areaId, label: snap }, sceneRef.current);
      sceneRef.current?.refresh();
      store.bumpData();
      const sel = store.getState().selection;
      if (sel?.kind === 'label' && sel.id === menu.labelId) {
        store.setState({ selection: null });
      }
      store.setState({ status: t('menu.deletedLabel', { id: menu.labelId }), contextMenu: null });
    };

    const submitLabelMoveTo = () => {
      if (!moveLabelToDialog || !snap) return;
      const newX = parseInt(moveLabelToDialog.x, 10);
      const newY = parseInt(moveLabelToDialog.y, 10);
      const newZ = parseInt(moveLabelToDialog.z, 10);
      if (isNaN(newX) || isNaN(newY) || isNaN(newZ)) return;
      if (newX !== snap.pos[0] || newY !== snap.pos[1] || newZ !== snap.pos[2]) {
        pushCommand({
          kind: 'moveLabel',
          areaId: menu.areaId,
          id: menu.labelId,
          from: [snap.pos[0], snap.pos[1], snap.pos[2]],
          to: [newX, newY, newZ],
        }, sceneRef.current);
        sceneRef.current?.refresh();
        store.bumpData();
        store.setState({ status: t('menu.movedLabel', { id: menu.labelId, x: newX, y: newY, z: newZ }) });
      }
      store.setState({ contextMenu: null });
    };

    if (moveLabelToDialog) {
      return (
        <div
          ref={ref}
          className="context-menu context-menu-form"
          style={{ left: menu.screenX, top: menu.screenY }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="context-menu-title">{t('menu.moveLabelTo', { id: menu.labelId })}</div>
          <div className="context-menu-coords">
            <div className="context-menu-field">
              <label>X</label>
              <input
                type="number"
                value={moveLabelToDialog.x}
                onChange={(e) => setMoveLabelToDialog((d) => d && { ...d, x: e.target.value })}
              />
            </div>
            <div className="context-menu-field">
              <label>Y</label>
              <input
                type="number"
                value={moveLabelToDialog.y}
                onChange={(e) => setMoveLabelToDialog((d) => d && { ...d, y: e.target.value })}
              />
            </div>
            <div className="context-menu-field">
              <label>Z</label>
              <input
                type="number"
                value={moveLabelToDialog.z}
                onChange={(e) => setMoveLabelToDialog((d) => d && { ...d, z: e.target.value })}
              />
            </div>
          </div>
          <div className="context-menu-actions">
            <button type="button" className="context-menu-btn" onClick={() => setMoveLabelToDialog(null)}>
              {t('menu.back')}
            </button>
            <button type="button" className="context-menu-btn primary" onClick={submitLabelMoveTo}>
              {t('menu.move')}
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
        <div className="context-menu-title">{t('menu.labelTitle', { id: menu.labelId })}</div>
        <button type="button" className="context-menu-item" onClick={openLabelMoveTo}>
          {t('menu.moveTo')}
        </button>
        <button type="button" className="context-menu-item danger" onClick={deleteLabel}>
          {t('menu.deleteLabel')}
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
    if (multiIds) {
      const neighborEditsMap = buildDeleteNeighborEditsForMany(st.map, multiIds);
      const cmds = multiIds.map(id => {
        const room = st.map!.rooms[id];
        return {
          kind: 'deleteRoom' as const,
          id,
          room: { ...room },
          areaId: room.area,
          neighborEdits: neighborEditsMap.get(id) ?? [],
        };
      });
      pushCommand({ kind: 'batch', cmds }, sceneRef.current);
      sceneRef.current?.refresh();
      store.bumpStructure();
      store.setState({ selection: null, status: t('menu.deletedRooms', { count: multiIds.length }), contextMenu: null });
      return;
    }
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
    const curSel = store.getState().selection;
    if (curSel?.kind === 'room' && curSel.ids.includes(menu.roomId)) {
      store.setState({ selection: null });
    }
    store.setState({ status: t('menu.deletedRoom', { id: menu.roomId }), contextMenu: null });
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
        cmds.push(...buildCustomLineMoveCommands(s.map, id, dx, dy));
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
      const dx = newX - raw.x;
      const dy = newY - raw.y;
      if (newX !== raw.x || newY !== raw.y || newZ !== raw.z) {
        cmds.push({
          kind: 'moveRoom' as const,
          id: menu.roomId,
          from: { x: raw.x, y: raw.y, z: raw.z },
          to: { x: newX, y: newY, z: newZ },
        });
      }
      cmds.push(...buildCustomLineMoveCommands(s.map, menu.roomId, dx, dy));
    }

    if (cmds.length > 0) {
      pushBatch(cmds, sceneRef.current);
      sceneRef.current?.refresh();
      store.bumpStructure();
      store.setState({
        status: multiIds
          ? t('menu.movedRooms', { count: multiIds.length, areaId: moveToDialog.areaId, x: newX, y: newY, z: newZ })
          : t('menu.movedRoom', { id: menu.roomId, areaId: moveToDialog.areaId, x: newX, y: newY, z: newZ }),
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
        <div className="context-menu-title">
          {multiIds ? t('menu.moveRoomsTo', { count: multiIds.length }) : t('menu.moveRoomTo', { id: menu.roomId })}
        </div>
        <div className="context-menu-field">
          <label>{t('menu.area')}</label>
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
            {t('menu.back')}
          </button>
          <button type="button" className="context-menu-btn primary" onClick={submitMoveTo}>
            {t('menu.move')}
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
      <div className="context-menu-title">
        {multiIds ? t('menu.roomsTitle', { count: multiIds.length }) : t('menu.roomTitle', { id: menu.roomId })}
      </div>
      <button type="button" className="context-menu-item" onClick={openMoveTo}>
        {t('menu.moveTo')}
      </button>
      {multiIds && (
        <>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => store.setState({ spreadShrink: { mode: 'spread', factor: 2, centerMode: 'centroid', anchorRoomId: null }, contextMenu: null })}
          >
            {t('menu.spread')}
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => store.setState({ spreadShrink: { mode: 'shrink', factor: 0.5, centerMode: 'centroid', anchorRoomId: null }, contextMenu: null })}
          >
            {t('menu.shrink')}
          </button>
        </>
      )}
      <button type="button" className="context-menu-item danger" onClick={deleteRoom}>
        {multiIds ? t('menu.deleteRooms', { count: multiIds.length }) : t('menu.deleteRoom')}
      </button>
    </div>
  );
}
