import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState } from '../editor/store';
import { registerSpecialExitPickCb } from '../editor/tools';
import { pushCommand } from '../editor/commands';
import { normalizeCustomLineKey, OPPOSITE, DIR_SHORT, DIR_INDEX, SHORT_TO_DIR, type CustomLineCompanion, type SetCustomLineCompanion, type Direction } from '../editor/types';
import type { SceneHandle } from '../editor/scene';
import type { MudletMap } from '../mapIO';
import type { RoomPanelSection } from '../editor/plugin';
import { createDefaultRoom } from '../editor/mapHelpers';
import { roomAtCell } from '../editor/hitTest';
import { EnvPicker } from './EnvPicker';
import { DoorIcon, LockIcon, WeightIcon, CrosshairIcon, CenterOnRoomIcon } from './icons';
import { RoomLink, Field, UserDataEditor, hexToMudletColor } from './panelShared';
import { warningKey } from './panels/MapPanel';
import { loadAcks, saveAcks, mapAckKey } from '../editor/warningAcks';

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

const ROOM_OFFSETS: Record<Direction, { x: number; y: number; z: number }> = {
  north: { x: 0, y: 1, z: 0 },
  northeast: { x: 1, y: 1, z: 0 },
  east: { x: 1, y: 0, z: 0 },
  southeast: { x: 1, y: -1, z: 0 },
  south: { x: 0, y: -1, z: 0 },
  southwest: { x: -1, y: -1, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  northwest: { x: -1, y: 1, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  down: { x: 0, y: 0, z: -1 },
  in: { x: 0, y: 0, z: 0 },
  out: { x: 0, y: 0, z: 0 },
};

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
  const { t } = useTranslation('panels');
  const selId = selection.ids[0];
  const pending = useEditorState((s) => s.pending);
  const warnings = useEditorState((s) => s.warnings);

  const [nameDraft, setNameDraft] = useState(room.name ?? '');
  const [idDraft, setIdDraft] = useState(String(selId));
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
  const skipCleanupRef = useRef(false);

  useEffect(() => {
    const prevRoom = room;
    const prevId = selId;
    const prevHash = lookupRoomHash(map, prevId, prevRoom);
    return () => {
      if (skipCleanupRef.current) {
        skipCleanupRef.current = false;
        return;
      }
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
      if (changed) {
        sceneRef.current?.refresh();
        store.bumpData();
      }
    };
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNameDraft(room.name ?? '');
    setIdDraft(String(selId));
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
    store.setState({ status: t('room.updatedField', { field, id: selId }) });
  };

  const commitRoomId = (raw: string) => {
    const next = Number(raw.trim());
    if (!Number.isInteger(next) || next <= 0) {
      setIdDraft(String(selId));
      return;
    }
    if (next === selId) {
      setIdDraft(String(selId));
      return;
    }
    if (map.rooms[next]) {
      setIdDraft(String(selId));
      store.setState({ status: t('room.idExists', { id: next }) });
      return;
    }
    const currentHash = lookupRoomHash(map, selId, room);
    let changed = false;
    if (symbolDraftRef.current !== room.symbol) {
      pushCommand({ kind: 'setRoomField', id: selId, field: 'symbol', from: room.symbol, to: symbolDraftRef.current }, sceneRef.current);
      changed = true;
    }
    if (nameDraftRef.current !== room.name) {
      pushCommand({ kind: 'setRoomField', id: selId, field: 'name', from: room.name, to: nameDraftRef.current }, sceneRef.current);
      changed = true;
    }
    const nextWeight = Number(weightDraftRef.current);
    if (!Number.isNaN(nextWeight) && nextWeight !== room.weight) {
      pushCommand({ kind: 'setRoomField', id: selId, field: 'weight', from: room.weight, to: nextWeight }, sceneRef.current);
      changed = true;
    }
    const nextHash = hashDraftRef.current.trim();
    if (nextHash !== currentHash) {
      pushCommand({ kind: 'setRoomHash', id: selId, from: currentHash || null, to: nextHash || null }, sceneRef.current);
      changed = true;
    }
    skipCleanupRef.current = true;
    pushCommand({ kind: 'renameRoomId', fromId: selId, toId: next }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpStructure();
    setIdDraft(String(next));
    if (changed) {
      setNameDraft(nameDraftRef.current);
      setWeightDraft(weightDraftRef.current);
      setSymbolDraft(symbolDraftRef.current);
      setHashDraft(nextHash);
    }
    store.setState({ status: t('room.idUpdated', { from: selId, to: next }) });
  };

  const commitHash = (raw: string) => {
    const next = raw.trim();
    const current = lookupRoomHash(map, selId, room);
    if (next === current) return;
    pushCommand({ kind: 'setRoomHash', id: selId, from: current || null, to: next || null }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: next ? t('room.hashSet', { id: selId, hash: next }) : t('room.hashCleared', { id: selId }) });
  };

  const handleEnvSelect = (envId: number) => {
    if (envId === room.environment) return;
    pushCommand({ kind: 'setRoomField', id: selId, field: 'environment', from: room.environment, to: envId }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: t('room.envChanged', { id: selId, env: envId }) });
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
    const previous = (room as any)[dir] ?? -1;
    pushCommand({ kind: 'addExit', fromId: selId, dir, toId, previous, reverse: null }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: t('room.exitAdded', { dir, id: toId }) });
  };

  const submitExitDraft = (dir: Direction, raw: string, mode: 'blur' | 'enter') => {
    const nextId = parseInt(raw, 10);
    if (Number.isNaN(nextId) || nextId <= 0) {
      setExitDrafts((prev) => ({ ...prev, [dir]: '' }));
      return;
    }

    if (map.rooms[nextId]) {
      addExit(dir, nextId);
      setExitDrafts((prev) => ({ ...prev, [dir]: '' }));
      return;
    }

    if (mode !== 'enter') return;

    if (dir === 'in' || dir === 'out') {
      store.setState({ status: t('room.exitCreateInOut') });
      return;
    }

    const offset = ROOM_OFFSETS[dir];
    const targetX = room.x + offset.x;
    const targetY = room.y + offset.y;
    const targetZ = room.z + offset.z;
    const occupied = roomAtCell(map, room.area, targetX, targetY, targetZ);
    if (occupied) {
      store.setState({ status: t('room.exitCreateOccupied', { id: nextId, x: targetX, y: targetY, z: targetZ }) });
      return;
    }

    const newRoom = createDefaultRoom(nextId, room.area, targetX, targetY, targetZ);
    const previous = (room as any)[dir] ?? -1;
    pushCommand({
      kind: 'batch',
      cmds: [
        { kind: 'addRoom', id: nextId, room: newRoom, areaId: room.area },
        { kind: 'addExit', fromId: selId, dir, toId: nextId, previous, reverse: null },
      ],
    }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpStructure();
    setExitDrafts((prev) => ({ ...prev, [dir]: '' }));
    store.setState({ status: t('room.exitRoomCreated', { id: nextId, dir: DIR_ABBREV[dir], from: selId }) });
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
    store.setState({ status: t('room.specialExitAdded', { name, id: toId }) });
    setSpecialExitName('');
    setSpecialExitTarget('');
  };

  const removeSpecialExit = (name: string, toId: number) => {
    pushCommand({ kind: 'removeSpecialExit', roomId: selId, name, toId }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: t('room.specialExitRemoved', { name }) });
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
    store.setState({ status: t('room.customLineRemoved', { name: exitName }) });
  };

  const startDrawingCustomLine = (rawExitName: string) => {
    const name = rawExitName.trim();
    if (!name) { store.setState({ status: t('room.enterExitNameFirst') }); return; }
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
      status: t('customLine.startStatus'),
    });
    store.bumpData();
    setLineFormFor(null);
  };

  const drawEmptyCustomLine = (rawExitName: string) => {
    const name = rawExitName.trim();
    if (!name) { store.setState({ status: t('room.enterExitNameFirst') }); return; }
    const scene = sceneRef.current;
    if (!scene) return;
    const key = normalizeCustomLineKey(name);
    const raw = map.rooms[selId];
    const color = hexToMudletColor(clColor);
    const previousSnapshot = raw?.customLines?.[key]
      ? {
          points: raw.customLines[key],
          color: raw.customLinesColor?.[key] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
          style: raw.customLinesStyle?.[key] ?? 1,
          arrow: raw.customLinesArrow?.[key] ?? false,
        }
      : null;

    let companion: SetCustomLineCompanion | undefined;
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
          companion = { roomId: partnerId, exitName: oppositeKey, data: { points: [], color, style: clStyle, arrow: false }, previous: partnerPrev };
        }
      }
    }

    pushCommand({
      kind: 'setCustomLine',
      roomId: selId,
      exitName: key,
      data: { points: [], color, style: clStyle, arrow: clArrow },
      previous: previousSnapshot,
      companion,
    }, scene);
    scene.refresh();
    store.setState({ selection: { kind: 'customLine', roomId: selId, exitName: key } });
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

  const DOOR_TITLES = [
    t('room.doorNone'),
    t('room.doorOpen'),
    t('room.doorClosed'),
    t('room.doorLocked'),
  ];
  const DOOR_CLASSES = ['', 'door-open', 'door-closed', 'door-locked'];

  const renderLineForm = (exitName: string) => (
    <div className="cl-form cl-form-inline">
      <div className="cl-form-row">
        <label className="cl-form-label">{t('room.clColor')}</label>
        <input type="color" value={clColor} onChange={(e) => setClColor(e.target.value)} />
        <select value={clStyle} onChange={(e) => setClStyle(Number(e.target.value))} style={{ flex: 1, marginLeft: 6 }}>
          <option value={1}>{t('room.solid')}</option>
          <option value={2}>{t('room.dash')}</option>
          <option value={3}>{t('room.dot')}</option>
          <option value={4}>{t('room.dashDot')}</option>
          <option value={5}>{t('room.dashDotDot')}</option>
        </select>
      </div>
      <div className="cl-form-row">
        <label className="cl-form-label" style={{ width: 'auto', whiteSpace: 'nowrap' }}>{t('room.clArrow')}</label>
        <input type="checkbox" checked={clArrow} onChange={(e) => setClArrow(e.target.checked)} />
      </div>
      <div className="cl-form-row" title={t('room.clBothWaysHint')}>
        <label className="cl-form-label" style={{ width: 'auto', whiteSpace: 'nowrap' }}>{t('room.clBothWays')}</label>
        <input type="checkbox" checked={clBothWays} onChange={(e) => setClBothWays(e.target.checked)} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="button" onClick={() => startDrawingCustomLine(exitName)} style={{ flex: 1 }}>
          {t('room.startDrawing')}
        </button>
        <button type="button" onClick={() => drawEmptyCustomLine(exitName)} style={{ flex: 1 }}>
          {t('room.drawEmpty')}
        </button>
        <button type="button" onClick={() => setLineFormFor(null)}>{t('room.cancel')}</button>
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
      <div key={dir} className={[
        'compass-cell',
        hasExit ? 'has-exit' : '',
        isStub && !hasExit ? 'is-stub' : '',
        lineFormFor === dir ? 'active' : '',
        isPicking ? 'picking-exit' : '',
      ].filter(Boolean).join(' ')}>
        <div className="cc-header">
          <span className="cc-label">{DIR_ABBREV[dir]}</span>
          {hasExit && <RoomLink id={v} className="cc-target" />}
          {isStub && !hasExit && <span className="cc-stub-label">STUB</span>}
          {!isActive && (
            <input
              type="number"
              className="cc-exit-input"
              placeholder="#"
              value={exitDrafts[dir] ?? ''}
              onChange={(e) => setExitDrafts((prev) => ({ ...prev, [dir]: e.target.value }))}
              onBlur={(e) => submitExitDraft(d, e.target.value, 'blur')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitExitDraft(d, (e.target as HTMLInputElement).value, 'enter');
                }
              }}
            />
          )}
          {isActive
            ? (
              <button
                type="button"
                className="cc-icon-btn cc-delete-btn"
                title={hasExit ? t('room.removeExit') : t('room.removeStub')}
                onClick={() => deleteExit(d, hasExit, v, isStub)}
              >X</button>
            ) : (
              <button
                type="button"
                className={`cc-pick-btn${isPicking ? ' picking' : ''}`}
                title={isPicking ? t('room.pickTargetCancel') : t('room.pickTarget')}
                onClick={() => store.setState(isPicking ? { pending: null } : { pending: { kind: 'pickExit', fromId: selId, dir: d } })}
              >
                <CrosshairIcon />
              </button>
            )
          }
        </div>
        {hasExit && (
          <div className="cc-line2">
            <button
              type="button"
              className={`exit-line-btn${hasCustomLine ? '' : ' no-line'}`}
              onClick={() => handleLineButton(dir)}
              title={hasCustomLine ? t('room.editCustomLine') : t('room.drawCustomLine')}
            >
              {hasCustomLine
                ? (() => { const c = room.customLinesColor?.[dirKey]; const rgb = c ? `rgb(${c.r},${c.g},${c.b})` : '#fff'; return <><span className="cl-swatch" style={{ background: rgb }} /><span className="exit-line-label">{t('room.customLine')}</span></>; })()
                : <><span className="cl-placeholder">∿</span><span className="exit-line-label">{t('room.customLine')}</span></>
              }
            </button>
          </div>
        )}
        {hasExit && (
          <div className="cc-footer">
            <button
              type="button"
              className={`cc-door-btn ${DOOR_CLASSES[doorState]}`}
              title={DOOR_TITLES[doorState]}
              onClick={() => changeDoor(d, doorState, (doorState + 1) % 4)}
            >
              <DoorIcon />
            </button>
            <button
              type="button"
              className="cc-icon-btn cc-stub-btn"
              title={t('room.convertToStub')}
              onClick={() => toggleStub(d, false, v)}
            >STUB</button>
            <button
              type="button"
              className={`cc-icon-btn${isLocked ? ' lock-active' : ''}`}
              title={isLocked ? t('room.exitLocked') : t('room.exitUnlocked')}
              onClick={() => toggleExitLock(d, isLocked)}
            ><LockIcon locked={isLocked} /></button>
            <span className="cc-weight-wrap">
              <WeightIcon />
              <input
                key={`${selId}-${dir}-${exitWeight}`}
                type="number"
                className="cc-weight"
                min={1}
                defaultValue={exitWeight}
                title={t('room.exitWeight')}
                onBlur={(e) => changeWeight(d, exitWeight, Math.max(1, parseInt(e.target.value, 10) || 1))}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </span>
          </div>
        )}
        {!isActive && (
          <div className="cc-footer-empty">
            <button
              type="button"
              className="cc-icon-btn cc-stub-btn"
              title={t('room.markAsStub')}
              onClick={() => toggleStub(d, false, v)}
            >STUB</button>
          </div>
        )}
      </div>
    );
  };

  const envColor = sceneRef.current?.reader.getColorValue(room.environment) ?? 'rgb(114,1,0)';
  const specialExits = Object.entries(room.mSpecialExits ?? {});
  const customLineEntries = Object.entries(room.customLines ?? {});

  return (
    <div className="panel-content">
      <h3 className="room-heading">
        <span className="room-heading-id">
          <span>Room #</span>
          <input
            type="number"
            className="room-id-input"
            min={1}
            value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)}
            onBlur={(e) => commitRoomId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setIdDraft(String(selId));
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label={t('room.id')}
          />
        </span>
        <span className="room-heading-right">
          <span className="room-coords">({room.x}, {room.y}, {room.z})</span>
          <button
            type="button"
            className="room-center-btn"
            title={t('room.centerView')}
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

      {(() => {
        const mapKey = mapAckKey(map);
        const acks = loadAcks(mapKey);
        const ws = warnings.filter((w) =>
          !acks.has(warningKey(w)) && (
            (w.kind === 'selfLinkRoom' && w.roomId === selId) ||
            (w.kind === 'orphanRoom'   && w.roomId === selId) ||
            (w.kind === 'danglingExit' && w.roomId === selId) ||
            (w.kind === 'coordMismatch' && w.roomId === selId) ||
            (w.kind === 'duplicateCoord' && w.roomIds.includes(selId))
          )
        );
        if (ws.length === 0) return null;
        return (
          <div className="warnings-list">
            {ws.map((w, i) => {
              let detail = '';
              if (w.kind === 'selfLinkRoom')   detail = `self-link: ${w.dirs.join(', ')}`;
              if (w.kind === 'orphanRoom')      detail = 'no connections';
              if (w.kind === 'danglingExit')    detail = `${w.dir} → missing #${w.targetId}`;
              if (w.kind === 'coordMismatch')   detail = `${w.dir} → #${w.targetId}`;
              if (w.kind === 'duplicateCoord')  detail = `(${w.x}, ${w.y}, ${w.z}) with ${w.roomIds.filter((id) => id !== selId).map((id) => `#${id}`).join(', ')}`;
              return (
                <div key={i} className="warning-row">
                  <span className="warning-icon">⚠</span>
                  <span className="warning-text">
                    <span className="warning-detail">{detail}</span>
                  </span>
                  <button
                    type="button"
                    className="warning-ack-btn"
                    onClick={() => {
                      const next = new Set(loadAcks(mapKey));
                      next.add(warningKey(w));
                      saveAcks(mapKey, next);
                      store.bumpAckVersion();
                    }}
                  >{t('room.ack')}</button>
                </div>
              );
            })}
          </div>
        );
      })()}

      <Field label={t('room.name')}>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => commit('name', nameDraft)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </Field>

      <Field label={t('room.hash')}>
        <input
          value={hashDraft}
          placeholder={t('room.hashNone')}
          spellCheck={false}
          onChange={(e) => setHashDraft(e.target.value)}
          onBlur={() => commitHash(hashDraft)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </Field>

      <div className="env-symbol-row">
        <div className="field env-field">
          <span className="label">{t('room.environment')}</span>
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
        <Field label={t('room.symbol')}>
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
              title={t('room.symbolColorTitle')}
              onChange={(e) => setSymbolColor(e.target.value)}
              onBlur={() => { if (symbolColor !== null) commitSymbolColor(symbolColor); }}
            />
            <button
              type="button"
              className="symbol-color-clear"
              style={{ visibility: symbolColor !== null ? 'visible' : 'hidden' }}
              title={t('room.clearSymbolColor')}
              onClick={() => { setSymbolColor(null); commitSymbolColor(null); }}
            >X</button>
          </div>
        </Field>
      </div>

      <h4>{t('room.exits')}</h4>
      <div className="compass-rose">
        {COMPASS_GRID.flat().map((dir, i) =>
          dir === null
            ? (
              <div key={i} className="compass-cell compass-center">
                <button
                  type="button"
                  className={`cc-room-lock-btn${room.isLocked ? ' lock-active' : ''}`}
                  title={room.isLocked ? t('room.roomLocked') : t('room.roomUnlocked')}
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
                  title={t('room.roomWeight')}
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

      <h4>{t('room.specialExits')}</h4>
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
                  <RoomLink id={toId} className="cc-target" />
                  <button
                    type="button"
                    className="cc-icon-btn cc-delete-btn"
                    title={t('room.removeSpecialExit')}
                    onClick={() => removeSpecialExit(name, toId)}
                  >X</button>
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
                  <button
                    type="button"
                    className={`exit-line-btn se-line-btn${hasCustomLine ? '' : ' no-line'}`}
                    onClick={() => handleLineButton(name)}
                    title={hasCustomLine ? t('room.editCustomLine') : t('room.drawCustomLine')}
                  >
                    {hasCustomLine
                      ? (() => { const c = room.customLinesColor?.[name]; const rgb = c ? `rgb(${c.r},${c.g},${c.b})` : '#fff'; return <><span className="cl-swatch" style={{ background: rgb }} /><span className="exit-line-label">{t('room.customLine')}</span></>; })()
                      : <><span className="cl-placeholder">∿</span><span className="exit-line-label">{t('room.customLine')}</span></>
                    }
                  </button>
                  <span className="cc-weight-wrap">
                    <WeightIcon />
                    <input
                      key={`${selId}-${name}-${exitWeight}`}
                      type="number"
                      className="cc-weight"
                      min={1}
                      defaultValue={exitWeight}
                      title={t('room.exitWeight')}
                      onBlur={(e) => changeSpecialWeight(name, exitWeight, Math.max(1, parseInt(e.target.value, 10) || 1))}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </span>
                </div>
              </div>
              {lineFormFor === name && renderLineForm(name)}
            </Fragment>
          );
        })}

        <div className="special-exit-add">
          <input placeholder={t('room.specialExitPlaceholder')} value={specialExitName} onChange={(e) => setSpecialExitName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && specialExitTarget && addSpecialExit()} />
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
              title={pending?.kind === 'pickSpecialExit' && pending.fromId === selId ? t('room.pickTargetCancel') : t('room.pickTarget')}
              onClick={() => {
                const isPicking = pending?.kind === 'pickSpecialExit' && pending.fromId === selId;
                store.setState({ pending: isPicking ? null : { kind: 'pickSpecialExit', fromId: selId } });
              }}
            >
              <CrosshairIcon />
            </button>
          </div>
          <button type="button" onClick={addSpecialExit} disabled={!specialExitName.trim() || !specialExitTarget}>{t('room.addButton')}</button>
        </div>
      </div>

      {customLineEntries.length > 0 && (
        <>
          <h4>{t('room.customLines')}</h4>
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
      <h4>{t('room.userData')}</h4>
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
