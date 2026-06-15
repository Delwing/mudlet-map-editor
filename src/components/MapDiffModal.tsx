import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../editor/store';
import type { MudletMap } from '../mapIO';
import { revertCommand } from '../editor/commands';
import { computeMapDiff, countDiff, type MapDiff, type DiffCounts } from '../editor/diff/mapDiff';
import { createDiffPane, linkCameras, alignCamera, type DiffPane } from '../editor/diff/diffScene';
import { roomKey, labelKey, type DiffStatus } from '../editor/diff/DiffHighlightOverlay';
import { DropdownSelect } from './DropdownSelect';

const ENTRY_CAP = 300;
/** Zoom level used when jumping to a specific change (close-up on the room). */
const JUMP_ZOOM = 0.6;

interface JumpEntry {
  key: string;
  status: DiffStatus;
  area: number;
  z: number;
  x: number;
  y: number;
  primary: string;
  secondary?: string;
}

const STATUS_COLOR: Record<DiffStatus, string> = {
  added: '#36d399',
  deleted: '#f87272',
  changed: '#fbbd23',
};

/** Reconstruct the map as it was at session start by reverting the undo stack. */
function reconstructBaseline(current: MudletMap, undo: import('../editor/types').Command[]): MudletMap {
  const baseline = structuredClone(current);
  for (let i = undo.length - 1; i >= 0; i--) {
    revertCommand(baseline, undo[i], null);
  }
  return baseline;
}

function describeChange(path: string, from: any, to: any): string {
  const fmt = (v: any) => {
    if (v === undefined) return '∅';
    if (Array.isArray(v)) return `[${v.join(', ')}]`;
    if (typeof v === 'object' && v !== null) return '{…}';
    const s = String(v);
    return s.length > 24 ? s.slice(0, 24) + '…' : s;
  };
  return `${path}: ${fmt(from)} → ${fmt(to)}`;
}

export function MapDiffModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('modals');

  // Snapshot the live map + history once on open. `current` is the live map
  // (read-only here); `baseline` is reconstructed from the undo stack.
  const currentMap = useMemo(() => store.getState().map, []);
  const baseName = useMemo(() => store.getState().loaded?.fileName ?? 'map', []);
  const undoSnapshot = useMemo(() => store.getState().undo, []);

  const [baseline, setBaseline] = useState<MudletMap | null>(null);
  const [diff, setDiff] = useState<MapDiff | null>(null);
  const [counts, setCounts] = useState<DiffCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(true);
  const [panesReady, setPanesReady] = useState(false);
  const [area, setArea] = useState<number | null>(null);
  const [z, setZ] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [leftPct, setLeftPct] = useState(50);
  const [showHighlights, setShowHighlights] = useState(true);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftPane = useRef<DiffPane | null>(null);
  const rightPane = useRef<DiffPane | null>(null);
  const viewRef = useRef({ area, z });
  viewRef.current = { area, z };
  const showHighlightsRef = useRef(showHighlights);
  showHighlightsRef.current = showHighlights;
  const hoveredKeyRef = useRef(hoveredKey);
  hoveredKeyRef.current = hoveredKey;
  const listRef = useRef<HTMLDivElement>(null);

  // --- Compute baseline + diff (once) -----------------------------------------

  useEffect(() => {
    if (!currentMap) return;
    setComputing(true);
    // Defer so the "computing" state paints before the blocking work.
    const h = setTimeout(() => {
      try {
        const base = reconstructBaseline(currentMap, undoSnapshot);
        const d = computeMapDiff(base, currentMap);
        setBaseline(base);
        setDiff(d);
        setCounts(countDiff(d));
        const first = firstChangedArea(d, currentMap, base);
        if (first) {
          setArea(first.area);
          setZ(first.z);
        } else {
          const anyArea = Number(Object.keys(currentMap.areaNames)[0] ?? -1);
          setArea(anyArea);
          setZ(0);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setComputing(false);
      }
    }, 0);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Build / tear down the panes --------------------------------------------

  useEffect(() => {
    if (!diff || !baseline || !currentMap || !leftRef.current || !rightRef.current) return;
    const L = createDiffPane(baseline, leftRef.current, diff, 'old');
    const R = createDiffPane(currentMap, rightRef.current, diff, 'new');
    leftPane.current = L;
    rightPane.current = R;
    const unlink = linkCameras(L, R);
    L.setHighlightsEnabled(showHighlightsRef.current);
    R.setHighlightsEnabled(showHighlightsRef.current);
    const v = viewRef.current;
    if (v.area != null) {
      L.setView(v.area, v.z);
      R.setView(v.area, v.z);
      alignCamera(L, R);
    }
    setPanesReady(true);
    return () => {
      unlink();
      L.destroy();
      R.destroy();
      leftPane.current = null;
      rightPane.current = null;
      setPanesReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, baseline]);

  const toggleHighlights = (next: boolean) => {
    setShowHighlights(next);
    leftPane.current?.setHighlightsEnabled(next);
    rightPane.current?.setHighlightsEnabled(next);
  };

  // Single hover source of truth: drives the pane emphasis ring (both panes)
  // and the sidebar entry highlight, regardless of where the hover originated.
  const setHovered = (key: string | null) => {
    if (hoveredKeyRef.current === key) return;
    hoveredKeyRef.current = key;
    setHoveredKey(key);
    leftPane.current?.setHover(key);
    rightPane.current?.setHover(key);
  };

  // roomId / "areaId-labelId" → sidebar entry key, for map-hover → sidebar.
  const keyByHit = useMemo(() => {
    const rooms = new Map<number, string>();
    const labels = new Map<string, string>();
    if (diff) {
      for (const r of diff.rooms.added) rooms.set(r.id, roomKey('added', r.id));
      for (const r of diff.rooms.deleted) rooms.set(r.id, roomKey('deleted', r.id));
      for (const id of Object.keys(diff.rooms.updated)) rooms.set(Number(id), roomKey('changed', Number(id)));
      for (const l of diff.labels.added) labels.set(`${l.areaId}-${l.labelId ?? l.id}`, labelKey('added', l.areaId, l.labelId ?? l.id));
      for (const l of diff.labels.deleted) labels.set(`${l.areaId}-${l.labelId ?? l.id}`, labelKey('deleted', l.areaId, l.labelId ?? l.id));
      for (const key of Object.keys(diff.labels.updated)) {
        const [a, lid] = key.split('-').map(Number);
        labels.set(`${a}-${lid}`, labelKey('changed', a, lid));
      }
    }
    return { rooms, labels };
  }, [diff]);

  const onPaneMove = (pane: DiffPane | null, e: React.MouseEvent<HTMLDivElement>) => {
    if (!pane) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pt = pane.renderer.camera.clientToMapPoint(e.clientX, e.clientY, { left: rect.left, top: rect.top });
    if (!pt) return;
    const hit = pane.renderer.hitTest(pt.x, pt.y);
    let key: string | null = null;
    if (hit?.kind === 'room' && hit.id != null) {
      key = keyByHit.rooms.get(Number(hit.id)) ?? null;
    } else if (hit?.kind === 'label' && hit.id != null) {
      const areaId = (hit.payload as any)?.areaId;
      key = keyByHit.labels.get(`${areaId}-${hit.id}`) ?? null;
    }
    setHovered(key);
  };

  // Scroll the hovered entry into view when the hover came from the map.
  useEffect(() => {
    if (!hoveredKey || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-diff-key="${CSS.escape(hoveredKey)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [hoveredKey]);

  const goToView = (nextArea: number, nextZ: number, room?: { x: number; y: number }) => {
    setArea(nextArea);
    setZ(nextZ);
    const L = leftPane.current;
    const R = rightPane.current;
    if (!L || !R) return;
    L.setView(nextArea, nextZ);
    R.setView(nextArea, nextZ);
    if (room) {
      L.renderer.setZoom(JUMP_ZOOM);
      L.panToRoom(room.x, room.y);
    }
    alignCamera(L, R);
  };

  // --- Divider drag -----------------------------------------------------------

  const panesRef = useRef<HTMLDivElement>(null);
  const onDividerDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const box = panesRef.current?.getBoundingClientRect();
      if (!box) return;
      const pct = ((ev.clientX - box.left) / box.width) * 100;
      setLeftPct(Math.min(85, Math.max(15, pct)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // --- Derived lists ----------------------------------------------------------

  const areaOptions = useMemo(() => {
    if (!baseline || !currentMap) return [] as { value: number; label: string }[];
    const ids = new Set<number>([
      ...Object.keys(baseline.areaNames).map(Number),
      ...Object.keys(currentMap.areaNames).map(Number),
    ]);
    return [...ids]
      .map((id) => ({ value: id, label: `${currentMap.areaNames[id] ?? baseline.areaNames[id] ?? '?'} (#${id})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [baseline, currentMap]);

  const zLevels = useMemo(() => {
    if (area == null) return [0];
    const a = currentMap?.areas[area] ?? baseline?.areas[area];
    return a?.zLevels?.length ? [...a.zLevels].sort((x, y) => x - y) : [0];
  }, [area, baseline, currentMap]);

  const roomEntries = useMemo<JumpEntry[]>(() => {
    if (!diff || !baseline || !currentMap) return [];
    const out: JumpEntry[] = [];
    for (const r of diff.rooms.added)
      out.push({ key: roomKey('added', r.id), status: 'added', area: r.area, z: r.z, x: r.x, y: r.y, primary: `#${r.id}`, secondary: r.name });
    for (const r of diff.rooms.deleted)
      out.push({ key: roomKey('deleted', r.id), status: 'deleted', area: r.area, z: r.z, x: r.x, y: r.y, primary: `#${r.id}`, secondary: r.name });
    for (const id of Object.keys(diff.rooms.updated)) {
      const room = currentMap.rooms[Number(id)] ?? baseline.rooms[Number(id)];
      if (!room) continue;
      out.push({
        key: roomKey('changed', Number(id)),
        status: 'changed',
        area: room.area,
        z: room.z,
        x: room.x,
        y: room.y,
        primary: `#${id}`,
        secondary: Object.keys(diff.rooms.updated[id]).join(', '),
      });
    }
    return out;
  }, [diff, baseline, currentMap]);

  const labelEntries = useMemo<JumpEntry[]>(() => {
    if (!diff || !baseline || !currentMap) return [];
    const out: JumpEntry[] = [];
    const push = (l: any, status: DiffStatus, areaId: number) =>
      out.push({
        key: labelKey(status, areaId, l.labelId ?? l.id),
        status,
        area: areaId,
        z: l.pos[2],
        x: l.pos[0],
        y: l.pos[1],
        primary: `${t('diff.label')} #${l.labelId ?? l.id}`,
        secondary: typeof l.text === 'string' ? l.text : undefined,
      });
    for (const l of diff.labels.added) push(l, 'added', l.areaId);
    for (const l of diff.labels.deleted) push(l, 'deleted', l.areaId);
    for (const key of Object.keys(diff.labels.updated)) {
      const [areaIdStr, labelIdStr] = key.split('-');
      const areaId = Number(areaIdStr);
      const labelId = Number(labelIdStr);
      const label = (currentMap.labels[areaId] || baseline.labels[areaId] || []).find((l) => (l.labelId ?? l.id) === labelId);
      if (label) push(label, 'changed', areaId);
    }
    return out;
  }, [diff, baseline, currentMap, t]);

  const mapPropEntries = useMemo(() => {
    if (!diff) return [];
    return Object.entries(diff.map).map(([path, change]) => describeChange(path, change.from, change.to));
  }, [diff]);

  // --- Render -----------------------------------------------------------------

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal diff-modal">
        <div className="modal-header">
          <h2>{t('diff.title')}</h2>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="diff-layout">
          <div className="diff-sidebar">
            <div className="diff-controls">
              <div className="diff-files">
                <span style={{ color: STATUS_COLOR.deleted }}>◀ {t('diff.sessionStart')}</span>
                <span style={{ color: STATUS_COLOR.added }}>{t('diff.now')} ▶</span>
              </div>
              <DropdownSelect
                label={t('diff.area')}
                value={area}
                options={areaOptions}
                onChange={(id) => {
                  const a = currentMap?.areas[id] ?? baseline?.areas[id];
                  const firstZ = a?.zLevels?.length ? [...a.zLevels].sort((x, y) => x - y)[0] : 0;
                  goToView(id, firstZ);
                }}
                searchable
                width={220}
              />
              <DropdownSelect
                label={t('diff.level')}
                value={z}
                options={zLevels.map((lv) => ({ value: lv, label: String(lv) }))}
                onChange={(lv) => area != null && goToView(area, lv)}
              />
              <label className="diff-toggle">
                <input
                  type="checkbox"
                  checked={showHighlights}
                  onChange={(e) => toggleHighlights(e.target.checked)}
                />
                {t('diff.highlights')}
              </label>
            </div>

            {error && <div className="diff-status" style={{ color: STATUS_COLOR.deleted }}>{error}</div>}

            {counts && (
              <div className="diff-summary">
                <SummaryRow label={t('diff.rooms')} c={counts.rooms} />
                <SummaryRow label={t('diff.labels')} c={counts.labels} />
                <SummaryRow label={t('diff.areas')} c={counts.areas} />
                {counts.map > 0 && <div className="diff-summary-row"><span>{t('diff.mapProps')}</span><span>{counts.map}</span></div>}
                {counts.total === 0 && <div className="diff-status">{t('diff.noChanges')}</div>}
              </div>
            )}

            <div className="diff-list" ref={listRef}>
              <EntryGroup title={t('diff.rooms')} entries={roomEntries} selectedKey={selectedKey} hoveredKey={hoveredKey}
                onHover={setHovered}
                onPick={(en) => { setSelectedKey(en.key); goToView(en.area, en.z, { x: en.x, y: en.y }); }} />
              <EntryGroup title={t('diff.labels')} entries={labelEntries} selectedKey={selectedKey} hoveredKey={hoveredKey}
                onHover={setHovered}
                onPick={(en) => { setSelectedKey(en.key); goToView(en.area, en.z, { x: en.x, y: en.y }); }} />
              {mapPropEntries.length > 0 && (
                <div className="diff-group">
                  <div className="diff-group-title">{t('diff.mapProps')} ({mapPropEntries.length})</div>
                  {mapPropEntries.slice(0, ENTRY_CAP).map((s, i) => (
                    <div key={i} className="diff-entry diff-entry-static">{s}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="diff-panes" ref={panesRef}>
            {(computing || !panesReady) && (
              <div className="diff-loading">
                <div className="diff-loading-label">{t('diff.computing')}</div>
                <div className="diff-loading-track">
                  <div className="diff-loading-fill" />
                </div>
              </div>
            )}
            <div className="diff-pane" style={{ width: `${leftPct}%` }}>
              <div className="diff-pane-label" style={{ color: STATUS_COLOR.deleted }}>{baseName} · {t('diff.sessionStart')}</div>
              <div
                className="diff-pane-canvas"
                ref={leftRef}
                onMouseMove={(e) => onPaneMove(leftPane.current, e)}
                onMouseLeave={() => setHovered(null)}
              />
            </div>
            <div className="diff-divider" onMouseDown={onDividerDown} title={t('diff.dragHint')} />
            <div className="diff-pane" style={{ width: `${100 - leftPct}%` }}>
              <div className="diff-pane-label" style={{ color: STATUS_COLOR.added }}>{baseName} · {t('diff.now')}</div>
              <div
                className="diff-pane-canvas"
                ref={rightRef}
                onMouseMove={(e) => onPaneMove(rightPane.current, e)}
                onMouseLeave={() => setHovered(null)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, c }: { label: string; c: { added: number; deleted: number; updated: number } }) {
  if (c.added + c.deleted + c.updated === 0) return null;
  return (
    <div className="diff-summary-row">
      <span>{label}</span>
      <span className="diff-counts">
        {c.added > 0 && <span style={{ color: STATUS_COLOR.added }}>+{c.added}</span>}
        {c.deleted > 0 && <span style={{ color: STATUS_COLOR.deleted }}>−{c.deleted}</span>}
        {c.updated > 0 && <span style={{ color: STATUS_COLOR.changed }}>~{c.updated}</span>}
      </span>
    </div>
  );
}

function EntryGroup({
  title,
  entries,
  selectedKey,
  hoveredKey,
  onPick,
  onHover,
}: {
  title: string;
  entries: JumpEntry[];
  selectedKey: string | null;
  hoveredKey: string | null;
  onPick: (e: JumpEntry) => void;
  onHover: (key: string | null) => void;
}) {
  if (entries.length === 0) return null;
  const shown = entries.slice(0, ENTRY_CAP);
  return (
    <div className="diff-group">
      <div className="diff-group-title">{title} ({entries.length})</div>
      {shown.map((en) => (
        <button
          key={en.key}
          type="button"
          data-diff-key={en.key}
          className={`diff-entry${selectedKey === en.key ? ' selected' : ''}${hoveredKey === en.key ? ' hovered' : ''}`}
          onClick={() => onPick(en)}
          onMouseEnter={() => onHover(en.key)}
          onMouseLeave={() => onHover(null)}
        >
          <span className="diff-dot" style={{ background: STATUS_COLOR[en.status] }} />
          <span className="diff-entry-primary">{en.primary}</span>
          {en.secondary && <span className="diff-entry-secondary">{en.secondary}</span>}
        </button>
      ))}
      {entries.length > ENTRY_CAP && (
        <div className="diff-entry diff-entry-static">+{entries.length - ENTRY_CAP} more…</div>
      )}
    </div>
  );
}

/** First area (with z) that has any room/label change. */
function firstChangedArea(diff: MapDiff, newMap: MudletMap, oldMap: MudletMap): { area: number; z: number } | null {
  const first = diff.rooms.added[0] ?? diff.rooms.deleted[0];
  if (first) return { area: first.area, z: first.z };
  const updId = Object.keys(diff.rooms.updated)[0];
  if (updId) {
    const room = newMap.rooms[Number(updId)] ?? oldMap.rooms[Number(updId)];
    if (room) return { area: room.area, z: room.z };
  }
  const addedLabel = diff.labels.added[0] ?? diff.labels.deleted[0];
  if (addedLabel) return { area: addedLabel.areaId, z: addedLabel.pos[2] };
  return null;
}
