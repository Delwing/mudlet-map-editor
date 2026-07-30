import type { MudletMap, MudletRoom, MudletColor } from '../../mapIO';
import type { LabelSnapshot } from '../types';
import { buildRendererInput } from '../../mapIO';
import { CARDINAL_DIRECTIONS, DIR_SHORT, DIR_INDEX, DEFAULT_LABEL_FONT, type Direction, type LabelFont } from '../types';
import { generateLabelPixmap, dataUrlToBuffer } from '../labelPixmap';
import { PlaneRoomIndex, INFINITE_BOUNDS, type Bounds } from './PlaneRoomIndex';

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
  ro('hash');
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

/**
 * Build the EditorExit set for `rooms`. Mirrors Area.createExits in the renderer.
 *
 * `rooms` is the set being drawn (a viewport window, not necessarily the whole
 * area), while `resolve` looks up any room of the same area by id. Halves are
 * gathered from BOTH endpoints via `resolve`, so a link whose far end is
 * off-screen still pairs and renders two-way exactly as in a full-area build —
 * unlike the renderer's SkeletonArea, which degrades those to one-way.
 * `resolve` must be area-scoped: cross-area links stay one-sided (that is what
 * makes the renderer draw them as area exits).
 */
function buildExitsFor(rooms: readonly LiveRoom[], resolve: (id: number) => LiveRoom | undefined): Map<string, EditorExit> {
  type HalfExit = { origin: number; target: number; z: number; dir: Direction };
  const OPPOSITE: Partial<Record<Direction, Direction>> = {
    north: 'south', south: 'north',
    east: 'west', west: 'east',
    northeast: 'southwest', southwest: 'northeast',
    northwest: 'southeast', southeast: 'northwest',
    up: 'down', down: 'up',
    in: 'out', out: 'in',
  };

  // Collect the room pairs at least one drawn room links to, then gather every
  // half of each pair from the endpoints themselves — a pair is visited once
  // however many of its endpoints are in `rooms`, so this also dedupes.
  const halvesByPair = new Map<string, HalfExit[]>();
  // `LiveRoom.exits` is a getter that builds a fresh object per access; this runs
  // on every scene build (so on every drag frame), so read each room's exits once.
  const exitsCache = new Map<number, Record<string, number>>();
  const exitsOf = (room: LiveRoom): Record<string, number> => {
    let e = exitsCache.get(room.id);
    if (!e) { e = room.exits; exitsCache.set(room.id, e); }
    return e;
  };
  const addHalves = (room: LiveRoom | undefined, pairKey: string, other: number) => {
    if (!room) return;
    for (const [dir, targetId] of Object.entries(exitsOf(room))) {
      if (targetId !== other) continue;
      let arr = halvesByPair.get(pairKey);
      if (!arr) { arr = []; halvesByPair.set(pairKey, arr); }
      arr.push({ origin: room.id, target: targetId, z: room.z, dir: dir as Direction });
    }
  };
  const seenPairs = new Set<string>();
  for (const room of rooms) {
    for (const targetId of Object.values(exitsOf(room))) {
      if (room.id === targetId) continue;
      const a = Math.min(room.id, targetId);
      const b = Math.max(room.id, targetId);
      const key = `${a}-${b}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      addHalves(resolve(a), key, b);
      addHalves(resolve(b), key, a);
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
  const styleValue = areaUserData[`editor.labelStyle_${id}`];
  if (styleValue) rawLabel.styleId = styleValue;
  const alignValue = areaUserData[`editor.labelAlign_${id}`];
  if (alignValue === 'left' || alignValue === 'right' || alignValue === 'center') rawLabel.textAlign = alignValue;
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
  // Editor-only metadata Mudlet ignores; 'plain'/unset stays out of userData.
  if (rawLabel.styleId && rawLabel.styleId !== 'plain') {
    areaUserData[`editor.labelStyle_${id}`] = rawLabel.styleId;
  } else {
    delete areaUserData[`editor.labelStyle_${id}`];
  }
  if (rawLabel.textAlign && rawLabel.textAlign !== 'center') {
    areaUserData[`editor.labelAlign_${id}`] = rawLabel.textAlign;
  } else {
    delete areaUserData[`editor.labelAlign_${id}`];
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
    styleId: raw.styleId,
    textAlign: raw.textAlign,
    pixMap: raw.pixMapBase64 ? `data:image/png;base64,${raw.pixMapBase64}` : '',
    imageSrc: raw.imageSrc,
  };
}


/**
 * The window the renderer last pushed through `EditorMapReader.setViewport`,
 * shared by reference with every area and plane. `revision` changes whenever
 * `bounds` does, so derived results can be cached against it.
 */
export type ViewportWindow = { bounds: Bounds; revision: number };

export class EditorPlane {
  private index: PlaneRoomIndex;
  /** Narrowed room list, cached against (viewport, index) revisions. */
  private visible: LiveRoom[] | null = null;
  private visibleKey = '';

  constructor(private rooms: LiveRoom[], private labels: any[], private readonly viewport: ViewportWindow) {
    this.index = new PlaneRoomIndex(rooms);
  }

  /**
   * Rooms inside the current viewport window — this is what the renderer builds
   * a scene from, so it is what bounds the cost of a rebuild. Editor code that
   * reasons about the level as a whole (marquee, bounds, counts) wants
   * {@link getAllRooms} instead.
   */
  getRooms(): LiveRoom[] {
    const key = `${this.viewport.revision}:${this.index.getRevision()}`;
    if (this.visible && this.visibleKey === key) return this.visible;
    this.visible = this.index.collectInBounds(this.viewport.bounds);
    this.visibleKey = key;
    return this.visible;
  }

  /** Every room on the plane, viewport or not. */
  getAllRooms(): LiveRoom[] { return this.rooms; }

  getIndex(): PlaneRoomIndex { return this.index; }

  getLabels(): any[] { return this.labels; }
  /** Full-plane extent (NOT the viewport) so fitArea keeps framing the whole level. */
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

  setRooms(rooms: LiveRoom[]) {
    this.rooms = rooms;
    this.index = new PlaneRoomIndex(rooms);
    this.visible = null;
  }
  setLabels(labels: any[]) { this.labels = labels; }
}

export class EditorArea {
  private planes: Record<number, EditorPlane> = {};
  /** Own rooms by id — the area-scoped resolver `buildExitsFor` pairs halves through. */
  private byId = new Map<number, LiveRoom>();
  private version = 0;
  private suspendCount = 0;
  private pendingPlanes = false;
  /** Exits of one plane, cached against (area version, viewport, plane index). */
  private exitCache: { key: string; exits: EditorExit[] } | null = null;

  constructor(
    private readonly areaId: number,
    private readonly areaName: string,
    private rooms: LiveRoom[],
    private labels: any[],
    private readonly viewport: ViewportWindow,
  ) {
    this.rebuildPlanes();
  }

  getAreaId(): number { return this.areaId; }
  getAreaName(): string { return this.areaName; }
  /**
   * Content version. Includes the viewport revision because the plane content the
   * renderer sees is viewport-dependent — the `ViewportDataSource` contract
   * requires areas to look stale when the window moves.
   */
  getVersion(): number { return this.version + this.viewport.revision; }
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

  /**
   * Exits to draw on level `zIndex`, paired over the rooms the plane currently
   * materialises — so this costs O(viewport), not O(area). Pairing happens per
   * build instead of being cached area-wide, which is also why nothing has to
   * invalidate exits after a room changes z-level or area: the zIndex snapshot
   * that used to go stale is now recomputed every time.
   */
  getLinkExits(zIndex: number): EditorExit[] {
    const plane = this.planes[zIndex];
    if (!plane) return [];
    const key = `${zIndex}:${this.version}:${this.viewport.revision}:${plane.getIndex().getRevision()}`;
    if (this.exitCache && this.exitCache.key === key) return this.exitCache.exits;
    const resolve = (id: number) => this.byId.get(id);
    const exits = Array.from(buildExitsFor(plane.getRooms(), resolve).values())
      .filter(e => e.zIndex.includes(zIndex));
    this.exitCache = { key, exits };
    return exits;
  }

  setLabels(labels: any[]): void {
    this.labels = labels;
    this.rebuildPlanes();
    this.markDirty();
  }


  addRoomLive(room: LiveRoom): void {
    this.rooms.push(room);
    this.rebuildPlanes();
    this.markDirty();
  }

  addRoomsLive(newRooms: LiveRoom[]): void {
    this.rooms.push(...newRooms);
    this.rebuildPlanes();
    this.markDirty();
  }

  removeRoomById(id: number): void {
    this.rooms = this.rooms.filter(r => r.id !== id);
    this.rebuildPlanes();
    this.markDirty();
  }

  removeRoomsById(ids: Set<number>): void {
    this.rooms = this.rooms.filter(r => !ids.has(r.id));
    this.rebuildPlanes();
    this.markDirty();
  }

  renameRoomId(fromId: number, toId: number): void {
    this.rooms = this.rooms.map((room) => room.id === fromId ? makeLiveRoom(toId, room.__raw) : room);
    this.rebuildPlanes();
    this.markDirty();
  }

  /**
   * Re-file a room in its plane's spatial index after its coordinates changed.
   * A move within one plane needs nothing else: exits are paired per build and
   * the room objects are live views over the raw map.
   */
  roomMoved(room: LiveRoom): void {
    this.planes[room.z]?.getIndex().update(room);
  }

  /**
   * Defer `rebuildPlanes` until the matching `resumeRebuilds`. Nestable. While
   * suspended the rooms/labels arrays still mutate immediately — only the
   * derived planes are stale, and nothing reads those between a suspend and its
   * resume.
   */
  suspendRebuilds(): void { this.suspendCount++; }

  resumeRebuilds(): void {
    if (this.suspendCount === 0) return;
    this.suspendCount--;
    if (this.suspendCount > 0) return;
    if (this.pendingPlanes) { this.pendingPlanes = false; this.rebuildPlanes(); }
  }

  rebuildPlanes(): void {
    if (this.suspendCount > 0) { this.pendingPlanes = true; return; }
    const grouped: Record<number, LiveRoom[]> = {};
    const byId = new Map<number, LiveRoom>();
    for (const r of this.rooms) {
      const arr = grouped[r.z] ?? (grouped[r.z] = []);
      arr.push(r);
      byId.set(r.id, r);
    }
    this.byId = byId;
    const next: Record<number, EditorPlane> = {};
    for (const [zStr, rs] of Object.entries(grouped)) {
      const z = Number(zStr);
      const labels = this.labels.filter(l => l.Z === z);
      next[z] = new EditorPlane(rs, labels, this.viewport);
    }
    this.planes = next;
    this.exitCache = null;
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
 *  - It is a `ViewportDataSource`: planes hand the renderer only the rooms inside
 *    the window pushed by `setViewport`, so a scene rebuild — one per pointer
 *    event while dragging — costs O(viewport) rather than O(level). The renderer
 *    detects this by duck-typing `viewportAware` and rebuilds on pan when the
 *    camera leaves the padded window it last applied.
 */
export class EditorMapReader {
  readonly viewportAware = true as const;

  private readonly rooms: Record<number, LiveRoom> = {};
  private readonly areas: Record<number, EditorArea> = {};
  private readonly colors: Record<number, ColorEntry> = {};
  /** Shared by reference with every area/plane; `revision` bumps on each change. */
  private readonly viewport: ViewportWindow = { bounds: INFINITE_BOUNDS, revision: 0 };

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
        this.viewport,
      );
    }
  }

  // --- ViewportDataSource (see mudlet-map-renderer/src/reader/ViewportDataSource.ts) ---

  /** Narrow what planes materialise. Bounds are render space, same as the renderer reports. */
  setViewport(bounds: Bounds): void {
    const v = this.viewport.bounds;
    if (bounds.minX === v.minX && bounds.maxX === v.maxX &&
        bounds.minY === v.minY && bounds.maxY === v.maxY) return;
    this.viewport.bounds = { ...bounds };
    this.viewport.revision++;
  }

  getViewport(): Bounds { return this.viewport.bounds; }

  /** Rooms on the whole (area, z) plane — the input to the renderer's LOD tier decision. */
  getPlaneRoomCount(areaId: number, z: number): number {
    return this.areas[areaId]?.getPlane(z)?.getAllRooms().length ?? 0;
  }

  estimateVisibleCount(areaId: number, z: number, bounds: Bounds): number {
    const index = this.areas[areaId]?.getPlane(z)?.getIndex();
    return index ? index.countInBounds(bounds) : 0;
  }

  forEachInBounds(
    areaId: number, z: number, bounds: Bounds,
    fn: (x: number, y: number, envId: number) => void,
  ): void {
    const index = this.areas[areaId]?.getPlane(z)?.getIndex();
    index?.forEachInBounds(bounds, room => fn(room.x, room.y, room.env ?? 0));
  }

  /**
   * Suspend per-mutation plane/exit rebuilds across every area until the
   * matching `endBatch`. Use around a run of mutations that would otherwise pay
   * a full rebuild each — a 40-room merge goes from ~80 rebuilds to one per
   * area. Nestable; always pair in a `try/finally`.
   */
  beginBatch(): void {
    for (const area of this.getAreas()) area.suspendRebuilds();
  }

  endBatch(): void {
    for (const area of this.getAreas()) area.resumeRebuilds();
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
    if (oldZ !== z) {
      // The room changed plane — regroup so it lands in the right one (and gets
      // indexed there).
      area.rebuildPlanes();
    } else {
      const live = this.rooms[id];
      if (live) area.roomMoved(live);
    }
    area.markDirty();
  }

  /** Set a cardinal exit. `toId < 0` removes it. */
  setExit(fromId: number, dir: Direction, toId: number): void {
    const rawRoom = this.raw.rooms[fromId];
    if (!rawRoom) return;
    (rawRoom as any)[dir] = toId;
    const area = this.areas[rawRoom.area];
    if (!area) return;
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
    // Other areas may hold exits pointing at the renamed room; their next build
    // pairs afresh, they just need to look stale.
    for (const otherArea of this.getAreas()) {
      if (otherArea !== area) otherArea.markDirty();
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

  /** Bulk-add many rooms. Does one rebuildPlanes per affected area. */
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
    // Untouched areas can still hold exits into the new rooms — mark them stale
    // so their next build re-pairs.
    for (const otherArea of this.getAreas()) {
      if (!affectedAreaIds.has(otherArea.getAreaId())) otherArea.markDirty();
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
    this.areas[id] = new EditorArea(id, name, [], [], this.viewport);
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
      styleId: snapshot.styleId,
      textAlign: snapshot.textAlign,
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
      delete areaUserData[`editor.labelStyle_${labelId}`];
      delete areaUserData[`editor.labelAlign_${labelId}`];
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

  setLabelStyle(areaId: number, labelId: number, styleId: string | undefined): void {
    const raw: any = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.styleId = styleId;
    const areaUserData = this.raw.areas[areaId]?.userData as Record<string, string> | undefined;
    if (areaUserData) syncLabelToAreaUserData(raw, areaUserData);
    this.syncRendererLabels(areaId);
  }

  setLabelAlign(areaId: number, labelId: number, align: import('../types').LabelTextAlign | undefined): void {
    const raw: any = this.raw.labels[areaId]?.find(l => l.id === labelId);
    if (!raw) return;
    raw.textAlign = align;
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
   * using `neighborEdits`); `affectedOtherAreaIds` are marked stale so they
   * re-pair their exits on the next build.
   */
  removeAreaWithRooms(areaId: number, roomIds: number[], affectedOtherAreaIds: number[]): void {
    for (const id of roomIds) {
      delete this.rooms[id];
    }
    delete this.areas[areaId];
    for (const otherId of affectedOtherAreaIds) {
      const a = this.areas[otherId];
      if (a) a.markDirty();
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
    this.areas[areaId] = new EditorArea(areaId, areaName, liveRooms, [], this.viewport);
    for (const otherId of affectedOtherAreaIds) {
      const a = this.areas[otherId];
      if (a) a.markDirty();
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
      // Other areas may have had incoming exits to this room — stale, so they
      // re-pair on their next build.
      for (const otherArea of this.getAreas()) {
        if (otherArea !== area) otherArea.markDirty();
      }
    }
  }

  /** Bulk-remove many rooms. Caller must have already severed neighbor exits in raw map.
   *  Does one rebuildPlanes per affected area instead of one per room. */
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
      if (!affectedAreaIds.has(otherArea.getAreaId())) otherArea.markDirty();
    }
  }
}
