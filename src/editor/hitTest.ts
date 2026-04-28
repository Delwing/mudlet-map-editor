import type { MapRenderer } from 'mudlet-map-renderer';
import type { MudletMap } from '../mapIO';
import type { Direction, HitItem, LabelResizeHandle } from './types';
import type { EditorMapReader } from './reader/EditorMapReader';

/**
 * Hit-test map labels. Labels are axis-aligned rects. Returns the topmost label
 * (last in the list, rendered on top) whose render-space rect contains (mapX, mapY).
 * MapData.Label stores X/Y in Mudlet space; render position is (X, -Y).
 */
export function labelAt(
  areaId: number,
  z: number,
  mapX: number,
  mapY: number,
  reader: EditorMapReader,
): { id: number; areaId: number } | null {
  const area = reader.getArea(areaId);
  if (!area) return null;
  const plane = area.getPlane(z);
  if (!plane) return null;
  const labels = plane.getLabels();
  const MIN_HIT = 1;
  let hit: { id: number; areaId: number } | null = null;
  for (const label of labels) {
    const rx = label.X;
    const ry = -label.Y;
    const hw = Math.max(label.Width, MIN_HIT);
    const hh = Math.max(label.Height, MIN_HIT);
    if (mapX >= rx && mapX <= rx + hw && mapY >= ry && mapY <= ry + hh) {
      hit = { id: label.labelId ?? label.id, areaId };
    }
  }
  return hit;
}

/**
 * Like labelAt but returns ALL labels whose rect contains (mapX, mapY), in
 * draw order (topmost — last in the list — is last in the returned array).
 */
export function allLabelsAt(
  areaId: number,
  z: number,
  mapX: number,
  mapY: number,
  reader: EditorMapReader,
): { id: number; areaId: number }[] {
  const area = reader.getArea(areaId);
  if (!area) return [];
  const plane = area.getPlane(z);
  if (!plane) return [];
  const labels = plane.getLabels();
  const MIN_HIT = 1;
  const hits: { id: number; areaId: number }[] = [];
  for (const label of labels) {
    const rx = label.X;
    const ry = -label.Y;
    const hw = Math.max(label.Width, MIN_HIT);
    const hh = Math.max(label.Height, MIN_HIT);
    if (mapX >= rx && mapX <= rx + hw && mapY >= ry && mapY <= ry + hh) {
      hits.push({ id: label.labelId ?? label.id, areaId });
    }
  }
  return hits;
}

/**
 * Returns ALL elements under (mapX, mapY) in visual-priority order:
 *   1. All rooms occupying the same grid cell (stacked rooms)
 *   2. All overlapping labels (topmost first)
 *   3. Custom line (if any)
 *   4. Exit (if any)
 * Used for Alt+click cycling and the right-click disambiguate menu.
 */
export function allHitsAt(
  renderer: MapRenderer,
  map: MudletMap,
  areaId: number,
  z: number,
  mapX: number,
  mapY: number,
  roomSize: number,
  reader: EditorMapReader,
): HitItem[] {
  const hits: HitItem[] = [];

  // Rooms: use pickAll so every stacked room at the cursor position is found
  // regardless of which element type has the highest priority at that point.
  for (const h of renderer.hitTester.pickAll(mapX, mapY)) {
    if (h.kind !== 'room') continue;
    const raw = map.rooms[h.id as number];
    if (raw && raw.area === areaId && raw.z === z) {
      hits.push({ kind: 'room', id: h.id as number });
    }
  }

  // Labels: topmost first (reverse draw order).
  const lblHits = allLabelsAt(areaId, z, mapX, mapY, reader);
  for (let i = lblHits.length - 1; i >= 0; i--) {
    hits.push({ kind: 'label', id: lblHits[i].id, areaId: lblHits[i].areaId });
  }

  // Custom lines, then exits.
  const cl = customLineAt(renderer, mapX, mapY, roomSize);
  if (cl) hits.push({ kind: 'customLine', roomId: cl.roomId, exitName: cl.exitName });

  const exit = exitAt(renderer, mapX, mapY, roomSize);
  if (exit) hits.push({ kind: 'exit', fromId: exit.fromId, toId: exit.toId, dir: exit.dir });

  const stub = stubAt(renderer, mapX, mapY, roomSize);
  if (stub) hits.push({ kind: 'stub', roomId: stub.roomId, dir: stub.dir });

  return hits;
}

/**
 * 8 handle positions relative to a label's padded selection rect.
 * Returns the handle under the cursor, or null.
 * `hitRadius` is the capture radius in map units (typically 8px worth of units).
 */
export function labelResizeHandleAt(
  bounds: { x: number; y: number; w: number; h: number },
  mapX: number,
  mapY: number,
  hitRadius: number,
): LabelResizeHandle | null {
  const pad = 0.05;
  const bx = bounds.x - pad;
  const by = bounds.y - pad;
  const bw = bounds.w + pad * 2;
  const bh = bounds.h + pad * 2;
  const r = Math.max(0.15, hitRadius);

  const handles: [number, number, LabelResizeHandle][] = [
    [bx,          by,          'nw'],
    [bx + bw / 2, by,          'n'],
    [bx + bw,     by,          'ne'],
    [bx + bw,     by + bh / 2, 'e'],
    [bx + bw,     by + bh,     'se'],
    [bx + bw / 2, by + bh,     's'],
    [bx,          by + bh,     'sw'],
    [bx,          by + bh / 2, 'w'],
  ];

  let best: { handle: LabelResizeHandle; dist: number } | null = null;
  for (const [hx, hy, id] of handles) {
    const d = Math.hypot(mapX - hx, mapY - hy);
    if (d <= r && (!best || d < best.dist)) best = { handle: id, dist: d };
  }
  return best?.handle ?? null;
}

/** Does any room occupy the exact raw grid cell (x, y, z) on the given area? */
export function roomAtCell(
  map: MudletMap,
  areaId: number,
  x: number,
  y: number,
  z: number,
) {
  const area = map.areas[areaId];
  if (!area) return null;
  for (const id of area.rooms) {
    const room = map.rooms[id];
    if (!room) continue;
    if (room.x === x && room.y === y && room.z === z) return room;
  }
  return null;
}

function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Min distance from (px,py) to any segment in a flat [x,y,x,y,...] polyline. */
function distToPolyline(points: ArrayLike<number>, px: number, py: number): number {
  if (points.length < 4) return Infinity;
  let best = Infinity;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const d = distToSegment(px, py, points[i], points[i + 1], points[i + 2], points[i + 3]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 8 handle offsets (signs relative to room centre, each scaled by roomSize/2).
 * Used both for hit-testing and for rendering the ConnectHandlesEffect.
 */
export const HANDLE_OFFSETS: ReadonlyArray<readonly [number, number, Direction]> = [
  [ 0, -1, 'north'],
  [ 1, -1, 'northeast'],
  [ 1,  0, 'east'],
  [ 1,  1, 'southeast'],
  [ 0,  1, 'south'],
  [-1,  1, 'southwest'],
  [-1,  0, 'west'],
  [-1, -1, 'northwest'],
];

/**
 * Given a cursor in render space and a room's render-space centre, return
 * which handle direction the cursor is pointing at. Assumes the caller has
 * already established the cursor is within the room's hit-test region — this
 * function just maps the angular offset to one of 8 sectors, so there is
 * never a "body" / null result and the direction transitions smoothly around
 * the room.
 */
export function handleDirFor(
  cursor: { x: number; y: number },
  roomCentre: { x: number; y: number },
  _roomSize: number,
): Direction {
  const dx = cursor.x - roomCentre.x;
  const dy = cursor.y - roomCentre.y;
  if (dx === 0 && dy === 0) return 'east';
  const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  if (deg < 22.5 || deg >= 337.5) return 'east';
  if (deg < 67.5) return 'southeast';
  if (deg < 112.5) return 'south';
  if (deg < 157.5) return 'southwest';
  if (deg < 202.5) return 'west';
  if (deg < 247.5) return 'northwest';
  if (deg < 292.5) return 'north';
  return 'northeast';
}

/**
 * Hit-test an inter-room exit against the geometry the renderer actually
 * drew. Walks every polyline segment of every drawn exit's `lines` and
 * `arrows` so dashed lines, one-way arrows, cross-z stubs, and the
 * renderer's suppression rules (e.g. both-sides-customLine two-ways) are
 * honoured by construction — we never hover an exit that wasn't rendered.
 */
export function exitAt(
  renderer: MapRenderer,
  mapX: number,
  mapY: number,
  roomSize: number,
): { fromId: number; toId: number; dir: Direction } | null {
  const threshold = roomSize * 0.35;
  const drawn = renderer.getDrawnExits();
  let best: {
    a: number; b: number;
    aDir?: Direction; bDir?: Direction;
    nearA: boolean;
    dist: number;
  } | null = null;
  for (const entry of drawn) {
    // Only cardinal-direction exits are selectable in the editor; up/down/in/out
    // aren't drawn as lines by the renderer anyway, so they wouldn't show up
    // in `lines`/`arrows`, but guard the dir assertion defensively below.
    let dist = Infinity;
    let nearA = true;
    for (const line of entry.data.lines) {
      const d = distToPolyline(line.points, mapX, mapY);
      if (d < dist) {
        dist = d;
        const d1 = Math.hypot(mapX - line.points[0], mapY - line.points[1]);
        const last = line.points.length - 2;
        const d2 = Math.hypot(mapX - line.points[last], mapY - line.points[last + 1]);
        nearA = d1 <= d2;
      }
    }
    for (const arrow of entry.data.arrows) {
      const d = distToPolyline(arrow.points, mapX, mapY);
      if (d < dist) {
        dist = d;
        // arrows always start at the source edge → source end is index 0
        const d1 = Math.hypot(mapX - arrow.points[0], mapY - arrow.points[1]);
        const last = arrow.points.length - 2;
        const d2 = Math.hypot(mapX - arrow.points[last], mapY - arrow.points[last + 1]);
        nearA = (entry.aDir ? d1 <= d2 : d2 < d1);
      }
    }
    if (dist < threshold && (best === null || dist < best.dist)) {
      best = {
        a: entry.a,
        b: entry.b,
        aDir: entry.aDir as Direction | undefined,
        bDir: entry.bDir as Direction | undefined,
        nearA,
        dist,
      };
    }
  }
  if (!best) return null;
  const bothDirs = best.aDir && best.bDir;
  if (bothDirs) {
    return best.nearA
      ? { fromId: best.a, toId: best.b, dir: best.aDir! }
      : { fromId: best.b, toId: best.a, dir: best.bDir! };
  }
  if (best.aDir) return { fromId: best.a, toId: best.b, dir: best.aDir };
  if (best.bDir) return { fromId: best.b, toId: best.a, dir: best.bDir };
  return null;
}

/**
 * Hit-test a custom line polyline against the geometry the renderer drew.
 * `points` on each drawn entry already mirror what went to the canvas —
 * including the prepended room-centre segment — so stroke style doesn't
 * matter; we just walk segments.
 */
export function customLineAt(
  renderer: MapRenderer,
  mapX: number,
  mapY: number,
  roomSize: number,
): { roomId: number; exitName: string } | null {
  const threshold = roomSize * 0.5;
  let best: { roomId: number; exitName: string; dist: number } | null = null;
  for (const entry of renderer.getDrawnSpecialExits()) {
    const d = distToPolyline(entry.points, mapX, mapY);
    if (d < threshold && (best === null || d < best.dist)) {
      best = { roomId: entry.roomId, exitName: entry.exitName, dist: d };
    }
  }
  return best ? { roomId: best.roomId, exitName: best.exitName } : null;
}

/**
 * Hit-test a line segment of a specific custom line. Returns the raw-points
 * index at which a new waypoint should be inserted so it lands on the clicked
 * segment (between waypoint `insertIndex - 1` and `insertIndex`). Waypoint
 * handles are skipped — caller should check `customLinePointAt` first.
 */
export function customLineSegmentAt(
  renderer: MapRenderer,
  roomId: number,
  exitName: string,
  mapX: number,
  mapY: number,
  roomSize: number,
): { insertIndex: number } | null {
  const threshold = roomSize * 0.5;
  for (const entry of renderer.getDrawnSpecialExits()) {
    if (entry.roomId !== roomId || entry.exitName !== exitName) continue;
    let best: { segIdx: number; dist: number } | null = null;
    // drawn polyline: [roomCx, roomCy, p0x, p0y, p1x, p1y, ...]. Segment i
    // spans drawn points i → i+1. Inserting at raw index `i` lands a new
    // waypoint inside that segment.
    for (let i = 0; i + 3 < entry.points.length; i += 2) {
      const d = distToSegment(
        mapX, mapY,
        entry.points[i], entry.points[i + 1],
        entry.points[i + 2], entry.points[i + 3],
      );
      if (d < threshold && (best === null || d < best.dist)) {
        best = { segIdx: i / 2, dist: d };
      }
    }
    if (!best) return null;
    return { insertIndex: best.segIdx };
  }
  return null;
}

/**
 * Hit-test a waypoint handle on a specific custom line. Returns the 0-based
 * index into the *raw* customLine.points array (which excludes the
 * renderer-prepended room centre), or null.
 */
export function customLinePointAt(
  renderer: MapRenderer,
  roomId: number,
  exitName: string,
  mapX: number,
  mapY: number,
  roomSize: number,
): number | null {
  const threshold = roomSize * 0.45;
  for (const entry of renderer.getDrawnSpecialExits()) {
    if (entry.roomId !== roomId || entry.exitName !== exitName) continue;
    let best: { index: number; dist: number } | null = null;
    // drawn polyline: [roomCx, roomCy, p0x, p0y, p1x, p1y, ...]. Waypoint i in
    // raw storage ↔ drawn index (i + 1). Skip drawn index 0 (room centre).
    for (let i = 1; i * 2 + 1 < entry.points.length; i++) {
      const px = entry.points[i * 2];
      const py = entry.points[i * 2 + 1];
      const d = Math.hypot(mapX - px, mapY - py);
      if (d < threshold && (best === null || d < best.dist)) {
        best = { index: i - 1, dist: d };
      }
    }
    return best ? best.index : null;
  }
  return null;
}

/**
 * Hit-test a `room.stubs` entry against the geometry the renderer actually
 * drew. Non-cardinal stubs (up/down/in/out) render as zero-length segments
 * and are implicitly skipped by the distance check.
 */
export function stubAt(
  renderer: MapRenderer,
  mapX: number,
  mapY: number,
  roomSize: number,
): { roomId: number; dir: Direction } | null {
  const threshold = roomSize * 0.3;
  let best: { roomId: number; dir: Direction; dist: number } | null = null;
  for (const stub of renderer.getDrawnStubs()) {
    const d = distToSegment(mapX, mapY, stub.x1, stub.y1, stub.x2, stub.y2);
    if (d < threshold && (best === null || d < best.dist)) {
      best = { roomId: stub.roomId, dir: stub.direction as Direction, dist: d };
    }
  }
  return best ? { roomId: best.roomId, dir: best.dir } : null;
}
