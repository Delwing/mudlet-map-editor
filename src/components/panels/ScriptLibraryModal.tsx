import { useEffect, useRef } from 'react';

interface SavedScript { code: string; savedAt: number }
type ScriptLibrary = Record<string, SavedScript>;

interface Props {
  library: ScriptLibrary;
  currentName: string | null;
  onLoad(name: string): void;
  onDelete(name: string): void;
  onClose(): void;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < 30_000) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function ScriptLibraryModal({ library, currentName, onLoad, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const names = Object.keys(library).sort((a, b) => a.localeCompare(b));

  return (
    <div ref={ref} className="script-library-popover" role="dialog" aria-label="Saved scripts">
      <div className="script-library-popover-header">
        <span className="script-library-popover-title">Saved scripts</span>
        <button type="button" className="script-library-popover-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="script-library-popover-body">
        {names.length === 0 ? (
          <p className="hint" style={{ textAlign: 'center', padding: '20px 10px' }}>
            No saved scripts yet. Type a name above and click Save.
          </p>
        ) : (
          <div className="script-library-list">
            {names.map((name) => {
              const entry = library[name];
              const isCurrent = name === currentName;
              return (
                <div key={name} className={`script-library-item${isCurrent ? ' current' : ''}`}>
                  <div className="script-library-item-main">
                    <div className="script-library-item-name">{name}</div>
                    <div className="script-library-item-meta">
                      Saved {relativeTime(entry.savedAt)}
                      {isCurrent && <span className="script-library-item-badge">loaded</span>}
                    </div>
                  </div>
                  <div className="script-library-item-actions">
                    <button
                      type="button"
                      onClick={() => { onLoad(name); onClose(); }}
                      disabled={isCurrent}
                      title={isCurrent ? 'Already loaded' : 'Load into editor'}
                    >Load</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete saved script "${name}"?`)) onDelete(name);
                      }}
                      title={`Delete "${name}"`}
                    >Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
