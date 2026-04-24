/**
 * Ambient TypeScript declarations for the script sandbox, loaded into Monaco
 * via addExtraLib() so the editor gives full type-aware autocomplete, hover,
 * and signature help.
 *
 * Keep in sync with the `api` object in `script.ts`.
 */

export const SCRIPT_TYPES_DTS = `
declare type Direction =
  | 'north' | 'south' | 'east' | 'west'
  | 'northeast' | 'northwest' | 'southeast' | 'southwest'
  | 'up' | 'down' | 'in' | 'out';

/** Frozen read-only snapshot of a room. Re-query via room() / findRooms() after mutations to see updates. */
declare interface Room {
  readonly id: number;
  /** X coordinate (raw). */
  readonly x: number;
  /** Y coordinate (raw Mudlet, +y = north). */
  readonly y: number;
  readonly z: number;
  readonly area: number;
  readonly name: string;
  /** Environment / env id (paint colour index). */
  readonly environment: number;
  /** Room symbol / character. */
  readonly symbol: string;
  readonly weight: number;
  readonly isLocked: boolean;
  readonly userData: Readonly<Record<string, string>>;
  readonly doors: Readonly<Record<string, number>>;
  readonly exitWeights: Readonly<Record<string, number>>;
  readonly specialExits: Readonly<Record<string, number>>;
  readonly stubs: readonly number[];
  readonly exitLocks: readonly number[];
  /** Target room id, or -1. */
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
  readonly northeast: number;
  readonly northwest: number;
  readonly southeast: number;
  readonly southwest: number;
  readonly up: number;
  readonly down: number;
  readonly in: number;
  readonly out: number;
}

declare interface Area {
  readonly id: number;
  readonly name: string;
}

declare interface Env {
  readonly id: number;
  /** True if env has a custom colour override (map.mCustomEnvColors). */
  readonly custom: boolean;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** '#rrggbb'. */
  readonly hex: string;
  /** 'rgb(r,g,b)' — same string the renderer uses. */
  readonly rgb: string;
}

declare interface CustomLineColor {
  r: number; g: number; b: number; alpha?: number;
}

declare interface CustomLineOptions {
  color?: string | CustomLineColor;
  style?: 'solid' | 'dash' | 'dot' | 'dashDot' | 'dashDotDot' | number;
  arrow?: boolean;
}

declare interface ConnectOptions {
  direction?: Direction;
  oneWay?: boolean;
}

// ── Read ───────────────────────────────────────────────────────────────

/** Return a fresh snapshot array of all rooms. */
declare function rooms(): Room[];
/** Return rooms matching the predicate. */
declare function findRooms(pred: (r: Room) => boolean): Room[];
/** Return a snapshot of one room, or undefined. */
declare function room(id: number): Room | undefined;
/** List of all areas. */
declare function areas(): Area[];
/** Lookup one area by id. */
declare function area(id: number): Area;
/** List of every environment known to the map (default palette + custom + ids used by rooms). */
declare function envs(): Env[];
/** Look up one environment by id. Returns undefined if unknown and unused. */
declare function env(id: number): Env | undefined;
/** Cardinal direction between two rooms, inferred from map coordinates. */
declare function directionBetween(fromId: number, toId: number): Direction | null;

/** The area currently shown in the editor. */
declare const currentAreaId: number | null;
/** Current z-level shown in the editor. */
declare const currentZ: number;
/** All cardinal directions. */
declare const DIRS: readonly Direction[];

// ── I/O ────────────────────────────────────────────────────────────────

/** Append to the script Log panel. */
declare function log(...args: any[]): void;

declare const console: {
  /** Alias for log(). */
  log(...args: any[]): void;
};

// ── Write (collected into one undo batch) ──────────────────────────────

/** Set a room name. */
declare function setRoomName(id: number, name: string): void;
/** Set a room environment (paint colour). */
declare function setRoomEnv(id: number, env: number): void;
/** Set a room symbol / character. */
declare function setRoomSymbol(id: number, symbol: string): void;
/** Set a room weight. */
declare function setRoomWeight(id: number, weight: number): void;
/** Lock / unlock a room. */
declare function setRoomLock(id: number, locked: boolean): void;
/** Move a room. Coords are raw Mudlet (y = north is +). */
declare function moveRoom(id: number, x: number, y: number, z: number): void;
/** Set a cardinal exit. toId < 0 removes it. */
declare function setExit(fromId: number, dir: Direction, toId: number): void;
/** Set door state: 0=none, 1=open, 2=closed, 3=locked. */
declare function setDoor(roomId: number, dir: Direction, value: number): void;
/** Set exit traversal weight. */
declare function setExitWeight(roomId: number, dir: Direction, value: number): void;
/** Lock / unlock an exit. */
declare function setExitLock(roomId: number, dir: Direction, locked: boolean): void;
/** Add / remove a stub. */
declare function setStub(roomId: number, dir: Direction, stub: boolean): void;
/** Set a room userData entry. Pass null to delete. */
declare function setUserData(roomId: number, key: string, value: string | null): void;
/** Set a special (named) exit. toId < 0 removes it. */
declare function setSpecialExit(roomId: number, name: string, toId: number): void;
/** Link two rooms. Direction inferred from coords for 2D cardinals; pass { direction } for up/down/in/out. */
declare function connectRooms(fromId: number, toId: number, options?: ConnectOptions): Direction | null;
/** Remove a cardinal exit (and its reverse unless oneWay: true). */
declare function disconnect(fromId: number, dir: Direction, options?: { oneWay?: boolean }): void;
/** Draw a custom line on a room exit. Points are raw Mudlet [x, y] pairs. */
declare function setCustomLine(roomId: number, exitName: string, points: Array<[number, number]>, options?: CustomLineOptions): void;
/** Remove a custom line from a room exit. */
declare function removeCustomLine(roomId: number, exitName: string): void;
`.trim();
