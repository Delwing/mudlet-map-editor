import type { MudletMap, MudletRoom } from '../mapIO';
import { CARDINAL_DIRECTIONS } from './types';
import { ROOM_UI_HIDDEN, isHiddenValue } from './roomFlags';

/** Whether a room is flagged hidden via its userData. */
function isRoomHidden(room: MudletRoom): boolean {
  return isHiddenValue(room.userData?.[ROOM_UI_HIDDEN]);
}

/**
 * Structured room-search query language used by the Search panel.
 *
 * A query is a whitespace-separated list of tokens. Each token is either:
 *   - a structured filter `key:value` (e.g. `env:3`, `weight:>5`, `stubs:>0`,
 *     `exits:1`, `door:yes`, `locked:no`), optionally negated with a leading
 *     `-` or `!` (e.g. `-door:yes`); or
 *   - free text, matched against room name / id / userData (legacy behaviour).
 *
 * All structured filters are ANDed together; free-text tokens are joined with a
 * space and matched as a single substring. A token is treated as a filter only
 * when the part before the first colon is a recognised key — anything else
 * (including URLs and colon-bearing free text) falls through to free text, so
 * filters never produce surprising "unknown" errors for ordinary searches.
 */

export interface RoomMatchContext {
  room: MudletRoom;
  id: number;
  map: MudletMap;
}

export type RoomPredicate = (ctx: RoomMatchContext) => boolean;

export interface ParsedQuery {
  /** Free-text portion, lowercased; '' when the query is filters-only. */
  text: string;
  /** Structured predicates; a room must satisfy all of them. */
  predicates: RoomPredicate[];
  /** Canonical keys of the active filters, in first-seen order (for result summaries). */
  filterKeys: string[];
  /** The original token of the first malformed filter, or null. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Room field helpers
// ---------------------------------------------------------------------------

/** Count of real outgoing exits: cardinal/vertical exits plus special exits. */
export function exitCount(room: MudletRoom): number {
  let n = 0;
  for (const dir of CARDINAL_DIRECTIONS) {
    if (((room as any)[dir] as number) > 0) n++;
  }
  n += Object.keys(room.mSpecialExits ?? {}).length;
  return n;
}

function stubCount(room: MudletRoom): number {
  return room.stubs?.length ?? 0;
}

function doorCount(room: MudletRoom): number {
  return Object.values(room.doors ?? {}).filter((v) => v > 0).length;
}

function exitLockCount(room: MudletRoom): number {
  return room.exitLocks?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

type NumPredicate = (n: number) => boolean;

/**
 * Parse a numeric predicate value: a bare number (`5`), a comparison
 * (`>5`, `<=2`, `=0`), or an inclusive range (`1-5` or `2..8`).
 * Returns null if the value is not a valid numeric predicate.
 */
function parseNumPredicate(raw: string): NumPredicate | null {
  const v = raw.trim();
  if (!v) return null;

  let m = v.match(/^(-?\d+)\.\.(-?\d+)$/) ?? v.match(/^(\d+)-(\d+)$/);
  if (m) {
    const lo = Math.min(Number(m[1]), Number(m[2]));
    const hi = Math.max(Number(m[1]), Number(m[2]));
    return (n) => n >= lo && n <= hi;
  }

  m = v.match(/^(>=|<=|>|<|=)?\s*(-?\d+)$/);
  if (m) {
    const op = m[1] ?? '=';
    const num = Number(m[2]);
    switch (op) {
      case '>': return (n) => n > num;
      case '>=': return (n) => n >= num;
      case '<': return (n) => n < num;
      case '<=': return (n) => n <= num;
      default: return (n) => n === num;
    }
  }
  return null;
}

const TRUE_WORDS = new Set(['yes', 'y', 'true', '1', 'on']);
const FALSE_WORDS = new Set(['no', 'n', 'false', '0', 'off']);

/** Interpret a value as a boolean, or undefined when it is not boolean-like. */
function boolLike(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Predicate builders
// ---------------------------------------------------------------------------

function numField(value: string, get: (ctx: RoomMatchContext) => number): RoomPredicate | null {
  const pred = parseNumPredicate(value);
  if (!pred) return null;
  return (ctx) => pred(get(ctx));
}

/** Existence/boolean filter. An empty value (`door:`) means `yes`. */
function boolField(value: string, get: (ctx: RoomMatchContext) => boolean): RoomPredicate | null {
  if (value.trim() === '') return (ctx) => get(ctx);
  const b = boolLike(value);
  if (b === undefined) return null;
  return (ctx) => get(ctx) === b;
}

function symbolPredicate(value: string): RoomPredicate | null {
  const v = value.trim();
  if (v === '') return (ctx) => (ctx.room.symbol ?? '').length > 0;
  const b = boolLike(v);
  if (b !== undefined) return (ctx) => ((ctx.room.symbol ?? '').length > 0) === b;
  const q = v.toLowerCase();
  return (ctx) => (ctx.room.symbol ?? '').toLowerCase().includes(q);
}

function areaPredicate(value: string): RoomPredicate | null {
  const v = value.trim();
  if (!v) return null;
  const numPred = parseNumPredicate(v);
  if (numPred) return (ctx) => numPred(ctx.room.area);
  const q = v.toLowerCase();
  return (ctx) => (ctx.map.areaNames[ctx.room.area] ?? '').toLowerCase().includes(q);
}

function userDataPredicate(value: string): RoomPredicate | null {
  const v = value.trim();
  if (!v) return (ctx) => Object.keys(ctx.room.userData ?? {}).length > 0;
  const eq = v.indexOf('=');
  if (eq >= 0) {
    const kq = v.slice(0, eq).trim().toLowerCase();
    const vq = v.slice(eq + 1).trim().toLowerCase();
    return (ctx) =>
      Object.entries(ctx.room.userData ?? {}).some(
        ([k, val]) => k.toLowerCase().includes(kq) && String(val).toLowerCase().includes(vq),
      );
  }
  const q = v.toLowerCase();
  return (ctx) =>
    Object.entries(ctx.room.userData ?? {}).some(
      ([k, val]) => k.toLowerCase().includes(q) || String(val).toLowerCase().includes(q),
    );
}

function buildPredicate(key: string, value: string): RoomPredicate | null {
  switch (key) {
    // Numeric fields
    case 'env': return numField(value, (c) => c.room.environment);
    case 'weight': return numField(value, (c) => c.room.weight ?? 1);
    case 'exits': return numField(value, (c) => exitCount(c.room));
    case 'stubs': return numField(value, (c) => stubCount(c.room));
    case 'doors': return numField(value, (c) => doorCount(c.room));
    case 'exitlocks': return numField(value, (c) => exitLockCount(c.room));
    case 'z': return numField(value, (c) => c.room.z);
    case 'id': return numField(value, (c) => c.id);
    // Boolean / existence fields
    case 'locked': return boolField(value, (c) => c.room.isLocked);
    case 'door': return boolField(value, (c) => doorCount(c.room) > 0);
    case 'stub': return boolField(value, (c) => stubCount(c.room) > 0);
    case 'exitlock': return boolField(value, (c) => exitLockCount(c.room) > 0);
    case 'customline': return boolField(value, (c) => Object.keys(c.room.customLines ?? {}).length > 0);
    case 'special': return boolField(value, (c) => Object.keys(c.room.mSpecialExits ?? {}).length > 0);
    case 'deadend': return boolField(value, (c) => exitCount(c.room) === 1);
    case 'hidden': return boolField(value, (c) => isRoomHidden(c.room));
    case 'named': return boolField(value, (c) => (c.room.name ?? '').trim().length > 0);
    // Text fields
    case 'name': {
      const q = value.trim().toLowerCase();
      return (c) => (c.room.name ?? '').toLowerCase().includes(q);
    }
    case 'symbol': return symbolPredicate(value);
    case 'area': return areaPredicate(value);
    case 'userdata': return userDataPredicate(value);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Key registry
// ---------------------------------------------------------------------------

const CANONICAL_KEYS = new Set([
  'env', 'weight', 'exits', 'stubs', 'doors', 'exitlocks', 'z', 'id',
  'locked', 'door', 'stub', 'exitlock', 'customline', 'special', 'deadend',
  'hidden', 'named', 'name', 'symbol', 'area', 'userdata',
]);

const ALIASES: Record<string, string> = {
  environment: 'env',
  w: 'weight', weights: 'weight',
  exit: 'exits', exitcount: 'exits',
  hasstub: 'stub', stubbed: 'stub',
  hasdoor: 'door',
  lock: 'locked', locks: 'locked',
  exitlocked: 'exitlock',
  line: 'customline', cline: 'customline', customlines: 'customline',
  specialexit: 'special', specialexits: 'special', se: 'special',
  deadends: 'deadend', dead: 'deadend',
  hide: 'hidden', invisible: 'hidden',
  data: 'userdata', ud: 'userdata',
  level: 'z',
};

function resolveKey(key: string): string | null {
  if (CANONICAL_KEYS.has(key)) return key;
  return ALIASES[key] ?? null;
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export function parseRoomQuery(input: string): ParsedQuery {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const predicates: RoomPredicate[] = [];
  const freeTextParts: string[] = [];
  const filterKeys: string[] = [];
  let error: string | null = null;

  for (const token of tokens) {
    let body = token;
    let negate = false;
    if ((body.startsWith('-') || body.startsWith('!')) && body.length > 1) {
      const rest = body.slice(1);
      const ci = rest.indexOf(':');
      if (ci > 0 && resolveKey(rest.slice(0, ci).toLowerCase())) {
        negate = true;
        body = rest;
      }
    }

    const ci = body.indexOf(':');
    if (ci > 0) {
      const canonical = resolveKey(body.slice(0, ci).toLowerCase());
      if (canonical) {
        const pred = buildPredicate(canonical, body.slice(ci + 1));
        if (!pred) {
          if (error === null) error = token;
          continue;
        }
        predicates.push(negate ? (ctx) => !pred(ctx) : pred);
        if (!filterKeys.includes(canonical)) filterKeys.push(canonical);
        continue;
      }
    }

    freeTextParts.push(token);
  }

  return {
    text: freeTextParts.join(' ').toLowerCase(),
    predicates,
    filterKeys,
    error,
  };
}

/**
 * Build a compact, human-readable summary of the room values relevant to the
 * active filter keys — shown as the result row's reason when no free text
 * supplied a match reason.
 */
export function describeRoom(ctx: RoomMatchContext, keys: string[]): string {
  const { room } = ctx;
  const parts: string[] = [];
  for (const key of keys) {
    switch (key) {
      case 'env': parts.push(`env ${room.environment}`); break;
      case 'weight': parts.push(`weight ${room.weight ?? 1}`); break;
      case 'exits': case 'deadend': {
        const n = exitCount(room);
        parts.push(`${n} ${n === 1 ? 'exit' : 'exits'}`);
        break;
      }
      case 'stubs': case 'stub': {
        const n = stubCount(room);
        parts.push(`${n} ${n === 1 ? 'stub' : 'stubs'}`);
        break;
      }
      case 'doors': case 'door': {
        const n = doorCount(room);
        parts.push(`${n} ${n === 1 ? 'door' : 'doors'}`);
        break;
      }
      case 'exitlocks': case 'exitlock': {
        const n = exitLockCount(room);
        parts.push(`${n} exit ${n === 1 ? 'lock' : 'locks'}`);
        break;
      }
      case 'locked': parts.push(room.isLocked ? 'locked' : 'unlocked'); break;
      case 'hidden': parts.push(isRoomHidden(room) ? 'hidden' : 'visible'); break;
      case 'z': parts.push(`z${room.z}`); break;
      case 'customline': parts.push(`${Object.keys(room.customLines ?? {}).length} custom lines`); break;
      case 'special': parts.push(`${Object.keys(room.mSpecialExits ?? {}).length} special exits`); break;
      case 'symbol': if (room.symbol) parts.push(`symbol "${room.symbol}"`); break;
      case 'area': parts.push(ctx.map.areaNames[room.area] ?? `Area ${room.area}`); break;
      default: break;
    }
  }
  return parts.join(' · ');
}
