import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../editor/store';
import { pushCommand } from '../editor/commands';
import type { Command } from '../editor/types';
import type { SceneHandle } from '../editor/scene';
import type { MudletMap } from '../mapIO';
import { EnvPicker } from './EnvPicker';
import { LockIcon } from './icons';
import { RoomLink } from './panelShared';

interface MultiRoomPanelProps {
  selection: { kind: 'room'; ids: number[] };
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
}

function unanimous<T>(arr: T[]): { same: true; value: T } | { same: false } {
  if (arr.length === 0) return { same: false };
  const first = arr[0];
  return arr.every((v) => v === first) ? { same: true, value: first } : { same: false };
}

const COLOR_KEY = 'system.fallback_symbol_color';

export function MultiRoomPanel({ selection, map, sceneRef }: MultiRoomPanelProps) {
  const { t } = useTranslation('panels');
  const ids = selection.ids;

  const rooms = ids.map((id) => map.rooms[id]).filter((r): r is NonNullable<typeof r> => r != null);

  const commonName = unanimous(rooms.map((r) => r.name ?? ''));
  const commonSymbol = unanimous(rooms.map((r) => r.symbol ?? ''));
  const commonColor = unanimous(rooms.map((r) => r.userData?.[COLOR_KEY] ?? null));
  const commonEnv = unanimous(rooms.map((r) => r.environment));
  const commonLock = unanimous(rooms.map((r) => r.isLocked ?? false));
  const commonWeight = unanimous(rooms.map((r) => r.weight ?? 1));

  const [nameEnabled, setNameEnabled] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => (commonName.same ? commonName.value : ''));

  const [symbolEnabled, setSymbolEnabled] = useState(false);
  const [symbolDraft, setSymbolDraft] = useState(() => (commonSymbol.same ? commonSymbol.value : ''));

  const [symbolColorEnabled, setSymbolColorEnabled] = useState(false);
  const [symbolColorDraft, setSymbolColorDraft] = useState<string | null>(() =>
    commonColor.same && commonColor.value !== null ? commonColor.value : '#ffffff',
  );

  const [envEnabled, setEnvEnabled] = useState(false);
  const [envDraft, setEnvDraft] = useState<number>(() => (commonEnv.same ? commonEnv.value : -1));
  const [envPickerOpen, setEnvPickerOpen] = useState(false);

  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockDraft, setLockDraft] = useState(() => (commonLock.same ? commonLock.value : false));

  const [weightEnabled, setWeightEnabled] = useState(false);
  const [weightDraft, setWeightDraft] = useState(() => String(commonWeight.same ? commonWeight.value : 1));

  const anyEnabled = nameEnabled || symbolEnabled || symbolColorEnabled || envEnabled || lockEnabled || weightEnabled;

  const handleApply = () => {
    const cmds: Command[] = [];
    for (const id of ids) {
      const room = map.rooms[id];
      if (!room) continue;

      if (nameEnabled && nameDraft !== room.name) {
        cmds.push({ kind: 'setRoomField', id, field: 'name', from: room.name, to: nameDraft });
      }
      if (symbolEnabled && symbolDraft !== room.symbol) {
        cmds.push({ kind: 'setRoomField', id, field: 'symbol', from: room.symbol, to: symbolDraft });
      }
      if (symbolColorEnabled) {
        const from = room.userData?.[COLOR_KEY] ?? null;
        const to = symbolColorDraft;
        if (from !== to) {
          cmds.push({ kind: 'setUserDataEntry', roomId: id, key: COLOR_KEY, from, to });
        }
      }
      if (envEnabled && envDraft !== room.environment) {
        cmds.push({ kind: 'setRoomField', id, field: 'environment', from: room.environment, to: envDraft });
      }
      if (lockEnabled && lockDraft !== room.isLocked) {
        cmds.push({ kind: 'setRoomLock', id, lock: lockDraft });
      }
      if (weightEnabled) {
        const w = Math.max(1, parseInt(weightDraft, 10) || 1);
        if (w !== (room.weight ?? 1)) {
          cmds.push({ kind: 'setRoomField', id, field: 'weight', from: room.weight ?? 1, to: w });
        }
      }
    }

    if (cmds.length === 0) return;
    pushCommand({ kind: 'batch', cmds }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: t('multiRoom.applied', { count: ids.length }) });
  };

  const envColor = sceneRef.current?.reader.getColorValue(envDraft) ?? 'rgb(114,1,0)';

  return (
    <div className="panel-content">
      <h3>{t('multiRoom.heading', { count: ids.length })}</h3>
      <p className="hint">{t('multiRoom.hint')}</p>

      <div className="multi-room-list">
        {ids.map((id) => {
          const room = map.rooms[id];
          return <RoomLink key={id} id={id} name={room?.name} />;
        })}
      </div>

      <h4>{t('multiRoom.bulkEdit')}</h4>

      <div className="multi-room-fields">
        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={nameEnabled}
            onChange={(e) => setNameEnabled(e.target.checked)}
            title={t('multiRoom.enableName')}
          />
          <span className="multi-field-label">
            {t('multiRoom.name')}
            {!commonName.same && <span className="multi-field-mixed" title={t('multiRoom.differentValues')}>~</span>}
          </span>
          <input
            className="multi-field-input"
            disabled={!nameEnabled}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder={commonName.same ? '' : t('multiRoom.mixed')}
          />
        </div>

        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={symbolEnabled}
            onChange={(e) => setSymbolEnabled(e.target.checked)}
            title={t('multiRoom.enableSymbol')}
          />
          <span className="multi-field-label">
            {t('multiRoom.symbol')}
            {!commonSymbol.same && <span className="multi-field-mixed" title={t('multiRoom.differentValues')}>~</span>}
          </span>
          <input
            className="multi-field-input multi-field-symbol"
            disabled={!symbolEnabled}
            value={symbolDraft}
            maxLength={4}
            onChange={(e) => setSymbolDraft(e.target.value)}
            placeholder={commonSymbol.same ? '' : t('multiRoom.mixed')}
          />
        </div>

        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={symbolColorEnabled}
            onChange={(e) => setSymbolColorEnabled(e.target.checked)}
            title={t('multiRoom.enableSymbolColor')}
          />
          <span className="multi-field-label">
            {t('multiRoom.symbolColor')}
            {!commonColor.same && <span className="multi-field-mixed" title={t('multiRoom.differentValues')}>~</span>}
          </span>
          <input
            type="color"
            className="symbol-color-input"
            disabled={!symbolColorEnabled || symbolColorDraft === null}
            value={symbolColorDraft ?? '#ffffff'}
            onChange={(e) => setSymbolColorDraft(e.target.value)}
          />
          <button
            type="button"
            className="symbol-color-clear"
            disabled={!symbolColorEnabled}
            title={symbolColorDraft === null ? t('multiRoom.restoreSymbolColor') : t('multiRoom.clearSymbolColor')}
            onClick={() => setSymbolColorDraft((v) => (v === null ? '#ffffff' : null))}
          >
            {symbolColorDraft === null ? '+' : '×'}
          </button>
        </div>

        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={envEnabled}
            onChange={(e) => setEnvEnabled(e.target.checked)}
            title={t('multiRoom.enableEnv')}
          />
          <span className="multi-field-label">
            {t('multiRoom.env')}
            {!commonEnv.same && <span className="multi-field-mixed" title={t('multiRoom.differentValues')}>~</span>}
          </span>
          <div className="env-field-row" style={{ position: 'relative' }}>
            <button
              type="button"
              className="env-pick-btn"
              style={{ background: envEnabled ? envColor : 'rgba(80,80,90,0.5)' }}
              disabled={!envEnabled}
              onClick={() => setEnvPickerOpen((v) => !v)}
              title={envEnabled ? t('multiRoom.envPickerChange', { id: envDraft }) : t('multiRoom.enableToSet')}
            />
            <span className="env-id-label">#{envDraft}</span>
            {envPickerOpen && envEnabled && (
              <EnvPicker
                map={map}
                sceneRef={sceneRef}
                currentEnvId={envDraft}
                onSelect={(id) => setEnvDraft(id)}
                onClose={() => setEnvPickerOpen(false)}
              />
            )}
          </div>
        </div>

        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={weightEnabled}
            onChange={(e) => setWeightEnabled(e.target.checked)}
            title={t('multiRoom.enableWeight')}
          />
          <span className="multi-field-label">
            {t('multiRoom.weight')}
            {!commonWeight.same && <span className="multi-field-mixed" title={t('multiRoom.differentValues')}>~</span>}
          </span>
          <input
            type="number"
            className="multi-field-input multi-field-weight"
            disabled={!weightEnabled}
            min={1}
            value={weightDraft}
            onChange={(e) => setWeightDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder={commonWeight.same ? '' : t('multiRoom.mixed')}
          />
        </div>

        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={lockEnabled}
            onChange={(e) => setLockEnabled(e.target.checked)}
            title={t('multiRoom.enableLock')}
          />
          <span className="multi-field-label">
            {t('multiRoom.lock')}
            {!commonLock.same && <span className="multi-field-mixed" title={t('multiRoom.differentValues')}>~</span>}
          </span>
          <button
            type="button"
            className={`multi-lock-btn${lockDraft ? ' lock-active' : ''}`}
            disabled={!lockEnabled}
            title={lockDraft ? t('multiRoom.locked') : t('multiRoom.unlocked')}
            onClick={() => setLockDraft((v) => !v)}
          >
            <LockIcon locked={lockDraft} />
          </button>
        </div>
      </div>

      <div className="multi-room-actions">
        <button
          type="button"
          className="multi-room-apply-btn"
          disabled={!anyEnabled}
          onClick={handleApply}
        >
          {t('multiRoom.applyTo', { count: ids.length })}
        </button>
        {anyEnabled && (
          <p className="multi-room-warning">
            {t('multiRoom.warning', { count: ids.length })}
          </p>
        )}
      </div>
    </div>
  );
}
