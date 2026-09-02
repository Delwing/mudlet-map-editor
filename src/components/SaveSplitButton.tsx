import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MapFormat } from '../editor/formats';

/**
 * Split "Save" button: the main button saves in the active format directly; the
 * caret (shown only when more than one format is registered) opens a dropdown to
 * save as any other format. Picking a format from the list makes it the new
 * active format, so subsequent main-button saves default to it.
 *
 * The main button mirrors the built-in save {@link ToolbarAction} (icon, title,
 * dirty badge, disabled, style, onClick) so plugin overrides of the save action
 * still drive it.
 */
export function SaveSplitButton({
  icon,
  title,
  badge,
  style,
  disabled,
  menuTitle,
  onSave,
  formats,
  activeFormatId,
  onPick,
}: {
  icon?: ReactNode;
  title?: string;
  badge?: ReactNode;
  style?: CSSProperties;
  disabled?: boolean;
  /** Tooltip for the caret. Supplied by Toolbar (i18n, or a plugin override). */
  menuTitle?: string;
  onSave?: () => void;
  formats: MapFormat[];
  activeFormatId: string;
  onPick: (format: MapFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const [listStyle, setListStyle] = useState<CSSProperties>({});
  const caretRef = useRef<HTMLButtonElement>(null);
  const showCaret = formats.length > 1;

  const openList = () => {
    const rect = caretRef.current?.getBoundingClientRect();
    if (rect) {
      // Anchor the list's right edge to the caret so it doesn't overflow the viewport.
      setListStyle({ position: 'fixed', top: rect.bottom + 6, right: window.innerWidth - rect.right, minWidth: 200 });
    }
    setOpen(true);
  };

  // Portal into the editor's scoped root so the prefixed `.mudlet-editor-root …`
  // CSS matches (document.body is outside the scope → unstyled popup).
  const portalTarget =
    (caretRef.current?.closest('.mudlet-editor-root') as HTMLElement | null) ?? document.body;

  return (
    <span style={{ display: 'inline-flex' }}>
      <button
        type="button"
        title={title}
        onClick={onSave}
        disabled={disabled}
        style={showCaret
          ? { ...style, borderTopRightRadius: 0, borderBottomRightRadius: 0 }
          : style}
      >
        {icon}
        {badge}
      </button>

      {showCaret && (
        <button
          ref={caretRef}
          type="button"
          title={menuTitle}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          style={{
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            borderLeft: '1px solid rgba(143, 184, 255, 0.18)',
            padding: '6px 6px',
          }}
        >
          <span style={{ fontSize: 10, lineHeight: 1 }}>{open ? '▴' : '▾'}</span>
        </button>
      )}

      {open && createPortal(
        <>
          <div className="dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="dropdown-list" style={listStyle}>
            <div className="dropdown-options">
              {formats.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  className={`dropdown-option${format.id === activeFormatId ? ' selected' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                  onClick={() => { setOpen(false); onPick(format); }}
                >
                  <span>{format.label}</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>
                    {format.extensions[0] ?? ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>,
        portalTarget,
      )}
    </span>
  );
}
