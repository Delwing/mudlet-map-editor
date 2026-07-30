import { useTranslation } from 'react-i18next';
import { useEditorState } from '../editor/store';

/**
 * Shown while a map load is in flight. On a big map (~27k rooms) the load is
 * ~0.5s of parsing followed by ~1s of building the editor model and scene, all
 * synchronous on the main thread — so this exists to say *what* the frozen UI is
 * doing, and that it will finish.
 *
 * The spinner animates `transform` only (and declares `will-change`), which puts
 * it on the compositor: it keeps turning through a blocked main thread, where a
 * JS-driven or layout-driven animation would sit still. The phase label is the
 * dependable part though — each phase is committed and painted *before* its
 * blocking work starts (see `loadFile.ts`), so even if the spinner stalls on some
 * browser, the text still tells you which stage you are waiting on.
 */
export function MapLoadingOverlay() {
  const { t } = useTranslation('editor');
  const loading = useEditorState((s) => s.loading);
  if (!loading) return null;

  const determinate = loading.phase === 'fetching' && loading.pct != null;

  return (
    <div className="map-loading-overlay" role="status" aria-live="polite">
      <div className="map-loading-card">
        <div className="map-loading-spinner" />
        <div className="map-loading-text">
          <div className="map-loading-phase">{t(`loading.${loading.phase}`)}</div>
          <div className="map-loading-file">{loading.fileName}</div>
        </div>
        {determinate ? (
          <div className="map-loading-bar">
            <div className="map-loading-bar-fill" style={{ width: `${loading.pct}%` }} />
          </div>
        ) : (
          <div className="map-loading-hint">{t('loading.hint')}</div>
        )}
      </div>
    </div>
  );
}
