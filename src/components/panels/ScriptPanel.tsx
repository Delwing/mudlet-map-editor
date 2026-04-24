import { lazy, Suspense, useState } from 'react';
import { runScript, type ScriptResult } from '../../editor/script';
import { store } from '../../editor/store';
import type { SceneHandle } from '../../editor/scene';
import { ScriptHelpModal } from './ScriptHelpModal';

// Lazy-load the CodeMirror editor so its ~200 KB chunk only downloads when the
// user actually opens the Script tab.
const ScriptCodeEditor = lazy(() => import('./ScriptCodeEditor'));

const LS_KEY = 'mudlet-editor-script';

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
  const [code, setCode] = useState(() => localStorage.getItem(LS_KEY) ?? DEFAULT_CODE);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
          store.setState({ status: `Script error: ${r.error.message}` });
        } else {
          store.setState({ status: r.commandCount === 0 ? 'Script ran (no changes)' : `Script: ${r.commandCount} change${r.commandCount === 1 ? '' : 's'}` });
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
        <h3>Script</h3>
        <button
          type="button"
          className="script-help-btn"
          onClick={() => setShowHelp(true)}
          title="Show script API reference"
        >? API</button>
      </div>
      <p className="hint">Bulk-edit rooms with JavaScript. One run = one undo step.</p>
      <Suspense
        fallback={
          <textarea
            className="script-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            rows={16}
            placeholder="// Loading editor…"
          />
        }
      >
        <ScriptCodeEditor value={code} onChange={setCode} onRun={onRun} />
      </Suspense>
      <div className="script-actions">
        <button type="button" className="script-run-btn" onClick={onRun} disabled={running}>
          {running ? 'Running…' : 'Run script'}
        </button>
        <button type="button" onClick={onReset}>Reset</button>
        <span className="script-hint">Ctrl+Enter to run</span>
      </div>
      {result && (
        <div className="script-result">
          {result.error ? (
            <div className="script-error-box">
              <div className="script-error-title">{result.error.name}</div>
              <pre className="script-error-msg">{result.error.message}</pre>
              <div className="hint">All changes rolled back.</div>
            </div>
          ) : (
            <div className="script-ok-box">
              {result.commandCount === 0 ? 'No changes.' : `Applied ${result.commandCount} change${result.commandCount === 1 ? '' : 's'}.`}
            </div>
          )}
          {result.logs.length > 0 && (
            <>
              <div className="script-log-title">Log</div>
              <pre className="script-log">{result.logs.join('\n')}</pre>
            </>
          )}
          {result.returnJson !== undefined && (
            <>
              <div className="script-log-title">
                Result
                <button
                  type="button"
                  className="script-copy-btn"
                  onClick={() => navigator.clipboard?.writeText(result.returnJson ?? '')}
                  title="Copy JSON to clipboard"
                >Copy</button>
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
