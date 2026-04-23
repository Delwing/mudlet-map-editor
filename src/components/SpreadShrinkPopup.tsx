import { useEffect, useRef } from 'react';
import { store, useEditorState } from '../editor/store';
import { pushBatch, buildCustomLineMoveCommands } from '../editor/commands';
import type { SceneHandle } from '../editor/scene';
import type { Command } from '../editor/types';

interface SpreadShrinkPopupProps {
  sceneRef: { current: SceneHandle | null };
}

export function SpreadShrinkPopup({ sceneRef }: SpreadShrinkPopupProps) {
  const spreadShrink = useEditorState((s) => s.spreadShrink);
  const selection = useEditorState((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!spreadShrink) return;
    const cancel = () => store.setState({ spreadShrink: null });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // right-clicks are handled by the contextmenu event
      if (ref.current && !ref.current.contains(e.target as Node)) cancel();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [spreadShrink]);

  if (!spreadShrink || !selection || selection.kind !== 'room') return null;

  const { mode, factor, centerMode, anchorRoomId } = spreadShrink;

  const setMode = (m: 'spread' | 'shrink') => {
    store.setState({ spreadShrink: { ...spreadShrink, mode: m, factor: m === 'spread' ? 2.0 : 0.5 } });
  };

  const setCenterMode = (cm: 'centroid' | 'anchor') => {
    store.setState({ spreadShrink: { ...spreadShrink, centerMode: cm, anchorRoomId: null } });
  };

  const setFactor = (raw: string) => {
    const v = parseFloat(raw);
    if (!isNaN(v) && v > 0) store.setState({ spreadShrink: { ...spreadShrink, factor: v } });
  };

  const apply = () => {
    const state = store.getState();
    const sel = state.selection;
    const scene = sceneRef.current;
    if (!sel || sel.kind !== 'room' || !scene || !state.map) return;

    const rooms: { id: number; rx: number; ry: number }[] = [];
    for (const id of sel.ids) {
      const room = scene.getRenderRoom(id);
      if (!room || room.z !== state.currentZ || room.area !== state.currentAreaId) continue;
      rooms.push({ id, rx: room.x, ry: room.y });
    }
    if (rooms.length < 2) { store.setState({ spreadShrink: null }); return; }

    const ss = state.spreadShrink!;
    let cx: number, cy: number;
    if (ss.centerMode === 'anchor' && ss.anchorRoomId !== null) {
      const anchor = scene.getRenderRoom(ss.anchorRoomId);
      cx = anchor ? anchor.x : rooms.reduce((s, r) => s + r.rx, 0) / rooms.length;
      cy = anchor ? anchor.y : rooms.reduce((s, r) => s + r.ry, 0) / rooms.length;
    } else {
      cx = rooms.reduce((s, r) => s + r.rx, 0) / rooms.length;
      cy = rooms.reduce((s, r) => s + r.ry, 0) / rooms.length;
    }

    const snapV = state.snapToGrid
      ? (v: number) => Math.round(v / state.gridStep) * state.gridStep
      : (v: number) => v;

    const cmds: Command[] = [];
    for (const { id, rx, ry } of rooms) {
      const newRX = snapV(cx + (rx - cx) * factor);
      const newRY = snapV(cy + (ry - cy) * factor);
      const raw = state.map.rooms[id];
      if (!raw) continue;
      const toX = newRX;
      const toY = -newRY;
      if (toX === raw.x && toY === raw.y) continue;
      cmds.push({ kind: 'moveRoom', id, from: { x: raw.x, y: raw.y, z: raw.z }, to: { x: toX, y: toY, z: raw.z } });
      cmds.push(...buildCustomLineMoveCommands(state.map, id, toX - raw.x, toY - raw.y));
    }

    if (cmds.length > 0) {
      pushBatch(cmds, scene);
      scene.refresh();
      store.bumpStructure();
      store.setState({ status: `${mode === 'spread' ? 'Spread' : 'Shrunk'} ${rooms.length} rooms (×${factor.toFixed(2)})` });
    }
    store.setState({ spreadShrink: null });
  };

  return (
    <div ref={ref} className="spread-shrink-popup" onContextMenu={(e) => e.preventDefault()}>
      <div className="spread-shrink-title">
        {mode === 'spread' ? 'Spread' : 'Shrink'} {selection.ids.length} rooms
      </div>
      <div className="spread-shrink-mode">
        <button type="button" className={`spread-shrink-tab${mode === 'spread' ? ' active' : ''}`} onClick={() => setMode('spread')}>
          Spread
        </button>
        <button type="button" className={`spread-shrink-tab${mode === 'shrink' ? ' active' : ''}`} onClick={() => setMode('shrink')}>
          Shrink
        </button>
      </div>
      <div className="spread-shrink-mode">
        <button type="button" className={`spread-shrink-tab${centerMode === 'centroid' ? ' active' : ''}`} onClick={() => setCenterMode('centroid')}>
          Centroid
        </button>
        <button type="button" className={`spread-shrink-tab${centerMode === 'anchor' ? ' active' : ''}`} onClick={() => setCenterMode('anchor')}>
          Anchor
        </button>
      </div>
      {centerMode === 'anchor' && (
        <div className="spread-shrink-anchor">
          {anchorRoomId === null
            ? <span className="spread-shrink-anchor-hint">Right-click a room to set anchor</span>
            : (
              <>
                <span>Anchor: room {anchorRoomId}</span>
                <button type="button" className="spread-shrink-anchor-clear" onClick={() => setCenterMode('anchor')}>×</button>
              </>
            )
          }
        </div>
      )}
      <div className="spread-shrink-field">
        <label>Scale factor</label>
        <input
          type="number"
          min="0.01"
          max="10"
          step="0.1"
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
        />
      </div>
      <div className="spread-shrink-actions">
        <button type="button" className="context-menu-btn" onClick={() => store.setState({ spreadShrink: null })}>
          Cancel
        </button>
        <button type="button" className="context-menu-btn primary" onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
