import type { MudletMap, MudletRoom, MudletColor } from '../../mapIO';
import type { LabelSnapshot } from '../types';
import { buildRendererInput } from '../../mapIO';
import { CARDINAL_DIRECTIONS, DIR_SHORT, DIR_INDEX, DEFAULT_LABEL_FONT, type Direction, type LabelFont } from '../types';
import { generateLabelPixmap, dataUrlToBuffer } from '../labelPixmap';

/** Editor-side Exit — mirrors the renderer's Exit type. */
export interface EditorExit {
  a: number;
  b: number;
  aDir?: Direction;
  bDir?: Direction;
  zIndex: number[];
}

/** Live view over a raw MudletRoom. Y is flipped for render-space consumption. */
export interface LiveRoom {
  readonly id: number;
  x: number;
  y: number;
  z: number;
  readonly area: number;
  readonly name: string;
  readonly weight: number;
  readonly env: number | undefined;
  readonly roomChar: string | undefined;
  readonly userData: Record<string, string>;
  readonly doors: Record<string, number>;
  readonly isLocked: boolean;
  readonly exitLocks: number[];
  readonly stubs: number[];
  readonly exitWeights: Record<string, number>;
  readonly mSpecialExitLocks: number[];
  readonly exits: Record<string, number>;
  readonly specialExits: Record<string, number>;
  readonly customLines: Record<string, any>;
  readonly hash?: string;
  /** Backing raw room (for direct mutation). */
  readonly __raw: MudletRoom;
}

const PEN_STYLES: Record<number, string> = {
  1: 'solid line',
  2: 'dash line',
  3: 'dot line',
  4: 'dash dot line',
  5: 'dash dot dot line',
};

function makeLiveRoom(id: number, raw: MudletRoom): LiveRoom {
  const live: any = { id, __raw: raw };
  Object.defineProperty(live, 'x', {
    get() { return raw.x; },
    set(v: number) { raw.x = v; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(live, 'y', {
    // Renderer space: y grows down. Raw Mudlet: +y = north.
    get() { return -raw.y; },
    set(v: number) { raw.y = -v; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(live, 'z', {
    get() { return raw.z; },
    set(v: number) { raw.z = v; },
    enumerable: true, configurable: true,
  });
  const ro = (key: keyof MudletRoom) =>
    Object.defineProperty(live, key, {
      get() { return raw[key]; },
      enumerable: true, configurable: true,
    });
  ro('area');
  ro('name');
  ro('weight');
  ro('userData');
  ro('doors');
  ro('isLocked');
  ro('exitLocks');
  ro('stubs');
  ro('exitWeights');
  ro('mSpecialExitLocks');
  Object.defineProperty(live, 'env', {
    get() { return raw.environment || undefined; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(live, 'roomChar', {
    get() { return raw.symbol || undefined; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(live, 'exits', {
    get() {
      const out: Record<string, number> = {};
      for (const dir of CARDINAL_DIRECTIONS) {
        const v = (raw as any)[dir] as number | undefined;
        if (v !== undefined && v !== -1) out[dir] = v;
      }
      return out;
    },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(live, 'specialExits', {
    get() { return raw.mSpecialExits; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(live, 'customLines', {
    get() {
      const out: Record<string, any> = {};
      const names = Object.keys(raw.customLines ?? {});
      for (const key of names) {
        const pts = raw.customLines[key];
        const color = raw.customLinesColor?.[key];
        out[key] = {
          points: pts.map(([x, y]) => ({ x, y })),  // raw Mudlet y-up; renderer flips with -pt.y itself
          attributes: {
            color: color ? { r: color.r, g: color.g, b: color.b } : { r: 255, g: 255, b: 255 },
            style: PEN_STYLES[raw.customLinesStyle?.[key]] ?? 'solid line',
            arrow: raw.customLinesArrow?.[key] ?? false,
          },
        };
      }
      return out;
    },
    enumerable: true, configurable: true,
  });
  return live as LiveRoom;
}

/** Build an EditorExit set for a set of rooms. Mirrors Area.createExits in the renderer. */
function buildExitsFor(rooms: LiveRoom[]): Map<string, EditorExit> {
  type HalfExit = { origin: number; target: number; z: number; dir: Direction };
  const OPPOSITE: Partial<Record<Direction, Direction>> = {
    north: 'south', south: 'north',
    east: 'west', west: 'east',
    northeast: 'southwest', southwest: 'northeast',
    northwest: 'southeast', southeast: 'northwest',
    up: 'down', down: 'up',
    in: 'out', out: 'in',
  };

  const halvesByPair = new Map<string, HalfExit[]>();
  for (const room of rooms) {
    for (const [dir, targetId] of Object.entries(room.exits)) {
      if (room.id === targetId) continue;
      const a = Math.min(room.id, targetId);
      const b = Math.max(room.id, targetId);
      const key = `${a}-${b}`;
      let arr = halvesByPair.get(key);
      if (!arr) { arr = []; halvesByPair.set(key, arr); }
      arr.push({ origin: room.id, target: targetId, z: room.z, dir: dir as Direction });
    }
  }

  const out = new Map<string, EditorExit>();
  for (const [pairKey, halves] of halvesByPair) {
    const [aStr, bStr] = pairKey.split('-');
    const a = parseInt(aStr);
    const b = parseInt(bStr);
    const aSide = halves.filter(h => h.origin === a);
    const bSide = halves.filter(h => h.origin === b);
    const usedB = new Set<number>();

    for (const aHalf of aSide) {
      let bestIdx = -1;
      for (let i = 0; i < bSide.length; i++) {
        if (usedB.has(i)) continue;
        if (bSide[i].dir === OPPOSITE[aHalf.dir]) { bestIdx = i; break; }
        if (bestIdx === -1) bestIdx = i;
      }
      if (bestIdx !== -1) {
        usedB.add(bestIdx);
        const bHalf = bSide[bestIdx];
        out.set(`${pairKey}-${aHalf.dir}`, {
          a, b, aDir: aHalf.dir, bDir: bHalf.dir, zIndex: [aHalf.z, bHalf.z],
        });
      } else {
        out.set(`${pairKey}-a:${aHalf.dir}`, {
          a, b, aDir: aHalf.dir, zIndex: [aHalf.z],
        });
      }
    }
    for (let i = 0; i < bSide.length; i++) {
      if (!usedB.has(i)) {
        const bHalf = bSide[i];
        out.set(`${pairKey}-b:${bHalf.dir}`, {
          a, b, bDir: bHalf.dir, zIndex: [bHalf.z],
        });
      }
    }
  }
  return out;
}

/** Convert a Buffer pixMap to bare base64 (no data-URL prefix). */
function bufferToBase64(buf: any): string {
  if (!buf || buf.length === 0) return '';
  // Already a string — strip any accidental data-URL prefix.
  if (typeof buf === 'string') return buf.includes(',') ? buf.split(',')[1] : buf;
  try { return buf.toString('base64'); } catch { return ''; }
}

/**
 * Ensure a raw label has its pixMapBase64 field populated.
 * Called once at load time and whenever the pixmap changes.
 * pixMapBase64 is a bare base64 string (no data:image/png;base64, prefix).
 * The renderer receives it directly; getLabelSnapshot prepends the prefix for <img>.
 */
function ensurePixMapBase64(l: any): void {
  if (l.pixMapBase64 === undefined) {
    l.pixMapBase64 = bufferToBase64(l.pixMap);
  }
}

/**
 * Mudlet can't store label font/outlineColor in the binary format yet, so it
 * serializes them into area userData as:
 *   system.labelFont_N      → "family|pointSize|weight|italic"
 *   system.labelOutlineColor_N → "r|g|b|alpha"
 * Read those entries and populate the raw label's font/outlineColor fields.
 */
function hydrateLabelFromAreaUserData(rawLabel: any, areaUserData: Record<string, string>): void {
  const id = rawLabel.id;
  if (!rawLabel.font) {
    const fontValue = areaUserData[`system.labelFont_${id}`];
    if (fontValue) {
      const parts = fontValue.split('|');
      if (parts.length >= 4) {
        const pointSize = parseInt(parts[1], 10);
        const weight = parseInt(parts[2], 10);
        // Qt5 weight range 0–99 (bold≥63); Qt6 range 100–900 (bold≥600).
        const bold = weight < 100 ? weight >= 63 : weight >= 600;
        rawLabel.font = {
          family: parts[0] || DEFAULT_LABEL_FONT.family,
          size: isNaN(pointSize) || pointSize <= 0 ? DEFAULT_LABEL_FONT.size : pointSize,
          bold,
          italic: parts[3] === '1',
          underline: false,
          strikeout: false,
        };
      }
    }
  }
  const outlineValue = areaUserData[`system.labelOutlineColor_${id}`];
  if (outlineValue) {
    const parts = outlineValue.split('|');
    if (parts.length >= 4) {
      rawLabel.outlineColor = {
        r: parseInt(parts[0], 10),
        g: parseInt(parts[1], 10),
        b: parseInt(parts[2], 10),
        alpha: parseInt(parts[3], 10),
      };
    }
  }
}

/** Write label font/outlineColor back into area userData so the binary map round-trips correctly. */
function syncLabelToAreaUserData(rawLabel: any, areaUserData: Record<string, string>): void {
  const id = rawLabel.id;
  const font = rawLabel.font as LabelFont | undefined;
  if (font?.family) {
    const weight = font.bold ? 75 : 50;
    areaUserData[`system.labelFont_${id}`] = `${font.family}|${font.size}|${weight}|${font.italic ? 1 : 0}`;
  }
  if (rawLabel.outlineColor) {
    const { r, g, b, alpha } = rawLabel.outlineColor;
    areaUserData[`system.labelOutlineColor_${id}`] = `${r}|${g}|${b}|${alpha}`;
  } else {
    // Write default transparent outline so Mudlet always has the entry.
    areaUserData[`system.labelOutlineColor_${id}`] = '0|0|0|0';
  }
}

function snapshotFromRawLabel(raw: any): LabelSnapshot {
  return {
    id: raw.id,
    pos: [...raw.pos] as [number, number, number],
    size: [...raw.size] as [number, number],
    text: raw.text ?? '',
    fgColor: { ...raw.fgColor },
    bgColor: { ...raw.bgColor },
    noScaling: raw.noScaling ?? false,
    showOnTop: raw.showOnTop ?? false,
    font: raw.font ? { ...raw.font } : { ...DEFAULT_LABEL_FONT },
    outlineColor: raw.outlineColor ? { ...raw.outlineColor } : undefined,
    pixMap: raw.pixMapBase64 ? `data:image/png;base64,${raw.pixMapBase64}` : '',
    imageSrc: raw.imageSrc,
  };
}


export class EditorPlane {
  constructor(private rooms: LiveRoom[], private labels: any[]) {}

  getRooms(): LiveRoom[] { return this.rooms; }
  getLabels(): any[] { return this.labels; }
  getBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const r of this.rooms) {
      if (r.x < minX) minX = r.x;
      if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.y > maxY) maxY = r.y;
    }
    for (const l of this.labels) {
      const lx = l.X;
      const ly = -l.Y;
      if (lx < minX) minX = lx;
      if (lx + l.Width > maxX) maxX = lx + l.Width;
      if (ly < minY) minY = ly;
      if (ly + l.Height > maxY) maxY = ly + l.Height;
    }
    return { minX, maxX, minY, maxY };
  }

  setRooms(rooms: LiveRoom[]) { this.rooms = rooms; }
  setLabels(labels: any[]) { this.labels = labels; }
}

export class EditorArea {
  private planes: Record<number, EditorPlane> = {};
  private exits: Map<string, EditorExit> = new Map();
  private version = 0;

  constructor(
    private readonly areaId: number,
    private readonly areaName: string,
    private rooms: LiveRoom[],
    private labels: any[],
  ) {
    this.rebuildPlanes();
    this.rebuildExits();
  }

  getAreaId(): number { return this.areaId; }
  getAreaName(): string { return this.areaName; }
  getVersion(): number { return this.version; }
  markDirty(): void { this.version++; }

  getPlane(z: number): EditorPlane { return this.planes[z]; }
  getPlanes(): EditorPlane[] { return Object.values(this.planes); }
  getZLevels(): number[] { return Object.keys(this.planes).map(Number).sort((a, b) => a - b); }
  getRooms(): LiveRoom[] { return this.rooms; }

  getFullBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return this.getPlanes().reduce(
      (acc, p) => {
        const b = p.getBounds();
        return {
          minX: Math.min(acc.minX, b.minX),
          maxX: Math.max(acc.maxX, b.maxX),
          minY: Math.min(acc.minY, b.minY),
          maxY: Math.max(acc.maxY, b.maxY),
        };
      },
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
  }

  getLinkExits(zIndex: number): EditorExit[] {
    return Array.from(this.exits.values()).filter(e => e.zIndex.includes(zIndex));
  }

  setLabels(labels: any[]): void {
    this.labels = labels;
    this.rebuildPlanes();
    this.markDirty();
  }


  addRoomLive(room: LiveRoom): void {
    this.rooms.push(room);
    this.rebuildPlanes();
    this.rebuildExits();
    this.markDirty();
  }

  addRoomsLive(newRooms: LiveRoom[]): void {
    this.rooms.push(...newRooms);
    this.rebuildPlanes();
    this.rebuildExits();
    this.markDirty();
  }

  removeRoomById(id: number): void {
    this.rooms = this.rooms.filter(r => r.id !== id);
    this.rebuildPlanes();
    this.rebuildExits();
    this.markDirty();
  }

  removeRoomsById(ids: Set<number>): void {
    this.rooms = this.rooms.filter(r => !ids.has(r.id));
    this.rebuildPlanes();
    this.rebuildExits();
    this.markDirty();
  }

  renameRoomId(fromId: number, toId: number): void {
    this.rooms = this.rooms.map((room) => room.id === fromId ? makeLiveRoom(toId, room.__raw) : room);
    this.rebuildPlanes();
    this.rebuildExits();
    this.markDirty();
  }

  rebuildPlanes(): void {
    const grouped: Record<number, LiveRoom[]> = {};
    for (const r of this.rooms) {
      const arr = grouped[r.z] ?? (grouped[r.z] = []);
      arr.push(r);
    }
    const next: Record<number, EditorPlane> = {};
    for (const [zStr, rs] of Object.entries(grouped)) {
      const z = Number(zStr);
      const labels = this.labels.filter(l => l.Z === z);
      next[z] = new EditorPlane(rs, labels);
    }
    this.planes = next;
  }

  rebuildExits(): void {
    this.exits = buildExitsFor(this.rooms);
  }
}

function calculateLuminance(rgb: number[]) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

type ColorEntry = {
  rgb: number[];
  rgbValue: string;
  symbolColor: number[];
  symbolColorValue: string;
};

const defaultColor: ColorEntry = {
  rgb: [114, 1, 0],
  rgbValue: 'rgb(114, 1, 0)',
  symbolColor: [225, 225, 225],
  symbolColorValue: 'rgb(225,225,225)',
};

/**
 * Editor-side MapReader. Drop-in replacement for `mudlet-map-renderer`'s MapReader
 * — exposes the same read surface the renderer needs, but:
 *  - Rooms are live getters over raw `MudletRoom` objects (no clone, no snapshot).
 *  - Y is flipped via a getter so mutations to raw.y propagate with correct sign.
 *  - Mutation methods are public: `moveRoom`, `setExit`, `addRoom`, `removeRoom`,
 *    `setRoomField`. Each updates the raw map and invalidates the relevant Area
 *    cache, so `renderer.refresh()` picks up the change.
 */
export class EditorMapReader {
  private readonly rooms: Record<number, LiveRoom> = {};
  private readonly areas: Record<number, EditorArea> = {};
  private readonly colors: Record<number, ColorEntry> = {};

  constructor(private readonly raw: MudletMap) {
    // Reuse binary reader's color generation (pure, no room cloning).
    const { colors: colorEntries } = buildRendererInput(raw);
    for (const c of colorEntries) {
      this.colors[c.envId] = {
        rgb: c.colors,
        rgbValue: `rgb(${c.colors.join(',')})`,
        symbolColor: calculateLuminance(c.colors) > 0.41 ? [25, 25, 25] : [225, 255, 255],
        symbolColorValue: calculateLuminance(c.colors) > 0.41 ? 'rgb(25,25,25)' : 'rgb(225,255,255)',
      };
    }

    for (const [areaIdStr, areaData] of Object.entries(raw.areas)) {
      const areaId = Number(areaIdStr);
      const areaRooms: LiveRoom[] = [];
      for (const roomId of areaData.rooms) {
        const rawRoom = raw.rooms[roomId];
        if (!rawRoom) continue;
        const live = makeLiveRoom(roomId, rawRoom);
        this.rooms[roomId] = live;
        areaRooms.push(live);
      }
      const rawLabels = (raw.labels?.[areaId] as any[]) ?? [];
      const areaUserData: Record<string, string> = (raw.areas[areaId]?.userData as any) ?? {};
      // One-time Buffer→base64 conversion and font/outlineColor hydration from area userData.
      for (const l of rawLabels) {
        ensurePixMapBase64(l);
        hydrateLabelFromAreaUserData(l, areaUserData);
      }
      this.areas[areaId] = new EditorArea(
        areaId,
        raw.areaNames[areaId] ?? `Area ${areaId}`,
        areaRooms,
        rawLabels.map(l => this.toRendererLabel(l, areaId)),
      );
    }
  }

  private toRendererLabel(l: any, areaId: number): any {
    return {
      id: l.id,
      labelId: l.id,
      areaId,
      X: l.pos[0],
      Y: l.pos[1],
      Z: l.pos[2],
      Width: l.size[0],
      Height: l.size[1],
      Text: l.text ?? '',
      FgColor: { ...l.fgColor },
      BgColor: { ...l.bgColor },
      pixMap: l.pixMapBase64 ?? '',
      noScaling: l.noScaling ?? false,
      showOnTop: l.showOnTop ?? false,
    };
  }

  private syncRendererLabels(areaId: number): void {
    const converted = (this.raw.labels?.[areaId] as any[] ?? []).map(l => this.toRendererLabel(l, areaId));
    this.areas[areaId]?.setLabels(converted);
  }

  // --- Read API (matches MapReader's surface) ---

  getRoom(id: number): LiveRoom | undefined { return this.rooms[id]; }
  getArea(areaId: number): EditorArea | undefined { return this.areas[areaId]; }
  getAreas(): EditorArea[] { return Object.values(this.areas); }
  getRooms(): LiveRoom[] { return Object.values(this.rooms); }
  getExplorationArea(): undefined { return undefined; }
  decorateWithExploration(): Set<number> | undefined { return undefined; }
  getVisitedRooms(): Set<number> | undefined { return undefined; }
  clearExplorationDecoration(): void { /* no-op */ }
  isExplorationEnabled(): boolean { return false; }
  setVisitedRooms(): Set<number> { return new Set(); }
  addVisitedRoom(): boolean { return false; }
  addVisitedRooms(): number { return 0; }
  hasVisitedRoom(): boolean { return false; }

  getColorValue(envId: number): string {
    return this.colors[envId]?.rgbValue ?? defaultColor.rgbValue;
  }

  getSymbolColor(envId: number, opacity?: number): string {
    const entry = this.colors[envId] ?? defaultColor;
    const a = Math.min(Math.max(opacity ?? 1, 0), 1);
    const value = entry.symbolColor.join(',');
    return a !== 1 ? `rgba(${value}, ${a})` : `rgba(${value})`;
  }

  // --- Mutation API ---

  /** Move a room. Coordinates are in RENDER space (same as what culling returns / cursor maps to). */
  moveRoom(id: number, x: number, y: number, z: number): void {
    const rawRoom = this.raw.rooms[id];
    if (!rawRoom) return;
    const oldZ = rawRoom.z;
    rawRoom.x = x;
    rawRoom.y = -y;   // render → raw flip
    rawRoom.z = z;
    const area = this.areas[rawRoom.area];
    if (!area) return;
    if (oldZ !== z) area.rebuildPlanes();
    area.markDirty();
  }

  /** Set a cardinal exit. `toId < 0` removes it. */
  setExit(fromId: number, dir: Direction, toId: number): void {
    const rawRoom = this.raw.rooms[fromId];
    if (!rawRoom) return;
    (rawRoom as any)[dir] = toId;
    const area = this.areas[rawRoom.area];
    if (!area) return;
    area.rebuildExits();
    area.markDirty();
  }

  setRoomField(id: number, field: 'name' | 'environment' | 'weight' | 'symbol', value: string | number): void {
    const rawRoom = this.raw.rooms[id];
    if (!rawRoom) return;
    (rawRoom as any)[field] = value;
    this.areas[rawRoom.area]?.markDirty();
  }

  setRoomLock(id: number, lock: boolean): void {
    const rawRoom = this.raw.rooms[id];
    if (!rawRoom) return;
    rawRoom.isLocked = lock;
    this.areas[rawRoom.area]?.markDirty();
  }

  setUserDataEntry(id: number, key: string, value: string | null): void {
    const rawRoom = this.raw.rooms[id];
    if (!rawRoom) return;
    if (!rawRoom.userData) rawRoom.userData = {};
    if (value === null) {
      delete rawRoom.userData[key];
    } else {
      rawRoom.userData[key] = value;
    }
    this.areas[rawRoom.area]?.markDirty();
  }

  renameRoomId(fromId: number, toId: number): void {
    const rawRoom = this.raw.rooms[toId];
    if (!rawRoom || fromId === toId) return;
    delete this.rooms[fromId];
    this.rooms[toId] = makeLiveRoom(toId, rawRoom);

    const area = this.areas[rawRoom.area];
    area?.renameRoomId(fromId, toId);
    for (const otherArea of this.getAreas()) {
      if (otherArea !== area) {
        otherArea.rebuildExits();
        otherArea.markDirty();
      }
    }
  }

  /** Add a raw room (expected `raw.rooms[id]` already set or not, we set it). */
  addRoom(id: number, rawRoom: MudletRoom): void {
    this.raw.rooms[id] = rawRoom;
    const rawArea = this.raw.areas[rawRoom.area];
    if (rawArea && !rawArea.rooms.includes(id)) rawArea.rooms.push(id);
    const live = makeLiveRoom(id, rawRoom);
    this.rooms[id] = live;
    this.areas[rawRoom.area]?.addRoomLive(live);
  }

  /** Bulk-add many rooms. Does one rebuildPlanes/rebuildExits per affected area. */
  addRooms(rooms: Array<{ id: number; room: MudletRoom }>): void {
    const byArea = new Map<number, LiveRoom[]>();
    for (const { id, room } of rooms) {
      this.raw.rooms[id] = room;
      const rawArea = this.raw.areas[room.area];
      if (rawArea && !rawArea.rooms.includes(id)) rawArea.rooms.push(id);
      const live = makeLiveRoom(id, room);
      this.rooms[id] = live;
      let arr = byArea.get(room.area);
      if (!arr) { arr = []; byArea.set(room.area, arr); }
      arr.push(live);
    }
    const affectedAreaIds = new Set(byArea.keys());
    for (const [areaId, liveRooms] of byArea) {
      this.areas[areaId]?.addRoomsLive(liveRooms);
    }
    for (const otherArea of this.getAreas()) {
      if (!affectedAreaIds.has(otherArea.getAreaId())) {
        otherArea.rebuildExits();
        otherArea.markDirty();
      }
    }
  }

  setSpecialExit(roomId: number, name: string, toId: number): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    rawRoom.mSpecialExits[name] = toId;
    this.areas[rawRoom.area]?.markDirty();
  }

  removeSpecialExit(roomId: number, name: string): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    delete rawRoom.mSpecialExits[name];
    this.areas[rawRoom.area]?.markDirty();
  }

  setDoor(roomId: number, dir: Direction, value: number): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    const key = DIR_SHORT[dir];
    if (value === 0) delete rawRoom.doors[key];
    else rawRoom.doors[key] = value;
    this.areas[rawRoom.area]?.markDirty();
  }

  setSpecialExitDoor(roomId: number, name: string, value: number): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    if (value === 0) delete rawRoom.doors[name];
    else rawRoom.doors[name] = value;
    this.areas[rawRoom.area]?.markDirty();
  }

  setExitWeight(roomId: number, dir: Direction, value: number): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    const key = DIR_SHORT[dir];
    if (value <= 1) delete rawRoom.exitWeights[key];
    else rawRoom.exitWeights[key] = value;
    this.areas[rawRoom.area]?.markDirty();
  }

  setSpecialExitWeight(roomId: number, name: string, value: number): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    if (value <= 1) delete rawRoom.exitWeights[name];
    else rawRoom.exitWeights[name] = value;
    this.areas[rawRoom.area]?.markDirty();
  }

  setExitLock(roomId: number, dir: Direction, lock: boolean): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    const idx = DIR_INDEX[dir];
    if (lock) {
      if (!rawRoom.exitLocks.includes(idx)) rawRoom.exitLocks.push(idx);
    } else {
      const i = rawRoom.exitLocks.indexOf(idx);
      if (i !== -1) rawRoom.exitLocks.splice(i, 1);
    }
    this.areas[rawRoom.area]?.markDirty();
  }

  setStub(roomId: number, dir: Direction, stub: boolean): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    const idx = DIR_INDEX[dir];
    if (stub) {
      if (!rawRoom.stubs.includes(idx)) rawRoom.stubs.push(idx);
    } else {
      const i = rawRoom.stubs.indexOf(idx);
      if (i !== -1) rawRoom.stubs.splice(i, 1);
    }
    this.areas[rawRoom.area]?.rebuildExits();
    this.areas[rawRoom.area]?.markDirty();
  }

  /** Move a single custom line waypoint. renderX/renderY are render-space (y-down). */
  setCustomLinePoint(roomId: number, exitName: string, index: number, renderX: number, renderY: number): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    const pts = rawRoom.customLines[exitName];
    if (!pts || index < 0 || index >= pts.length) return;
    pts[index] = [renderX, -renderY]; // render → raw Mudlet y-up
    this.areas[rawRoom.area]?.markDirty();
  }

  setCustomLine(
    roomId: number,
    exitName: string,
    points: [number, number][],
    color: MudletColor,
    style: number,
    arrow: boolean,
  ): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    rawRoom.customLines[exitName] = points.map(p => [p[0], p[1]] as [number, number]);
    rawRoom.customLinesColor[exitName] = color;
    rawRoom.customLinesStyle[exitName] = style;
    rawRoom.customLinesArrow[exitName] = arrow;
    this.areas[rawRoom.area]?.markDirty();
  }

  removeCustomLine(roomId: number, exitName: string): void {
    const rawRoom = this.raw.rooms[roomId];
    if (!rawRoom) return;
    delete rawRoom.customLines[exitName];
    delete rawRoom.customLinesColor[exitName];
    delete rawRoom.customLinesStyle[exitName];
    delete rawRoom.customLinesArrow[exitName];
    this.areas[rawRoom.area]?.markDirty();
  }

  addArea(id: number, name: string): void {
    this.raw.areas[id] = {
      rooms: [],
      zLevels: [0],
      mAreaExits: {},
      gridMode: false,
      max_x: 0, max_y: 0, max_z: 0,
      min_x: 0, min_y: 0, min_z: 0,
      span: [0, 0, 0],
      xmaxForZ: {}, ymaxForZ: {}, xminForZ: {}, yminForZ: {},
      pos: [0, 0, 0],
      isZone: false,
      zoneAreaRef: -1,
      userData: {},
    };
    this.raw.areaNames[id] = name;
    this.areas[id] = new EditorArea(id, name, [], []);
  }

  removeArea(id: number): void {
    delete this.raw.areas[id];
    delete this.raw.areaNames[id];
    delete this.areas[id];
  }

  moveRoomsToArea(roomIds: number[], fromAreaId: number, toAreaId: number): void {
    const fromArea = this.areas[fromAreaId];
    const toArea = this.areas[toAreaId];
    const movedSet = new Set(roomIds);
    const liveRooms: LiveRoom[] = [];
    for (const roomId of roomIds) {
      const rawRoom = this.raw.rooms[roomId];
      if (!rawRoom) continue;
      rawRoom.area = toAreaId;
      const toRaw = this.raw.areas[toAreaId];
      if (toRaw && !toRaw.rooms.includes(roomId)) toRaw.rooms.push(roomId);
      const liveRoom = this.rooms[roomId];
      if (liveRoom) liveRooms.push(liveRoom);
    }
    const fromRaw = this.raw.areas[fromAreaId];
    if (fromRaw) fromRaw.rooms = fromRaw.rooms.filter(id => !movedSet.has(id));
    if (fromArea) fromArea.removeRoomsById(movedSet);
    if (toArea) toArea.addRoomsLive(liveRooms);
    fromArea?.markDirty();
  }

  renameArea(id: number, name: string): void {
    this.raw.areaNames[id] = name;
    // EditorArea.areaName is private; renderer has areaName disabled, so raw update suffices.
  }

  setCustomEnvColor(envId: number, color: MudletColor | null): void {
    if (color === null) {
      delete this.raw.mCustomEnvColors[envId];
    } else {
      this.raw.mCustomEnvColors[envId] = color;
    }
    // Rebuild the affected color entry.
    const { colors } = buildRendererInput(this.raw);
    for (const c of colors) {
      this.colors[c.envId] = {
        rgb: c.colors,
        rgbValue: `rgb(${c.colors.join(',')})`,
        symbolColor: calculateLuminance(c.colors) > 0.41 ? [25, 25, 25] : [225, 255, 255],
        symbolColorValue: calculateLuminance(c.colors) > 0.41 ? 'rgb(25,25,25)' : 'rgb(225,255,255)',
      };
    }
    if (color === null) delete this.colors[envId];
  }

  getLabelSnapshot(areaId: number, labelId: number): LabelSnapshot | null {
    const raw = this.raw.labels[areaId]?.find(l => l.id === labelId);
    return raw ? snapshotFromRawLabel(raw) : null;
  }

  addLabel(areaId: number, snapshot: LabelSnapshot): void {
    if (!this.raw.labels[areaId]) this.raw.labels[areaId] = [];
    const dataUrl = snapshot.pixMap || generateLabelPixmap(snapshot);
    const raw: any = {
      id: snapshot.id,
      labelId: snapshot.id,
      areaId,
      pos: [...snapshot.pos] as [number, number, number],
      size: [...snapshot.size] as [number, number],
      text: snapshot.text,
      fgColor: { ...snapshot.fgColor },
      bgColor: { ...snapshot.bgColor },
      pixMap: dataUrlToBuffer(dataUrl),
      pixMapBase64: dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl,
      noScaling: snapshot.noScaling,
      showOnTop: snapshot.showOnTop,
      font: { ...snapshot.font },
      outlineColor: snapshot.outlineColor ? { ...snapshot.outlineColor } : undefined,
    };
    this.raw.labels[areaId].push(raw);
    const areaUserData = this.raw.areas[areaId]?.userData as Record<string, string> | undefined;
    if (areaUserData) syncLabelToAreaUserData(raw, areaUserData);
    this.syncRendererLabels(areaId);
  }

  removeLabel(areaId: number, labelId: number): void {
    if (!this.raw.labels[areaId]) return;
    this.raw.labels[areaId] = this.raw.labels[areaId].filter(l => l.id !== labelId);
    const areaUserData = this.raw.areas[areaId]?.userData as Record<string, string> | undefined;
    if (areaUserData) {
      delete areaUserData[`system.labelFont_${labelId}`];
      delete areaUserData[`system.labelOutlineColor_${labelId}`];
    }
    this.syncRendererLabels(areaId);
  }

  /** Move a label. renderX/renderY are render-space (y-down); stored as raw Mudlet (y-up). */
  moveLabel(areaId: number, labelId: number, renderX: number, renderY: number): void {
    const raw = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.pos[0] = renderX;
    raw.pos[1] = -renderY;
    this.syncRendererLabels(areaId);
  }


  setLabelText(areaId: number, labelId: number, text: string): void {
    const raw = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.text = text;
    this.syncRendererLabels(areaId);
  }

  setLabelSize(areaId: number, labelId: number, width: number, height: number): void {
    const raw = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.size[0] = width;
    raw.size[1] = height;
    this.syncRendererLabels(areaId);
  }

  setLabelPixmap(areaId: number, labelId: number, dataUrl: string): void {
    const raw: any = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.pixMap = dataUrlToBuffer(dataUrl);
    raw.pixMapBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    this.syncRendererLabels(areaId);
  }

  setLabelImageSrc(areaId: number, labelId: number, imageSrc: string | undefined): void {
    const raw: any = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.imageSrc = imageSrc;
    // No renderer sync needed — imageSrc is editor-only metadata.
  }

  setLabelFont(areaId: number, labelId: number, font: LabelFont): void {
    const raw: any = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.font = { ...font };
    const areaUserData = this.raw.areas[areaId]?.userData as Record<string, string> | undefined;
    if (areaUserData) syncLabelToAreaUserData(raw, areaUserData);
    this.syncRendererLabels(areaId);
  }

  setLabelOutlineColor(areaId: number, labelId: number, color: import('../../mapIO').MudletColor | undefined): void {
    const raw: any = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.outlineColor = color ? { ...color } : undefined;
    const areaUserData = this.raw.areas[areaId]?.userData as Record<string, string> | undefined;
    if (areaUserData) syncLabelToAreaUserData(raw, areaUserData);
    this.syncRendererLabels(areaId);
  }

  setLabelNoScaling(areaId: number, labelId: number, noScaling: boolean): void {
    const raw = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.noScaling = noScaling;
    this.syncRendererLabels(areaId);
  }

  setLabelShowOnTop(areaId: number, labelId: number, showOnTop: boolean): void {
    const raw = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.showOnTop = showOnTop;
    this.syncRendererLabels(areaId);
  }

  setLabelColors(areaId: number, labelId: number, fg: MudletColor, bg: MudletColor): void {
    const raw = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.fgColor = { ...fg };
    raw.bgColor = { ...bg };
    this.syncRendererLabels(areaId);
  }

  getAllEnvColors(): { envId: number; rgbValue: string }[] {
    return Object.entries(this.colors)
      .map(([id, c]) => ({ envId: Number(id), rgbValue: c.rgbValue }))
      .sort((a, b) => a.envId - b.envId);
  }

  /**
   * Bulk-delete an entire area and its rooms. Assumes the caller has already
   * severed cross-area incoming exits on raw rooms (same pattern as `deleteRoom`
   * using `neighborEdits`). Rebuilds exit caches on `affectedOtherAreaIds` once
   * at the end — cheap, vs. N× rebuild-all-areas from the per-room path.
   */
  removeAreaWithRooms(areaId: number, roomIds: number[], affectedOtherAreaIds: number[]): void {
    for (const id of roomIds) {
      delete this.rooms[id];
    }
    delete this.areas[areaId];
    for (const otherId of affectedOtherAreaIds) {
      const a = this.areas[otherId];
      if (a) { a.rebuildExits(); a.markDirty(); }
    }
  }

  /** Restore an area + its rooms (for `deleteAreaWithRooms` undo). */
  restoreAreaWithRooms(
    areaId: number,
    areaName: string,
    rooms: Array<{ id: number; room: MudletRoom }>,
    affectedOtherAreaIds: number[],
  ): void {
    const liveRooms: LiveRoom[] = [];
    for (const { id, room } of rooms) {
      const live = makeLiveRoom(id, room);
      this.rooms[id] = live;
      liveRooms.push(live);
    }
    this.areas[areaId] = new EditorArea(areaId, areaName, liveRooms, []);
    for (const otherId of affectedOtherAreaIds) {
      const a = this.areas[otherId];
      if (a) { a.rebuildExits(); a.markDirty(); }
    }
  }

  removeRoom(id: number): void {
    const rawRoom = this.raw.rooms[id];
    if (!rawRoom) return;
    // Sever incoming cardinal exits from other rooms.
    for (const key of Object.keys(this.raw.rooms)) {
      const other = this.raw.rooms[Number(key)];
      if (!other) continue;
      for (const dir of CARDINAL_DIRECTIONS) {
        if ((other as any)[dir] === id) (other as any)[dir] = -1;
      }
    }
    const areaId = rawRoom.area;
    delete this.raw.rooms[id];
    const rawArea = this.raw.areas[areaId];
    if (rawArea) {
      const idx = rawArea.rooms.indexOf(id);
      if (idx !== -1) rawArea.rooms.splice(idx, 1);
    }
    delete this.rooms[id];
    const area = this.areas[areaId];
    if (area) {
      area.removeRoomById(id);
      // Other areas that had incoming exits to this room need their exits rebuilt.
      for (const otherArea of this.getAreas()) {
        if (otherArea !== area) otherArea.rebuildExits();
      }
    }
  }

  /** Bulk-remove many rooms. Caller must have already severed neighbor exits in raw map.
   *  Does one rebuildPlanes/rebuildExits per affected area instead of one per room. */
  removeRooms(ids: number[]): void {
    const deletedSet = new Set(ids);
    const affectedAreaIds = new Set<number>();
    for (const id of ids) {
      const rawRoom = this.raw.rooms[id];
      if (!rawRoom) continue;
      affectedAreaIds.add(rawRoom.area);
      delete this.raw.rooms[id];
      delete this.rooms[id];
    }
    for (const areaId of affectedAreaIds) {
      const rawArea = this.raw.areas[areaId];
      if (rawArea) rawArea.rooms = rawArea.rooms.filter(r => !deletedSet.has(r));
      this.areas[areaId]?.removeRoomsById(deletedSet);
    }
    for (const otherArea of this.getAreas()) {
      if (!affectedAreaIds.has(otherArea.getAreaId())) otherArea.rebuildExits();
    }
  }
}
