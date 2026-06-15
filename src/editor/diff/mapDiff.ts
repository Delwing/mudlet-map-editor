import type { MudletMap, MudletRoom } from '../../mapIO';
import type { MudletLabel, MudletArea } from 'mudlet-map-binary-reader';

// Ported from `mudlet-map-diff` (src/diff.ts) and adapted to run in the browser
// on two in-memory MudletMap objects rather than reading from file paths.
// Keep the algorithm in sync with the upstream library when it changes.

const SET_DIFF_MARKER = '__setDiff__';

// Binary fields (e.g. label pixMap) may be a Node Buffer on the live map but a
// plain Uint8Array on a structuredClone()'d baseline. Buffer extends Uint8Array,
// so treat both uniformly and compare by bytes — otherwise every label with a
// pixmap would always show as changed.
function isBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Internal wrapper used to carry set-diff direction through flatten → getPropertyDiff.
class SetDiffValue {
  constructor(public items: any[], public direction: 'removed' | 'added') {}
}

function isPrimitiveArray(arr: unknown[]): boolean {
  return arr.every((item) => typeof item !== 'object' || item === null);
}

function deepCompare(obj1: unknown, obj2: unknown): any {
  if (isBytes(obj1) && isBytes(obj2)) {
    return bytesEqual(obj1, obj2) ? {} : obj2;
  }
  if (typeof obj2 !== 'object' || obj2 === null) {
    return obj1 === obj2 ? {} : obj2;
  }

  // Primitive arrays (e.g. room ID lists) are treated as sets to avoid
  // cascading index shifts when a single element is added or removed.
  if (Array.isArray(obj2) && isPrimitiveArray(obj2 as unknown[])) {
    const arr1 = Array.isArray(obj1) ? (obj1 as unknown[]) : [];
    const set1 = new Set(arr1);
    const set2 = new Set(obj2 as unknown[]);
    const added = (obj2 as unknown[]).filter((x) => !set1.has(x));
    const removed = arr1.filter((x) => !set2.has(x));
    if (added.length === 0 && removed.length === 0) return {};
    return { [SET_DIFF_MARKER]: true, added, removed };
  }

  const diffObj: any = Array.isArray(obj2) ? [] : {};
  let o1 = obj1 as Record<string, any>;
  let o2 = obj2 as Record<string, any>;

  if (Array.isArray(o1)) o1 = [...o1].sort();
  if (Array.isArray(o2)) o2 = [...o2].sort();

  Object.getOwnPropertyNames(o2).forEach(function (prop) {
    const val1 = o1?.[prop];
    const val2 = o2[prop];
    if (isBytes(val1) || isBytes(val2)) {
      if (!(isBytes(val1) && isBytes(val2) && bytesEqual(val1, val2))) diffObj[prop] = val2;
    } else if (typeof val2 === 'object' && val2 !== null) {
      const res = deepCompare(val1 || {}, val2);
      if (Object.getOwnPropertyNames(res).length > 0) {
        diffObj[prop] = res;
      }
    } else if (val1 !== val2) {
      diffObj[prop] = val2;
    }
  });
  return diffObj;
}

function flatten(obj: any, parent?: string, res: Record<string, any> = {}): Record<string, any> {
  if (typeof obj !== 'object' || obj === null) return res;
  for (const key in obj) {
    const propName = parent ? parent + '.' + key : key;
    const val = (obj as Record<string, any>)[key];
    if (isBytes(val)) {
      res[propName] = val;
    } else if (val !== null && typeof val === 'object' && SET_DIFF_MARKER in val) {
      if (val.removed.length > 0) res[propName + '.removed'] = new SetDiffValue(val.removed, 'removed');
      if (val.added.length > 0) res[propName + '.added'] = new SetDiffValue(val.added, 'added');
    } else if (typeof val === 'object' && val !== null) {
      flatten(val, propName, res);
    } else {
      res[propName] = val;
    }
  }
  return res;
}

export interface PropertyChange {
  from: any;
  to: any;
}

export type PropertyDiff = Record<string, PropertyChange>;

export interface EntityDiff<T> {
  added: T[];
  deleted: T[];
  updated: Record<string, PropertyDiff>;
}

export interface MapDiff {
  rooms: EntityDiff<MudletRoom & { id: number }>;
  labels: EntityDiff<MudletLabel & { areaId: number }>;
  areas: EntityDiff<MudletArea & { id: number }>;
  map: PropertyDiff;
}

export function getPropertyDiff(obj1: unknown, obj2: unknown): PropertyDiff {
  const diff = deepCompare(obj1, obj2);
  const revDiff = deepCompare(obj2, obj1);
  const flatDiff = flatten(diff);
  const flatRevDiff = flatten(revDiff);

  const result: PropertyDiff = {};
  for (const key in flatDiff) {
    const val = flatDiff[key];
    if (val instanceof SetDiffValue) {
      // The forward diff already carries both directions; construct from/to directly.
      result[key] =
        val.direction === 'removed'
          ? { from: val.items, to: undefined }
          : { from: undefined, to: val.items };
    } else {
      result[key] = {
        from: flatRevDiff[key] instanceof SetDiffValue ? undefined : flatRevDiff[key],
        to: val,
      };
    }
  }
  for (const key in flatRevDiff) {
    if (key in result) continue;
    const val = flatRevDiff[key];
    if (val instanceof SetDiffValue) continue; // mirror of a forward set-diff entry, skip
    result[key] = { from: val, to: undefined };
  }
  return result;
}

function diffEntities<T extends object>(
  v1Map: Record<string | number, T>,
  v2Map: Record<string | number, T>,
  entityDiff: EntityDiff<T & { id?: number; areaId?: number }>,
  updateKeyPrefix?: (id: number) => string,
) {
  const allIds = new Set([...Object.keys(v1Map), ...Object.keys(v2Map)].map(Number));
  for (const id of allIds) {
    const e1 = v1Map[id];
    const e2 = v2Map[id];
    if (!e1 && e2) {
      const added = { ...e2 } as T & { id?: number; areaId?: number };
      if (added.id === undefined) added.id = id;
      entityDiff.added.push(added);
    } else if (e1 && !e2) {
      const deleted = { ...e1 } as T & { id?: number; areaId?: number };
      if (deleted.id === undefined) deleted.id = id;
      entityDiff.deleted.push(deleted);
    } else if (e1 && e2) {
      const diff = getPropertyDiff(e1, e2);
      if (Object.keys(diff).length > 0) {
        const key = updateKeyPrefix ? updateKeyPrefix(id) : id.toString();
        entityDiff.updated[key] = diff;
      }
    }
  }
}

/** Compute a structural diff between two in-memory maps (v1 = old, v2 = new). */
export function computeMapDiff(v1: MudletMap, v2: MudletMap): MapDiff {
  const rooms: EntityDiff<MudletRoom & { id: number }> = { added: [], deleted: [], updated: {} };
  const labels: EntityDiff<MudletLabel & { areaId: number }> = { added: [], deleted: [], updated: {} };
  const areas: EntityDiff<MudletArea & { id: number }> = { added: [], deleted: [], updated: {} };

  diffEntities(v1.rooms, v2.rooms, rooms);
  diffEntities(v1.areas, v2.areas, areas);

  const allAreaIds = new Set([...Object.keys(v1.areas), ...Object.keys(v2.areas)].map(Number));
  for (const areaId of allAreaIds) {
    const labels1 = v1.labels[areaId] || [];
    const labels2 = v2.labels[areaId] || [];
    const l1Map: Record<number, MudletLabel & { areaId: number }> = {};
    labels1.forEach((l) => (l1Map[l.labelId ?? l.id] = { ...l, areaId }));
    const l2Map: Record<number, MudletLabel & { areaId: number }> = {};
    labels2.forEach((l) => (l2Map[l.labelId ?? l.id] = { ...l, areaId }));

    diffEntities(
      l1Map,
      l2Map,
      labels as EntityDiff<MudletLabel & { areaId: number }>,
      (labelId) => `${areaId}-${labelId}`,
    );
  }

  // Diff map-level properties (excluding the entity collections handled above).
  const map1Props = { ...v1 } as Record<string, any>;
  const map2Props = { ...v2 } as Record<string, any>;
  for (const e of ['rooms', 'areas', 'labels'] as const) {
    delete map1Props[e];
    delete map2Props[e];
  }
  const map = getPropertyDiff(map1Props, map2Props);

  return { rooms, labels, areas, map };
}

export interface DiffCounts {
  rooms: { added: number; deleted: number; updated: number };
  labels: { added: number; deleted: number; updated: number };
  areas: { added: number; deleted: number; updated: number };
  map: number;
  total: number;
}

export function countDiff(diff: MapDiff): DiffCounts {
  const c = (e: EntityDiff<any>) => ({
    added: e.added.length,
    deleted: e.deleted.length,
    updated: Object.keys(e.updated).length,
  });
  const rooms = c(diff.rooms);
  const labels = c(diff.labels);
  const areas = c(diff.areas);
  const map = Object.keys(diff.map).length;
  const sum = (x: { added: number; deleted: number; updated: number }) => x.added + x.deleted + x.updated;
  return { rooms, labels, areas, map, total: sum(rooms) + sum(labels) + sum(areas) + map };
}
