import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runScript, type ScriptResult } from '../../editor/script';
import { store } from '../../editor/store';
import type { SceneHandle } from '../../editor/scene';
import { ScriptHelpModal } from './ScriptHelpModal';
import { ScriptLibraryModal } from './ScriptLibraryModal';

// Lazy-load the Monaco editor so its chunk only downloads when the user
// actually opens the Script tab. App.tsx also kicks the same dynamic import
// right after mount so this usually resolves from cache.
const ScriptCodeEditor = lazy(() => import('./ScriptCodeEditor'));

function ScriptEditorLoading() {
  const { t } = useTranslation('panels');
  return (
    <div className="script-editor-loading" role="status" aria-live="polite">
      <div className="script-editor-loading-bar" />
      <span>{t('script.loadingEditor')}</span>
    </div>
  );
}

const LS_KEY = 'mudlet-editor-script';
const LS_NAME = 'mudlet-editor-script-name';
const LS_LIBRARY = 'mudlet-editor-scripts';

interface SavedScript { code: string; savedAt: number }
type ScriptLibrary = Record<string, SavedScript>;

function loadLibrary(): ScriptLibrary {
  try {
    const raw = localStorage.getItem(LS_LIBRARY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as ScriptLibrary : {};
  } catch {
    return {};
  }
}

function persistLibrary(lib: ScriptLibrary) {
  localStorage.setItem(LS_LIBRARY, JSON.stringify(lib));
}

const DEFAULT_CODE = `// JavaScript. Whole run = one undo step.
// Read:  rooms() / findRooms(pred) / room(id) / areas() / area(id)
//        currentAreaId, currentZ, DIRS, log(...)
// Write: setRoomName/Env/Symbol/Weight/Lock, moveRoom,
//        setExit, setDoor, setExitWeight, setExitLock, setStub,
//        setUserData, setSpecialExit
// Return anything (array, object…) to display it as JSON below.

// Example: repaint rooms whose name contains "Office" to env 5,
// and return the list of affected rooms.
const hits = findRooms(r => r.name.includes('Office'));
for (const r of hits) setRoomEnv(r.id, 5);
return hits.map(r => ({ id: r.id, name: r.name }));
`;

interface Props {
  sceneRef: { current: SceneHandle | null };
}

export function ScriptPanel({ sceneRef }: Props) {
  const { t } = useTranslation('panels');
  const [code, setCode] = useState(() => localStorage.getItem(LS_KEY) ?? DEFAULT_CODE);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [library, setLibrary] = useState<ScriptLibrary>(() => loadLibrary());
  const [currentName, setCurrentName] = useState<string | null>(() => localStorage.getItem(LS_NAME) || null);
  const [nameInput, setNameInput] = useState<string>(() => localStorage.getItem(LS_NAME) ?? '');

  const libraryCount = Object.keys(library).length;
  const trimmedName = nameInput.trim();
  const nameExists = trimmedName in library;
  const saveLabel = nameExists && trimmedName !== currentName ? t('script.overwriteBtn') : t('script.saveBtn');

  const onSave = () => {
    const name = trimmedName;
    if (!name) return;
    const next: ScriptLibrary = { ...library, [name]: { code, savedAt: Date.now() } };
    setLibrary(next);
    persistLibrary(next);
    setCurrentName(name);
    localStorage.setItem(LS_NAME, name);
    store.setState({ status: t('script.savedStatus', { name }) });
  };

  const onLoad = (name: string) => {
    if (!name) {
      setCurrentName(null);
      setNameInput('');
      localStorage.removeItem(LS_NAME);
      return;
    }
    const entry = library[name];
    if (!entry) return;
    setCode(entry.code);
    setCurrentName(name);
    setNameInput(name);
    localStorage.setItem(LS_NAME, name);
    setResult(null);
    store.setState({ status: t('script.loadedStatus', { name }) });
  };

  const onDeleteByName = (name: string) => {
    if (!name || !library[name]) return;
    const { [name]: _discard, ...rest } = library;
    void _discard;
    setLibrary(rest);
    persistLibrary(rest);
    if (currentName === name) {
      setCurrentName(null);
      setNameInput('');
      localStorage.removeItem(LS_NAME);
    }
    store.setState({ status: t('script.deletedStatus', { name }) });
  };

  const onRun = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    localStorage.setItem(LS_KEY, code);
    setRunning(true);
    // Defer so the "Running…" paint lands before the (sync) eval blocks.
    setTimeout(() => {
      try {
        const r = runScript(code, scene);
        setResult(r);
        if (r.error) {
          store.setState({ status: t('script.errorStatus', { message: r.error.message }) });
        } else {
          store.setState({ status: r.commandCount === 0 ? t('script.ranNoChanges') : (r.commandCount === 1 ? t('script.ranChange', { count: r.commandCount }) : t('script.ranChanges', { count: r.commandCount })) });
        }
      } finally {
        setRunning(false);
      }
    }, 0);
  };

  const onReset = () => {
    setCode(DEFAULT_CODE);
    setResult(null);
  };

  return (
    <div className="panel-content script-panel">
      <div className="script-header">
        <h3>{t('script.heading')}</h3>
        <div className="script-header-actions">
          <button
            type="button"
            className="script-help-btn"
            onClick={() => setShowLibrary(true)}
            title={t('script.libraryTitle')}
          >{t('script.libraryBtn')}{libraryCount > 0 && <span className="tab-badge">{libraryCount}</span>}</button>
          <button
            type="button"
            className="script-help-btn"
            onClick={() => setShowHelp(true)}
            title={t('script.apiTitle')}
          >{t('script.apiBtn')}</button>
        </div>
      </div>
      <p className="hint">{t('script.hint')}</p>
      <div className="script-library">
        <input
          type="text"
          className="script-library-name"
          placeholder={t('script.namePlaceholder')}
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSave(); }
          }}
          spellCheck={false}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!trimmedName}
          title={nameExists ? t('script.overwriteTitle', { name: trimmedName }) : t('script.saveTitle')}
        >{saveLabel}</button>
      </div>
      <div className="script-editor-container">
        <Suspense fallback={<ScriptEditorLoading />}>
          <ScriptCodeEditor value={code} onChange={setCode} onRun={onRun} />
        </Suspense>
        {showLibrary && (
          <ScriptLibraryModal
            library={library}
            currentName={currentName}
            onLoad={onLoad}
            onDelete={onDeleteByName}
            onClose={() => setShowLibrary(false)}
          />
        )}
      </div>
      <div className="script-actions">
        <button type="button" className="script-run-btn" onClick={onRun} disabled={running}>
          {running ? t('script.running') : t('script.runBtn')}
        </button>
        <button type="button" onClick={onReset}>{t('script.resetBtn')}</button>
        <span className="script-hint">{t('script.runHint')}</span>
      </div>
      {result && (
        <div className="script-result">
          {result.error ? (
            <div className="script-error-box">
              <div className="script-error-title">{result.error.name}</div>
              <pre className="script-error-msg">{result.error.message}</pre>
              <div className="hint">{t('script.errorRolledBack')}</div>
            </div>
          ) : (
            <div className="script-ok-box">
              {result.commandCount === 0 ? t('script.noChanges') : (result.commandCount === 1 ? t('script.appliedChange', { count: result.commandCount }) : t('script.appliedChanges', { count: result.commandCount }))}
            </div>
          )}
          {result.logs.length > 0 && (
            <>
              <div className="script-log-title">{t('script.logTitle')}</div>
              <pre className="script-log">{result.logs.join('\n')}</pre>
            </>
          )}
          {result.returnJson !== undefined && (
            <>
              <div className="script-log-title">
                {t('script.resultTitle')}
                <button
                  type="button"
                  className="script-copy-btn"
                  onClick={() => navigator.clipboard?.writeText(result.returnJson ?? '')}
                  title={t('script.copyTitle')}
                >{t('script.copyBtn')}</button>
              </div>
              <pre className="script-result-json">{result.returnJson}</pre>
            </>
          )}
        </div>
      )}
      {showHelp && <ScriptHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
