import { useState, useMemo, useRef, useEffect } from 'react';
import { store, useEditorState } from '../editor/store';

type SearchMode = 'rooms' | 'labels';

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
  const map = useEditorState((s) => s.map);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('rooms');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    if (!map || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();

    if (mode === 'rooms') {
      const out: RoomResult[] = [];
      for (const [idStr, r] of Object.entries(map.rooms)) {
        if (!r) continue;
        const id = Number(idStr);
        let matchReason: string | null = null;
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
        if (matchReason !== null) {
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
      }
      return out;
    } else {
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
      return out;
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
            Rooms
          </button>
          <button
            type="button"
            className={`search-tab${mode === 'labels' ? ' active' : ''}`}
            onClick={() => handleModeChange('labels')}
          >
            Labels
          </button>
        </div>
        <button type="button" className="modal-close" onClick={onClose} title="Close (Esc)">✕</button>
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
          placeholder={mode === 'rooms' ? 'name, ID, or user data… (Tab to switch)' : 'label text… (Tab to switch)'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="search-panel-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} title="Clear">✕</button>
        )}
      </div>
      {query.trim().length > 0 && (
        <ul className="search-panel-results" ref={listRef}>
          {results.length === 0 ? (
            <li className="search-panel-empty">No matches</li>
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
                      <span className="search-result-name">{r.name || <em>unnamed</em>}</span>
                      <span className="search-result-meta">#{r.id} · {r.areaName}{r.z !== 0 ? ` · z${r.z}` : ''}</span>
                    </div>
                    <div className="search-result-reason">{r.matchReason}</div>
                  </>
                ) : (
                  <>
                    <span className="search-result-name">{r.text || <em>empty label</em>}</span>
                    <span className="search-result-meta">
                      {r.areaName}{r.z !== 0 ? ` · z${r.z}` : ''}
                    </span>
                  </>
                )}
              </li>
            ))
          )}
          {results.length === 100 && (
            <li className="search-panel-more">Showing first 100 results — refine your query</li>
          )}
        </ul>
      )}
    </div>
  );
}
