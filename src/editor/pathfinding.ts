import { PathFinder, type PathFindingAlgorithm } from 'mudlet-map-renderer';
import type { MudletMap, MudletRoom } from '../mapIO';
import type { EditorMapReader } from './reader/EditorMapReader';
import { CARDINAL_DIRECTIONS, DIR_SHORT, type Direction } from './types';

export type { PathFindingAlgorithm };

export type RouteStep = {
  /** Room you leave from. */
  fromId: number;
  /** Room you arrive at. */
  toId: number;
  /** Speedwalk command — short cardinal (n, ne, up…) or the special-exit name. */
  token: string;
  /** Whether this hop is a cardinal exit or a named special exit. */
  kind: 'cardinal' | 'special';
  /** Edge weight A* / Dijkstra paid for this hop. */
  weight: number;
};

export type RouteSummary = {
  /** Room-id sequence start→end (length = steps + 1). */
  path: number[];
  steps: RouteStep[];
  /** Sum of edge weights along the path. */
  totalWeight: number;
  /** Semicolon-joined command string, e.g. "n;n;ne;up". */
  speedwalk: string;
};

/**
 * Edge weight rule, mirroring MapGraph.resolveEdgeWeight in the renderer so the
 * cost we display matches the cost the pathfinder actually optimised: an explicit
 * positive exit weight wins, otherwise the target room's weight (min 1).
 */
function edgeWeight(from: MudletRoom, key: string, to: MudletRoom): number {
  const w = from.exitWeights?.[key];
  if (w !== undefined && w > 0) return w;
  return Math.max(to.weight ?? 1, 1);
}

/** Resolve the command + weight for a single hop, or null if no forward exit links them. */
function resolveStep(map: MudletMap, fromId: number, toId: number): RouteStep | null {
  const from = map.rooms[fromId];
  const to = map.rooms[toId];
  if (!from || !to) return null;

  for (const dir of CARDINAL_DIRECTIONS) {
    if ((from as unknown as Record<string, unknown>)[dir] === toId) {
      const key = DIR_SHORT[dir as Direction];
      return { fromId, toId, token: key, kind: 'cardinal', weight: edgeWeight(from, key, to) };
    }
  }
  for (const [name, target] of Object.entries(from.mSpecialExits ?? {})) {
    if (target === toId) {
      return { fromId, toId, token: name, kind: 'special', weight: edgeWeight(from, name, to) };
    }
  }
  return null;
}

/**
 * Find the lowest-cost route between two rooms using the renderer's pathfinder
 * (respects exit/room weights, locked exits, and locked special exits) and
 * summarise it into a speedwalk string + per-hop steps. Returns null when either
 * endpoint is missing or no route exists.
 *
 * A fresh PathFinder is built per call: it snapshots the graph in its constructor,
 * and the editor mutates the map constantly, so reusing one would go stale.
 */
export function findRoute(
  reader: EditorMapReader,
  map: MudletMap,
  fromId: number,
  toId: number,
  algorithm: PathFindingAlgorithm = 'astar',
): RouteSummary | null {
  const finder = new PathFinder(reader as never, algorithm);
  const path = finder.findPath(fromId, toId);
  if (!path || path.length === 0) return null;

  const steps: RouteStep[] = [];
  let totalWeight = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const step = resolveStep(map, path[i], path[i + 1]);
    if (step) {
      steps.push(step);
      totalWeight += step.weight;
    }
  }

  return {
    path,
    steps,
    totalWeight,
    speedwalk: steps.map((s) => s.token).join(';'),
  };
}
