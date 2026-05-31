import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState } from '../../editor/store';
import type { SceneHandle } from '../../editor/scene';
import { registerRoomPickCb } from '../../editor/tools';
import { findRoute, type PathFindingAlgorithm } from '../../editor/pathfinding';
import { Field, RoomLink } from '../panelShared';
import { CrosshairIcon } from '../icons';

type Endpoint = 'from' | 'to';

/** Inline horizontal button/input group. */
function Row({ children }: { children: ReactNode }) {
  return <div className="route-row">{children}</div>;
}

export function RoutePanel({ sceneRef }: { sceneRef: { current: SceneHandle | null } }) {
  const { t } = useTranslation('panels');
  const map = useEditorState((s) => s.map);
  const route = useEditorState((s) => s.route);
  const pending = useEditorState((s) => s.pending);
  const [copied, setCopied] = useState(false);

  const setRoute = (patch: Partial<typeof route>) =>
    store.setState((s) => ({ route: { ...s.route, ...patch } }));

  // Which endpoint a map-pick should fill. Held in a ref so the (once-registered)
  // pick callback always sees the latest target without re-registering.
  const pickTargetRef = useRef<Endpoint | null>(null);
  useEffect(() => {
    registerRoomPickCb((roomId) => {
      const tgt = pickTargetRef.current;
      if (tgt) setRoute({ [`${tgt}Id`]: roomId });
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

  const run = (fromId: number | null, toId: number | null, algorithm: PathFindingAlgorithm) => {
    const reader = sceneRef.current?.reader;
    if (!map || !reader) return;
    if (fromId == null || toId == null || !map.rooms[fromId] || !map.rooms[toId]) {
      setRoute({ fromId, toId, algorithm, summary: null, status: 'missing' });
      return;
    }
    if (fromId === toId) {
      setRoute({ fromId, toId, algorithm, summary: null, status: 'sameRoom' });
      return;
    }
    const summary = findRoute(reader, map, fromId, toId, algorithm);
    setRoute({ fromId, toId, algorithm, summary, status: summary ? 'found' : 'noPath' });
    if (summary) navigateToRoom(fromId);
  };

  const clear = () => setRoute({ summary: null, status: 'idle' });

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

  const summary = route.summary;

  return (
    <div className="panel-content route-panel">
      <h3>{t('route.title')}</h3>
      <p className="hint">{t('route.description')}</p>

      <Field label={t('route.from')} as="div">
        <Row>
          <input
            className="route-id-input"
            type="text"
            inputMode="numeric"
            placeholder="ID"
            value={route.fromId ?? ''}
            onChange={(e) => setRoute({ fromId: parseId(e.target.value) })}
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
            onChange={(e) => setRoute({ toId: parseId(e.target.value) })}
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
        <button type="button" className="route-btn" title={t('route.swap')} onClick={() => setRoute({ fromId: route.toId, toId: route.fromId })}>⇄ {t('route.swap')}</button>
      </Row>

      <Field label={t('route.algorithm')} as="div">
        <div className="route-radio-group">
          {(['astar', 'dijkstra'] as PathFindingAlgorithm[]).map((algo) => (
            <label key={algo} className="route-radio">
              <input
                type="radio"
                name="route-algo"
                checked={route.algorithm === algo}
                onChange={() => run(route.fromId, route.toId, algo)}
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
          onClick={() => run(route.fromId, route.toId, route.algorithm)}
          disabled={route.fromId == null || route.toId == null}
        >
          {t('route.find')}
        </button>
        <button type="button" className="route-btn" onClick={clear} disabled={!summary && route.status === 'idle'}>{t('route.clear')}</button>
      </Row>

      {route.status === 'missing' && <p className="hint route-error">{t('route.missing')}</p>}
      {route.status === 'sameRoom' && <p className="hint route-error">{t('route.sameRoom')}</p>}
      {route.status === 'noPath' && (
        <p className="hint route-error">{t('route.noPath', { from: route.fromId, to: route.toId })}</p>
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
            {summary.steps.map((s, i) => (
              <li key={i} className="route-step">
                <span className="route-step-token">{s.token}</span>
                <RoomLink id={s.toId} />
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="hint">{t('route.pickHint')}</p>
    </div>
  );
}
