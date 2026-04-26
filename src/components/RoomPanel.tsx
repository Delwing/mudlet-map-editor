import { Fragment, useEffect, useRef, useState } from 'react';
import { store, useEditorState } from '../editor/store';
import { registerSpecialExitPickCb } from '../editor/tools';
import { pushCommand, pushBatch } from '../editor/commands';
import { normalizeCustomLineKey, OPPOSITE, DIR_SHORT, DIR_INDEX, SHORT_TO_DIR, type CustomLineCompanion, type Direction } from '../editor/types';
import type { SceneHandle } from '../editor/scene';
import type { MudletMap } from '../mapIO';
import type { RoomPanelSection } from '../editor/plugin';
import { EnvPicker } from './EnvPicker';
import { DoorIcon, LockIcon, WeightIcon, CrosshairIcon, CenterOnRoomIcon } from './icons';
import { RoomLink, Field, UserDataEditor, hexToMudletColor } from './panelShared';

const EXIT_DIRS = [
  'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest',
  'up', 'down', 'in', 'out',
] as const;

const COMPASS_GRID = [
  ['northwest', 'north',  'northeast'],
  ['west',       null,    'east'     ],
  ['southwest', 'south',  'southeast'],
] as (string | null)[][];

const VERTICAL_GRID = [
  ['up', null, 'down'],
  ['in', null, 'out'],
] as (string | null)[][];

const DIR_ABBREV: Record<string, string> = {
  north: 'N', northeast: 'NE', east: 'E', southeast: 'SE',
  south: 'S', southwest: 'SW', west: 'W', northwest: 'NW',
  up: 'Up', down: 'Dn', in: 'In', out: 'Out',
};

const DOOR_TITLES = ['No door (click to set)', 'Open door', 'Closed door', 'Locked door'];
const DOOR_CLASSES = ['', 'door-open', 'door-closed', 'door-locked'];

interface RoomPanelProps {
  selection: { kind: 'room'; ids: number[] };
  room: NonNullable<MudletMap['rooms'][number]>;
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
  pluginSections?: RoomPanelSection[];
}

function lookupRoomHash(map: MudletMap, id: number, room: NonNullable<MudletMap['rooms'][number]>): string {
  const raw = (room as any).hash;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  for (const [h, rid] of Object.entries(map.mpRoomDbHashToRoomId ?? {})) {
    if (rid === id) return h;
  }
  return '';
}

export function RoomPanel({ selection, room, map, sceneRef, pluginSections = [] }: RoomPanelProps) {
  const selId = selection.ids[0];
  const pending = useEditorState((s) => s.pending);

  const [nameDraft, setNameDraft] = useState(room.name ?? '');
  const [weightDraft, setWeightDraft] = useState(String(room.weight ?? 1));
  const [symbolDraft, setSymbolDraft] = useState(room.symbol ?? '');
  const [hashDraft, setHashDraft] = useState(() => lookupRoomHash(map, selId, room));
  const [symbolColor, setSymbolColor] = useState<string | null>(room.userData?.['system.fallback_symbol_color'] ?? null);
  const [envPickerOpen, setEnvPickerOpen] = useState(false);
  const [specialExitName, setSpecialExitName] = useState('');
  const [specialExitTarget, setSpecialExitTarget] = useState('');
  const [exitDrafts, setExitDrafts] = useState<Record<string, string>>({});
  const [lineFormFor, setLineFormFor] = useState<string | null>(null);
  const [clColor, setClColor] = useState('#ffffff');
  const [clStyle, setClStyle] = useState(1);
  const [clArrow, setClArrow] = useState(false);
  const [clBothWays, setClBothWays] = useState(false);

  // Register a direct callback so pickSpecialExit can fill the target field
  // synchronously without going through the React effect cycle.
  const setSpecialExitTargetRef = useRef(setSpecialExitTarget);
  setSpecialExitTargetRef.current = setSpecialExitTarget;
  useEffect(() => {
    registerSpecialExitPickCb((id) => setSpecialExitTargetRef.current(String(id)));
    return () => registerSpecialExitPickCb(null);
  }, []);

  const nameDraftRef = useRef(nameDraft);
  nameDraftRef.current = nameDraft;
  const weightDraftRef = useRef(weightDraft);
  weightDraftRef.current = weightDraft;
  const symbolDraftRef = useRef(symbolDraft);
  symbolDraftRef.current = symbolDraft;
  const hashDraftRef = useRef(hashDraft);
  hashDraftRef.current = hashDraft;

  useEffect(() => {
    const prevRoom = room;
    const prevId = selId;
    const prevHash = lookupRoomHash(map, prevId, prevRoom);
    return () => {
      let changed = false;
      const sym = symbolDraftRef.current;
      if (sym !== prevRoom.symbol) {
        pushCommand({ kind: 'setRoomField', id: prevId, field: 'symbol', from: prevRoom.symbol, to: sym }, sceneRef.current);
        changed = true;
      }
      const name = nameDraftRef.current;
      if (name !== prevRoom.name) {
        pushCommand({ kind: 'setRoomField', id: prevId, field: 'name', from: prevRoom.name, to: name }, sceneRef.current);
        changed = true;
      }
      const w = Number(weightDraftRef.current);
      if (!Number.isNaN(w) && w !== prevRoom.weight) {
        pushCommand({ kind: 'setRoomField', id: prevId, field: 'weight', from: prevRoom.weight, to: w }, sceneRef.current);
        changed = true;
      }
      const hashNext = hashDraftRef.current.trim();
      if (hashNext !== prevHash) {
        pushCommand({ kind: 'setRoomHash', id: prevId, from: prevHash || null, to: hashNext || null }, sceneRef.current);
        changed = true;
      }
      if (changed) { sceneRef.current?.refresh(); store.bumpData(); }
    };
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNameDraft(room.name ?? '');
    setWeightDraft(String(room.weight ?? 1));
    setSymbolDraft(room.symbol ?? '');
    setHashDraft(lookupRoomHash(map, selId, room));
    setSymbolColor(room.userData?.['system.fallback_symbol_color'] ?? null);
    setEnvPickerOpen(false);
    setSpecialExitName('');
    setSpecialExitTarget('');
    setExitDrafts({});
    setLineFormFor(null);
    setClBothWays(false);
    const p = store.getState().pending;
    if (p?.kind === 'pickExit' || p?.kind === 'pickSpecialExit') store.setState({ pending: null });
  }, [room]);

  const commit = (field: 'name' | 'weight' | 'environment' | 'symbol', raw: string) => {
    const current = (room as any)[field];
    let next: string | number = raw;
    if (field === 'weight' || field === 'environment') {
      const n = Number(raw);
      if (Number.isNaN(n)) return;
      next = n;
    }
    if (next === current) return;
    pushCommand({ kind: 'setRoomField', id: selId, field, from: current, to: next }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Updated ${field} on room ${selId}` });
  };

  const commitHash = (raw: string) => {
    const next = raw.trim();
    const current = lookupRoomHash(map, selId, room);
    if (next === current) return;
    pushCommand({ kind: 'setRoomHash', id: selId, from: current || null, to: next || null }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: next ? `Room ${selId} hash → ${next}` : `Room ${selId} hash cleared` });
  };

  const handleEnvSelect = (envId: number) => {
    if (envId === room.environment) return;
    pushCommand({ kind: 'setRoomField', id: selId, field: 'environment', from: room.environment, to: envId }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Room ${selId} environment → ${envId}` });
  };

  const commitSymbolColor = (hex: string | null) => {
    const key = 'system.fallback_symbol_color';
    const from = room.userData?.[key] ?? null;
    const to = hex;
    if (from === to) return;
    pushCommand({ kind: 'setUserDataEntry', roomId: selId, key, from, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const addExit = (dir: Direction, toId: number) => {
    if (!map.rooms[toId]) return;
    const previous = (room as any)[dir] as number;
    pushCommand({ kind: 'addExit', fromId: selId, dir, toId, previous, reverse: null }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Exit ${dir} → room ${toId} added.` });
  };

  const changeDoor = (dir: Direction, from: number, to: number) => {
    pushCommand({ kind: 'setDoor', roomId: selId, dir, from, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const changeWeight = (dir: Direction, from: number, to: number) => {
    if (from === to) return;
    pushCommand({ kind: 'setExitWeight', roomId: selId, dir, from, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const toggleExitLock = (dir: Direction, current: boolean) => {
    pushCommand({ kind: 'setExitLock', roomId: selId, dir, lock: !current }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const deleteExit = (dir: Direction, hasExit: boolean, targetId: number, isStub: boolean) => {
    if (hasExit) {
      pushCommand({ kind: 'removeExit', fromId: selId, dir, was: targetId, reverse: null }, sceneRef.current);
    } else if (isStub) {
      pushCommand({ kind: 'setStub', roomId: selId, dir, stub: false }, sceneRef.current);
    }
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const toggleStub = (dir: Direction, currentStub: boolean, targetId: number) => {
    if (currentStub) {
      pushCommand({ kind: 'setStub', roomId: selId, dir, stub: false }, sceneRef.current);
    } else if (targetId !== -1) {
      pushBatch([
        { kind: 'removeExit', fromId: selId, dir, was: targetId, reverse: null },
        { kind: 'setStub', roomId: selId, dir, stub: true },
      ], sceneRef.current);
    } else {
      pushCommand({ kind: 'setStub', roomId: selId, dir, stub: true }, sceneRef.current);
    }
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const addSpecialExit = () => {
    const name = specialExitName.trim();
    const toId = parseInt(specialExitTarget, 10);
    if (!name || Number.isNaN(toId) || toId <= 0) return;
    pushCommand({ kind: 'addSpecialExit', roomId: selId, name, toId }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Special exit '${name}' → ${toId} added` });
    setSpecialExitName('');
    setSpecialExitTarget('');
  };

  const removeSpecialExit = (name: string, toId: number) => {
    pushCommand({ kind: 'removeSpecialExit', roomId: selId, name, toId }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Special exit '${name}' removed` });
  };

  const changeSpecialDoor = (name: string, from: number, to: number) => {
    pushCommand({ kind: 'setSpecialExitDoor', roomId: selId, name, from, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const changeSpecialWeight = (name: string, from: number, to: number) => {
    if (from === to) return;
    pushCommand({ kind: 'setSpecialExitWeight', roomId: selId, name, from, to }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
  };

  const removeCustomLine = (exitName: string) => {
    const r = map.rooms[selId];
    if (!r?.customLines?.[exitName]) return;
    pushCommand({
      kind: 'removeCustomLine',
      roomId: selId,
      exitName,
      snapshot: {
        points: r.customLines[exitName],
        color: r.customLinesColor?.[exitName] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
        style: r.customLinesStyle?.[exitName] ?? 1,
        arrow: r.customLinesArrow?.[exitName] ?? false,
      },
    }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Custom line '${exitName}' removed` });
  };

  const startDrawingCustomLine = (rawExitName: string) => {
    const name = rawExitName.trim();
    if (!name) { store.setState({ status: 'Enter exit name first.' }); return; }
    const scene = sceneRef.current;
    const renderRoom = scene?.reader.getRoom(selId);
    if (!scene || !renderRoom) return;
    const key = normalizeCustomLineKey(name);
    const raw = map.rooms[selId];
    const previousSnapshot = raw?.customLines?.[key]
      ? {
          points: raw.customLines[key],
          color: raw.customLinesColor?.[key] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
          style: raw.customLinesStyle?.[key] ?? 1,
          arrow: raw.customLinesArrow?.[key] ?? false,
        }
      : null;
    const color = hexToMudletColor(clColor);

    let companion: CustomLineCompanion | null = null;
    const fullDir = SHORT_TO_DIR[key];
    if (clBothWays && fullDir) {
      const partnerId = (raw as any)?.[fullDir] as number | undefined;
      if (partnerId !== undefined && partnerId !== -1) {
        const partnerRaw = map.rooms[partnerId];
        const oppositeFull = OPPOSITE[fullDir];
        if (partnerRaw && (partnerRaw as any)[oppositeFull] === selId) {
          const oppositeKey = DIR_SHORT[oppositeFull];
          const partnerPrev = partnerRaw.customLines?.[oppositeKey]
            ? {
                points: partnerRaw.customLines[oppositeKey],
                color: partnerRaw.customLinesColor?.[oppositeKey] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
                style: partnerRaw.customLinesStyle?.[oppositeKey] ?? 1,
                arrow: partnerRaw.customLinesArrow?.[oppositeKey] ?? false,
              }
            : null;
          companion = { roomId: partnerId, exitName: oppositeKey, previousSnapshot: partnerPrev };
          scene.reader.setCustomLine(partnerId, oppositeKey, [], color, clStyle, false);
        }
      }
    }

    scene.reader.setCustomLine(selId, key, [], color, clStyle, clArrow);
    scene.refresh();
    store.setState({
      activeTool: 'customLine',
      pending: {
        kind: 'customLine',
        roomId: selId,
        exitName: key,
        color,
        style: clStyle,
        arrow: clArrow,
        points: [[renderRoom.x, renderRoom.y]],
        cursor: null,
        previousSnapshot,
        companion,
      },
      status: 'Click canvas to add waypoints · double-click or Enter to finish · Esc cancels',
    });
    store.bumpData();
    setLineFormFor(null);
  };

  const customLineInfo = (rawName: string) => {
    const key = normalizeCustomLineKey(rawName);
    const pts = room.customLines?.[key];
    if (!pts) return null;
    return { key, color: room.customLinesColor?.[key] };
  };

  const handleLineButton = (rawName: string) => {
    const info = customLineInfo(rawName);
    if (info) {
      store.setState({ selection: { kind: 'customLine', roomId: selId, exitName: info.key } });
      return;
    }
    setClColor('#ffffff');
    setClStyle(1);
    setClArrow(false);
    setClBothWays(false);
    setLineFormFor(rawName);
  };

  const renderLineForm = (exitName: string) => (
    <div className="cl-form cl-form-inline">
      <div className="cl-form-row">
        <label className="cl-form-label">Color</label>
        <input type="color" value={clColor} onChange={(e) => setClColor(e.target.value)} />
      </div>
      <div className="cl-form-row">
        <label className="cl-form-label">Style</label>
        <select value={clStyle} onChange={(e) => setClStyle(Number(e.target.value))}>
          <option value={1}>Solid</option>
          <option value={2}>Dash</option>
          <option value={3}>Dot</option>
          <option value={4}>Dash-Dot</option>
          <option value={5}>Dash-Dot-Dot</option>
        </select>
      </div>
      <div className="cl-form-row">
        <label className="cl-form-label">Arrow</label>
        <input type="checkbox" checked={clArrow} onChange={(e) => setClArrow(e.target.checked)} />
      </div>
      <div className="cl-form-row" title="Also hide the default line on the partner room (only applies to reciprocal cardinal exits)">
        <label className="cl-form-label">Both ways</label>
        <input type="checkbox" checked={clBothWays} onChange={(e) => setClBothWays(e.target.checked)} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="button" onClick={() => startDrawingCustomLine(exitName)} style={{ flex: 1 }}>
          Start Drawing
        </button>
        <button type="button" onClick={() => setLineFormFor(null)}>Cancel</button>
      </div>
    </div>
  );

  const renderCell = (dir: string) => {
    const d = dir as Direction;
    const v = (room as any)[dir] as number;
    const hasExit = v !== -1;
    const dirKey = DIR_SHORT[d];
    const dirIdx = DIR_INDEX[d];
    const isStub = room.stubs?.includes(dirIdx) ?? false;
    const isActive = hasExit || isStub;
    const doorState = room.doors?.[dirKey] ?? 0;
    const exitWeight = room.exitWeights?.[dirKey] ?? 1;
    const isLocked = room.exitLocks?.includes(dirIdx) ?? false;
    const hasCustomLine = !!room.customLines?.[dirKey];
    const isPicking = pending?.kind === 'pickExit' && pending.fromId === selId && pending.dir === d;
    return (
      <div key={dir} className={`compass-cell${isActive ? ' has-exit' : ''}${lineFormFor === dir ? ' active' : ''}${isPicking ? ' picking-exit' : ''}`}>
        <div className="cc-header">
          <span className="cc-label">{DIR_ABBREV[dir]}</span>
          <span className="cc-header-btn-slot">
            {isActive && (
              <button
                type="button"
                className={`exit-line-btn${hasCustomLine ? ' has-line' : ''}`}
                onClick={() => handleLineButton(dir)}
                title={hasCustomLine ? 'Edit custom line' : 'Draw custom line'}
              >
                {hasCustomLine
                  ? (() => { const c = room.customLinesColor?.[dirKey]; const rgb = c ? `rgb(${c.r},${c.g},${c.b})` : '#fff'; return <span className="cl-swatch" style={{ background: rgb }} />; })()
                  : <span className="exit-line-icon">∿</span>
                }
              </button>
            )}
            <button
              type="button"
              className={`cc-icon-btn cc-stub-btn${isStub ? ' stub-active' : ''}`}
              title={isStub ? 'Remove stub' : hasExit ? 'Convert to stub' : 'Add stub'}
              onClick={() => toggleStub(d, isStub, v)}
            >S</button>
            {isActive && (
              <button
                type="button"
                className="cc-icon-btn cc-delete-btn"
                title={hasExit ? 'Remove exit' : 'Remove stub'}
                onClick={() => deleteExit(d, hasExit, v, isStub)}
              >×</button>
            )}
          </span>
        </div>
        <div className="cc-middle">
          {hasExit && <RoomLink id={v} className="cc-target" />}
          {isStub && !hasExit && <span className="cc-stub-label">stub</span>}
          {!isActive && (
            <div className="cc-exit-add">
              <input
                type="number"
                className="cc-exit-input"
                placeholder="#"
                value={exitDrafts[dir] ?? ''}
                onChange={(e) => setExitDrafts((prev) => ({ ...prev, [dir]: e.target.value }))}
                onBlur={(e) => {
                  const id = parseInt(e.target.value, 10);
                  if (!isNaN(id)) { addExit(d, id); setExitDrafts((prev) => ({ ...prev, [dir]: '' })); }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <button
                type="button"
                className={`cc-pick-btn${isPicking ? ' picking' : ''}`}
                title={isPicking ? 'Click a room on the map (Esc to cancel)' : 'Pick target room from map'}
                onClick={() => store.setState(isPicking ? { pending: null } : { pending: { kind: 'pickExit', fromId: selId, dir: d } })}
              >
                <CrosshairIcon />
              </button>
            </div>
          )}
        </div>
        <div className="cc-footer">
          <button
            type="button"
            className={`cc-door-btn ${DOOR_CLASSES[doorState]}${!isActive ? ' cc-dim' : ''}`}
            title={isActive ? DOOR_TITLES[doorState] : undefined}
            disabled={!isActive}
            onClick={isActive ? () => changeDoor(d, doorState, (doorState + 1) % 4) : undefined}
          >
            <DoorIcon />
          </button>
          <button
            type="button"
            className={`cc-icon-btn${isLocked ? ' lock-active' : ''}${!isActive ? ' cc-dim' : ''}`}
            title={isActive ? (isLocked ? 'Locked — click to unlock' : 'Unlocked — click to lock') : undefined}
            disabled={!isActive}
            onClick={isActive ? () => toggleExitLock(d, isLocked) : undefined}
          ><LockIcon locked={isLocked} /></button>
          <span className={`cc-weight-wrap${!isActive ? ' cc-dim' : ''}`}>
            <WeightIcon />
            <input
              key={`${selId}-${dir}-${exitWeight}`}
              type="number"
              className="cc-weight"
              min={1}
              defaultValue={exitWeight}
              disabled={!isActive}
              title="Exit weight"
              onBlur={(e) => changeWeight(d, exitWeight, Math.max(1, parseInt(e.target.value, 10) || 1))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </span>
        </div>
      </div>
    );
  };

  const envColor = sceneRef.current?.reader.getColorValue(room.environment) ?? 'rgb(114,1,0)';
  const specialExits = Object.entries(room.mSpecialExits ?? {});
  const customLineEntries = Object.entries(room.customLines ?? {});

  return (
    <div className="panel-content">
      <h3 className="room-heading">
        <span>Room #{selId}</span>
        <span className="room-heading-right">
          <span className="room-coords">({room.x}, {room.y}, {room.z})</span>
          <button
            type="button"
            className="room-center-btn"
            title="Center view on room"
            onClick={() => {
              const scene = sceneRef.current;
              if (!scene) return;
              scene.renderer.camera.panToMapPoint(room.x, -room.y);
              scene.refresh();
            }}
          >
            <CenterOnRoomIcon />
          </button>
        </span>
      </h3>

      <Field label="Name">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => commit('name', nameDraft)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </Field>

      <Field label="Hash">
        <input
          value={hashDraft}
          placeholder="(none)"
          spellCheck={false}
          onChange={(e) => setHashDraft(e.target.value)}
          onBlur={() => commitHash(hashDraft)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </Field>

      <div className="env-symbol-row">
        <div className="field env-field">
          <span className="label">Environment</span>
          <div className="env-field-row">
            <button
              type="button"
              className="env-pick-btn"
              style={{ background: envColor }}
              onClick={() => setEnvPickerOpen((v) => !v)}
              title={`Env ${room.environment} — click to change`}
            />
            <span className="env-id-label">#{room.environment}</span>
            {envPickerOpen && (
              <EnvPicker
                map={map}
                sceneRef={sceneRef}
                currentEnvId={room.environment}
                onSelect={handleEnvSelect}
                onClose={() => setEnvPickerOpen(false)}
              />
            )}
          </div>
        </div>
        <Field label="Symbol">
          <div className="symbol-row">
            <input
              value={symbolDraft}
              maxLength={4}
              onChange={(e) => setSymbolDraft(e.target.value)}
              onBlur={() => commit('symbol', symbolDraft)}
            />
            <input
              type="color"
              className="symbol-color-input"
              value={symbolColor ?? '#ffffff'}
              title="Symbol color (stored in userData as system.fallback_symbol_color)"
              onChange={(e) => setSymbolColor(e.target.value)}
              onBlur={() => { if (symbolColor !== null) commitSymbolColor(symbolColor); }}
            />
            <button
              type="button"
              className="symbol-color-clear"
              style={{ visibility: symbolColor !== null ? 'visible' : 'hidden' }}
              title="Clear symbol color"
              onClick={() => { setSymbolColor(null); commitSymbolColor(null); }}
            >×</button>
          </div>
        </Field>
      </div>

      <h4>Exits</h4>
      <div className="compass-rose">
        {COMPASS_GRID.flat().map((dir, i) =>
          dir === null
            ? (
              <div key={i} className="compass-cell compass-center">
                <button
                  type="button"
                  className={`cc-room-lock-btn${room.isLocked ? ' lock-active' : ''}`}
                  title={room.isLocked ? 'Room locked — click to unlock' : 'Room unlocked — click to lock'}
                  onClick={() => {
                    pushCommand({ kind: 'setRoomLock', id: selId, lock: !room.isLocked }, sceneRef.current);
                    sceneRef.current?.refresh();
                    store.bumpData();
                  }}
                ><LockIcon locked={room.isLocked} /></button>
                <input
                  key={`${selId}-w`}
                  type="number"
                  className="cc-room-weight"
                  min={1}
                  value={weightDraft}
                  title="Room weight"
                  onChange={(e) => setWeightDraft(e.target.value)}
                  onBlur={() => commit('weight', weightDraft)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
            )
            : renderCell(dir)
        )}
      </div>
      <div className="compass-extra">
        {VERTICAL_GRID.flat().map((dir, i) =>
          dir === null
            ? <div key={i} className="compass-vert-spacer" />
            : renderCell(dir)
        )}
      </div>
      {lineFormFor !== null && EXIT_DIRS.includes(lineFormFor as any) && renderLineForm(lineFormFor)}

      <h4>Special Exits</h4>
      <div className="special-exits-list">
        {specialExits.map(([name, toId]) => {
          const doorState = room.doors?.[name] ?? 0;
          const exitWeight = room.exitWeights?.[name] ?? 1;
          const hasCustomLine = !!room.customLines?.[name];
          return (
            <Fragment key={name}>
              <div className={`compass-cell has-exit${lineFormFor === name ? ' active' : ''}`}>
                <div className="cc-header">
                  <span className="cc-label" title={name}>{name}</span>
                  <span className="cc-header-btn-slot">
                    <button
                      type="button"
                      className={`exit-line-btn${hasCustomLine ? ' has-line' : ''}`}
                      onClick={() => handleLineButton(name)}
                      title={hasCustomLine ? 'Edit custom line' : 'Draw custom line'}
                    >
                      {hasCustomLine
                        ? (() => { const c = room.customLinesColor?.[name]; const rgb = c ? `rgb(${c.r},${c.g},${c.b})` : '#fff'; return <span className="cl-swatch" style={{ background: rgb }} />; })()
                        : <span className="exit-line-icon">∿</span>
                      }
                    </button>
                  </span>
                </div>
                <div className="cc-middle">
                  <RoomLink id={toId} className="cc-target" />
                </div>
                <div className="cc-footer">
                  <button
                    type="button"
                    className={`cc-door-btn ${DOOR_CLASSES[doorState]}`}
                    title={DOOR_TITLES[doorState]}
                    onClick={() => changeSpecialDoor(name, doorState, (doorState + 1) % 4)}
                  >
                    <DoorIcon />
                  </button>
                  <span className="cc-weight-wrap">
                    <WeightIcon />
                    <input
                      key={`${selId}-${name}-${exitWeight}`}
                      type="number"
                      className="cc-weight"
                      min={1}
                      defaultValue={exitWeight}
                      title="Exit weight"
                      onBlur={(e) => changeSpecialWeight(name, exitWeight, Math.max(1, parseInt(e.target.value, 10) || 1))}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </span>
                  <button
                    type="button"
                    className="cc-icon-btn"
                    title="Remove special exit"
                    onClick={() => removeSpecialExit(name, toId)}
                  >✕</button>
                </div>
              </div>
              {lineFormFor === name && renderLineForm(name)}
            </Fragment>
          );
        })}

        <div className="special-exit-add">
          <input placeholder="exit name" value={specialExitName} onChange={(e) => setSpecialExitName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && specialExitTarget && addSpecialExit()} />
          <div className="cc-exit-add">
            <input
              type="number"
              className="cc-exit-input"
              placeholder="#"
              value={specialExitTarget}
              onChange={(e) => setSpecialExitTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && specialExitName && addSpecialExit()}
            />
            <button
              type="button"
              className={`cc-pick-btn${pending?.kind === 'pickSpecialExit' && pending.fromId === selId ? ' picking' : ''}`}
              title={pending?.kind === 'pickSpecialExit' && pending.fromId === selId ? 'Click a room on the map (Esc to cancel)' : 'Pick target room from map'}
              onClick={() => {
                const isPicking = pending?.kind === 'pickSpecialExit' && pending.fromId === selId;
                store.setState({ pending: isPicking ? null : { kind: 'pickSpecialExit', fromId: selId } });
              }}
            >
              <CrosshairIcon />
            </button>
          </div>
          <button type="button" onClick={addSpecialExit} disabled={!specialExitName.trim() || !specialExitTarget}>Add</button>
        </div>
      </div>

      {customLineEntries.length > 0 && (
        <>
          <h4>Custom Lines</h4>
          <div className="exit-list">
            {customLineEntries.map(([name, pts]) => {
              const color = room.customLinesColor?.[name];
              const rgb = color ? `rgb(${color.r},${color.g},${color.b})` : '#fff';
              return (
                <div key={name} className="customline-row">
                  <span className="cl-swatch" style={{ background: rgb }} />
                  <button type="button" className="customline-name" onClick={() => store.setState({ selection: { kind: 'customLine', roomId: selId, exitName: name } })} title={name}>{name}</button>
                  <span className="customline-badge" title={`${pts.length} waypoint${pts.length === 1 ? '' : 's'}`}>{pts.length}</span>
                  <button type="button" className="customline-remove" onClick={() => removeCustomLine(name)} title="Remove">✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {pluginSections.map((s) => (
        <Fragment key={s.id}>{s.render({ roomId: selId, room, map, sceneRef })}</Fragment>
      ))}
      <h4>User Data</h4>
      <UserDataEditor
        data={room.userData}
        onCommit={(key, from, to) => {
          pushCommand({ kind: 'setUserDataEntry', roomId: selId, key, from, to }, sceneRef.current);
          sceneRef.current?.refresh();
          store.bumpData();
        }}
      />
    </div>
  );
}
