import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState, type TrackedRoute } from '../../editor/store';
import type { SceneHandle } from '../../editor/scene';
import { registerRoomPickCb } from '../../editor/tools';
import type { PathFindingAlgorithm } from '../../editor/pathfinding';
import { addRoute, removeRoute, searchRoute, setRouteEndpoints, updateRoute } from '../../editor/routes';
import { Field, RoomLink } from '../panelShared';
import { CrosshairIcon } from '../icons';

type Endpoint = 'from' | 'to';

/** Inline horizontal button/input group. */
function Row({ children }: { children: ReactNode }) {
  return <div className="route-row">{children}</div>;
}

/** Cost change since the route's previous answer, signed, or null when there is nothing to compare. */
function costDelta(r: TrackedRoute): number | null {
  return r.previous && r.summary ? r.summary.totalWeight - r.previous.totalWeight : null;
}

function formatDelta(d: number): string {
  return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0';
}

/** Cheaper is good news, dearer is bad news; the colour says which at a glance. */
function deltaClass(d: number | null): string {
  return d == null ? 'route-delta route-delta--lost' : d < 0 ? 'route-delta route-delta--down' : d > 0 ? 'route-delta route-delta--up' : 'route-delta';
}

function RouteListItem({ route, active }: { route: TrackedRoute; active: boolean }) {
  const { t } = useTranslation('panels');
  const delta = costDelta(route);
  const ends = `${route.fromId != null ? `#${route.fromId}` : '?'} → ${route.toId != null ? `#${route.toId}` : '?'}`;
  const result =
    route.status === 'idle' ? t('route.unsearched')
    : route.summary ? t('route.cost', { weight: route.summary.totalWeight })
    : t('route.noPathShort');
  return (
    <li
      className={`route-item${active ? ' active' : ''}${route.status === 'idle' ? ' idle' : ''}`}
      onClick={() => store.setState((s) => ({ route: { ...s.route, activeId: route.id } }))}
    >
      <button
        type="button"
        className="route-item-swatch"
        style={{ borderColor: route.color, background: route.visible ? route.color : 'transparent' }}
        title={route.visible ? t('route.hideRoute') : t('route.showRoute')}
        onClick={(e) => { e.stopPropagation(); updateRoute(route.id, { visible: !route.visible }); }}
      />
      <span className="route-item-ends">{ends}</span>
      <span className="route-item-result">{result}</span>
      {route.previous && (
        <span className={deltaClass(delta)} title={t('route.changed')}>{delta == null ? '✕' : formatDelta(delta)}</span>
      )}
      <button
        type="button"
        className="route-item-remove"
        title={t('route.removeRoute')}
        onClick={(e) => { e.stopPropagation(); removeRoute(route.id); }}
      >
        ×
      </button>
    </li>
  );
}

export function RoutePanel({ sceneRef }: { sceneRef: { current: SceneHandle | null } }) {
  const { t } = useTranslation('panels');
  const map = useEditorState((s) => s.map);
  const routeState = useEditorState((s) => s.route);
  const pending = useEditorState((s) => s.pending);
  const [copied, setCopied] = useState(false);

  const route = routeState.routes.find((r) => r.id === routeState.activeId) ?? routeState.routes[0];

  // Which endpoint a map-pick should fill. Held in a ref so the (once-registered)
  // pick callback always sees the latest target without re-registering.
  const pickTargetRef = useRef<Endpoint | null>(null);
  useEffect(() => {
    registerRoomPickCb((roomId) => {
      const tgt = pickTargetRef.current;
      if (tgt) setRouteEndpoints(store.getState().route.activeId, { [`${tgt}Id`]: roomId });
    });
    return () => {
      registerRoomPickCb(null);
      // Drop a stale pick if the user navigates away mid-pick.
      if (store.getState().pending?.kind === 'pickRoom') store.setState({ pending: null });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isPicking = (target: Endpoint) =>
    pending?.kind === 'pickRoom' && pending.target === target;

  const togglePick = (target: Endpoint) => {
    if (isPicking(target)) {
      pickTargetRef.current = null;
      store.setState({ pending: null });
    } else {
      pickTargetRef.current = target;
      store.setState({ pending: { kind: 'pickRoom', target } });
    }
  };

  /** Pan/switch to a room without leaving the Route tab. */
  const navigateToRoom = (id: number) => {
    if (!map) return;
    const room = map.rooms[id];
    if (!room) return;
    const sameView = store.getState().currentAreaId === room.area && store.getState().currentZ === room.z;
    if (sameView) {
      store.setState({ selection: { kind: 'room', ids: [id] }, panRequest: { mapX: room.x, mapY: -room.y }, sidebarTab: 'route' });
    } else {
      store.setState({
        currentAreaId: room.area,
        currentZ: room.z,
        navigateTo: { mapX: room.x, mapY: -room.y },
        selection: { kind: 'room', ids: [id] },
        sidebarTab: 'route',
        pending: null,
      });
      store.bumpStructure();
    }
  };

  // An explicit search is the one time the view jumps to the route; the
  // recalculations that follow map edits leave the view where the user is working.
  const find = () => {
    const found = searchRoute(route.id, sceneRef.current);
    if (found?.summary && found.fromId != null) navigateToRoom(found.fromId);
  };

  const setAlgorithm = (algorithm: PathFindingAlgorithm) =>
    store.setState((s) => ({ route: { ...s.route, algorithm } }));

  const copySpeedwalk = async () => {
    if (!route.summary) return;
    try {
      await navigator.clipboard.writeText(route.summary.speedwalk);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };

  const parseId = (v: string): number | null => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  };

  const { summary, previous } = route;
  const delta = costDelta(route);
  const previousRooms = previous ? new Set(previous.path) : null;

  return (
    <div className="panel-content route-panel">
      <h3>{t('route.title')}</h3>
      <p className="hint">{t('route.description')}</p>

      <Field label={t('route.routes')} as="div">
        <ul className="route-list">
          {routeState.routes.map((r) => (
            <RouteListItem key={r.id} route={r} active={r.id === route.id} />
          ))}
        </ul>
        <Row>
          <button type="button" className="route-btn" onClick={addRoute}>+ {t('route.addRoute')}</button>
        </Row>
      </Field>

      <Field label={t('route.from')} as="div">
        <Row>
          <input
            className="route-id-input"
            type="text"
            inputMode="numeric"
            placeholder="ID"
            value={route.fromId ?? ''}
            onChange={(e) => setRouteEndpoints(route.id, { fromId: parseId(e.target.value) })}
          />
          <button
            type="button"
            className={`cc-pick-btn${isPicking('from') ? ' picking' : ''}`}
            title={isPicking('from') ? t('route.pickCancel') : t('route.pickFrom')}
            onClick={() => togglePick('from')}
          >
            <CrosshairIcon />
          </button>
        </Row>
      </Field>

      <Field label={t('route.to')} as="div">
        <Row>
          <input
            className="route-id-input"
            type="text"
            inputMode="numeric"
            placeholder="ID"
            value={route.toId ?? ''}
            onChange={(e) => setRouteEndpoints(route.id, { toId: parseId(e.target.value) })}
          />
          <button
            type="button"
            className={`cc-pick-btn${isPicking('to') ? ' picking' : ''}`}
            title={isPicking('to') ? t('route.pickCancel') : t('route.pickTo')}
            onClick={() => togglePick('to')}
          >
            <CrosshairIcon />
          </button>
        </Row>
      </Field>

      <Row>
        <button type="button" className="route-btn" title={t('route.swap')} onClick={() => setRouteEndpoints(route.id, { fromId: route.toId, toId: route.fromId })}>⇄ {t('route.swap')}</button>
      </Row>

      <Field label={t('route.algorithm')} as="div">
        <div className="route-radio-group">
          {(['astar', 'dijkstra'] as PathFindingAlgorithm[]).map((algo) => (
            <label key={algo} className="route-radio">
              <input
                type="radio"
                name="route-algo"
                checked={routeState.algorithm === algo}
                onChange={() => setAlgorithm(algo)}
              />
              {algo === 'astar' ? t('route.astar') : t('route.dijkstra')}
            </label>
          ))}
        </div>
      </Field>

      <Row>
        <button
          type="button"
          className="route-btn route-btn--primary"
          onClick={find}
          disabled={route.fromId == null || route.toId == null}
        >
          {t('route.find')}
        </button>
        <button
          type="button"
          className="route-btn"
          onClick={() => setRouteEndpoints(route.id, {})}
          disabled={route.status === 'idle'}
        >
          {t('route.clear')}
        </button>
      </Row>
      <p className="hint">{t('route.tracking')}</p>

      {route.status === 'missing' && <p className="hint route-error">{t('route.missing')}</p>}
      {route.status === 'sameRoom' && <p className="hint route-error">{t('route.sameRoom')}</p>}
      {route.status === 'noPath' && (
        <p className="hint route-error">{t('route.noPath', { from: route.fromId, to: route.toId })}</p>
      )}

      {previous && (
        <div className="route-change">
          <div className="route-change-head">
            <span>{t('route.changed')}</span>
            <span className={deltaClass(delta)}>{delta == null ? '✕' : formatDelta(delta)}</span>
          </div>
          {!summary && <div>{t('route.nowNoPath')}</div>}
          <div className="route-change-was">{t('route.was', { weight: previous.totalWeight, count: previous.steps.length })}</div>
          <Row>
            <button type="button" className="route-btn" onClick={() => updateRoute(route.id, { previous: null })}>{t('route.dismissChange')}</button>
          </Row>
        </div>
      )}

      {summary && route.status === 'found' && (
        <div className="route-result">
          <div className="route-stats">
            <span className="route-stat">{t('route.rooms', { count: summary.path.length })}</span>
            <span className="route-stat">{t('route.steps', { count: summary.steps.length })}</span>
            <span className="route-stat">{t('route.cost', { weight: summary.totalWeight })}</span>
          </div>

          <Field label={t('route.speedwalk')} as="div">
            <Row>
              <input className="route-speedwalk" type="text" readOnly value={summary.speedwalk} />
              <button type="button" className="route-btn" onClick={copySpeedwalk}>{copied ? t('route.copied') : t('route.copy')}</button>
            </Row>
          </Field>

          <Row>
            <button type="button" className="route-btn" onClick={() => navigateToRoom(summary.path[0])}>{t('route.goStart')}</button>
            <button type="button" className="route-btn" onClick={() => navigateToRoom(summary.path[summary.path.length - 1])}>{t('route.goEnd')}</button>
          </Row>

          <h3>{t('route.stepList')}</h3>
          <ol className="route-steps">
            {summary.steps.map((s, i) => {
              const isNew = previousRooms != null && !previousRooms.has(s.toId);
              return (
                <li key={i} className={`route-step${isNew ? ' route-step--new' : ''}`} title={isNew ? t('route.newStep') : undefined}>
                  <span className="route-step-token">{s.token}</span>
                  <RoomLink id={s.toId} />
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <p className="hint">{t('route.pickHint')}</p>
    </div>
  );
}
