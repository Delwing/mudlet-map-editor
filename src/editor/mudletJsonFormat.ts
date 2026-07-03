/**
 * Mudlet's official JSON map format (`exportJsonMap` / `importJsonMap`).
 *
 * This is a real interchange codec, not a dump of our in-memory model: it maps
 * `MudletMap` (the binary model) to and from the exact JSON schema Mudlet's C++
 * writes (`TMap::writeJsonMapFile` / `TArea::writeJsonArea` / `TRoom::writeJsonRoom`,
 * formatVersion 1). Files produced here load in real Mudlet and vice versa.
 *
 * Schema highlights that differ from our model:
 *   - Rooms are nested inside `areas[].rooms[]`, never top-level.
 *   - `coordinates` is a flat `[x, y, z]` array; label `size` is `[w, h]`.
 *   - Exits are a flat array mixing normal + special exits; the direction is the
 *     `name` field (long spelling: "northeast", not "ne") and `exitId` is the
 *     destination. Doors are "open"/"closed"/"locked"; `locked` is the routing lock.
 *   - Colors are `color24RGB: [r,g,b]` (opaque) or `color32RGBA: [r,g,b,a]`.
 *   - Most fields are omitted at their default and must be re-defaulted on read.
 *
 * Fidelity is interop-first: a few Mudlet-only room fields our model can't hold
 * (symbol/border colour, hidden flag) are dropped; everything geometric and
 * navigational round-trips.
 */
import { Buffer } from 'buffer';
import type { MapFormat } from './formats';
import type { MudletMap, MudletRoom, MudletColor } from '../mapIO';

// --- direction tables ---------------------------------------------------------
// Our model stores exits as flat per-direction fields plus parallel maps keyed by
// SHORT code (doors/customLines/exitWeights) and numeric dir codes (locks/stubs).
// Mudlet JSON uses the LONG name. This table bridges all three.
interface Dir { field: keyof MudletRoom; long: string; short: string; code: number }
const DIRS: Dir[] = [
  { field: 'north',     long: 'north',     short: 'n',    code: 1 },
  { field: 'northeast', long: 'northeast', short: 'ne',   code: 2 },
  { field: 'northwest', long: 'northwest', short: 'nw',   code: 3 },
  { field: 'east',      long: 'east',      short: 'e',    code: 4 },
  { field: 'west',      long: 'west',      short: 'w',    code: 5 },
  { field: 'south',     long: 'south',     short: 's',    code: 6 },
  { field: 'southeast', long: 'southeast', short: 'se',   code: 7 },
  { field: 'southwest', long: 'southwest', short: 'sw',   code: 8 },
  { field: 'up',        long: 'up',        short: 'up',   code: 9 },
  { field: 'down',      long: 'down',      short: 'down', code: 10 },
  { field: 'in',        long: 'in',        short: 'in',   code: 11 },
  { field: 'out',       long: 'out',       short: 'out',  code: 12 },
];
const DIR_BY_LONG = new Map(DIRS.map((d) => [d.long, d]));
const DIR_BY_CODE = new Map(DIRS.map((d) => [d.code, d]));

const DOOR_TO_STR: Record<number, string> = { 1: 'open', 2: 'closed', 3: 'locked' };
const DOOR_FROM_STR: Record<string, number> = { open: 1, closed: 2, locked: 3 };

// Qt::PenStyle codes → Mudlet's JSON style strings (solid = 1 is omitted).
const STYLE_TO_STR: Record<number, string> = { 2: 'dash line', 3: 'dot line', 4: 'dash dot line', 5: 'dash dot dot line' };
const STYLE_FROM_STR: Record<string, number> = { 'dash line': 2, 'dot line': 3, 'dash dot line': 4, 'dash dot dot line': 5 };

// --- colour helpers -----------------------------------------------------------
function colorToJson(c: MudletColor): Record<string, number[]> {
  const rgb = [c.r, c.g, c.b];
  return c.alpha >= 255 ? { color24RGB: rgb } : { color32RGBA: [...rgb, c.alpha] };
}
function colorFromJson(obj: any): MudletColor {
  const arr: number[] = obj?.color24RGB ?? obj?.color32RGBA ?? [255, 255, 255];
  const [r, g, b, a] = arr;
  return { spec: 1, alpha: a ?? 255, r, g, b, pad: 0 };
}

// --- base64 (label pixmaps) ---------------------------------------------------
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}
function base64ToUint8(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64; // tolerate data: URLs
  const binary = atob(clean.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- font (QFont::toString / fromString, tolerant subset) ---------------------
function fontToDetails(f: any): string {
  if (!f || !f.family) return '';
  const italic = f.styleOblique ? 1 : 0;
  // 10-field QFont string form that QFont::fromString accepts:
  // family,pointSize,pixelSize,styleHint,weight,italic,underline,strikeOut,fixedPitch,rawMode
  return [
    f.family,
    f.pointSize > 0 ? f.pointSize : 12,
    f.pixelSize > 0 ? f.pixelSize : -1,
    f.styleHint ?? 5,
    f.weight ?? 50,
    italic,
    f.underline ? 1 : 0,
    f.strikeOut ? 1 : 0,
    f.fixedPitch ? 1 : 0,
    0,
  ].join(',');
}
function fontFromDetails(s: string | undefined): any {
  const parts = (s ?? '').split(',');
  return {
    family: parts[0] ?? '', style: '',
    pointSize: Number(parts[1]) || -1, pixelSize: -1,
    styleHint: Number(parts[3]) || 5, styleStrategy: 0,
    weight: Number(parts[4]) || 50, fontBits: 0, stretch: 0, extendedFontBits: 0,
    letterSpacing: 0, wordSpacing: 0, hintingPreference: 0, capital: 0,
    styleSetting: false, underline: false, overline: false, strikeOut: false,
    fixedPitch: false, kerning: true, styleOblique: false, ignorePitch: false,
    letterSpacingIsAbsolute: false,
  };
}

// =============================================================================
// EXPORT: MudletMap → Mudlet JSON
// =============================================================================

function customLineToJson(room: MudletRoom, key: string, points: [number, number][]): any {
  const cl: any = { coordinates: points.map(([x, y]) => [x, y]) };
  const color = room.customLinesColor?.[key];
  if (color) Object.assign(cl, colorToJson(color));
  cl.endsInArrow = !!room.customLinesArrow?.[key];
  const styleStr = STYLE_TO_STR[room.customLinesStyle?.[key] as number];
  if (styleStr) cl.style = styleStr; // solid lines omit the key
  return cl;
}

/** True if a special exit (command → dest) is locked, per the raw "0/1"-prefixed encoding. */
function specialExitLocked(room: MudletRoom, cmd: string, dest: number): boolean {
  const raw = room.rawSpecialExits?.[dest];
  if (raw) for (const s of raw) if (s.slice(1) === cmd) return s[0] === '1';
  return false;
}

function exitsToJson(room: MudletRoom): any[] {
  const exits: any[] = [];
  const emit = (name: string, dest: number, key: string, locked: boolean) => {
    if (typeof dest !== 'number' || dest < 1) return;
    const ex: any = { name, exitId: dest };
    const door = room.doors?.[key];
    if (door) ex.door = DOOR_TO_STR[door];
    const weight = room.exitWeights?.[key];
    if (weight != null) ex.weight = weight;
    if (locked) ex.locked = true;
    const cl = room.customLines?.[key];
    if (cl && cl.length) ex.customLine = customLineToJson(room, key, cl); // Mudlet omits point-less lines
    exits.push(ex);
  };
  for (const d of DIRS) {
    emit(d.long, room[d.field] as number, d.short, (room.exitLocks ?? []).includes(d.code));
  }
  // Mudlet iterates special exits from a Qt QMap (sorted by command). Match that
  // ordering with a plain code-unit compare (Qt's QString::operator<).
  const special = Object.entries(room.mSpecialExits ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [cmd, dest] of special) {
    emit(cmd, dest as number, cmd, specialExitLocked(room, cmd, dest as number));
  }
  return exits;
}

function stubExitsToJson(room: MudletRoom): any[] {
  // Mudlet sorts stub direction names alphabetically and writes no door on stubs
  // (its stub door lookup keys off the long name, which never matches its
  // short-keyed door map — so stub doors are always dropped). Match that exactly.
  const names = (room.stubs ?? [])
    .map((code) => DIR_BY_CODE.get(code)?.long)
    .filter((n): n is string => !!n);
  names.sort();
  return names.map((name) => ({ name }));
}

function roomToJson(id: number, room: MudletRoom): any {
  const r: any = { id };
  if (room.name) r.name = room.name;
  r.coordinates = [room.x, room.y, room.z];
  if (room.isLocked) r.locked = true;
  if (room.weight !== 1) r.weight = room.weight;
  if (room.symbol) r.symbol = { text: room.symbol };
  r.environment = room.environment;
  if (room.hash) r.hash = room.hash;
  r.exits = exitsToJson(room);
  const stubs = stubExitsToJson(room);
  if (stubs.length) r.stubExits = stubs;
  if (room.userData && Object.keys(room.userData).length) r.userData = room.userData;
  return r;
}

function labelToJson(l: any): any {
  const o: any = {
    id: l.id,
    coordinates: [l.pos[0], l.pos[1], l.pos[2]],
    size: [l.size[0], l.size[1]],
  };
  if (l.text) o.text = l.text;
  o.colors = [colorToJson(l.fgColor), colorToJson(l.bgColor)];
  const bytes = l.pixMap instanceof Uint8Array ? l.pixMap
    : typeof l.pixMap === 'string' ? base64ToUint8(l.pixMap) : new Uint8Array(0);
  o.image = [uint8ToBase64(bytes)];
  o.showOnTop = !!l.showOnTop;
  o.scaledels = !l.noScaling; // note Mudlet's literal (inverted) key spelling
  return o;
}

function serialize(map: MudletMap): Uint8Array {
  const areas = Object.entries(map.areas).map(([idStr, area]) => {
    const id = Number(idStr);
    const a: any = { id, name: map.areaNames[id] ?? '' };
    if (area.gridMode) a.gridMode = true;
    if (area.userData && Object.keys(area.userData).length) a.userData = area.userData;
    const rooms = area.rooms.filter((rid) => map.rooms[rid]).map((rid) => roomToJson(rid, map.rooms[rid]));
    a.roomCount = rooms.length;
    a.rooms = rooms;
    const labels = map.labels[id];
    if (labels && labels.length) a.labels = labels.map(labelToJson);
    return a;
  });

  const doc: any = {
    formatVersion: 1,
    areaCount: areas.length,
    roomCount: Object.keys(map.rooms).length,
    labelCount: Object.values(map.labels).reduce((n, ls) => n + (ls?.length ?? 0), 0),
    defaultAreaName: map.areaNames[-1] ?? 'Default Area',
    anonymousAreaName: 'Unnamed Area',
    playersRoomId: {},
    customEnvColors: Object.entries(map.mCustomEnvColors ?? {}).map(([id, c]) => ({ id: Number(id), ...colorToJson(c) })),
    mapSymbolFontDetails: fontToDetails(map.mapSymbolFont),
    mapSymbolFontFudgeFactor: map.mapFontFudgeFactor ?? 1,
    onlyMapSymbolFontToBeUsed: !!map.useOnlyMapFont,
    playerRoomColors: [{ color24RGB: [255, 0, 0] }, { color24RGB: [255, 255, 255] }],
    playerRoomStyle: 0,
    playerRoomOuterDiameterPercentage: 120,
    playerRoomInnerDiameterPercentage: 70,
    areas,
  };
  const env = map.envColors ?? {};
  if (Object.keys(env).length) doc.envToColorMapping = { ...env };
  if (map.mUserData && Object.keys(map.mUserData).length) doc.userData = map.mUserData;

  // Qt's QJsonObject serialises keys alphabetically; match that so our output is
  // byte-identical to Mudlet's own export.
  return new TextEncoder().encode(JSON.stringify(sortKeysDeep(doc), null, 2));
}

/** Recursively re-key every object with sorted keys (arrays keep their order). */
function sortKeysDeep(x: any): any {
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  if (x && typeof x === 'object') {
    const out: any = {};
    for (const k of Object.keys(x).sort()) out[k] = sortKeysDeep(x[k]);
    return out;
  }
  return x;
}

// =============================================================================
// IMPORT: Mudlet JSON → MudletMap
// =============================================================================

function emptyRoom(area: number): MudletRoom {
  return {
    area, x: 0, y: 0, z: 0,
    north: -1, northeast: -1, east: -1, southeast: -1, south: -1, southwest: -1,
    west: -1, northwest: -1, up: -1, down: -1, in: -1, out: -1,
    environment: -1, weight: 1, name: '', isLocked: false,
    rawSpecialExits: {}, mSpecialExits: {}, mSpecialExitLocks: [],
    symbol: '', userData: {},
    customLines: {}, customLinesArrow: {}, customLinesColor: {}, customLinesStyle: {},
    exitLocks: [], stubs: [], exitWeights: {}, doors: {},
  };
}

function applyCustomLine(room: MudletRoom, key: string, cl: any): void {
  room.customLines[key] = (cl.coordinates ?? []).map(([x, y]: number[]) => [x, y] as [number, number]);
  room.customLinesArrow[key] = !!cl.endsInArrow;
  room.customLinesColor[key] = (cl.color24RGB || cl.color32RGBA) ? colorFromJson(cl) : { spec: 1, alpha: 255, r: 191, g: 191, b: 191, pad: 0 };
  room.customLinesStyle[key] = STYLE_FROM_STR[cl.style] ?? 1; // absent style = solid
}

function roomFromJson(r: any, areaId: number): MudletRoom {
  const room = emptyRoom(areaId);
  room.name = r.name ?? '';
  const [x, y, z] = r.coordinates ?? [0, 0, 0];
  room.x = x; room.y = y; room.z = z;
  room.isLocked = !!r.locked;
  room.weight = r.weight ?? 1;
  room.symbol = r.symbol?.text ?? '';
  room.environment = r.environment ?? -1;
  if (r.hash) room.hash = r.hash;
  if (r.userData && typeof r.userData === 'object') room.userData = r.userData;

  for (const ex of r.exits ?? []) {
    const dir = DIR_BY_LONG.get(ex.name);
    const dest = ex.exitId;
    if (dir) {
      (room as any)[dir.field] = dest;
      if (ex.door) room.doors[dir.short] = DOOR_FROM_STR[ex.door];
      if (ex.weight != null) room.exitWeights[dir.short] = ex.weight;
      if (ex.locked) room.exitLocks.push(dir.code);
      if (ex.customLine) applyCustomLine(room, dir.short, ex.customLine);
    } else {
      // Special (named) exit.
      room.mSpecialExits[ex.name] = dest;
      (room.rawSpecialExits![dest] ??= []).push((ex.locked ? '1' : '0') + ex.name);
      if (ex.door) room.doors[ex.name] = DOOR_FROM_STR[ex.door];
      if (ex.weight != null) room.exitWeights[ex.name] = ex.weight;
      if (ex.customLine) applyCustomLine(room, ex.name, ex.customLine);
    }
  }
  for (const st of r.stubExits ?? []) {
    const dir = DIR_BY_LONG.get(st.name);
    if (!dir) continue;
    room.stubs.push(dir.code);
    if (st.door) room.doors[dir.short] = DOOR_FROM_STR[st.door];
  }
  return room;
}

function labelFromJson(l: any): any {
  const image = (Array.isArray(l.image) ? l.image.join('') : (l.image ?? '')).replace(/\s+/g, '');
  const clean = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image; // tolerate data: URLs
  const [fg, bg] = l.colors ?? [];
  return {
    id: l.id,
    pos: l.coordinates ?? [0, 0, 0],
    size: l.size ?? [0, 0],
    text: l.text ?? '',
    fgColor: fg ? colorFromJson(fg) : { spec: 1, alpha: 255, r: 255, g: 255, b: 255, pad: 0 },
    bgColor: bg ? colorFromJson(bg) : { spec: 1, alpha: 255, r: 50, g: 50, b: 50, pad: 0 },
    // Must be a Buffer (not a bare Uint8Array): the editor derives the renderer's
    // base64 via pixMap.toString('base64'), which only works on a Buffer.
    pixMap: clean ? Buffer.from(clean, 'base64') : Buffer.alloc(0),
    noScaling: !(l.scaledels ?? true),
    showOnTop: !!l.showOnTop,
  };
}

/** Recompute the spatial bookkeeping our model/binary writer expect from room coords. */
function computeAreaGeometry(roomIds: number[], rooms: Record<number, MudletRoom>) {
  const g: any = {
    max_x: 0, max_y: 0, max_z: 0, min_x: 0, min_y: 0, min_z: 0,
    span: [0, 0, 0] as [number, number, number],
    zLevels: [0], xmaxForZ: {}, ymaxForZ: {}, xminForZ: {}, yminForZ: {},
    pos: [0, 0, 0] as [number, number, number], mAreaExits: {},
  };
  const present = roomIds.map((id) => rooms[id]).filter(Boolean);
  if (!present.length) return g;
  const zset = new Set<number>();
  let first = true;
  for (const r of present) {
    if (first) { g.min_x = g.max_x = r.x; g.min_y = g.max_y = r.y; g.min_z = g.max_z = r.z; first = false; }
    g.min_x = Math.min(g.min_x, r.x); g.max_x = Math.max(g.max_x, r.x);
    g.min_y = Math.min(g.min_y, r.y); g.max_y = Math.max(g.max_y, r.y);
    g.min_z = Math.min(g.min_z, r.z); g.max_z = Math.max(g.max_z, r.z);
    zset.add(r.z);
    g.xmaxForZ[r.z] = g.xmaxForZ[r.z] == null ? r.x : Math.max(g.xmaxForZ[r.z], r.x);
    g.xminForZ[r.z] = g.xminForZ[r.z] == null ? r.x : Math.min(g.xminForZ[r.z], r.x);
    g.ymaxForZ[r.z] = g.ymaxForZ[r.z] == null ? r.y : Math.max(g.ymaxForZ[r.z], r.y);
    g.yminForZ[r.z] = g.yminForZ[r.z] == null ? r.y : Math.min(g.yminForZ[r.z], r.y);
  }
  g.zLevels = [...zset].sort((a, b) => a - b);
  g.span = [g.max_x - g.min_x, g.max_y - g.min_y, g.max_z - g.min_z];
  g.pos = [Math.round((g.min_x + g.max_x) / 2), Math.round((g.min_y + g.max_y) / 2), Math.round((g.min_z + g.max_z) / 2)];
  return g;
}

function parse(bytes: ArrayBuffer): MudletMap {
  const doc = JSON.parse(new TextDecoder().decode(bytes));

  const map: MudletMap = {
    version: 20, rooms: {}, areas: {}, areaNames: {},
    mCustomEnvColors: {}, envColors: {}, mpRoomDbHashToRoomId: {}, mRoomIdHash: {},
    mUserData: (doc.userData && typeof doc.userData === 'object') ? doc.userData : {},
    labels: {},
    mapSymbolFont: fontFromDetails(doc.mapSymbolFontDetails),
    mapFontFudgeFactor: doc.mapSymbolFontFudgeFactor ?? 1,
    useOnlyMapFont: !!doc.onlyMapSymbolFontToBeUsed,
  };

  for (const areaJson of doc.areas ?? []) {
    const aid = areaJson.id;
    map.areaNames[aid] = areaJson.name ?? '';
    const roomIds: number[] = [];
    for (const rJson of areaJson.rooms ?? []) {
      const room = roomFromJson(rJson, aid);
      map.rooms[rJson.id] = room;
      roomIds.push(rJson.id);
      if (room.hash) { map.mRoomIdHash[room.hash] = rJson.id; map.mpRoomDbHashToRoomId[room.hash] = rJson.id; }
    }
    const labels = (areaJson.labels ?? []).map(labelFromJson);
    if (labels.length) map.labels[aid] = labels;

    map.areas[aid] = {
      rooms: roomIds,
      gridMode: !!areaJson.gridMode,
      userData: (areaJson.userData && typeof areaJson.userData === 'object') ? areaJson.userData : {},
      isZone: false, zoneAreaRef: -1,
      ...computeAreaGeometry(roomIds, map.rooms),
    };
  }

  if (doc.envToColorMapping) {
    for (const [k, v] of Object.entries(doc.envToColorMapping)) map.envColors[Number(k)] = Number(v);
  }
  for (const c of doc.customEnvColors ?? []) {
    if (c && typeof c.id === 'number') map.mCustomEnvColors[c.id] = colorFromJson(c);
  }

  return map;
}

// --- the format ---------------------------------------------------------------
export const mudletJsonFormat: MapFormat = {
  id: 'mudlet-json',
  label: 'Mudlet map (JSON)',
  extensions: ['.json'],
  parse: (bytes) => parse(bytes),
  serialize: (map) => serialize(map),
};
