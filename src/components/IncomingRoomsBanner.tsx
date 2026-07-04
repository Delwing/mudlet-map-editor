import { useTranslation } from 'react-i18next';
import { store, useEditorState } from '../editor/store';

/** Banner shown when another tab sends rooms over. "Place" arms a placement
 *  gesture: a ghost preview follows the cursor (PlacePreviewEffect) and a click
 *  commits the paste there — Esc or right-click cancels back to this banner. */
export function IncomingRoomsBanner() {
  const { t } = useTranslation('editor');
  const incoming = useEditorState((s) => s.incomingRooms);
  const placing = useEditorState((s) => s.pending?.kind === 'placeRooms');
  const canPlace = useEditorState((s) => s.map != null && s.currentAreaId != null);
  if (!incoming || placing) return null;

  const dismiss = () => store.setState({ incomingRooms: null });

  const place = () => {
    const s = store.getState();
    if (!s.map || !s.incomingRooms || s.currentAreaId == null) return;
    store.setState({
      pending: { kind: 'placeRooms', clipboard: s.incomingRooms.clipboard },
      contextMenu: null,
      status: t('incoming.placeHint'),
    });
  };

  return (
    <div className="incoming-banner">
      <span className="incoming-banner-text">
        {t('incoming.title', { count: incoming.clipboard.rooms.length, name: incoming.fromFileName })}
      </span>
      <button
        type="button"
        className="context-menu-btn primary"
        onClick={place}
        disabled={!canPlace}
        title={canPlace ? t('incoming.placeTitle') : t('incoming.noMap')}
      >
        {t('incoming.place')}
      </button>
      <button type="button" className="context-menu-btn" onClick={dismiss}>
        {t('incoming.dismiss')}
      </button>
    </div>
  );
}
