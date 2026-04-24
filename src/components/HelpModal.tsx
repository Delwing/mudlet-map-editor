import type { ToolId } from '../editor/types';
import { modKey } from '../platform';

export const TOOL_BUTTONS: { id: ToolId; label: string; hint: string; key: string }[] = [
  { id: 'select',     label: 'Select',      hint: 'Click to select · Shift+click/drag to add · Ctrl+click/drag to toggle · drag to move (snaps to grid) · arrow keys nudge · MMB or Space to pan.', key: '1' },
  { id: 'connect',    label: 'Connect',     hint: 'Click source, then target. Shift = one-way.',                              key: '2' },
  { id: 'unlink',     label: 'Unlink',      hint: 'Click a room to remove all its exits. Click an exit/custom line to remove just that one.', key: '3' },
  { id: 'addRoom',    label: 'Add Room',    hint: `Click empty cell to create a room. ${modKey}+click to place without selecting.`, key: '4' },
  { id: 'addLabel',   label: 'Add Label',   hint: 'Click to place a text label. Select to move/edit, Delete to remove.',     key: '5' },
  { id: 'delete',     label: 'Delete',      hint: 'Click a room to delete it, or an exit/custom line/label to remove it.',   key: '6' },
  { id: 'pan',        label: 'Pan',         hint: 'Drag background to pan. Hold Space with any tool for temporary pan.',      key: '7' },
  { id: 'paint',      label: 'Paint',       hint: 'Click or drag rooms to apply the active room swatch (symbol + environment). Select a swatch in the Swatches palette first.', key: '8' },
];

const SHORTCUTS = [
  { keys: ['1–7'], desc: 'Switch tool' },
  { keys: ['Space'], desc: 'Hold to pan temporarily (any tool)' },
  { keys: ['G'], desc: 'Toggle snap to grid' },
  { keys: ['F'], desc: 'Fit area to view' },
  { keys: [`${modKey}+F`], desc: 'Open / close search (rooms, labels)' },
  { keys: [`${modKey}+A`], desc: 'Select all rooms on current level' },
  { keys: [`${modKey}+C`], desc: 'Copy selected rooms' },
  { keys: [`${modKey}+V`], desc: 'Paste rooms at cursor (external exits become stubs)' },
  { keys: [`${modKey}+D`], desc: 'Duplicate selected rooms with offset' },
  { keys: ['Delete'], desc: 'Delete selection' },
  { keys: ['Arrow keys'], desc: 'Nudge selected room (Shift = ×5)' },
  { keys: [`${modKey}+Z`], desc: 'Undo' },
  { keys: [`${modKey}+Shift+Z`], desc: 'Redo' },
  { keys: ['Enter'], desc: 'Finish custom line' },
  { keys: ['Esc'], desc: 'Cancel / deselect' },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mudlet Map Editor — Help</h2>
          <button className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="modal-body help-modal-body">
          <p className="help-desc">
            Browser-based editor for Mudlet <code>.dat</code> map files. Load a map, navigate areas and z-levels,
            then use the tools below to build or modify rooms, exits, custom lines, and labels.
            Changes are auto-saved to your browser session. Export with Save when ready.
          </p>

          <h3 className="help-section-title">Tools</h3>
          <table className="help-table">
            <tbody>
              {TOOL_BUTTONS.map((t) => (
                <tr key={t.id}>
                  <td><kbd>{t.key}</kbd></td>
                  <td className="help-tool-name">{t.label}</td>
                  <td className="help-tool-hint">{t.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="help-section-title">Keyboard shortcuts</h3>
          <table className="help-table">
            <tbody>
              {SHORTCUTS.map((s, i) => (
                <tr key={i}>
                  <td>{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</td>
                  <td colSpan={2} className="help-tool-hint">{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
