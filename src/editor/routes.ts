import { store, ROUTE_COLORS, type EditorState, type RouteStatus, type TrackedRoute } from './store';
import type { SceneHandle } from './scene';
import type { MudletMap } from '../mapIO';
import { createPathFinder, findRoute, sameRouteSummary, type RouteSummary } from './pathfinding';

/**
 * The route finder's routes: editing them, and keeping every searched one up to
 * date as the map changes, so weight tweaks show their effect without anyone
 * pressing "Find route" again.
 */

type RouteResult = { summary: RouteSummary | null; status: Exclude<RouteStatus, 'idle'> };

/** Answer one route against the map as it stands; `search` only runs for two distinct, existing rooms. */
function evaluate(map: MudletMap, fromId: number | null, toId: number | null, search: (from: number, to: number) => RouteSummary | null): RouteResult {
  if (fromId == null || toId == null || !map.rooms[fromId] || !map.rooms[toId]) return { summary: null, status: 'missing' };
  if (fromId === toId) return { summary: null, status: 'sameRoom' };
  const summary = search(fromId, toId);
  return { summary, status: summary ? 'found' : 'noPath' };
}

export function updateRoute(id: number, patch: Partial<TrackedRoute>): void {
  store.setState((s) => ({
    route: { ...s.route, routes: s.route.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) },
  }));
}

/** Move an endpoint. The old result no longer answers the question, so the route
 *  drops back to idle (and out of tracking) until it is searched again. */
export function setRouteEndpoints(id: number, patch: Pick<Partial<TrackedRoute>, 'fromId' | 'toId'>): void {
  updateRoute(id, { ...patch, summary: null, status: 'idle', previous: null });
}

/** Add an empty route in the next unused colour and make it the active one. */
export function addRoute(): void {
  store.setState((s) => {
    const { routes } = s.route;
    const id = Math.max(0, ...routes.map((r) => r.id)) + 1;
    const used = new Set(routes.map((r) => r.color));
    const color = ROUTE_COLORS.find((c) => !used.has(c)) ?? ROUTE_COLORS[routes.length % ROUTE_COLORS.length];
    const route: TrackedRoute = { id, fromId: null, toId: null, color, visible: true, summary: null, status: 'idle', previous: null };
    return { route: { ...s.route, routes: [...routes, route], activeId: id } };
  });
}

/** Remove a route; the panel always keeps one, so removing the last one empties it instead. */
export function removeRoute(id: number): void {
  const { routes } = store.getState().route;
  if (routes.length <= 1) {
    setRouteEndpoints(id, { fromId: null, toId: null });
    return;
  }
  store.setState((s) => {
    const rest = s.route.routes.filter((r) => r.id !== id);
    const activeId = s.route.activeId === id ? rest[Math.max(0, s.route.routes.findIndex((r) => r.id === id) - 1)].id : s.route.activeId;
    return { route: { ...s.route, routes: rest, activeId } };
  });
}

/** Search one route from scratch. Starts a fresh comparison: whatever it finds is the new baseline. */
export function searchRoute(id: number, scene: SceneHandle | null): TrackedRoute | null {
  const { map, route } = store.getState();
  const reader = scene?.reader;
  const r = route.routes.find((x) => x.id === id);
  if (!map || !reader || !r) return null;
  const result = evaluate(map, r.fromId, r.toId, (from, to) => findRoute(reader, map, from, to, route.algorithm));
  updateRoute(id, { ...result, previous: null });
  return { ...r, ...result, previous: null };
}

/**
 * Re-answer every searched route against the current map, off a single graph
 * snapshot. A route whose answer changed keeps the answer it had before in
 * `previous`, so the panel can show what the edit did.
 */
export function recalcRoutes(scene: SceneHandle | null): void {
  const { map, route } = store.getState();
  const reader = scene?.reader;
  if (!map || !reader) return;
  if (!route.routes.some((r) => r.status !== 'idle')) return;

  let finder: ReturnType<typeof createPathFinder> | null = null;
  const search = (from: number, to: number) =>
    findRoute(reader, map, from, to, route.algorithm, (finder ??= createPathFinder(reader, route.algorithm)));

  let changed = false;
  const routes = route.routes.map((r) => {
    if (r.status === 'idle') return r;
    const next = evaluate(map, r.fromId, r.toId, search);
    if (next.status === r.status && sameRouteSummary(next.summary, r.summary)) return r;
    changed = true;
    // Found → broken keeps the route as it was; broken → found compares against
    // the route from before it broke, not against "nothing".
    return { ...r, ...next, previous: r.summary ?? r.previous };
  });
  if (changed) store.setState((s) => ({ route: { ...s.route, routes } }));
}

/** Whether anything a route's answer could depend on may have changed between two states. */
function mapMayHaveChanged(a: EditorState, b: EditorState): boolean {
  return a.map !== b.map || a.undo !== b.undo || a.redo !== b.redo
    || a.dataVersion !== b.dataVersion || a.route.algorithm !== b.route.algorithm;
}

/** Delay after the last edit before routes are re-answered: a burst of edits
 *  (typing a weight, dragging, undoing several steps) pays for one search. */
const RECALC_DELAY_MS = 150;

/**
 * Keep searched routes current while the scene lives. Any edit triggers a
 * recalculation rather than only weight/exit edits: telling in advance which
 * commands can matter (a moved room changes A*'s heuristic, a deleted room can
 * be an endpoint, a special exit rename changes the speedwalk) would be a
 * fragile list, and one pass over a handful of routes is cheap next to the edit.
 */
export function attachRouteTracker(sceneRef: { current: SceneHandle | null }): () => void {
  let last = store.getState();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => recalcRoutes(sceneRef.current), RECALC_DELAY_MS);
  };
  const unsubscribe = store.subscribe((s) => {
    if (!mapMayHaveChanged(last, s)) return;
    last = s;
    if (s.route.routes.some((r) => r.status !== 'idle')) schedule();
  });
  // A new scene means a newly loaded map: routes carried over from the last one
  // must be answered against it.
  schedule();
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
