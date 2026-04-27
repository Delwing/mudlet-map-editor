import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface SavedScript { code: string; savedAt: number }
type ScriptLibrary = Record<string, SavedScript>;

interface Props {
  library: ScriptLibrary;
  currentName: string | null;
  onLoad(name: string): void;
  onDelete(name: string): void;
  onClose(): void;
}

export function ScriptLibraryModal({ library, currentName, onLoad, onDelete, onClose }: Props) {
  const { t } = useTranslation('panels');
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

  function relativeTime(ms: number): string {
    const diff = Date.now() - ms;
    const minute = 60_000;
    const hour = 3_600_000;
    const day = 86_400_000;
    if (diff < 30_000) return t('script.libraryTimeJustNow');
    if (diff < hour) return t('script.libraryTimeMinutes', { count: Math.floor(diff / minute) });
    if (diff < day) return t('script.libraryTimeHours', { count: Math.floor(diff / hour) });
    if (diff < 7 * day) return t('script.libraryTimeDays', { count: Math.floor(diff / day) });
    return new Date(ms).toLocaleDateString();
  }

  const names = Object.keys(library).sort((a, b) => a.localeCompare(b));

  return (
    <div ref={ref} className="script-library-popover" role="dialog" aria-label={t('script.libraryPanelTitle')}>
      <div className="script-library-popover-header">
        <span className="script-library-popover-title">{t('script.libraryPanelTitle')}</span>
        <button type="button" className="script-library-popover-close" onClick={onClose} title={t('script.libraryCloseTitle')}>✕</button>
      </div>
      <div className="script-library-popover-body">
        {names.length === 0 ? (
          <p className="hint" style={{ textAlign: 'center', padding: '20px 10px' }}>
            {t('script.libraryEmpty')}
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
                      {t('script.librarySavedAgo', { time: relativeTime(entry.savedAt) })}
                      {isCurrent && <span className="script-library-item-badge">{t('script.libraryLoadedBadge')}</span>}
                    </div>
                  </div>
                  <div className="script-library-item-actions">
                    <button
                      type="button"
                      onClick={() => { onLoad(name); onClose(); }}
                      disabled={isCurrent}
                      title={isCurrent ? t('script.libraryAlreadyLoaded') : t('script.libraryLoadTitle')}
                    >{t('script.libraryLoadBtn')}</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('script.libraryDeleteConfirm', { name }))) onDelete(name);
                      }}
                      title={t('script.libraryDeleteTitle', { name })}
                    >{t('script.libraryDeleteBtn')}</button>
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
