import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { modKey } from '../platform';
import { store, useEditorState, saveUserSettings } from '../editor/store';
import { createEmptyMap, writeMapToBytes } from '../mapIO';
import { loadFileIntoStore } from '../editor/loadFile';
import { DropdownSelect } from './DropdownSelect';
import { useToolButtons } from './HelpModal';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Toolbar({ title = 'Mudlet Map Editor', onHelpClick, onLoadFromUrl, onSave, onSearchClick, onSettingsClick }: { title?: string; onHelpClick: () => void; onLoadFromUrl: () => void; onSave?: (bytes: Uint8Array) => void; onSearchClick?: () => void; onSettingsClick?: () => void }) {
  const { t } = useTranslation('editor');
  const toolButtons = useToolButtons();
  const activeTool = useEditorState((s) => s.activeTool);
  const map = useEditorState((s) => s.map);
  const mapLoaded = map != null;
  const loaded = useEditorState((s) => s.loaded);
  const currentAreaId = useEditorState((s) => s.currentAreaId);
  const currentZ = useEditorState((s) => s.currentZ);
  const snapToGrid = useEditorState((s) => s.snapToGrid);
  const status = useEditorState((s) => s.status);
  const pending = useEditorState((s) => s.pending);
  const undoLen = useEditorState((s) => s.undo.length);
  const redoLen = useEditorState((s) => s.redo.length);
  const savedUndoLength = useEditorState((s) => s.savedUndoLength);
  const swatchPaletteOpen = useEditorState((s) => s.swatchPaletteOpen);
  const activeSwatchId = useEditorState((s) => s.activeSwatchId);
  const activeSwatchSetId = useEditorState((s) => s.activeSwatchSetId);
  const swatchSets = useEditorState((s) => s.swatchSets);
  const pluginSwatchSets = useEditorState((s) => s.pluginSwatchSets);
  const activeSwatch = [...swatchSets, ...pluginSwatchSets].find(s => s.id === activeSwatchSetId)?.swatches.find(sw => sw.id === activeSwatchId) ?? null;
  const dirty = undoLen !== savedUndoLength;
  const structureVersion = useEditorState((s) => s.structureVersion);

  const areaOptions = useMemo(() => {
    if (!map) return [] as { id: number; name: string }[];
    return Object.entries(map.areaNames)
      .map(([id, name]) => ({ id: Number(id), name: name as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [map, structureVersion]);

  const zLevels = useMemo(() => {
    if (!map || currentAreaId == null) return [0];
    const area = map.areas[currentAreaId];
    return area?.zLevels?.length ? [...area.zLevels].sort((a, b) => a - b) : [0];
  }, [map, currentAreaId, structureVersion]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [gotoInput, setGotoInput] = useState('');

  const handleGotoRoom = () => {
    const id = parseInt(gotoInput, 10);
    if (Number.isNaN(id)) return;
    const s = store.getState();
    if (!s.map) return;
    const room = s.map.rooms[id];
    if (!room) {
      store.setState({ status: t('status.roomNotFound', { id }) });
      return;
    }
    store.setState({
      currentAreaId: room.area,
      currentZ: room.z,
      navigateTo: { mapX: room.x, mapY: -room.y },
      selection: { kind: 'room', ids: [id] },
      pending: null,
    });
    store.bumpStructure();
    setGotoInput('');
  };

  const handleNewMap = () => {
    const map = createEmptyMap();
    store.setState({
      map,
      loaded: { fileName: 'new-map.dat' },
      currentAreaId: -1,
      currentZ: 0,
      selection: null,
      hover: null,
      pending: null,
      undo: [],
      redo: [],
      savedUndoLength: 0,
      status: t('status.newMapCreated'),
      sessionId: null,
    });
    store.bumpStructure();
  };

  const handleFile = loadFileIntoStore;

  const handleSave = () => {
    const s = store.getState();
    if (!s.map || !s.loaded) return;
    try {
      const bytes = writeMapToBytes(s.map);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([ab], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = s.loaded.fileName.replace(/\.dat$/i, '') + '-edited.dat';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      store.setState((s) => ({ savedUndoLength: s.undo.length, status: t('status.saved', { filename: a.download }) }));
      onSave?.(bytes);
    } catch (err) {
      store.setState({ status: t('status.saveFailed', { error: (err as Error).message }) });
      console.error(err);
    }
  };

  return (
    <div className="toolbar">
      {/* Row 1: header */}
      <div className="toolbar-row toolbar-row-header">
        <img src={`logo.png`} alt="Mudlet logo" id={"logo"}/>
        <h1>{title}</h1>

        <button type="button" title={t('toolbar.newMap')} onClick={handleNewMap}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M6 9h4M8 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>

        <label className="file-button" title={t('toolbar.loadDat')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M1 5h14v9H1V5z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M1 5l2-3h4l1 1h7" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M8 8v4M6 10l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <input
            ref={fileInputRef}
            type="file"
            accept=".dat"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
        </label>

        <button type="button" title={t('toolbar.loadFromUrl')} onClick={onLoadFromUrl}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M2 8h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M2.5 5.5h11M2.5 10.5h11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeDasharray="1.5 1"/>
          </svg>
        </button>

        <button type="button" title={t('toolbar.saveDat')} onClick={handleSave} disabled={!mapLoaded} style={{ position: 'relative', ...(dirty ? { color: '#ffd080' } : {}) }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 2h9l3 3v9H2V2z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <rect x="5" y="2" width="5" height="4" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <rect x="3" y="8" width="10" height="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          </svg>
          {dirty && <span style={{ position: 'absolute', top: 6, right: 7, fontSize: '10px', lineHeight: 1, color: '#ffd080' }}>*</span>}
        </button>

        {mapLoaded && (
          <>
            <div className="toolbar-sep" />

            <DropdownSelect
              label={t('toolbar.area')}
              value={currentAreaId}
              options={areaOptions.map((a) => ({ value: a.id, label: `${a.name} (#${a.id})` }))}
              onChange={(id) => {
                store.setState({ currentAreaId: id, currentZ: 0, selection: null, pending: null });
                store.bumpStructure();
              }}
              searchable
              width={300}
            />

            <DropdownSelect
              label={t('toolbar.level')}
              value={currentZ}
              options={zLevels.map((z) => ({ value: z, label: String(z) }))}
              onChange={(z) => {
                store.setState({ currentZ: z, selection: null, pending: null });
                store.bumpStructure();
              }}
            />

            <div className="toolbar-sep" />

            <div className="toolbar-goto" title={t('toolbar.goToRoomTitle')}>
              <label className="toolbar-goto-label" htmlFor="toolbar-goto-input">{t('toolbar.room')}</label>
              <input
                id="toolbar-goto-input"
                className="toolbar-goto-input"
                type="number"
                min={1}
                placeholder="ID"
                value={gotoInput}
                onChange={(e) => setGotoInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleGotoRoom(); }}
              />
              <button
                type="button"
                className="toolbar-goto-btn"
                onClick={handleGotoRoom}
                disabled={gotoInput === ''}
              >
                {t('toolbar.go')}
              </button>
            </div>

            <button
              type="button"
              className="tool-btn"
              title={t('toolbar.fitTitle')}
              onClick={() => window.dispatchEvent(new CustomEvent('editor:fit'))}
            >
              <span className="tool-key">F</span>
              <span>{t('toolbar.fit')}</span>
            </button>

            <button
              type="button"
              className="tool-btn"
              title={t('toolbar.searchTitle', { modKey })}
              onClick={onSearchClick}
            >
              <span className="tool-key">^F</span>
              <span>{t('toolbar.search')}</span>
            </button>
          </>
        )}

        <span className="status">
          {loaded && <span className="status-file">[{loaded.fileName}]</span>}
          <span className="status-action">{status ?? t('status.initialStatus')}</span>
        </span>

        <button
          type="button"
          className="help-btn"
          title={t('toolbar.rendererSettings')}
          onClick={mapLoaded ? onSettingsClick : undefined}
          style={!mapLoaded ? { opacity: 0.35, cursor: 'default' } : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.8" fill="none"/>
          </svg>
        </button>

        <button type="button" className="help-btn" title={t('toolbar.helpTitle')} onClick={onHelpClick}>
          ?
        </button>

        <LanguageSwitcher />
      </div>

      {/* Row 2: tools (only when map loaded) */}
      {mapLoaded && (
        <div className="toolbar-row toolbar-row-tools">
          <div className="tool-group">
            {toolButtons.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={`tool-btn${activeTool === tb.id ? ' active' : ''}`}
                title={`${tb.label} (${tb.key}) — ${tb.hint}`}
                onClick={() => {
                  store.setState({ activeTool: tb.id, pending: null });
                }}
              >
                <span className="tool-key">{tb.key}</span>
                <span>{tb.label}</span>
              </button>
            ))}
          </div>

          <div className="toolbar-sep" />

          <button
            type="button"
            title={t('toolbar.undoTitle', { modKey })}
            disabled={undoLen === 0}
            onClick={() => window.dispatchEvent(new CustomEvent('editor:undo'))}
          >
            {t('toolbar.undo')}
          </button>
          <button
            type="button"
            title={t('toolbar.redoTitle', { modKey })}
            disabled={redoLen === 0}
            onClick={() => window.dispatchEvent(new CustomEvent('editor:redo'))}
          >
            {t('toolbar.redo')}
          </button>

          <div className="toolbar-sep" />

          <button
            type="button"
            className={`tool-btn toolbar-snap-btn${snapToGrid ? ' active' : ''}`}
            title={t('toolbar.snapTitle')}
            onClick={() => { saveUserSettings({ snapToGrid: !snapToGrid }); store.setState({ snapToGrid: !snapToGrid }); }}
          >
            <span className="tool-key">G</span>
            <span>{t('toolbar.snap')}</span>
          </button>

          <button
            type="button"
            className={`tool-btn${swatchPaletteOpen ? ' active' : ''}`}
            title={t('toolbar.swatchesTitle')}
            onClick={() => store.setState({ swatchPaletteOpen: !swatchPaletteOpen })}
          >
            {activeSwatch
              ? <><span className="tool-key">8↴</span><span>{activeSwatch.name}</span></>
              : <><span className="tool-key">8↴</span><span>{t('toolbar.swatches')}</span></>
            }
          </button>

          {!pending && activeTool === 'paint' && (
            <span className="toolbar-pending-hint">
              {activeSwatch
                ? t('hints.paintActive', { name: activeSwatch.name, env: activeSwatch.environment, symbol: activeSwatch.symbol ? `, symbol "${activeSwatch.symbol}"` : '' })
                : t('hints.paintNoSwatch')}
            </span>
          )}
          {pending?.kind === 'marquee' && (
            <span className="toolbar-pending-hint">
              {t('hints.marquee')}
            </span>
          )}
          {pending?.kind === 'connect' && (
            <span className="toolbar-pending-hint">
              {t('hints.connect')}
            </span>
          )}
          {pending?.kind === 'customLine' && (
            <span className="toolbar-pending-hint">
              {t('hints.customLine')}
            </span>
          )}
          {!pending && activeTool === 'select' && (
            <span className="toolbar-pending-hint">
              {t('hints.select')}
            </span>
          )}
          {!pending && activeTool === 'unlink' && (
            <span className="toolbar-pending-hint">
              {t('hints.unlink')}
            </span>
          )}
          {!pending && activeTool === 'addRoom' && (
            <span className="toolbar-pending-hint">
              {t('hints.addRoom', { modKey })}
            </span>
          )}
          {!pending && activeTool === 'addLabel' && (
            <span className="toolbar-pending-hint">
              {t('hints.addLabel')}
            </span>
          )}
          {pending?.kind === 'paint' && (
            <span className="toolbar-pending-hint">
              {t('hints.paintDrag')}
            </span>
          )}
          {pending?.kind === 'pickSwatch' && (
            <span className="toolbar-pending-hint" style={{ color: '#ffd080' }}>
              {t('hints.pickSwatch')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
