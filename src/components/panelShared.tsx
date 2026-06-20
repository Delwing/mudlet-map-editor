import { useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../editor/store';
import type { MudletColor } from '../mapIO';

export function RoomLink({ id, name, className }: { id: number; name?: string | null; className?: string }) {
  return (
    <button
      type="button"
      className={className ?? 'exit-target'}
      onClick={() => {
        const s = store.getState();
        const room = s.map?.rooms[id];
        if (!room) { store.setState({ selection: { kind: 'room', ids: [id] } }); return; }
        const areaChanged = room.area !== s.currentAreaId;
        const zChanged = room.z !== s.currentZ;
        if (areaChanged || zChanged) {
          store.setState({
            selection: { kind: 'room', ids: [id] },
            currentAreaId: room.area,
            currentZ: room.z,
            navigateTo: { mapX: room.x, mapY: -room.y },
          });
          store.bumpStructure();
        } else {
          store.setState({
            selection: { kind: 'room', ids: [id] },
            panRequest: { mapX: room.x, mapY: -room.y },
          });
        }
      }}
      onMouseEnter={() => store.setState({ hover: { kind: 'room', id, handleDir: null } })}
      onMouseLeave={() => store.setState({ hover: null })}
    >
      #{id}{name && String(id) !== name ? ` · ${name}` : ''}
    </button>
  );
}

export function Field({ label, children, as: Tag = 'label' }: { label: string; children: React.ReactNode; as?: 'label' | 'div' }) {
  return (
    <Tag className="field">
      <span className="label">{label}</span>
      {children}
    </Tag>
  );
}

export function CheckboxField({ checked, onChange, description }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  description: string;
}) {
  return (
    <label className="field checkbox-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{description}</span>
    </label>
  );
}

export function ToolHint({ activeTool }: { activeTool: string }) {
  const { t } = useTranslation('panels');
  const hints: Record<string, string> = {
    select: t('shared.toolHints.select'),
    connect: t('shared.toolHints.connect'),
    unlink: t('shared.toolHints.unlink'),
    addRoom: t('shared.toolHints.addRoom'),
    delete: t('shared.toolHints.delete'),
    pan: t('shared.toolHints.pan'),
    customLine: t('shared.toolHints.customLine'),
    label: t('shared.toolHints.label'),
  };
  return <p className="hint-tool">{hints[activeTool] ?? ''}</p>;
}

interface UserDataEditorProps {
  data: Record<string, string> | undefined;
  onCommit: (key: string, from: string | null, to: string | null) => void;
}

export function UserDataEditor({ data, onCommit }: UserDataEditorProps) {
  const { t } = useTranslation('panels');
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const addEntry = () => {
    const k = newKey.trim();
    if (!k) return;
    onCommit(k, null, newVal);
    setNewKey('');
    setNewVal('');
  };

  const entries = Object.entries(data ?? {});

  return (
    <div className="userdata-list">
      {entries.map(([key, val]) => (
        <div key={key} className="userdata-row">
          <span className="ud-key" title={key}>{key}</span>
          <input
            key={`ud-val-${key}-${val}`}
            className="ud-value"
            defaultValue={val}
            onBlur={(e) => { if (e.target.value !== val) onCommit(key, val, e.target.value); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <button type="button" className="ud-delete" title={t('shared.removeEntry')} onClick={() => onCommit(key, val, null)}>×</button>
        </div>
      ))}
      {entries.length === 0 && <div className="userdata-empty">{t('shared.noUserData')}</div>}
      <div className="userdata-add">
        <input
          className="ud-new-key"
          placeholder={t('shared.keyPlaceholder')}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newVal !== undefined && addEntry()}
        />
        <input
          className="ud-new-val"
          placeholder={t('shared.valuePlaceholder')}
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addEntry()}
        />
        <button type="button" className="ud-add" title={t('shared.addEntry')} onClick={addEntry} disabled={!newKey.trim()}>+</button>
      </div>
    </div>
  );
}

interface ColorSwatchProps {
  /** CSS colour painted across the swatch button (matches the Room Color picker). */
  color: string;
  /** When true, no colour is set: show a "none" indicator instead of painting {@link color}. */
  empty?: boolean;
  disabled?: boolean;
  title?: string;
  /** Fired on pointer-down on the swatch — e.g. to start an undo/coalescing session. */
  onActivate?: () => void;
  /** Remount key for the hidden native input (resets an uncontrolled value). */
  inputKey?: string;
  /** Props forwarded to the hidden native <input type="color"> (value/onChange/onBlur…). */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

/**
 * A color picker that looks exactly like the Room Color swatch (`.env-pick-btn`):
 * a solid-filled button. The real `<input type="color">` is kept behind it (hidden
 * but functional) and opened by forwarding the button's click, so every picker in
 * the app renders identically regardless of how the browser draws a native swatch.
 * All the original input handlers still fire on the hidden input; session-style
 * pickers (which started on the input's `mousedown`) use {@link onActivate} instead.
 */
export function ColorSwatch({ color, empty, disabled, title, onActivate, inputKey, inputProps }: ColorSwatchProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="color-swatch">
      <button
        type="button"
        className={`env-pick-btn color-swatch-btn${empty ? ' is-empty' : ''}`}
        style={empty ? undefined : { background: color }}
        disabled={disabled}
        title={title}
        onPointerDown={disabled ? undefined : onActivate}
        onClick={() => {
          // Focus first so the native picker's later blur fires (blur-based commits).
          ref.current?.focus({ preventScroll: true });
          ref.current?.click();
        }}
      />
      <input
        {...inputProps}
        key={inputKey}
        ref={ref}
        type="color"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="color-swatch-native"
      />
    </span>
  );
}

export function mudletColorToHex(c: MudletColor): string {
  return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function hexToMudletColor(hex: string): MudletColor {
  return { spec: 1, alpha: 255, r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), pad: 0 };
}
