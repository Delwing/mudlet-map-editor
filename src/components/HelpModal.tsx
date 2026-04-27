import { useTranslation } from 'react-i18next';
import type { ToolId } from '../editor/types';
import { modKey } from '../platform';

export const TOOL_BUTTON_META: { id: ToolId; key: string }[] = [
  { id: 'select',   key: '1' },
  { id: 'connect',  key: '2' },
  { id: 'unlink',   key: '3' },
  { id: 'addRoom',  key: '4' },
  { id: 'addLabel', key: '5' },
  { id: 'delete',   key: '6' },
  { id: 'pan',      key: '7' },
  { id: 'paint',    key: '8' },
];

/** Static English fallbacks — used by Toolbar before React renders */
export const TOOL_BUTTONS: { id: ToolId; label: string; hint: string; key: string }[] = [
  { id: 'select',   label: 'Select',    hint: 'Click to select · Shift+click/drag to add · Ctrl+click/drag to toggle · drag to move (snaps to grid) · arrow keys nudge · MMB or Space to pan.', key: '1' },
  { id: 'connect',  label: 'Connect',   hint: 'Click source, then target. Shift = one-way.',                              key: '2' },
  { id: 'unlink',   label: 'Unlink',    hint: 'Click a room to remove all its exits. Click an exit/custom line to remove just that one.', key: '3' },
  { id: 'addRoom',  label: 'Add Room',  hint: `Click empty cell to create a room. ${modKey}+click to place without selecting.`, key: '4' },
  { id: 'addLabel', label: 'Add Label', hint: 'Click to place a text label. Select to move/edit, Delete to remove.',     key: '5' },
  { id: 'delete',   label: 'Delete',    hint: 'Click a room to delete it, or an exit/custom line/label to remove it.',   key: '6' },
  { id: 'pan',      label: 'Pan',       hint: 'Drag background to pan. Hold Space with any tool for temporary pan.',      key: '7' },
  { id: 'paint',    label: 'Paint',     hint: 'Click or drag rooms to apply the active room swatch (symbol + environment). Select a swatch in the Swatches palette first.', key: '8' },
];

export function useToolButtons() {
  const { t } = useTranslation('editor');
  return TOOL_BUTTON_META.map(({ id, key }) => ({
    id,
    key,
    label: t(`tools.${id}.label` as any),
    hint:  t(`tools.${id}.hint` as any, { modKey }),
  }));
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('editor');
  const toolButtons = useToolButtons();

  const shortcuts = [
    { keys: ['1–7'],              desc: t('help.shortcuts.switchTool') },
    { keys: ['Space'],            desc: t('help.shortcuts.tempPan') },
    { keys: ['G'],                desc: t('help.shortcuts.snapGrid') },
    { keys: ['F'],                desc: t('help.shortcuts.fitView') },
    { keys: [`${modKey}+F`],      desc: t('help.shortcuts.search') },
    { keys: [`${modKey}+A`],      desc: t('help.shortcuts.selectAll') },
    { keys: [`${modKey}+C`],      desc: t('help.shortcuts.copy') },
    { keys: [`${modKey}+V`],      desc: t('help.shortcuts.paste') },
    { keys: [`${modKey}+D`],      desc: t('help.shortcuts.duplicate') },
    { keys: ['Delete'],           desc: t('help.shortcuts.delete') },
    { keys: ['Arrow keys'],       desc: t('help.shortcuts.nudge') },
    { keys: [`${modKey}+Z`],      desc: t('help.shortcuts.undo') },
    { keys: [`${modKey}+Shift+Z`],desc: t('help.shortcuts.redo') },
    { keys: ['Enter'],            desc: t('help.shortcuts.finishLine') },
    { keys: ['Esc'],              desc: t('help.shortcuts.cancel') },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('help.title')}</h2>
          <button className="modal-close" onClick={onClose} title={t('help.close')}>✕</button>
        </div>
        <div className="modal-body help-modal-body">
          <p className="help-desc">{t('help.description')}</p>

          <h3 className="help-section-title">{t('help.toolsSection')}</h3>
          <table className="help-table">
            <tbody>
              {toolButtons.map((tb) => (
                <tr key={tb.id}>
                  <td><kbd>{tb.key}</kbd></td>
                  <td className="help-tool-name">{tb.label}</td>
                  <td className="help-tool-hint">{tb.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="help-section-title">{t('help.shortcutsSection')}</h3>
          <table className="help-table">
            <tbody>
              {shortcuts.map((s, i) => (
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
