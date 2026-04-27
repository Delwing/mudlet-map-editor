import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, saveSwatchState, useEditorState } from '../editor/store';
import type { Swatch, SwatchSet } from '../editor/types';
import type { SceneHandle } from '../editor/scene';
import { EnvPicker } from './EnvPicker';

export function SwatchPalette({ sceneRef }: { sceneRef: { current: SceneHandle | null } }) {
  const { t } = useTranslation('swatches');
  const swatchSets = useEditorState((s) => s.swatchSets);
  const pluginSwatchSets = useEditorState((s) => s.pluginSwatchSets);
  const activeSwatchSetId = useEditorState((s) => s.activeSwatchSetId);
  const activeSwatchId = useEditorState((s) => s.activeSwatchId);
  const map = useEditorState((s) => s.map);
  const picking = useEditorState((s) => s.pending?.kind === 'pickSwatch');

  const [pos, setPos] = useState({ x: 12, y: 120 });
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);

  const [addingSet, setAddingSet] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [editingSetName, setEditingSetName] = useState(false);
  const [setNameDraft, setSetNameDraft] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSymbol, setDraftSymbol] = useState('');
  const [draftEnv, setDraftEnv] = useState(-1);
  const [showEnvPicker, setShowEnvPicker] = useState(false);

  const allSets = [...swatchSets, ...pluginSwatchSets.map((s) => ({ ...s, readonly: true as const }))];
  const activeSet = allSets.find((s) => s.id === activeSwatchSetId) ?? allSets[0] ?? null;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { ox, oy, px, py } = dragRef.current;
      setPos({ x: px + (e.clientX - ox), y: py + (e.clientY - oy) });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  useEffect(() => {
    const onPick = (e: Event) => {
      const { symbol, environment } = (e as CustomEvent<{ symbol: string; environment: number }>).detail;
      setDraftSymbol(symbol);
      setDraftEnv(environment);
    };
    window.addEventListener('editor:swatchRoomPicked', onPick);
    return () => window.removeEventListener('editor:swatchRoomPicked', onPick);
  }, []);

  const getEnvColor = (envId: number) => {
    const reader = sceneRef.current?.reader;
    if (reader) return reader.getColorValue(envId);
    return 'rgb(114,1,0)';
  };

  const commit = (newSets: SwatchSet[], newSetId?: string | null, newSwatchId?: string | null) => {
    const setId = newSetId !== undefined ? newSetId : activeSwatchSetId;
    const swatchId = newSwatchId !== undefined ? newSwatchId : activeSwatchId;
    store.setState({ swatchSets: newSets, activeSwatchSetId: setId, activeSwatchId: swatchId });
    saveSwatchState(newSets, setId, swatchId);
  };

  const addSet = () => {
    const name = newSetName.trim() || t('title');
    const id = crypto.randomUUID();
    const newSets = [...swatchSets, { id, name, swatches: [] } as SwatchSet];
    commit(newSets, id, null);
    setNewSetName('');
    setAddingSet(false);
  };

  const renameSet = (name: string) => {
    if (!activeSet) return;
    commit(swatchSets.map((s) => s.id === activeSet.id ? { ...s, name } : s));
  };

  const deleteSet = () => {
    if (!activeSet || swatchSets.length <= 1) return;
    if (!window.confirm(t('confirmDeleteSet', { name: activeSet.name }))) return;
    const newSets = swatchSets.filter((s) => s.id !== activeSet.id);
    commit(newSets, newSets[0]?.id ?? null, null);
  };

  const selectSet = (setId: string) => {
    store.setState({ activeSwatchSetId: setId, activeSwatchId: null });
    saveSwatchState(swatchSets, setId, null);
  };

  const activateSwatch = (swatchId: string) => {
    store.setState({ activeSwatchId: swatchId });
    saveSwatchState(swatchSets, activeSwatchSetId, swatchId);
  };

  const openEdit = (sw: Swatch) => {
    setEditId(sw.id);
    setDraftName(sw.name);
    setDraftSymbol(sw.symbol);
    setDraftEnv(sw.environment);
    setShowEnvPicker(false);
  };

  const openAdd = () => {
    setEditId('new');
    setDraftName('');
    setDraftSymbol('');
    setDraftEnv(-1);
    setShowEnvPicker(false);
  };

  const cancelEdit = () => { setEditId(null); setShowEnvPicker(false); };

  const commitEdit = () => {
    if (!activeSet || !editId) return;
    const name = draftName.trim() || t('title');
    const symbol = draftSymbol.slice(0, 4);
    if (editId === 'new') {
      const id = crypto.randomUUID();
      const newSwatch: Swatch = { id, name, symbol, environment: draftEnv };
      const newSets = swatchSets.map((s) =>
        s.id === activeSet.id ? { ...s, swatches: [...s.swatches, newSwatch] } : s
      );
      commit(newSets, activeSwatchSetId, id);
    } else {
      const newSets = swatchSets.map((s) =>
        s.id === activeSet.id
          ? { ...s, swatches: s.swatches.map((sw) => sw.id === editId ? { ...sw, name, symbol, environment: draftEnv } : sw) }
          : s
      );
      commit(newSets);
    }
    setEditId(null);
    setShowEnvPicker(false);
  };

  const deleteSwatch = (swatchId: string) => {
    if (!activeSet) return;
    const newSets = swatchSets.map((s) =>
      s.id === activeSet.id ? { ...s, swatches: s.swatches.filter((sw) => sw.id !== swatchId) } : s
    );
    commit(newSets, undefined, activeSwatchId === swatchId ? null : undefined);
  };

  return (
    <div className="swatch-palette" style={{ left: pos.x, top: pos.y }}>
      <div
        className="swatch-palette-header"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button, input, select')) return;
          dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
        }}
      >
        <span className="swatch-palette-title">{t('title')}</span>
        <button type="button" className="swatch-palette-close" onClick={() => store.setState({ swatchPaletteOpen: false })}>✕</button>
      </div>

      <div className="swatch-set-row">
        {allSets.length === 0 ? (
          <span className="swatch-empty-hint">{t('noSets')}</span>
        ) : !activeSet?.readonly && editingSetName ? (
          <>
            <input
              className="swatch-set-name-input"
              value={setNameDraft}
              onChange={(e) => setSetNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { renameSet(setNameDraft); setEditingSetName(false); }
                if (e.key === 'Escape') setEditingSetName(false);
              }}
              autoFocus
            />
            <button type="button" className="swatch-icon-btn" onClick={() => { renameSet(setNameDraft); setEditingSetName(false); }}>✓</button>
            <button type="button" className="swatch-icon-btn" onClick={() => setEditingSetName(false)}>✕</button>
          </>
        ) : (
          <>
            <select
              className="swatch-set-select"
              value={activeSet?.id ?? ''}
              onChange={(e) => selectSet(e.target.value)}
            >
              {allSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {!activeSet?.readonly && <>
              <button
                type="button"
                className="swatch-icon-btn"
                title={t('renameSet')}
                onClick={() => { setEditingSetName(true); setSetNameDraft(activeSet?.name ?? ''); }}
              >✏</button>
              <button
                type="button"
                className="swatch-icon-btn swatch-icon-btn-danger"
                title={t('deleteSet')}
                disabled={swatchSets.length <= 1}
                onClick={deleteSet}
              >🗑</button>
            </>}
          </>
        )}
        {addingSet ? (
          <>
            <input
              className="swatch-set-name-input"
              placeholder={t('setNamePlaceholder')}
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSet(); if (e.key === 'Escape') { setAddingSet(false); setNewSetName(''); } }}
              autoFocus
            />
            <button type="button" className="swatch-icon-btn" onClick={addSet}>✓</button>
            <button type="button" className="swatch-icon-btn" onClick={() => { setAddingSet(false); setNewSetName(''); }}>✕</button>
          </>
        ) : (
          <button type="button" className="swatch-icon-btn" title={t('newSet')} onClick={() => setAddingSet(true)}>+</button>
        )}
      </div>

      {activeSet && (
        <div className="swatch-grid">
          {activeSet.swatches.map((sw) => (
            <div
              key={sw.id}
              className={`swatch-chip${activeSwatchId === sw.id ? ' active' : ''}${editId === sw.id ? ' editing' : ''}`}
              onClick={() => activateSwatch(sw.id)}
              title={`${sw.name} · env ${sw.environment}${sw.symbol ? ` · "${sw.symbol}"` : ''}`}
            >
              <span className="swatch-chip-env" style={{ background: getEnvColor(sw.environment) }} />
              {sw.symbol && <span className="swatch-chip-symbol">{sw.symbol}</span>}
              <span className="swatch-chip-name">{sw.name}</span>
              {!activeSet.readonly && <>
                <button type="button" className="swatch-chip-edit" title={t('editSwatch')} onClick={(e) => { e.stopPropagation(); openEdit(sw); }}>✏</button>
                <button type="button" className="swatch-chip-del" title={t('deleteSwatch')} onClick={(e) => { e.stopPropagation(); deleteSwatch(sw.id); }}>×</button>
              </>}
            </div>
          ))}
          {!activeSet.readonly && <button type="button" className="swatch-add-btn" title={t('addSwatch')} onClick={openAdd}>+</button>}
        </div>
      )}

      {editId && !activeSet?.readonly && (
        picking ? (
          <div className="swatch-pick-banner">
            <span>{t('clickToCopy')}</span>
            <button type="button" className="swatch-icon-btn" onClick={() => store.setState({ pending: null })}>{t('cancel')}</button>
          </div>
        ) : (
          <div className="swatch-edit-form">
            <input
              className="swatch-edit-name"
              placeholder={t('namePlaceholder')}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              autoFocus
            />
            <input
              className="swatch-edit-symbol"
              placeholder={t('symPlaceholder')}
              maxLength={4}
              value={draftSymbol}
              onChange={(e) => setDraftSymbol(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
            />
            <div className="swatch-env-picker-wrap">
              <button
                type="button"
                className="swatch-env-btn"
                style={{ background: getEnvColor(draftEnv) }}
                title={`Env ${draftEnv === -1 ? 'none' : draftEnv} — click to change`}
                onClick={() => setShowEnvPicker((v) => !v)}
              >
                <span className="swatch-env-id">{draftEnv === -1 ? '−' : draftEnv}</span>
              </button>
              {showEnvPicker && map && (
                <EnvPicker
                  map={map}
                  sceneRef={sceneRef}
                  currentEnvId={draftEnv}
                  onSelect={(id) => { setDraftEnv(id); setShowEnvPicker(false); }}
                  onClose={() => setShowEnvPicker(false)}
                />
              )}
            </div>
            <button
              type="button"
              className="swatch-icon-btn"
              title={t('pickFromCanvas')}
              onClick={() => store.setState({ pending: { kind: 'pickSwatch' } })}
            >⊕</button>
            <button type="button" className="swatch-edit-ok" title="Save" onClick={commitEdit}>✓</button>
            <button type="button" className="swatch-edit-cancel" title={t('cancel')} onClick={cancelEdit}>✕</button>
          </div>
        )
      )}

      {swatchSets.length === 0 && (
        <div className="swatch-empty">{t('empty')}</div>
      )}
    </div>
  );
}
