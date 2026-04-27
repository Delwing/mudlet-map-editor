import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../editor/store';
import { listSessions, clearSession, clearAllSessions, restoreMapFromSession, type SessionData } from '../editor/session';

const AUTODELETE_KEY = 'mudlet-session-autodelete';

interface AutoDeleteSettings {
  enabled: boolean;
  days: number;
}

function loadAutoDeleteSettings(): AutoDeleteSettings {
  try {
    const raw = localStorage.getItem(AUTODELETE_KEY);
    if (raw) return JSON.parse(raw) as AutoDeleteSettings;
  } catch {}
  return { enabled: false, days: 30 };
}

function saveAutoDeleteSettings(s: AutoDeleteSettings) {
  localStorage.setItem(AUTODELETE_KEY, JSON.stringify(s));
}

function applyAutoDelete(sessions: SessionData[], days: number): SessionData[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const survivors: SessionData[] = [];
  for (const s of sessions) {
    if (s.savedAt < cutoff) {
      clearSession(s.id).catch(console.error);
    } else {
      survivors.push(s);
    }
  }
  return survivors;
}

export function SessionsPanel() {
  const { t } = useTranslation('sessions');
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [autoDelete, setAutoDelete] = useState<AutoDeleteSettings>(loadAutoDeleteSettings);

  useEffect(() => {
    const settings = loadAutoDeleteSettings();
    listSessions()
      .then((all) => {
        const visible = settings.enabled ? applyAutoDelete(all, settings.days) : all;
        setSessions(visible);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleLoad = (session: SessionData) => {
    const map = restoreMapFromSession(session);
    store.setState({
      map,
      loaded: { fileName: session.fileName },
      currentAreaId: session.currentAreaId,
      currentZ: session.currentZ,
      undo: session.undoStack,
      redo: [],
      savedUndoLength: 0,
      selection: null,
      hover: null,
      pending: null,
      status: t('restored', { rooms: session.roomCount, areas: Object.keys(map.areaNames).length }),
      sessionId: session.id,
    });
    store.bumpStructure();
  };

  const handleDelete = (session: SessionData) => {
    clearSession(session.id).catch(console.error);
    setSessions((prev) => prev.filter((s) => s.id !== session.id));
  };

  const handleDeleteAll = () => {
    clearAllSessions().catch(console.error);
    setSessions([]);
  };

  const handleAutoDeleteToggle = (enabled: boolean) => {
    const next = { ...autoDelete, enabled };
    setAutoDelete(next);
    saveAutoDeleteSettings(next);
    if (enabled) {
      setSessions((prev) => applyAutoDelete(prev, next.days));
    }
  };

  const handleAutoDeleteDays = (days: number) => {
    const next = { ...autoDelete, days };
    setAutoDelete(next);
    saveAutoDeleteSettings(next);
    if (next.enabled) {
      setSessions((prev) => applyAutoDelete(prev, days));
    }
  };

  if (!loaded) return <div className="empty-state">{t('loading')}</div>;
  if (sessions.length === 0) return <div className="empty-state">{t('noMap')}<br />{t('noMapHint')}<img src="logo.png" alt="logo" className="empty-state-logo" /></div>;

  return (
    <div className="sessions-panel-overlay">
      <div className="sessions-panel">
        <div className="sessions-panel-header">
          <span>{t('savedSessions')}</span>
          <button type="button" className="session-delete sessions-delete-all" onClick={handleDeleteAll}>{t('deleteAll')}</button>
        </div>
        <div className="sessions-list">
            {sessions.map((s) => (
              <div key={s.id} className="session-item">
                <div className="session-info">
                  <span className="session-filename">{s.fileName}</span>
                  <span className="session-meta">
                    {s.roomCount} rooms · {new Date(s.savedAt).toLocaleString()}
                  </span>
                </div>
                <div className="session-actions">
                  <button type="button" onClick={() => handleLoad(s)}>{t('load')}</button>
                  <button type="button" className="session-delete" onClick={() => handleDelete(s)}>{t('delete')}</button>
                </div>
              </div>
            ))}
        </div>
        <div className="sessions-autodelete">
          <label className="sessions-autodelete-label">
            <input
              type="checkbox"
              checked={autoDelete.enabled}
              onChange={(e) => handleAutoDeleteToggle(e.target.checked)}
            />
            {t('autoDelete')}
          </label>
          <input
            type="number"
            className="sessions-autodelete-days"
            min={1}
            max={365}
            value={autoDelete.days}
            disabled={!autoDelete.enabled}
            onChange={(e) => {
              const v = Math.max(1, Math.min(365, Number(e.target.value) || 1));
              handleAutoDeleteDays(v);
            }}
          />
          <span className="sessions-autodelete-unit">{t('days')}</span>
        </div>
      </div>
    </div>
  );
}
