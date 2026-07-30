import type { LiveRoom } from './EditorMapReader';

export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/** Window that materialises everything — the state before the renderer pushes one. */
export const INFINITE_BOUNDS: Bounds = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };

/**
 * Cell edge in map units. Rooms normally sit on a 1-unit grid, so a cell holds
 * up to ~1k rooms and an editing-zoom viewport spans only a handful of cells.
 */
const CELL = 32;

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
}

/**
 * Uniform spatial hash over one plane's rooms, supporting in-place updates.
 *
 * The renderer's own `PlaneIndex` (see `mudlet-map-renderer/bigmap`) is a
 * counting-sort over immutable typed arrays — rebuilding it costs O(plane),
 * which is fine for a read-only skeleton but not here, where a drag moves rooms
 * on every pointer event. This variant trades the compact layout for O(1)
 * add/remove/move: each room remembers the cell it was filed under, so
 * {@link update} re-files it without the caller tracking its old coordinates.
 */
export class PlaneRoomIndex {
  private readonly cells = new Map<string, LiveRoom[]>();
  /** Cell each room currently sits in, by room id. */
  private readonly filed = new Map<number, string>();
  private revision = 0;

  constructor(rooms: readonly LiveRoom[]) {
    for (const room of rooms) this.add(room);
  }

  /** Bumped whenever membership or any room's cell changes — cache key for query results. */
  getRevision(): number {
    return this.revision;
  }

  add(room: LiveRoom): void {
    const key = cellKey(room.x, room.y);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(room);
    else this.cells.set(key, [room]);
    this.filed.set(room.id, key);
    this.revision++;
  }

  remove(room: LiveRoom): void {
    const key = this.filed.get(room.id);
    if (key === undefined) return;
    this.filed.delete(room.id);
    const bucket = this.cells.get(key);
    if (bucket) {
      const i = bucket.findIndex(r => r.id === room.id);
      if (i !== -1) bucket.splice(i, 1);
      if (bucket.length === 0) this.cells.delete(key);
    }
    this.revision++;
  }

  /**
   * Re-file `room` after its coordinates changed. Cheap no-op while a drag stays
   * inside one cell, which is the common case.
   */
  update(room: LiveRoom): void {
    const key = cellKey(room.x, room.y);
    if (this.filed.get(room.id) === key) return;
    this.remove(room);
    this.add(room);
  }

  /** Every room whose centre lies inside `b`. Exact — each candidate is bounds-tested. */
  forEachInBounds(b: Bounds, fn: (room: LiveRoom) => void): void {
    for (const bucket of this.bucketsFor(b)) {
      for (const room of bucket) {
        if (room.x >= b.minX && room.x <= b.maxX && room.y >= b.minY && room.y <= b.maxY) fn(room);
      }
    }
  }

  collectInBounds(b: Bounds): LiveRoom[] {
    const out: LiveRoom[] = [];
    this.forEachInBounds(b, room => out.push(room));
    return out;
  }

  /**
   * Cheap UPPER BOUND on the rooms inside `b`: whole-cell occupancy, no per-room
   * test. Edge cells contribute rooms that are actually outside, so this must
   * not be used where an exact count matters.
   */
  countInBounds(b: Bounds): number {
    let total = 0;
    for (const bucket of this.bucketsFor(b)) total += bucket.length;
    return total;
  }

  /**
   * Buckets that overlap `b`. Walking the cell rectangle is the fast path, but
   * an unbounded (or simply very zoomed-out) window can span more cells than the
   * plane has occupied ones — then iterating occupancy is strictly cheaper.
   */
  private *bucketsFor(b: Bounds): Generator<LiveRoom[]> {
    const finite = Number.isFinite(b.minX) && Number.isFinite(b.maxX) &&
      Number.isFinite(b.minY) && Number.isFinite(b.maxY);
    if (finite) {
      const cx0 = Math.floor(b.minX / CELL), cx1 = Math.floor(b.maxX / CELL);
      const cy0 = Math.floor(b.minY / CELL), cy1 = Math.floor(b.maxY / CELL);
      const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
      if (span <= this.cells.size) {
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const bucket = this.cells.get(`${cx},${cy}`);
            if (bucket) yield bucket;
          }
        }
        return;
      }
    }
    for (const bucket of this.cells.values()) yield bucket;
  }
}
