import type { MudletRoom, MudletColor } from '../mapIO';
import { applyCommand, revertCommand } from './commands';
import { store } from './store';
import type { SceneHandle } from './scene';
import type { Command, CustomLineSnapshot, Direction } from './types';
import { CARDINAL_DIRECTIONS, DIR_SHORT, DIR_INDEX, OPPOSITE, normalizeCustomLineKey } from './types';
import { inferDirection, is2DCardinal, getExit } from './mapHelpers';

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

/**
 * Read-only snapshot of a room exposed to user scripts. Re-query (via room()
 * or findRooms()) after any mutation to see the updated state.
 */
function snapshotRoom(raw: MudletRoom, id: number): Readonly<Record<string, any>> {
  const s: Record<string, any> = {
    id,
    x: raw.x, y: raw.y, z: raw.z,
    area: raw.area,
    name: raw.name ?? '',
    environment: raw.environment,
    symbol: raw.symbol ?? '',
    weight: raw.weight,
    isLocked: !!raw.isLocked,
    userData: { ...(raw.userData ?? {}) },
    doors: { ...(raw.doors ?? {}) },
    exitWeights: { ...(raw.exitWeights ?? {}) },
    specialExits: { ...(raw.mSpecialExits ?? {}) },
    stubs: [...(raw.stubs ?? [])],
    exitLocks: [...(raw.exitLocks ?? [])],
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
      if (!!r.isLocked === !!lock) return;
      push({ kind: 'setRoomLock', id, lock: !!lock });
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
      if (was === !!lock) return;
      push({ kind: 'setExitLock', roomId, dir, lock: !!lock });
    },
    setStub: (roomId: number, dir: Direction, stub: boolean) => {
      const r = assertRoom(roomId);
      const idx = DIR_INDEX[dir];
      const was = r.stubs?.includes(idx) ?? false;
      if (was === !!stub) return;
      push({ kind: 'setStub', roomId, dir, stub: !!stub });
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
  };

  let returnValue: unknown;
  try {
    const names = Object.keys(api);
    const values = Object.values(api);
    const fn = new Function(...names, `"use strict";\n${code}`);
    returnValue = fn(...values);
  } catch (err: any) {
    for (let i = cmds.length - 1; i >= 0; i--) {
      try { revertCommand(map, cmds[i], scene); } catch {}
    }
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
