import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, saveSwatchState, useEditorState } from '../editor/store';
import type { Swatch, SwatchSet } from '../editor/types';
import type { SceneHandle } from '../editor/scene';
import { BORDER_THICKNESS_MIN, BORDER_THICKNESS_MAX } from '../editor/roomFlags';
import { EnvPicker } from './EnvPicker';
import { ColorSwatch } from './panelShared';

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
  const [draftSymbolColor, setDraftSymbolColor] = useState<string | null>(null);
  const [draftBorderColor, setDraftBorderColor] = useState<string | null>(null);
  const [draftBorderThickness, setDraftBorderThickness] = useState('');
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
      const { symbol, environment, symbolColor, borderColor, borderThickness } = (e as CustomEvent<{
        symbol: string;
        environment: number;
        symbolColor: string | null;
        borderColor: string | null;
        borderThickness: number | null;
      }>).detail;
      setDraftSymbol(symbol);
      setDraftEnv(environment);
      setDraftSymbolColor(symbolColor);
      setDraftBorderColor(borderColor);
      setDraftBorderThickness(borderThickness != null ? String(borderThickness) : '');
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
    if (!activeSet || activeSet.readonly) return;
    // The last remaining set can't be removed (we always keep one), so reset it
    // to an empty default instead of deleting it.
    if (swatchSets.length <= 1) {
      if (!window.confirm(t('confirmResetSet', { name: activeSet.name }))) return;
      commit(swatchSets.map((s) => s.id === activeSet.id ? { ...s, name: t('title'), swatches: [] } : s), activeSet.id, null);
      return;
    }
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
    setDraftSymbolColor(sw.symbolColor ?? null);
    setDraftBorderColor(sw.borderColor ?? null);
    setDraftBorderThickness(sw.borderThickness != null ? String(sw.borderThickness) : '');
    setShowEnvPicker(false);
  };

  const openAdd = () => {
    setEditId('new');
    setDraftName('');
    setDraftSymbol('');
    setDraftEnv(-1);
    setDraftSymbolColor(null);
    setDraftBorderColor(null);
    setDraftBorderThickness('');
    setShowEnvPicker(false);
  };

  const cancelEdit = () => { setEditId(null); setShowEnvPicker(false); };

  const commitEdit = () => {
    if (!activeSet || !editId) return;
    const name = draftName.trim() || t('title');
    const symbol = draftSymbol.slice(0, 4);
    const thicknessNum = draftBorderThickness.trim() === '' ? null : parseInt(draftBorderThickness, 10);
    const borderThickness = thicknessNum != null && Number.isFinite(thicknessNum)
      ? Math.min(BORDER_THICKNESS_MAX, Math.max(BORDER_THICKNESS_MIN, thicknessNum))
      : null;
    const extra = {
      symbolColor: draftSymbolColor,
      borderColor: draftBorderColor,
      borderThickness,
    };
    if (editId === 'new') {
      const id = crypto.randomUUID();
      const newSwatch: Swatch = { id, name, symbol, environment: draftEnv, ...extra };
      const newSets = swatchSets.map((s) =>
        s.id === activeSet.id ? { ...s, swatches: [...s.swatches, newSwatch] } : s
      );
      commit(newSets, activeSwatchSetId, id);
    } else {
      const newSets = swatchSets.map((s) =>
        s.id === activeSet.id
          ? { ...s, swatches: s.swatches.map((sw) => sw.id === editId ? { ...sw, name, symbol, environment: draftEnv, ...extra } : sw) }
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
                title={swatchSets.length <= 1 ? t('resetSet') : t('deleteSet')}
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
              <span
                className="swatch-chip-env"
                style={{
                  background: getEnvColor(sw.environment),
                  ...(sw.borderColor ? { borderColor: sw.borderColor, borderWidth: Math.min(3, sw.borderThickness ?? 1) } : null),
                }}
              />
              {sw.symbol && <span className="swatch-chip-symbol" style={sw.symbolColor ? { color: sw.symbolColor } : undefined}>{sw.symbol}</span>}
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
            <div className="swatch-edit-row">
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
            </div>

            <div className="swatch-edit-row swatch-edit-props">
              <div className="swatch-edit-group">
                <label className="swatch-edit-prop" title={t('symbolColorTitle')}>
                  <span className="swatch-edit-prop-label">{t('symbolColorLabel')}</span>
                  <ColorSwatch
                    color={draftSymbolColor ?? '#ffffff'}
                    empty={draftSymbolColor === null}
                    inputProps={{
                      value: draftSymbolColor ?? '#ffffff',
                      onChange: (e) => setDraftSymbolColor((e.target as HTMLInputElement).value),
                    }}
                  />
                  <button
                    type="button"
                    className="swatch-color-clear"
                    style={{ visibility: draftSymbolColor !== null ? 'visible' : 'hidden' }}
                    title={t('clearColor')}
                    onClick={() => setDraftSymbolColor(null)}
                  >×</button>
                </label>
              </div>
              <div className="swatch-edit-group">
                <label className="swatch-edit-prop" title={t('borderColorTitle')}>
                  <span className="swatch-edit-prop-label">{t('borderColorLabel')}</span>
                  <ColorSwatch
                    color={draftBorderColor ?? '#ffffff'}
                    empty={draftBorderColor === null}
                    inputProps={{
                      value: draftBorderColor ?? '#ffffff',
                      onChange: (e) => setDraftBorderColor((e.target as HTMLInputElement).value),
                    }}
                  />
                  <button
                    type="button"
                    className="swatch-color-clear"
                    style={{ visibility: draftBorderColor !== null ? 'visible' : 'hidden' }}
                    title={t('clearColor')}
                    onClick={() => setDraftBorderColor(null)}
                  >×</button>
                </label>
                <label className="swatch-edit-prop" title={t('borderThicknessTitle')}>
                  <span className="swatch-edit-prop-label">{t('borderThicknessLabel')}</span>
                  <input
                    type="number"
                    className="swatch-thickness-input"
                    min={BORDER_THICKNESS_MIN}
                    max={BORDER_THICKNESS_MAX}
                    placeholder="—"
                    value={draftBorderThickness}
                    onChange={(e) => setDraftBorderThickness(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                  />
                </label>
              </div>
            </div>

            <div className="swatch-edit-row swatch-edit-actions">
              <button
                type="button"
                className="swatch-icon-btn"
                title={t('pickFromCanvas')}
                onClick={() => store.setState({ pending: { kind: 'pickSwatch' } })}
              >⊕ {t('pick')}</button>
              <span className="swatch-edit-spacer" />
              <button type="button" className="swatch-edit-ok" title="Save" onClick={commitEdit}>✓</button>
              <button type="button" className="swatch-edit-cancel" title={t('cancel')} onClick={cancelEdit}>✕</button>
            </div>
          </div>
        )
      )}

      {swatchSets.length === 0 && (
        <div className="swatch-empty">{t('empty')}</div>
      )}
    </div>
  );
}
