import { useState } from 'react';
import { store } from '../../editor/store';
import { pushCommand } from '../../editor/commands';
import { finishCustomLine, restorePendingCustomLine } from '../../editor/tools';
import { snap } from '../../editor/coords';
import type { PendingCustomLine, Direction } from '../../editor/types';
import { CARDINAL_DIRECTIONS } from '../../editor/types';
import { getExit } from '../../editor/mapHelpers';
import type { SceneHandle } from '../../editor/scene';
import type { MudletColor, MudletMap } from '../../mapIO';
import { Field, RoomLink, mudletColorToHex, hexToMudletColor } from '../panelShared';

export function CustomLineDrawPanel({ pending, sceneRef }: {
  pending: PendingCustomLine;
  sceneRef: { current: SceneHandle | null };
}) {
  const updatePending = (patch: Partial<typeof pending>) => store.setState({ pending: { ...pending, ...patch } });
  const colorHex = mudletColorToHex(pending.color);

  const commitAttrPatch = (patch: { color?: MudletColor; style?: number; arrow?: boolean }) => {
    updatePending(patch);
    const scene = sceneRef.current;
    if (!scene) return;
    const rawPoints: [number, number][] = pending.points.slice(1).map(([x, y]) => [x, -y]);
    scene.reader.setCustomLine(
      pending.roomId,
      pending.exitName,
      rawPoints,
      patch.color ?? pending.color,
      patch.style ?? pending.style,
      patch.arrow ?? pending.arrow,
    );
    scene.refresh();
  };

  const cancel = () => {
    if (sceneRef.current) restorePendingCustomLine(pending, sceneRef.current);
    store.setState({ pending: null, activeTool: 'select', status: 'Custom line cancelled.' });
    store.bumpData();
  };

  return (
    <div className="side-panel">
      <div className="panel-content">
      <h3>Custom Line</h3>
      <p className="hint" style={{ marginBottom: 10 }}>
        Drawing on room #{pending.roomId}.<br />
        Click to add waypoints · right-click or Enter to finish · Esc cancels.
      </p>

      <Field label="Exit Name">
        <span className="readonly">{pending.exitName}</span>
      </Field>
      {pending.companion && (
        <p className="hint" style={{ fontSize: 11, margin: '4px 0 8px', color: '#8f97a6' }}>
          Covering both ways — stub on room #{pending.companion.roomId} ({pending.companion.exitName}).
        </p>
      )}
      <div className="cl-form-row" style={{ marginTop: 8 }}>
        <label className="cl-form-label">Color</label>
        <input type="color" value={colorHex} onChange={(e) => commitAttrPatch({ color: hexToMudletColor(e.target.value) })} />
      </div>
      <div className="cl-form-row">
        <label className="cl-form-label">Style</label>
        <select value={pending.style} onChange={(e) => commitAttrPatch({ style: Number(e.target.value) })}>
          <option value={1}>Solid</option>
          <option value={2}>Dash</option>
          <option value={3}>Dot</option>
          <option value={4}>Dash-Dot</option>
          <option value={5}>Dash-Dot-Dot</option>
        </select>
      </div>
      <div className="cl-form-row">
        <label className="cl-form-label">Arrow</label>
        <input type="checkbox" checked={pending.arrow} onChange={(e) => commitAttrPatch({ arrow: e.target.checked })} />
      </div>
      <p style={{ color: '#8f97a6', fontSize: 12, margin: '8px 0' }}>Waypoints: {pending.points.length - 1}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => finishCustomLine(pending)} disabled={pending.points.length < 2} style={{ flex: 1 }}>Finish</button>
        <button type="button" onClick={cancel} style={{ flex: 1 }}>Cancel</button>
      </div>
      </div>
    </div>
  );
}

export function CustomLineSelectPanel({ selection, map, sceneRef }: {
  selection: { kind: 'customLine'; roomId: number; exitName: string };
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
}) {
  const room = map.rooms[selection.roomId];
  const cl = room?.customLines?.[selection.exitName];
  const color = room?.customLinesColor?.[selection.exitName];
  const style = room?.customLinesStyle?.[selection.exitName] ?? 1;
  const arrow = room?.customLinesArrow?.[selection.exitName] ?? false;
  const specialTarget = room?.mSpecialExits?.[selection.exitName];
  const dirTarget = CARDINAL_DIRECTIONS.includes(selection.exitName as Direction) && room
    ? getExit(room, selection.exitName as Direction)
    : undefined;
  const targetRoomId = specialTarget ?? (dirTarget != null && dirTarget > 0 ? dirTarget : undefined);
  const targetRoom = targetRoomId != null ? map.rooms[targetRoomId] : null;

  const [colorHex, setColorHex] = useState(color ? mudletColorToHex(color) : '#ffffff');
  const [styleDraft, setStyleDraft] = useState(style);
  const [arrowDraft, setArrowDraft] = useState(arrow);

  if (!room || !cl) {
    return <h3>Custom line not found</h3>;
  }

  const buildSnapshot = (overrides: Partial<{ color: MudletColor; style: number; arrow: boolean }>) => ({
    points: cl,
    color: overrides.color ?? color ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
    style: overrides.style ?? style,
    arrow: overrides.arrow ?? arrow,
  });

  const previous = { points: cl, color: color ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 }, style, arrow };

  const applyChange = (overrides: Partial<{ color: MudletColor; style: number; arrow: boolean }>) => {
    pushCommand({
      kind: 'setCustomLine',
      roomId: selection.roomId,
      exitName: selection.exitName,
      data: buildSnapshot(overrides),
      previous,
    }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const removeCustomLine = () => {
    pushCommand({
      kind: 'removeCustomLine',
      roomId: selection.roomId,
      exitName: selection.exitName,
      snapshot: previous,
    }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ selection: null, status: `Custom line '${selection.exitName}' removed` });
  };

  const snapToGrid = () => {
    const step = store.getState().gridStep;
    const snapped: [number, number][] = cl.map(([x, y]) => [snap(x, step), -snap(-y, step)]);
    const changed = snapped.some((p, i) => p[0] !== cl[i][0] || p[1] !== cl[i][1]);
    if (!changed) {
      store.setState({ status: `Custom line '${selection.exitName}' already on grid.` });
      return;
    }
    pushCommand({
      kind: 'setCustomLine',
      roomId: selection.roomId,
      exitName: selection.exitName,
      data: { points: snapped, color: color ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 }, style, arrow },
      previous,
    }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Snapped custom line '${selection.exitName}' to grid` });
  };

  return (
    <>
      <h3>Custom Line</h3>
      <div className="link-info">
        <div className="link-info-row">
          <span className="label">Exit</span>
          <span className="readonly">{selection.exitName}</span>
        </div>
        <div className="link-info-row">
          <span className="label">{targetRoom != null ? 'From' : 'Room'}</span>
          <RoomLink id={selection.roomId} name={room.name} />
        </div>
        {targetRoom != null && targetRoomId != null && (
          <div className="link-info-row">
            <span className="label">To</span>
            <RoomLink id={targetRoomId} name={targetRoom.name} />
          </div>
        )}
        <div className="link-info-row">
          <span className="label">Points</span>
          <span className="readonly">{cl.length}</span>
        </div>
      </div>

      <p className="hint" style={{ margin: '8px 0 10px', fontSize: 11 }}>
        Right-click a segment to insert a waypoint · drag a waypoint to move it · Delete to remove
      </p>

      <div className="cl-form" style={{ marginTop: 10 }}>
        <div className="cl-form-row">
          <label className="cl-form-label">Color</label>
          <input
            type="color"
            value={colorHex}
            onChange={(e) => setColorHex(e.target.value)}
            onBlur={(e) => applyChange({ color: hexToMudletColor(e.target.value) })}
          />
        </div>
        <div className="cl-form-row">
          <label className="cl-form-label">Style</label>
          <select
            value={styleDraft}
            onChange={(e) => { const v = Number(e.target.value); setStyleDraft(v); applyChange({ style: v }); }}
          >
            <option value={1}>Solid</option>
            <option value={2}>Dash</option>
            <option value={3}>Dot</option>
            <option value={4}>Dash-Dot</option>
            <option value={5}>Dash-Dot-Dot</option>
          </select>
        </div>
        <div className="cl-form-row">
          <label className="cl-form-label">Arrow</label>
          <input
            type="checkbox"
            checked={arrowDraft}
            onChange={(e) => { setArrowDraft(e.target.checked); applyChange({ arrow: e.target.checked }); }}
          />
        </div>
      </div>

      <button type="button" style={{ marginTop: 12, width: '100%' }} onClick={snapToGrid} disabled={cl.length === 0}>
        Snap to grid
      </button>

      <button type="button" className="link-delete-btn" style={{ marginTop: 8 }} onClick={removeCustomLine}>
        Remove custom line
      </button>
    </>
  );
}
