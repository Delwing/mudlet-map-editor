import type { MudletRoom, MudletColor } from '../mapIO';
import { applyCommand, commandGroup, labelDiffCommands, revertCommand } from './commands';
import { store } from './store';
import type { SceneHandle } from './scene';
import type { Command, CustomLineSnapshot, Direction, LabelBorder, LabelPadding, LabelSnapshot, LabelTextAlign } from './types';
import { CARDINAL_DIRECTIONS, DIR_SHORT, DIR_INDEX, OPPOSITE, normalizeCustomLineKey } from './types';
import { inferDirection, is2DCardinal, getExit } from './mapHelpers';
import { snapshotFromRawLabel } from './reader/EditorMapReader';
import { labelSizeForText } from './labelPixmap';
import { applyLabelPreset, getLabelPresets } from './labelPresets';
import { getLabelStyles } from './labelStyles';
import { PIXMAP_REGEN, pixmapRefFor } from './pixmapRefs';

const MAX_COMMANDS = 1_000_000;

export type ScriptResult = {
  commandCount: number;
  logs: string[];
  /** Value the script returned via `return …`. `undefined` means no return. */
  returnValue?: unknown;
  /** JSON-stringified form of `returnValue`, or an error marker if not serialisable. */
  returnJson?: string;
  error?: { message: string; name: string };
};

const LINE_STYLES: Record<string, number> = {
  solid: 1, dash: 2, dot: 3, dashDot: 4, dashDotDot: 5,
};

function normalizeLineStyle(style: unknown): number {
  if (typeof style === 'number') return Math.max(1, Math.min(5, Math.floor(style)));
  if (typeof style === 'string' && style in LINE_STYLES) return LINE_STYLES[style];
  return 1;
}

function normalizeColor(color: unknown): MudletColor {
  if (color == null) return { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
  if (typeof color === 'string') {
    const hex = color.replace(/^#/, '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      throw new Error(`Invalid color '${color}' — expected '#rrggbb' or { r, g, b }`);
    }
    return {
      spec: 1, alpha: 255,
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  if (typeof color === 'object') {
    const c = color as any;
    if (typeof c.r !== 'number' || typeof c.g !== 'number' || typeof c.b !== 'number') {
      throw new Error('Color object must have numeric r, g, b fields');
    }
    return {
      spec: 1,
      alpha: typeof c.alpha === 'number' ? c.alpha : 255,
      r: Math.max(0, Math.min(255, c.r | 0)),
      g: Math.max(0, Math.min(255, c.g | 0)),
      b: Math.max(0, Math.min(255, c.b | 0)),
    };
  }
  throw new Error(`Invalid color value: ${String(color)}`);
}

/** JSON.stringify with cycle-safe replacer. Returns null if nothing useful to show. */
function stringifyReturn(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'function') return `[Function${v.name ? ` ${v.name}` : ''}]`;
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }, 2);
  } catch (err: any) {
    return `[unserialisable: ${err?.message ?? String(err)}]`;
  }
}

const LABEL_HEX = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Label colours accept '#rrggbb', '#rrggbbaa' or { r, g, b, alpha? }; unlike rooms, alpha matters here. */
function normalizeLabelColor(color: unknown, what: string): MudletColor {
  if (typeof color === 'string') {
    const m = LABEL_HEX.exec(color.trim());
    if (!m) throw new Error(`${what}: invalid color '${color}' — expected '#rrggbb', '#rrggbbaa' or { r, g, b, alpha }`);
    const hex = m[1];
    return {
      spec: 1,
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
    };
  }
  return normalizeColor(color);
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/** A label colour as scripts see it: channels plus ready-to-compare hex strings. */
function labelColorOut(c: MudletColor) {
  const hex = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return Object.freeze({ r: c.r, g: c.g, b: c.b, alpha: c.alpha, hex, hexa: hex + hex2(c.alpha) });
}

/** Read-only snapshot of a label exposed to user scripts. Coordinates are raw Mudlet (+y = north). */
function snapshotLabelForScript(s: LabelSnapshot, areaId: number): Readonly<Record<string, any>> {
  return Object.freeze({
    id: s.id,
    areaId,
    x: s.pos[0], y: s.pos[1], z: s.pos[2],
    width: s.size[0], height: s.size[1],
    text: s.text,
    font: Object.freeze({ ...s.font }),
    fgColor: labelColorOut(s.fgColor),
    bgColor: labelColorOut(s.bgColor),
    outlineColor: s.outlineColor ? labelColorOut(s.outlineColor) : null,
    border: s.border ? Object.freeze({ width: s.border.width, color: labelColorOut(s.border.color) }) : null,
    padding: s.padding ?? null,
    textAlign: s.textAlign ?? 'center',
    style: s.styleId ?? 'plain',
    noScaling: s.noScaling,
    showOnTop: s.showOnTop,
    isImage: !!s.imageSrc,
  });
}

/**
 * Read-only snapshot of a room exposed to user scripts. Re-query (via room()
 * or findRooms()) after any mutation to see the updated state.
 */
function snapshotRoom(raw: MudletRoom, id: number): Readonly<Record<string, any>> {
  const customLines: Record<string, Readonly<Record<string, any>>> = {};
  const linePoints = raw.customLines ?? {};
  for (const key of Object.keys(linePoints)) {
    const color = raw.customLinesColor?.[key] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
    customLines[key] = Object.freeze({
      points: (linePoints[key] ?? []).map((p) => [p[0], p[1]] as [number, number]),
      color: { ...color },
      style: raw.customLinesStyle?.[key] ?? 1,
      arrow: raw.customLinesArrow?.[key] ?? false,
    });
  }

  const s: Record<string, any> = {
    id,
    x: raw.x, y: raw.y, z: raw.z,
    area: raw.area,
    name: raw.name ?? '',
    environment: raw.environment,
    symbol: raw.symbol ?? '',
    weight: raw.weight,
    isLocked: raw.isLocked,
    userData: { ...(raw.userData ?? {}) },
    doors: { ...(raw.doors ?? {}) },
    exitWeights: { ...(raw.exitWeights ?? {}) },
    specialExits: { ...(raw.mSpecialExits ?? {}) },
    stubs: [...(raw.stubs ?? [])],
    exitLocks: [...(raw.exitLocks ?? [])],
    customLines: Object.freeze(customLines),
  };
  for (const d of CARDINAL_DIRECTIONS) s[d] = (raw as any)[d];
  return Object.freeze(s);
}

/**
 * Run a user script against the current map. Each helper mutates the map
 * eagerly (so subsequent reads see updated state) and records a Command. On
 * success, all commands are pushed as a single batch to the undo stack. On
 * error, every applied command is reverted.
 */
export function runScript(code: string, scene: SceneHandle): ScriptResult {
  const state = store.getState();
  const map = state.map;
  if (!map) return { commandCount: 0, logs: [], error: { name: 'Error', message: 'No map loaded' } };

  const cmds: Command[] = [];
  const logs: string[] = [];
  let structural = false;

  const push = (cmd: Command) => {
    if (cmds.length >= MAX_COMMANDS) {
      throw new Error(`Script exceeded ${MAX_COMMANDS} commands — aborting.`);
    }
    const r = applyCommand(map, cmd, scene);
    if (r.structural) structural = true;
    cmds.push(cmd);
  };

  const assertRoom = (id: number): MudletRoom => {
    const r = map.rooms[id];
    if (!r) throw new Error(`Room ${id} not found`);
    return r;
  };

  const snapshotEnv = (envId: number): Readonly<Record<string, any>> => {
    const rgbStr = scene.reader.getColorValue(envId);
    const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(rgbStr);
    const r = m ? Number(m[1]) : 0;
    const g = m ? Number(m[2]) : 0;
    const b = m ? Number(m[3]) : 0;
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    return Object.freeze({
      id: envId,
      custom: !!map.mCustomEnvColors[envId],
      r, g, b,
      hex,
      rgb: rgbStr,
    });
  };

  const allLabels = () =>
    Object.entries(map.labels).flatMap(([areaId, list]) =>
      (list as any[]).map((raw) => ({ areaId: Number(areaId), snap: snapshotFromRawLabel(raw) })));

  const assertLabel = (areaId: number, id: number, what: string): LabelSnapshot => {
    const raw = map.labels[areaId]?.find((l: any) => l.id === id);
    if (!raw) throw new Error(`${what}: label ${id} not found in area ${areaId}`);
    return snapshotFromRawLabel(raw);
  };

  const fitSize = (label: LabelSnapshot, fit: unknown): [number, number] => {
    if (!fit) return label.size;
    const fitted = labelSizeForText(label);
    if (fit === 'width') return [fitted[0], label.size[1]];
    if (fit === 'height') return [label.size[0], fitted[1]];
    return fitted;
  };

  /**
   * Record the commands that turn `cur` into `next` — the same ones the label
   * panel records — with the pixmap re-rendered last, once every property it
   * depends on is in place. Image labels keep their picture.
   */
  const commitLabel = (areaId: number, cur: LabelSnapshot, next: LabelSnapshot): boolean => {
    const cmds = labelDiffCommands(areaId, cur.id, cur, next);
    const moved = next.pos[0] !== cur.pos[0] || next.pos[1] !== cur.pos[1];
    if (moved) push({ kind: 'moveLabel', areaId, id: cur.id, from: [...cur.pos] as [number, number, number], to: [...next.pos] as [number, number, number] });
    for (const c of cmds) push(c);
    if (cmds.length > 0 && !cur.imageSrc) {
      push({ kind: 'setLabelPixmap', areaId, id: cur.id, from: pixmapRefFor(cur.pixMap, cur), to: PIXMAP_REGEN });
    }
    return moved || cmds.length > 0;
  };

  const TEXT_ALIGNS: LabelTextAlign[] = ['left', 'center', 'right'];

  const fmt = (v: any): string => {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
    return String(v);
  };
  const log = (...args: any[]) => { logs.push(args.map(fmt).join(' ')); };

  const api = {
    // ── Read ───────────────────────────────────────────────────────────────
    rooms: () =>
      Object.entries(map.rooms)
        .filter(([, r]) => r != null)
        .map(([id, r]) => snapshotRoom(r!, Number(id))),
    findRooms: (pred: (r: any) => boolean) =>
      Object.entries(map.rooms)
        .filter(([, r]) => r != null)
        .map(([id, r]) => snapshotRoom(r!, Number(id)))
        .filter(pred),
    room: (id: number) => {
      const r = map.rooms[id];
      return r ? snapshotRoom(r, id) : undefined;
    },
    areas: () => Object.entries(map.areaNames).map(([id, name]) => ({ id: Number(id), name })),
    area: (id: number) => ({ id, name: map.areaNames[id] ?? `Area ${id}` }),
    envs: () => {
      const ids = new Set<number>();
      for (const id of Object.keys(map.envColors)) ids.add(Number(id));
      for (const id of Object.keys(map.mCustomEnvColors)) ids.add(Number(id));
      for (const r of Object.values(map.rooms)) {
        if (r && r.environment != null && r.environment > 0) ids.add(r.environment);
      }
      return Array.from(ids).sort((a, b) => a - b).map(snapshotEnv);
    },
    env: (id: number) => {
      if (!map.envColors[id] && !map.mCustomEnvColors[id]) {
        // Not registered directly — but maybe some room uses it. If so, still return it.
        const used = Object.values(map.rooms).some((r) => r && r.environment === id);
        if (!used) return undefined;
      }
      return snapshotEnv(id);
    },
    currentAreaId: state.currentAreaId,
    currentZ: state.currentZ,
    DIRS: [...CARDINAL_DIRECTIONS] as readonly Direction[],
    DIR_SHORT: { ...DIR_SHORT } as Readonly<Record<Direction, string>>,
    getSelection: (): number[] => {
      const sel = store.getState().selection;
      return sel && sel.kind === 'room' ? [...sel.ids] : [];
    },
    labels: () => allLabels().map(({ areaId, snap }) => snapshotLabelForScript(snap, areaId)),
    findLabels: (pred: (l: any) => boolean) =>
      allLabels().map(({ areaId, snap }) => snapshotLabelForScript(snap, areaId)).filter(pred),
    label: (areaId: number, id: number) => {
      const raw = map.labels[areaId]?.find((l: any) => l.id === id);
      return raw ? snapshotLabelForScript(snapshotFromRawLabel(raw), areaId) : undefined;
    },
    getSelectedLabel: (): { areaId: number; id: number } | null => {
      const sel = store.getState().selection;
      return sel && sel.kind === 'label' ? { areaId: sel.areaId, id: sel.id } : null;
    },
    labelStyles: () => getLabelStyles().map((s) => ({ id: s.id, name: s.name })),
    labelPresets: () => getLabelPresets().map((p) => ({ id: p.id, name: p.name })),
    log,
    console: { log },

    // ── Write ──────────────────────────────────────────────────────────────
    setRoomName: (id: number, name: string) => {
      const r = assertRoom(id);
      const from = r.name ?? '';
      if (from === name) return;
      push({ kind: 'setRoomField', id, field: 'name', from, to: name });
    },
    setRoomEnv: (id: number, env: number) => {
      const r = assertRoom(id);
      const from = r.environment ?? 0;
      if (from === env) return;
      push({ kind: 'setRoomField', id, field: 'environment', from, to: env });
    },
    setRoomSymbol: (id: number, symbol: string) => {
      const r = assertRoom(id);
      const from = r.symbol ?? '';
      if (from === symbol) return;
      push({ kind: 'setRoomField', id, field: 'symbol', from, to: symbol });
    },
    setRoomWeight: (id: number, weight: number) => {
      const r = assertRoom(id);
      if (r.weight === weight) return;
      push({ kind: 'setRoomField', id, field: 'weight', from: r.weight, to: weight });
    },
    setRoomLock: (id: number, lock: boolean) => {
      const r = assertRoom(id);
      if (r.isLocked === lock) return;
      push({ kind: 'setRoomLock', id, lock });
    },
    moveRoom: (id: number, x: number, y: number, z: number) => {
      const r = assertRoom(id);
      if (r.x === x && r.y === y && r.z === z) return;
      push({ kind: 'moveRoom', id, from: { x: r.x, y: r.y, z: r.z }, to: { x, y, z } });
    },
    setExit: (fromId: number, dir: Direction, toId: number) => {
      const r = assertRoom(fromId);
      const current = ((r as any)[dir] as number) ?? -1;
      if (current === toId) return;
      if (toId == null || toId < 0) {
        push({ kind: 'removeExit', fromId, dir, was: current, reverse: null });
      } else {
        push({ kind: 'addExit', fromId, dir, toId, previous: current, reverse: null });
      }
    },
    setDoor: (roomId: number, dir: Direction, value: number) => {
      const r = assertRoom(roomId);
      const key = DIR_SHORT[dir];
      const from = r.doors?.[key] ?? 0;
      if (from === value) return;
      push({ kind: 'setDoor', roomId, dir, from, to: value });
    },
    setExitWeight: (roomId: number, dir: Direction, value: number) => {
      const r = assertRoom(roomId);
      const key = DIR_SHORT[dir];
      const from = r.exitWeights?.[key] ?? 1;
      if (from === value) return;
      push({ kind: 'setExitWeight', roomId, dir, from, to: value });
    },
    setExitLock: (roomId: number, dir: Direction, lock: boolean) => {
      const r = assertRoom(roomId);
      const idx = DIR_INDEX[dir];
      const was = r.exitLocks?.includes(idx) ?? false;
      if (was === lock) return;
      push({ kind: 'setExitLock', roomId, dir, lock });
    },
    setStub: (roomId: number, dir: Direction, stub: boolean) => {
      const r = assertRoom(roomId);
      const idx = DIR_INDEX[dir];
      const was = r.stubs?.includes(idx) ?? false;
      if (was === stub) return;
      push({ kind: 'setStub', roomId, dir, stub });
    },
    setUserData: (roomId: number, key: string, value: string | null) => {
      const r = assertRoom(roomId);
      const from = r.userData?.[key] ?? null;
      if (from === value) return;
      push({ kind: 'setUserDataEntry', roomId, key, from, to: value });
    },
    setSpecialExit: (roomId: number, name: string, toId: number) => {
      const r = assertRoom(roomId);
      const current = r.mSpecialExits?.[name];
      if (toId == null || toId < 0) {
        if (current == null) return;
        push({ kind: 'removeSpecialExit', roomId, name, toId: current });
        return;
      }
      if (current === toId) return;
      // Overwrite: record the removal of the old target before adding the new
      // one so undo restores the prior state.
      if (current != null) push({ kind: 'removeSpecialExit', roomId, name, toId: current });
      push({ kind: 'addSpecialExit', roomId, name, toId });
    },

    /** Direction between two rooms inferred from their map coordinates. */
    directionBetween: (fromId: number, toId: number): Direction | null => {
      const from = map.rooms[fromId];
      const to = map.rooms[toId];
      if (!from || !to) return null;
      // inferDirection expects render-space (y-down); raw Mudlet is y-up, so flip.
      return inferDirection(from.x, -from.y, to.x, -to.y);
    },

    /**
     * Connect two rooms. By default bidirectional with direction inferred from
     * coordinates (2D cardinals only). Pass `{ direction }` for non-2D links
     * (up/down/in/out) or to override; pass `{ oneWay: true }` to skip the
     * reverse exit.
     */
    connectRooms: (
      fromId: number,
      toId: number,
      options?: { direction?: Direction; oneWay?: boolean },
    ): Direction | null => {
      const from = assertRoom(fromId);
      const to = assertRoom(toId);
      if (fromId === toId) throw new Error(`connectRooms: self-loop (room ${fromId})`);

      let dir = options?.direction;
      if (!dir) {
        dir = inferDirection(from.x, -from.y, to.x, -to.y);
        if (!is2DCardinal(dir)) {
          throw new Error(
            `connectRooms: rooms ${fromId}→${toId} aren't on a 2D axis — pass { direction: 'up' | 'down' | 'in' | 'out' }`,
          );
        }
      }
      if (!CARDINAL_DIRECTIONS.includes(dir)) {
        throw new Error(`connectRooms: invalid direction '${dir}'`);
      }

      const previous = getExit(from, dir);
      const oneWay = options?.oneWay === true;
      const reverseDir = OPPOSITE[dir];
      const canReverse = !oneWay && is2DCardinal(reverseDir);
      const reverseExisting = canReverse ? getExit(to, reverseDir) : -1;
      // Only write the reverse leg if it's empty or already points back — don't
      // silently clobber an existing incoming exit on the target.
      const reverse = canReverse && (reverseExisting === -1 || reverseExisting === fromId)
        ? { fromId: toId, dir: reverseDir, previous: reverseExisting }
        : null;

      if (previous === toId && (!canReverse || reverseExisting === fromId)) return dir;

      push({ kind: 'addExit', fromId, dir, toId, previous, reverse });
      return dir;
    },

    /** Disconnect a cardinal exit (and its reverse unless `oneWay: true`). */
    disconnect: (fromId: number, dir: Direction, options?: { oneWay?: boolean }) => {
      const r = assertRoom(fromId);
      const was = getExit(r, dir);
      if (was < 0) return;
      const oneWay = options?.oneWay === true;
      const reverseDir = OPPOSITE[dir];
      const target = map.rooms[was];
      const reverseWas = !oneWay && target && is2DCardinal(reverseDir)
        ? getExit(target, reverseDir)
        : -1;
      const reverse = !oneWay && target && reverseWas === fromId
        ? { fromId: was, dir: reverseDir, was: reverseWas }
        : null;
      push({ kind: 'removeExit', fromId, dir, was, reverse });
    },

    /**
     * Write a custom line on a room exit. Points are raw Mudlet coords
     * (y-up). `exitName` accepts full names ('north') or short keys ('n');
     * it's normalised automatically.
     */
    setCustomLine: (
      roomId: number,
      exitName: string,
      points: Array<[number, number]>,
      options?: {
        color?: string | { r: number; g: number; b: number; alpha?: number };
        style?: 'solid' | 'dash' | 'dot' | 'dashDot' | 'dashDotDot' | number;
        arrow?: boolean;
      },
    ) => {
      const r = assertRoom(roomId);
      const key = normalizeCustomLineKey(exitName);
      if (!Array.isArray(points) || points.some((p) => !Array.isArray(p) || p.length !== 2)) {
        throw new Error('setCustomLine: points must be an array of [x, y] pairs');
      }
      const pts = points.map(([x, y]) => [Number(x), Number(y)] as [number, number]);
      const color = normalizeColor(options?.color);
      const style = normalizeLineStyle(options?.style);
      const arrow = options?.arrow === true;

      const prevPts = r.customLines?.[key];
      const previous: CustomLineSnapshot | null = prevPts
        ? {
            points: [...prevPts] as [number, number][],
            color: r.customLinesColor?.[key] ?? color,
            style: r.customLinesStyle?.[key] ?? style,
            arrow: r.customLinesArrow?.[key] ?? false,
          }
        : null;

      push({
        kind: 'setCustomLine',
        roomId,
        exitName: key,
        data: { points: pts, color, style, arrow },
        previous,
      });
    },

    /** Remove a custom line from a room exit. */
    removeCustomLine: (roomId: number, exitName: string) => {
      const r = assertRoom(roomId);
      const key = normalizeCustomLineKey(exitName);
      const prevPts = r.customLines?.[key];
      if (!prevPts) return;
      push({
        kind: 'removeCustomLine',
        roomId,
        exitName: key,
        snapshot: {
          points: [...prevPts] as [number, number][],
          color: r.customLinesColor?.[key] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
          style: r.customLinesStyle?.[key] ?? 1,
          arrow: r.customLinesArrow?.[key] ?? false,
        },
      });
    },

    /**
     * Change any of a label's properties in one go; fields left out stay as
     * they are. `font` merges, so `{ font: { size: 24 } }` keeps the family.
     * `fitToText` resizes the box to the (new) text afterwards. The pixmap is
     * re-rendered to match, exactly as an edit in the label panel would.
     * Returns true when anything changed.
     */
    updateLabel: (areaId: number, id: number, patch: Record<string, any>): boolean => {
      const what = 'updateLabel';
      const cur = assertLabel(areaId, id, what);
      if (!patch || typeof patch !== 'object') throw new Error(`${what}: patch must be an object`);
      const next: LabelSnapshot = { ...cur, pos: [...cur.pos] as [number, number, number], size: [...cur.size] as [number, number], font: { ...cur.font } };

      if (patch.text !== undefined) next.text = String(patch.text);
      if (patch.font !== undefined) {
        if (typeof patch.font !== 'object' || patch.font === null) throw new Error(`${what}: font must be an object`);
        for (const k of Object.keys(patch.font)) if (!(k in next.font)) throw new Error(`${what}: unknown font field '${k}'`);
        next.font = { ...next.font, ...patch.font };
      }
      if (patch.x !== undefined) next.pos[0] = Number(patch.x);
      if (patch.y !== undefined) next.pos[1] = Number(patch.y);
      if (patch.width !== undefined) next.size[0] = Math.max(0.1, Number(patch.width));
      if (patch.height !== undefined) next.size[1] = Math.max(0.1, Number(patch.height));
      if (patch.fgColor !== undefined) next.fgColor = normalizeLabelColor(patch.fgColor, what);
      if (patch.bgColor !== undefined) next.bgColor = normalizeLabelColor(patch.bgColor, what);
      if (patch.outlineColor !== undefined) {
        next.outlineColor = patch.outlineColor === null ? undefined : normalizeLabelColor(patch.outlineColor, what);
      }
      if (patch.border !== undefined) {
        const b = patch.border;
        next.border = b === null ? undefined : {
          width: Number(b.width ?? cur.border?.width ?? 1),
          // A border with no colour of its own follows the text colour, as in presets.
          color: b.color !== undefined ? normalizeLabelColor(b.color, what) : { ...next.fgColor },
        } satisfies LabelBorder;
      }
      if (patch.padding !== undefined) {
        const p = patch.padding;
        const ok = p === null || typeof p === 'number' || (Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number'));
        if (!ok) throw new Error(`${what}: padding must be a number, [horizontal, vertical] or null`);
        next.padding = p === null ? undefined : (p as LabelPadding);
      }
      if (patch.textAlign !== undefined) {
        if (!TEXT_ALIGNS.includes(patch.textAlign)) throw new Error(`${what}: textAlign must be 'left', 'center' or 'right'`);
        next.textAlign = patch.textAlign === 'center' ? undefined : patch.textAlign;
      }
      if (patch.style !== undefined) {
        const style = String(patch.style);
        if (style !== 'plain' && !getLabelStyles().some((s) => s.id === style)) {
          throw new Error(`${what}: unknown style '${style}' — see labelStyles()`);
        }
        next.styleId = style === 'plain' ? undefined : style;
      }
      if (patch.noScaling !== undefined) next.noScaling = !!patch.noScaling;
      if (patch.showOnTop !== undefined) next.showOnTop = !!patch.showOnTop;
      next.size = fitSize(next, patch.fitToText);

      return commitLabel(areaId, cur, next);
    },

    /** Apply a label preset (by id or name, see labelPresets()) the way the label panel's preset buttons do. */
    applyLabelPreset: (areaId: number, id: number, preset: string): boolean => {
      const what = 'applyLabelPreset';
      const cur = assertLabel(areaId, id, what);
      const p = getLabelPresets().find((x) => x.id === preset) ?? getLabelPresets().find((x) => x.name === preset);
      if (!p) throw new Error(`${what}: unknown preset '${preset}' — see labelPresets()`);
      return commitLabel(areaId, cur, applyLabelPreset(cur, p));
    },
  };

  let returnValue: unknown;
  try {
    const names = Object.keys(api);
    const values = Object.values(api);
    const fn = new Function(...names, `"use strict";\n${code}`);
    returnValue = fn(...values);
  } catch (err: any) {
    commandGroup(() => {
      for (let i = cmds.length - 1; i >= 0; i--) {
        try { revertCommand(map, cmds[i], scene); } catch {}
      }
    });
    scene.refresh();
    return {
      commandCount: 0,
      logs,
      error: { message: err?.message ?? String(err), name: err?.name ?? 'Error' },
    };
  }

  if (cmds.length > 0) {
    const batch: Command = cmds.length === 1 ? cmds[0] : { kind: 'batch', cmds };
    store.setState((s) => ({ undo: [...s.undo, batch], redo: [] }));
    scene.refresh();
    if (structural) store.bumpStructure(); else store.bumpData();
  }

  return {
    commandCount: cmds.length,
    logs,
    returnValue,
    returnJson: stringifyReturn(returnValue),
  };
}
