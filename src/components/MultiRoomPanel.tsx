import { useState } from 'react';
import { store } from '../editor/store';
import { pushCommand } from '../editor/commands';
import type { Command } from '../editor/types';
import type { SceneHandle } from '../editor/scene';
import type { MudletMap } from '../mapIO';
import { EnvPicker } from './EnvPicker';
import { LockIcon } from './icons';

interface MultiRoomPanelProps {
  selection: { kind: 'room'; ids: number[] };
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
}

/** Returns { same: true, value } if all elements are strictly equal, { same: false } otherwise. */
function unanimous<T>(arr: T[]): { same: true; value: T } | { same: false } {
  if (arr.length === 0) return { same: false };
  const first = arr[0];
  return arr.every((v) => v === first) ? { same: true, value: first } : { same: false };
}

const COLOR_KEY = 'system.fallback_symbol_color';

export function MultiRoomPanel({ selection, map, sceneRef }: MultiRoomPanelProps) {
  const ids = selection.ids;

  // Compute common values once at mount for pre-filling.
  const rooms = ids.map((id) => map.rooms[id]).filter((r): r is NonNullable<typeof r> => r != null);

  const commonName = unanimous(rooms.map((r) => r.name ?? ''));
  const commonSymbol = unanimous(rooms.map((r) => r.symbol ?? ''));
  const commonColor = unanimous(rooms.map((r) => r.userData?.[COLOR_KEY] ?? null));
  const commonEnv = unanimous(rooms.map((r) => r.environment));
  const commonLock = unanimous(rooms.map((r) => r.isLocked ?? false));

  const [nameEnabled, setNameEnabled] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => (commonName.same ? commonName.value : ''));

  const [symbolEnabled, setSymbolEnabled] = useState(false);
  const [symbolDraft, setSymbolDraft] = useState(() => (commonSymbol.same ? commonSymbol.value : ''));

  // null = "clear the color" mode
  const [symbolColorEnabled, setSymbolColorEnabled] = useState(false);
  // Only pre-fill when all rooms share a real color; null unanimous means "all have no color" —
  // still start in set-color mode so the picker is clickable.
  const [symbolColorDraft, setSymbolColorDraft] = useState<string | null>(() =>
    commonColor.same && commonColor.value !== null ? commonColor.value : '#ffffff',
  );

  const [envEnabled, setEnvEnabled] = useState(false);
  const [envDraft, setEnvDraft] = useState<number>(() => (commonEnv.same ? commonEnv.value : -1));
  const [envPickerOpen, setEnvPickerOpen] = useState(false);

  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockDraft, setLockDraft] = useState(() => (commonLock.same ? commonLock.value : false));

  const anyEnabled = nameEnabled || symbolEnabled || symbolColorEnabled || envEnabled || lockEnabled;

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
    }

    if (cmds.length === 0) return;
    pushCommand({ kind: 'batch', cmds }, sceneRef.current);
    sceneRef.current?.refresh();
    store.bumpData();
    store.setState({ status: `Applied bulk edit to ${ids.length} rooms` });
  };

  const envColor = sceneRef.current?.reader.getColorValue(envDraft) ?? 'rgb(114,1,0)';

  return (
    <div className="panel-content">
      <h3>{ids.length} rooms selected</h3>
      <p className="hint">Drag to move all. Delete to remove all. Shift+click/drag to add more. Ctrl+click/drag to toggle. Ctrl+A selects all.</p>

      <h4>Bulk Edit</h4>

      <div className="multi-room-fields">
        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={nameEnabled}
            onChange={(e) => setNameEnabled(e.target.checked)}
            title="Enable name override"
          />
          <span className="multi-field-label">
            Name
            {!commonName.same && <span className="multi-field-mixed" title="Rooms have different values">~</span>}
          </span>
          <input
            className="multi-field-input"
            disabled={!nameEnabled}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder={commonName.same ? '' : 'mixed'}
          />
        </div>

        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={symbolEnabled}
            onChange={(e) => setSymbolEnabled(e.target.checked)}
            title="Enable symbol override"
          />
          <span className="multi-field-label">
            Symbol
            {!commonSymbol.same && <span className="multi-field-mixed" title="Rooms have different values">~</span>}
          </span>
          <input
            className="multi-field-input multi-field-symbol"
            disabled={!symbolEnabled}
            value={symbolDraft}
            maxLength={4}
            onChange={(e) => setSymbolDraft(e.target.value)}
            placeholder={commonSymbol.same ? '' : 'mixed'}
          />
        </div>

        <div className="multi-field-row">
          <input
            type="checkbox"
            className="multi-field-check"
            checked={symbolColorEnabled}
            onChange={(e) => setSymbolColorEnabled(e.target.checked)}
            title="Enable symbol color override"
          />
          <span className="multi-field-label">
            Symbol color
            {!commonColor.same && <span className="multi-field-mixed" title="Rooms have different values">~</span>}
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
            title={symbolColorDraft === null ? 'Restore: set a color instead of clearing' : 'Clear: remove symbol color from all rooms'}
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
            title="Enable environment override"
          />
          <span className="multi-field-label">
            Env
            {!commonEnv.same && <span className="multi-field-mixed" title="Rooms have different values">~</span>}
          </span>
          <div className="env-field-row" style={{ position: 'relative' }}>
            <button
              type="button"
              className="env-pick-btn"
              style={{ background: envEnabled ? envColor : 'rgba(80,80,90,0.5)' }}
              disabled={!envEnabled}
              onClick={() => setEnvPickerOpen((v) => !v)}
              title={envEnabled ? `Env ${envDraft} — click to change` : 'Enable to set'}
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
            checked={lockEnabled}
            onChange={(e) => setLockEnabled(e.target.checked)}
            title="Enable lock override"
          />
          <span className="multi-field-label">
            Lock
            {!commonLock.same && <span className="multi-field-mixed" title="Rooms have different values">~</span>}
          </span>
          <button
            type="button"
            className={`multi-lock-btn${lockDraft ? ' lock-active' : ''}`}
            disabled={!lockEnabled}
            title={lockDraft ? 'Locked — click to set unlocked' : 'Unlocked — click to set locked'}
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
          Apply to {ids.length} rooms
        </button>
        {anyEnabled && (
          <p className="multi-room-warning">
            This will overwrite the checked properties on all {ids.length} selected rooms.
          </p>
        )}
      </div>
    </div>
  );
}
