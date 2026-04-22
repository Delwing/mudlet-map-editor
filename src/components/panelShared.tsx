import { useState } from 'react';
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
      #{id}{name ? ` · ${name}` : ''}
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
  const hints: Record<string, string> = {
    select: 'Click a room to select. Drag to move. Arrow keys nudge.',
    connect: 'Click source, then target. Shift for one-way.',
    unlink: 'Click an exit line to remove.',
    addRoom: 'Click an empty grid cell to create a room.',
    delete: 'Click a room to delete it.',
    pan: 'Drag to pan. Hold Space with any tool for temporary pan.',
    customLine: 'Click to add waypoints. Right-click or Enter to finish.',
    label: 'Click a label to select and edit its properties.',
  };
  return <p className="hint-tool">{hints[activeTool] ?? ''}</p>;
}

interface UserDataEditorProps {
  data: Record<string, string> | undefined;
  onCommit: (key: string, from: string | null, to: string | null) => void;
}

export function UserDataEditor({ data, onCommit }: UserDataEditorProps) {
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
          <button type="button" className="ud-delete" title="Remove entry" onClick={() => onCommit(key, val, null)}>×</button>
        </div>
      ))}
      {entries.length === 0 && <div className="userdata-empty">— no user data —</div>}
      <div className="userdata-add">
        <input
          className="ud-new-key"
          placeholder="key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newVal !== undefined && addEntry()}
        />
        <input
          className="ud-new-val"
          placeholder="value"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addEntry()}
        />
        <button type="button" className="ud-add" title="Add entry" onClick={addEntry} disabled={!newKey.trim()}>+</button>
      </div>
    </div>
  );
}

export function mudletColorToHex(c: MudletColor): string {
  return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function hexToMudletColor(hex: string): MudletColor {
  return { spec: 1, alpha: 255, r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), pad: 0 };
}
