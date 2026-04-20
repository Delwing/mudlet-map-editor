import { useMemo, useRef } from 'react';
import { store, useEditorState } from '../editor/store';
import type { ToolId } from '../editor/types';
import { createEmptyMap, readMapFromBytes, writeMapToBytes } from '../mapIO';
import { DropdownSelect } from './DropdownSelect';

const TOOL_BUTTONS: { id: ToolId; label: string; hint: string; key: string }[] = [
  { id: 'select',     label: 'Select',      hint: 'Click a room to select. Drag to move (snaps to grid). Arrow keys nudge.', key: '1' },
  { id: 'connect',    label: 'Connect',     hint: 'Click source, then target. Shift = one-way.',                              key: '2' },
  { id: 'unlink',     label: 'Unlink',      hint: 'Click an exit line to remove.',                                            key: '3' },
  { id: 'addRoom',    label: 'Add Room',    hint: 'Click empty cell to create a room.',                                       key: '4' },
  { id: 'delete',     label: 'Delete',      hint: 'Click a room to delete it.',                                               key: '5' },
  { id: 'pan',        label: 'Pan',         hint: 'Drag background to pan. Hold Space with any tool for temporary pan.',      key: '6' },
];

export function Toolbar() {
  const activeTool = useEditorState((s) => s.activeTool);
  const map = useEditorState((s) => s.map);
  const mapLoaded = map != null;
  const loaded = useEditorState((s) => s.loaded);
  const currentAreaId = useEditorState((s) => s.currentAreaId);
  const currentZ = useEditorState((s) => s.currentZ);
  const snapToGrid = useEditorState((s) => s.snapToGrid);
  const status = useEditorState((s) => s.status);
  const undoLen = useEditorState((s) => s.undo.length);
  const redoLen = useEditorState((s) => s.redo.length);
  const savedUndoLength = useEditorState((s) => s.savedUndoLength);
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
      status: 'New map created · 0 rooms · 1 area',
    });
    store.bumpStructure();
  };

  const handleFile = async (file: File) => {
    try {
      store.setState({ status: `Reading ${file.name}…` });
      const bytes = await file.arrayBuffer();
      const map = readMapFromBytes(bytes);
      const firstAreaId = Number(Object.keys(map.areaNames)[0] ?? -1);
      const resolvedArea = Number.isNaN(firstAreaId) ? null : firstAreaId;
      const firstZ = 0;
      store.setState({
        map,
        loaded: { fileName: file.name },
        currentAreaId: resolvedArea,
        currentZ: firstZ,
        selection: null,
        hover: null,
        pending: null,
        undo: [],
        redo: [],
        savedUndoLength: 0,
        status: `Loaded ${file.name} · ${Object.keys(map.rooms).length} rooms · ${Object.keys(map.areaNames).length} areas`,
      });
      store.bumpStructure();
    } catch (err) {
      store.setState({ status: `Failed to read file: ${(err as Error).message}` });
      console.error(err);
    }
  };

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
      store.setState((s) => ({ savedUndoLength: s.undo.length, status: `Saved ${a.download}` }));
    } catch (err) {
      store.setState({ status: `Save failed: ${(err as Error).message}` });
      console.error(err);
    }
  };

  return (
    <div className="toolbar">
      <img src="/logo.png" alt="Mudlet logo" id={"logo"}/>
      <h1>Mudlet Map Editor</h1>
      <button type="button" title="New Map" onClick={handleNewMap}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <path d="M6 9h4M8 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>

      <label className="file-button" title="Load .dat">
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

      <button type="button" title="Save .dat" onClick={handleSave} disabled={!mapLoaded} style={{ position: 'relative', ...(dirty ? { color: '#ffd080' } : {}) }}>
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
          <div className="tool-group">
            {TOOL_BUTTONS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tool-btn${activeTool === t.id ? ' active' : ''}`}
                title={`${t.label} (${t.key}) — ${t.hint}`}
                onClick={() => {
                  store.setState({ activeTool: t.id, pending: null });
                }}
              >
                <span className="tool-key">{t.key}</span>
                {t.label}
              </button>
            ))}
          </div>

          <div className="toolbar-sep" />

          <button
            type="button"
            title="Undo (Ctrl+Z)"
            disabled={undoLen === 0}
            onClick={() => window.dispatchEvent(new CustomEvent('editor:undo'))}
          >
            ↶ Undo
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Shift+Z)"
            disabled={redoLen === 0}
            onClick={() => window.dispatchEvent(new CustomEvent('editor:redo'))}
          >
            ↷ Redo
          </button>

          <div className="toolbar-sep" />

          <DropdownSelect
            label="Area"
            value={currentAreaId}
            options={areaOptions.map((a) => ({ value: a.id, label: `${a.name} (#${a.id})` }))}
            onChange={(id) => {
              store.setState({ currentAreaId: id, currentZ: 0, selection: null, pending: null });
              store.bumpStructure();
            }}
            searchable
          />

          <DropdownSelect
            label="Level"
            value={currentZ}
            options={zLevels.map((z) => ({ value: z, label: String(z) }))}
            onChange={(z) => {
              store.setState({ currentZ: z, selection: null, pending: null });
              store.bumpStructure();
            }}
          />

          <button
            type="button"
            className={`tool-btn toolbar-snap-btn${snapToGrid ? ' active' : ''}`}
            title="Snap to grid (G)"
            onClick={() => store.setState({ snapToGrid: !snapToGrid })}
          >
            Snap
          </button>
        </>
      )}

      <span className="status">
        {loaded && <span className="status-file">[{loaded.fileName}]</span>}
        <span className="status-action">{status}</span>
      </span>
    </div>
  );
}
