import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState } from '../editor/store';
import { parseRoomQuery, describeRoom } from '../editor/roomSearch';

type SearchMode = 'rooms' | 'labels';

/** Filter examples shown in the syntax help popover; click to append to the query. */
const FILTER_EXAMPLES: { example: string; descKey: string }[] = [
  { example: 'env:3', descKey: 'helpEnv' },
  { example: 'weight:>5', descKey: 'helpWeight' },
  { example: 'exits:1', descKey: 'helpExits' },
  { example: 'deadend:yes', descKey: 'helpDeadend' },
  { example: 'stubs:>0', descKey: 'helpStubs' },
  { example: 'door:yes', descKey: 'helpDoor' },
  { example: 'locked:no', descKey: 'helpLocked' },
  { example: 'hidden:yes', descKey: 'helpHidden' },
  { example: 'special:yes', descKey: 'helpSpecial' },
  { example: 'customline:yes', descKey: 'helpCustomLine' },
  { example: 'symbol:yes', descKey: 'helpSymbol' },
  { example: 'area:water', descKey: 'helpArea' },
  { example: 'z:0', descKey: 'helpZ' },
  { example: '-door:yes', descKey: 'helpNegate' },
];

interface RoomResult {
  kind: 'room';
  id: number;
  name: string;
  areaId: number;
  areaName: string;
  x: number;
  y: number;
  z: number;
  matchReason: string;
}

interface LabelResult {
  kind: 'label';
  id: number;
  text: string;
  areaId: number;
  areaName: string;
  x: number;
  y: number;
  z: number;
}

type SearchResult = RoomResult | LabelResult;

function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('search');
  const map = useEditorState((s) => s.map);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('rooms');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { results, filterError } = useMemo<{ results: SearchResult[]; filterError: string | null }>(() => {
    if (!map || query.trim().length === 0) return { results: [], filterError: null };

    if (mode === 'rooms') {
      const parsed = parseRoomQuery(query);
      // A query made up solely of an invalid filter (no text, no valid filters)
      // can't match anything — surface the error instead of an empty list.
      if (parsed.predicates.length === 0 && parsed.text === '') {
        return { results: [], filterError: parsed.error };
      }
      const out: RoomResult[] = [];
      for (const [idStr, r] of Object.entries(map.rooms)) {
        if (!r) continue;
        const id = Number(idStr);
        const ctx = { room: r, id, map };
        if (!parsed.predicates.every((p) => p(ctx))) continue;

        let matchReason: string | null = null;
        if (parsed.text) {
          const q = parsed.text;
          if (r.name?.toLowerCase().includes(q)) {
            matchReason = 'name';
          } else if (idStr.includes(q)) {
            matchReason = 'id';
          } else if (r.userData) {
            for (const [k, v] of Object.entries(r.userData)) {
              if (k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) {
                matchReason = `${k}: ${truncate(String(v))}`;
                break;
              }
            }
          }
          if (matchReason === null) continue; // free text required but not found
        }
        if (matchReason === null) {
          matchReason = describeRoom(ctx, parsed.filterKeys);
        }
        out.push({
          kind: 'room',
          id,
          name: r.name ?? '',
          areaId: r.area,
          areaName: map.areaNames[r.area] ?? `Area ${r.area}`,
          x: r.x,
          y: r.y,
          z: r.z,
          matchReason,
        });
        if (out.length >= 100) break;
      }
      return { results: out, filterError: parsed.error };
    } else {
      const q = query.trim().toLowerCase();
      const out: LabelResult[] = [];
      for (const [areaIdStr, labelList] of Object.entries(map.labels)) {
        if (!labelList) continue;
        const areaId = Number(areaIdStr);
        for (const label of labelList) {
          if (!label || !label.text?.toLowerCase().includes(q)) continue;
          out.push({
            kind: 'label',
            id: label.id,
            text: label.text,
            areaId,
            areaName: map.areaNames[areaId] ?? `Area ${areaId}`,
            x: label.pos[0],
            y: label.pos[1],
            z: label.pos[2],
          });
          if (out.length >= 100) break;
        }
        if (out.length >= 100) break;
      }
      return { results: out, filterError: null };
    }
  }, [map, query, mode]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const navigateTo = (result: SearchResult) => {
    const s = store.getState();
    const sameArea = s.currentAreaId === result.areaId && s.currentZ === result.z;
    if (result.kind === 'room') {
      if (sameArea) {
        store.setState({
          selection: { kind: 'room', ids: [result.id] },
          panRequest: { mapX: result.x, mapY: -result.y },
        });
      } else {
        store.setState({
          currentAreaId: result.areaId,
          currentZ: result.z,
          navigateTo: { mapX: result.x, mapY: -result.y },
          selection: { kind: 'room', ids: [result.id] },
          pending: null,
        });
        store.bumpStructure();
      }
    } else {
      if (sameArea) {
        store.setState({
          selection: { kind: 'label', id: result.id, areaId: result.areaId },
          panRequest: { mapX: result.x, mapY: -result.y },
        });
      } else {
        store.setState({
          currentAreaId: result.areaId,
          currentZ: result.z,
          navigateTo: { mapX: result.x, mapY: -result.y },
          selection: { kind: 'label', id: result.id, areaId: result.areaId },
          pending: null,
        });
        store.bumpStructure();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      handleModeChange(mode === 'rooms' ? 'labels' : 'rooms');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      navigateTo(results[selectedIndex]);
    }
  };

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleModeChange = (newMode: SearchMode) => {
    setMode(newMode);
    setQuery('');
    setShowHelp(false);
    inputRef.current?.focus();
  };

  const appendExample = (example: string) => {
    setQuery((q) => (q.trim() ? `${q.trim()} ${example} ` : `${example} `));
    inputRef.current?.focus();
  };

  return (
    <div className="search-panel" onKeyDown={handleKeyDown}>
      <div className="search-panel-header">
        <div className="search-panel-tabs">
          <button
            type="button"
            className={`search-tab${mode === 'rooms' ? ' active' : ''}`}
            onClick={() => handleModeChange('rooms')}
          >
            {t('tabRooms')}
          </button>
          <button
            type="button"
            className={`search-tab${mode === 'labels' ? ' active' : ''}`}
            onClick={() => handleModeChange('labels')}
          >
            {t('tabLabels')}
          </button>
        </div>
        <div className="search-panel-header-actions">
          {mode === 'rooms' && (
            <button
              type="button"
              className={`search-help-toggle${showHelp ? ' active' : ''}`}
              onClick={() => setShowHelp((v) => !v)}
              title={t('filtersHelpTitle')}
              aria-pressed={showHelp}
            >
              {t('filtersToggle')}
            </button>
          )}
          <button type="button" className="modal-close" onClick={onClose} title={t('closeTitle')}>✕</button>
        </div>
      </div>
      <div className="search-panel-input-wrap">
        <svg className="search-panel-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          className="search-panel-input"
          type="text"
          spellCheck={false}
          placeholder={mode === 'rooms' ? t('placeholderRooms') : t('placeholderLabels')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="search-panel-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} title={t('clearTitle')}>✕</button>
        )}
      </div>
      {mode === 'rooms' && showHelp && (
        <div className="search-panel-help">
          <div className="search-panel-help-hint">{t('filtersHelpHint')}</div>
          <div className="search-panel-help-grid">
            {FILTER_EXAMPLES.map((f) => (
              <button
                key={f.example}
                type="button"
                className="search-help-chip"
                onClick={() => appendExample(f.example)}
                title={t(f.descKey)}
              >
                <code>{f.example}</code>
                <span>{t(f.descKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {mode === 'rooms' && filterError && (
        <div className="search-panel-error">{t('invalidFilter', { token: filterError })}</div>
      )}
      {query.trim().length > 0 && (
        <ul className="search-panel-results" ref={listRef}>
          {results.length === 0 ? (
            !filterError && <li className="search-panel-empty">{t('noMatches')}</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.kind === 'room' ? `room-${r.id}` : `label-${r.areaId}-${r.id}`}
                className={`search-panel-result${i === selectedIndex ? ' selected' : ''}`}
                onClick={() => navigateTo(r)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {r.kind === 'room' ? (
                  <>
                    <div className="search-result-row">
                      <span className="search-result-name">{r.name || <em>{t('unnamed')}</em>}</span>
                      <span className="search-result-meta">#{r.id} · {r.areaName}{r.z !== 0 ? ` · z${r.z}` : ''}</span>
                    </div>
                    {r.matchReason && <div className="search-result-reason">{r.matchReason}</div>}
                  </>
                ) : (
                  <>
                    <span className="search-result-name">{r.text || <em>{t('emptyLabel')}</em>}</span>
                    <span className="search-result-meta">
                      {r.areaName}{r.z !== 0 ? ` · z${r.z}` : ''}
                    </span>
                  </>
                )}
              </li>
            ))
          )}
          {results.length === 100 && (
            <li className="search-panel-more">{t('tooManyResults')}</li>
          )}
        </ul>
      )}
    </div>
  );
}
