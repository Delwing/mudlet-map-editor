import { useTranslation } from 'react-i18next';
import { useEditorState } from '../editor/store';

/**
 * Shown while the renderer is drawing the current plane below full detail
 * (`mudlet-map-renderer`'s LOD tiers, see scene.ts). Without it the degraded
 * tiers are silent: `roomsOnly` looks like a map that lost its exits, and
 * `raster` looks like a map that stopped responding to clicks. Both are
 * zoom-based, so the fix is always "zoom in".
 */
export function LodBadge() {
  const { t } = useTranslation('editor');
  const lod = useEditorState((s) => s.lod);
  if (!lod || lod.mode === 'vector') return null;

  return (
    <div className={`lod-badge lod-badge-${lod.mode}`} title={t('lod.title', { count: lod.planeRoomCount })}>
      <span className="lod-badge-mode">{t(`lod.mode_${lod.mode}`)}</span>
      <span className="lod-badge-hint">
        {lod.hitTestActive ? t('lod.hintExits') : t('lod.hintZoomIn')}
      </span>
    </div>
  );
}
