import { useState } from 'react';
import { store, useEditorState } from '../editor/store';
import { pushBatch, pushCommand } from '../editor/commands';
import { nextAreaId } from '../editor/mapHelpers';
import { CARDINAL_DIRECTIONS, type NeighborEdit } from '../editor/types';
import type { SceneHandle } from '../editor/scene';
import { UserDataEditor } from './panelShared';

interface AreaPanelProps {
  sceneRef: { current: SceneHandle | null };
}

type DeleteConfirm = {
  id: number;
  name: string;
  rooms: number[];
  mode: 'idle' | 'confirming';
  moveTarget: number | '';
};

export function AreaPanel({ sceneRef }: AreaPanelProps) {
  const map = useEditorState((s) => s.map);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [expandedUd, setExpandedUd] = useState<number | null>(null);

  if (!map) return <div className="modal-empty">No map loaded.</div>;

  const areas = Object.entries(map.areaNames)
    .map(([id, name]) => ({ id: Number(id), name: name as string, roomCount: map.areas[Number(id)]?.rooms.length ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = nextAreaId(map);
    pushCommand({ kind: 'addArea', id, name: trimmed }, sceneRef.current);
    store.setState({ currentAreaId: id, currentZ: 0, selection: null, pending: null });
    store.bumpStructure();
    store.setState({ status: `Area '${trimmed}' added (ID ${id})` });
    setNewName('');
  };

  const requestDelete = (id: number, name: string) => {
    const rooms = map.areas[id]?.rooms ?? [];
    if (rooms.length === 0) {
      executeDeleteArea(id, name, []);
    } else {
      setDeleteConfirm({ id, name, rooms, mode: 'confirming', moveTarget: '' });
    }
  };

  const executeDeleteArea = (id: number, name: string, rooms: number[]) => {
    const roomIdSet = new Set(rooms);
    const roomSnapshots: Array<{ id: number; room: any }> = [];
    for (const rid of rooms) {
      const r = map.rooms[rid];
      if (r) roomSnapshots.push({ id: rid, room: { ...r } });
    }
    const crossAreaNeighborEdits: NeighborEdit[] = [];
    const affected = new Set<number>();
    for (const ridStr of Object.keys(map.rooms)) {
      const rid = Number(ridStr);
      if (roomIdSet.has(rid)) continue;
      const r = map.rooms[rid];
      for (const dir of CARDINAL_DIRECTIONS) {
        const to = (r as any)[dir] as number;
        if (typeof to === 'number' && roomIdSet.has(to)) {
          crossAreaNeighborEdits.push({ roomId: rid, dir, was: to });
          affected.add(r.area);
        }
      }
    }
    pushCommand({
      kind: 'deleteAreaWithRooms',
      areaId: id,
      areaName: name,
      areaSnapshot: { ...map.areas[id] },
      rooms: roomSnapshots,
      crossAreaNeighborEdits,
      affectedOtherAreaIds: Array.from(affected),
    }, sceneRef.current);
    const s = store.getState();
    if (s.currentAreaId === id) {
      const remaining = Object.keys(map.areaNames).map(Number).filter((a) => a !== id);
      store.setState({ currentAreaId: remaining[0] ?? null });
    } else {
      sceneRef.current?.refresh();
    }
    store.bumpStructure();
    store.setState({ status: `Area '${name}' and ${rooms.length} rooms deleted` });
    setDeleteConfirm(null);
  };

  const executeMoveRooms = () => {
    if (!deleteConfirm || deleteConfirm.moveTarget === '') return;
    const targetId = Number(deleteConfirm.moveTarget);
    pushBatch([
      { kind: 'moveRoomsToArea', roomIds: [...deleteConfirm.rooms], fromAreaId: deleteConfirm.id, toAreaId: targetId },
      { kind: 'deleteArea', id: deleteConfirm.id, name: deleteConfirm.name },
    ], sceneRef.current);
    const s = store.getState();
    if (s.currentAreaId === deleteConfirm.id) store.setState({ currentAreaId: targetId });
    else sceneRef.current?.refresh();
    store.bumpStructure();
    store.setState({ status: `Moved ${deleteConfirm.rooms.length} rooms to area #${targetId}, deleted '${deleteConfirm.name}'` });
    setDeleteConfirm(null);
  };

  const commitRename = (id: number, from: string) => {
    const trimmed = editDraft.trim();
    if (trimmed && trimmed !== from) {
      pushCommand({ kind: 'renameArea', id, from, to: trimmed }, sceneRef.current);
      store.bumpStructure();
      store.setState({ status: `Renamed area to '${trimmed}'` });
    }
    setEditingId(null);
  };

  const otherAreas = areas.filter((a) => deleteConfirm && a.id !== deleteConfirm.id);

  return (
    <div className="panel-content">
      <div className="modal-add-row">
        <input
          placeholder="New area name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button type="button" onClick={handleAdd} disabled={!newName.trim()}>Add</button>
      </div>

      <div className="modal-list">
        {areas.length === 0 && <div className="modal-empty">No areas.</div>}
        {areas.map(({ id, name, roomCount }) => (
          <div key={id}>
            <div className="modal-list-row">
              {editingId === id ? (
                <input
                  className="modal-inline-edit"
                  value={editDraft}
                  autoFocus
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitRename(id, name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(id, name);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="modal-list-name" onDoubleClick={() => { setEditingId(id); setEditDraft(name); }} title="Double-click to rename">
                  {name}
                </span>
              )}
              <span className="modal-list-meta">#{id} · {roomCount}r</span>
              <div className="modal-list-actions">
                <button type="button" onClick={() => { setEditingId(id); setEditDraft(name); }}>Rename</button>
                <button type="button" onClick={() => setExpandedUd(expandedUd === id ? null : id)} title="Edit user data">UD</button>
                <button type="button" className="danger icon-btn" title="Delete area" onClick={() => requestDelete(id, name)}>✕</button>
              </div>
            </div>

            {expandedUd === id && (
              <div className="area-ud-section">
                <UserDataEditor
                  data={map.areas[id]?.userData ?? {}}
                  onCommit={(key, from, to) => {
                    pushCommand({ kind: 'setAreaUserDataEntry', areaId: id, key, from, to }, sceneRef.current);
                    store.bumpData();
                  }}
                />
              </div>
            )}

            {deleteConfirm?.id === id && deleteConfirm.mode === 'confirming' && (
              <div className="area-delete-confirm">
                <p><strong>{name}</strong> has {deleteConfirm.rooms.length} room{deleteConfirm.rooms.length !== 1 ? 's' : ''}. Choose:</p>
                <div className="area-delete-actions">
                  <button
                    type="button"
                    className="danger"
                    onClick={() => executeDeleteArea(id, name, deleteConfirm.rooms)}
                  >
                    Delete all rooms &amp; area
                  </button>
                  <div className="area-move-row">
                    <select
                      value={deleteConfirm.moveTarget}
                      onChange={(e) => setDeleteConfirm({ ...deleteConfirm, moveTarget: e.target.value === '' ? '' : Number(e.target.value) })}
                    >
                      <option value="">Move rooms to…</option>
                      {otherAreas.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} (#{a.id})</option>
                      ))}
                    </select>
                    <button type="button" onClick={executeMoveRooms} disabled={deleteConfirm.moveTarget === ''}>Move &amp; delete</button>
                  </div>
                  <button type="button" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
