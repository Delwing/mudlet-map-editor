/**
 * Metadata for script API symbols — consumed by the CodeMirror completion
 * source in ScriptPanel. Keep in sync with the `api` object in `script.ts`.
 */

export type ApiKind = 'function' | 'variable' | 'namespace';

/** Simplified return-type tag used to pick member completions after `x.` or `fn().`. */
export type ApiReturnType = 'Room' | 'RoomArray' | 'Area' | 'AreaArray' | 'Env' | 'EnvArray' | 'Direction' | 'DirectionArray' | 'void' | 'number' | 'string' | 'boolean' | 'unknown';

export interface ApiEntry {
  name: string;
  kind: ApiKind;
  signature?: string;
  detail: string;
  /** Short human description shown in completion popup. */
  info: string;
  /** Return type for functions / inferred type for variables. Used by the completion engine. */
  returns?: ApiReturnType;
}

export const SCRIPT_API: ApiEntry[] = [
  // ── Read ────────────────────────────────────────────────────────────────
  { name: 'rooms', kind: 'function', signature: 'rooms(): Room[]',
    detail: 'Read', info: 'Return a fresh snapshot array of all rooms.', returns: 'RoomArray' },
  { name: 'findRooms', kind: 'function', signature: 'findRooms(pred: (r: Room) => boolean): Room[]',
    detail: 'Read', info: 'Return rooms matching the predicate.', returns: 'RoomArray' },
  { name: 'room', kind: 'function', signature: 'room(id: number): Room | undefined',
    detail: 'Read', info: 'Return a snapshot of one room, or undefined.', returns: 'Room' },
  { name: 'areas', kind: 'function', signature: 'areas(): { id, name }[]',
    detail: 'Read', info: 'List of all areas.', returns: 'AreaArray' },
  { name: 'area', kind: 'function', signature: 'area(id: number): { id, name }',
    detail: 'Read', info: 'Lookup one area by id.', returns: 'Area' },
  { name: 'envs', kind: 'function', signature: 'envs(): Env[]',
    detail: 'Read', info: 'List of every environment known to the map (default palette + custom + ids used by rooms).', returns: 'EnvArray' },
  { name: 'env', kind: 'function', signature: 'env(id: number): Env | undefined',
    detail: 'Read', info: 'Look up one environment by id. Returns { id, custom, r, g, b, hex, rgb } or undefined.', returns: 'Env' },
  { name: 'currentAreaId', kind: 'variable', detail: 'number | null',
    info: 'The area currently shown in the editor.', returns: 'number' },
  { name: 'currentZ', kind: 'variable', detail: 'number',
    info: 'Current z-level shown in the editor.', returns: 'number' },
  { name: 'DIRS', kind: 'variable', detail: 'Direction[]',
    info: "All cardinal directions: 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest', 'up', 'down', 'in', 'out'.", returns: 'DirectionArray' },
  { name: 'log', kind: 'function', signature: 'log(...args): void',
    detail: 'I/O', info: 'Append to the script Log panel.', returns: 'void' },
  { name: 'console', kind: 'namespace', detail: '{ log }',
    info: "Alias for log — so console.log(...) works too." },

  // ── Write ───────────────────────────────────────────────────────────────
  { name: 'setRoomName', kind: 'function', signature: 'setRoomName(id: number, name: string)',
    detail: 'Write', info: 'Set a room name.', returns: 'void' },
  { name: 'setRoomEnv', kind: 'function', signature: 'setRoomEnv(id: number, env: number)',
    detail: 'Write', info: 'Set a room environment (paint color).', returns: 'void' },
  { name: 'setRoomSymbol', kind: 'function', signature: 'setRoomSymbol(id: number, symbol: string)',
    detail: 'Write', info: 'Set a room symbol/char.', returns: 'void' },
  { name: 'setRoomWeight', kind: 'function', signature: 'setRoomWeight(id: number, weight: number)',
    detail: 'Write', info: 'Set a room weight.', returns: 'void' },
  { name: 'setRoomLock', kind: 'function', signature: 'setRoomLock(id: number, locked: boolean)',
    detail: 'Write', info: 'Lock / unlock a room.', returns: 'void' },
  { name: 'moveRoom', kind: 'function', signature: 'moveRoom(id: number, x: number, y: number, z: number)',
    detail: 'Write', info: 'Move a room. Coords are raw Mudlet (y = north is +).', returns: 'void' },
  { name: 'setExit', kind: 'function', signature: 'setExit(fromId: number, dir: Direction, toId: number)',
    detail: 'Write', info: 'Set a cardinal exit. toId < 0 removes it.', returns: 'void' },
  { name: 'setDoor', kind: 'function', signature: 'setDoor(roomId: number, dir: Direction, value: number)',
    detail: 'Write', info: 'Set door state: 0=none, 1=open, 2=closed, 3=locked.', returns: 'void' },
  { name: 'setExitWeight', kind: 'function', signature: 'setExitWeight(roomId: number, dir: Direction, value: number)',
    detail: 'Write', info: 'Set exit traversal weight.', returns: 'void' },
  { name: 'setExitLock', kind: 'function', signature: 'setExitLock(roomId: number, dir: Direction, locked: boolean)',
    detail: 'Write', info: 'Lock / unlock an exit.', returns: 'void' },
  { name: 'setStub', kind: 'function', signature: 'setStub(roomId: number, dir: Direction, stub: boolean)',
    detail: 'Write', info: 'Add / remove a stub.', returns: 'void' },
  { name: 'setUserData', kind: 'function', signature: 'setUserData(roomId: number, key: string, value: string | null)',
    detail: 'Write', info: 'Set a room userData entry. Pass null to delete.', returns: 'void' },
  { name: 'setSpecialExit', kind: 'function', signature: 'setSpecialExit(roomId: number, name: string, toId: number)',
    detail: 'Write', info: 'Set a special (named) exit. toId < 0 removes it.', returns: 'void' },
  { name: 'connectRooms', kind: 'function',
    signature: 'connectRooms(fromId, toId, { direction?, oneWay? }?): Direction | null',
    detail: 'Write',
    info: 'Link two rooms. Direction is inferred from coords for 2D cardinals; pass { direction } for up/down/in/out. Bidirectional unless { oneWay: true }. Returns the direction used.',
    returns: 'Direction' },
  { name: 'disconnect', kind: 'function',
    signature: 'disconnect(fromId, dir, { oneWay? }?)',
    detail: 'Write',
    info: 'Remove a cardinal exit. If the target points back, its reverse exit is also cleared unless { oneWay: true }.',
    returns: 'void' },
  { name: 'setCustomLine', kind: 'function',
    signature: "setCustomLine(roomId, exitName, points, { color?, style?, arrow? }?)",
    detail: 'Write',
    info: "Draw a custom line on a room exit. Points are raw Mudlet [x, y] pairs (y = north is +). color: '#rrggbb' or { r,g,b }. style: 'solid' | 'dash' | 'dot' | 'dashDot' | 'dashDotDot'.",
    returns: 'void' },
  { name: 'removeCustomLine', kind: 'function',
    signature: 'removeCustomLine(roomId, exitName)',
    detail: 'Write',
    info: 'Remove a custom line from a room exit.',
    returns: 'void' },
  { name: 'directionBetween', kind: 'function',
    signature: 'directionBetween(fromId, toId): Direction | null',
    detail: 'Read',
    info: 'Cardinal direction between two rooms based on their map coordinates.',
    returns: 'Direction' },
];

/** Fields available on an Area, used as completions after `.` on an area variable. */
export const AREA_FIELDS: ApiEntry[] = [
  { name: 'id', kind: 'variable', detail: 'number', info: 'Area id.' },
  { name: 'name', kind: 'variable', detail: 'string', info: 'Area name.' },
];

/** Fields available on an Env snapshot, used as completions after `.` on an env variable. */
export const ENV_FIELDS: ApiEntry[] = [
  { name: 'id', kind: 'variable', detail: 'number', info: 'Environment id.' },
  { name: 'custom', kind: 'variable', detail: 'boolean', info: 'True if the env has a custom color override (map.mCustomEnvColors).' },
  { name: 'r', kind: 'variable', detail: 'number', info: 'Red channel (0–255).' },
  { name: 'g', kind: 'variable', detail: 'number', info: 'Green channel (0–255).' },
  { name: 'b', kind: 'variable', detail: 'number', info: 'Blue channel (0–255).' },
  { name: 'hex', kind: 'variable', detail: 'string', info: "Color as '#rrggbb'." },
  { name: 'rgb', kind: 'variable', detail: 'string', info: "Color as 'rgb(r,g,b)' — the same string the renderer uses." },
];

/**
 * A curated subset of Array.prototype members, used as completions after `.`
 * on any expression whose inferred type is an array.
 */
export const ARRAY_METHODS: ApiEntry[] = [
  { name: 'length', kind: 'variable', detail: 'number', info: 'Number of elements.' },
  { name: 'at', kind: 'function', signature: 'at(index: number)', detail: 'Array', info: 'Element at index (supports negative indices).' },
  { name: 'concat', kind: 'function', signature: 'concat(...items)', detail: 'Array', info: 'Returns a new array joining this one with the arguments.' },
  { name: 'every', kind: 'function', signature: 'every(pred)', detail: 'Array', info: 'True if every element satisfies the predicate.' },
  { name: 'filter', kind: 'function', signature: 'filter(pred)', detail: 'Array', info: 'New array of elements matching the predicate.' },
  { name: 'find', kind: 'function', signature: 'find(pred)', detail: 'Array', info: 'First element matching the predicate, or undefined.' },
  { name: 'findIndex', kind: 'function', signature: 'findIndex(pred)', detail: 'Array', info: 'Index of first match, or -1.' },
  { name: 'findLast', kind: 'function', signature: 'findLast(pred)', detail: 'Array', info: 'Last element matching the predicate.' },
  { name: 'findLastIndex', kind: 'function', signature: 'findLastIndex(pred)', detail: 'Array', info: 'Index of last match, or -1.' },
  { name: 'flat', kind: 'function', signature: 'flat(depth?)', detail: 'Array', info: 'Flatten nested arrays.' },
  { name: 'flatMap', kind: 'function', signature: 'flatMap(fn)', detail: 'Array', info: 'Map then flatten one level.' },
  { name: 'forEach', kind: 'function', signature: 'forEach(fn)', detail: 'Array', info: 'Call fn for each element.' },
  { name: 'includes', kind: 'function', signature: 'includes(value)', detail: 'Array', info: 'True if value is present.' },
  { name: 'indexOf', kind: 'function', signature: 'indexOf(value)', detail: 'Array', info: 'Index of value, or -1.' },
  { name: 'join', kind: 'function', signature: 'join(sep?)', detail: 'Array', info: 'Join elements into a string.' },
  { name: 'lastIndexOf', kind: 'function', signature: 'lastIndexOf(value)', detail: 'Array', info: 'Last index of value, or -1.' },
  { name: 'map', kind: 'function', signature: 'map(fn)', detail: 'Array', info: 'New array where each element is replaced by fn(element).' },
  { name: 'reduce', kind: 'function', signature: 'reduce(fn, init?)', detail: 'Array', info: 'Fold left.' },
  { name: 'reduceRight', kind: 'function', signature: 'reduceRight(fn, init?)', detail: 'Array', info: 'Fold right.' },
  { name: 'slice', kind: 'function', signature: 'slice(from?, to?)', detail: 'Array', info: 'Shallow copy of a section.' },
  { name: 'some', kind: 'function', signature: 'some(pred)', detail: 'Array', info: 'True if any element matches the predicate.' },
  { name: 'sort', kind: 'function', signature: 'sort(cmp?)', detail: 'Array', info: 'Sort in place (mutates the returned snapshot).' },
  { name: 'reverse', kind: 'function', signature: 'reverse()', detail: 'Array', info: 'Reverse in place (mutates the returned snapshot).' },
  { name: 'entries', kind: 'function', signature: 'entries()', detail: 'Array', info: 'Iterator of [index, value] pairs.' },
  { name: 'keys', kind: 'function', signature: 'keys()', detail: 'Array', info: 'Iterator of indices.' },
  { name: 'values', kind: 'function', signature: 'values()', detail: 'Array', info: 'Iterator of elements.' },
];

/** Fields available on a Room snapshot, used as completions after `.` on a room variable. */
export const ROOM_FIELDS: ApiEntry[] = [
  { name: 'id', kind: 'variable', detail: 'number', info: 'Room id.' },
  { name: 'x', kind: 'variable', detail: 'number', info: 'X coordinate (raw).' },
  { name: 'y', kind: 'variable', detail: 'number', info: 'Y coordinate (raw Mudlet, +y = north).' },
  { name: 'z', kind: 'variable', detail: 'number', info: 'Z level.' },
  { name: 'area', kind: 'variable', detail: 'number', info: 'Area id.' },
  { name: 'name', kind: 'variable', detail: 'string', info: 'Room name.' },
  { name: 'environment', kind: 'variable', detail: 'number', info: 'Environment/env id.' },
  { name: 'symbol', kind: 'variable', detail: 'string', info: 'Room symbol/char.' },
  { name: 'weight', kind: 'variable', detail: 'number', info: 'Room weight.' },
  { name: 'isLocked', kind: 'variable', detail: 'boolean', info: 'Whether the room is locked.' },
  { name: 'userData', kind: 'variable', detail: 'Record<string, string>', info: 'User-data key/value pairs.' },
  { name: 'doors', kind: 'variable', detail: 'Record<string, number>', info: 'Door states by short direction key.' },
  { name: 'exitWeights', kind: 'variable', detail: 'Record<string, number>', info: 'Exit weights by short direction key.' },
  { name: 'specialExits', kind: 'variable', detail: 'Record<string, number>', info: 'Named special exits.' },
  { name: 'stubs', kind: 'variable', detail: 'number[]', info: 'Stub direction indices.' },
  { name: 'exitLocks', kind: 'variable', detail: 'number[]', info: 'Locked exit direction indices.' },
  { name: 'north', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'south', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'east', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'west', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'northeast', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'northwest', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'southeast', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'southwest', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'up', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'down', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'in', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
  { name: 'out', kind: 'variable', detail: 'number', info: 'Target room id, or -1.' },
];
