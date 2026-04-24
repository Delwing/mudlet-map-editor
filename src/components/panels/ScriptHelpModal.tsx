import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SCRIPT_API, ROOM_FIELDS, AREA_FIELDS, ENV_FIELDS, type ApiEntry } from '../../editor/scriptApiDocs';
import { buildAiPrompt } from '../../editor/scriptAiPrompt';

interface Props {
  onClose(): void;
}

function ApiTable({ entries }: { entries: ApiEntry[] }) {
  return (
    <div className="script-help-list">
      {entries.map((e) => (
        <div key={e.name} className="script-help-entry">
          <code className="script-help-sig">{e.signature ?? e.name}</code>
          <div className="script-help-info">{e.info}</div>
        </div>
      ))}
    </div>
  );
}

export function ScriptHelpModal({ onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const readEntries = SCRIPT_API.filter((e) => e.detail === 'Read' || e.detail === 'I/O' || e.kind !== 'function');
  const writeEntries = SCRIPT_API.filter((e) => e.detail === 'Write');

  const onCopyForAi = async () => {
    const text = buildAiPrompt();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in insecure contexts — fall back to a prompt.
      window.prompt('Copy the prompt text:', text);
    }
  };

  // Portal out of the side panel — its `backdrop-filter` establishes a new
  // containing block for `position: fixed`, which would otherwise clip us.
  return createPortal((
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Script API</h2>
          <button className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="modal-body help-modal-body">
          <p className="help-desc">
            JavaScript scripts run in a sandbox with the helpers below. Every mutation is recorded
            as one batch command — a single <kbd>Ctrl+Z</kbd> reverts the whole run. If the script
            throws, all applied changes roll back.
          </p>
          <p className="help-desc">
            <kbd>Ctrl+Space</kbd> triggers autocomplete; <kbd>Ctrl+Enter</kbd> runs the script.
            Return a value (array, object, …) to show it below the editor as JSON.
          </p>

          <div className="ai-prompt-card">
            <div className="ai-prompt-card-body">
              <div className="ai-prompt-card-title">Using an AI to write scripts?</div>
              <div className="ai-prompt-card-desc">
                Copy a compact markdown version of this API reference (with examples) to paste
                into ChatGPT / Claude / etc. before your request.
              </div>
            </div>
            <button
              type="button"
              className="ai-prompt-copy-btn"
              onClick={onCopyForAi}
              title="Copy AI-friendly API reference to clipboard"
            >{copied ? 'Copied!' : 'Copy for AI'}</button>
          </div>

          <h3 className="help-section-title">Read &amp; I/O</h3>
          <ApiTable entries={readEntries} />

          <h3 className="help-section-title">Write (collected into one undo batch)</h3>
          <ApiTable entries={writeEntries} />

          <h3 className="help-section-title">Room snapshot fields</h3>
          <p className="help-desc">
            <code>rooms()</code>, <code>findRooms(pred)</code>, and <code>room(id)</code> return
            frozen snapshot objects with these fields. To see a mutation, call the function again —
            snapshots don't auto-update.
          </p>
          <ApiTable entries={ROOM_FIELDS} />

          <h3 className="help-section-title">Area snapshot fields</h3>
          <p className="help-desc">
            <code>areas()</code> and <code>area(id)</code> return objects with these fields.
          </p>
          <ApiTable entries={AREA_FIELDS} />

          <h3 className="help-section-title">Env snapshot fields</h3>
          <p className="help-desc">
            <code>envs()</code> and <code>env(id)</code> return frozen objects describing each
            environment's resolved color (merging the default palette with any custom overrides).
          </p>
          <ApiTable entries={ENV_FIELDS} />

          <h3 className="help-section-title">Directions</h3>
          <p className="help-desc">
            The <code>Direction</code> type accepts any of: <code>north</code>, <code>south</code>,{' '}
            <code>east</code>, <code>west</code>, <code>northeast</code>, <code>northwest</code>,{' '}
            <code>southeast</code>, <code>southwest</code>, <code>up</code>, <code>down</code>,{' '}
            <code>in</code>, <code>out</code>. The constant <code>DIRS</code> is the full list.
          </p>
        </div>
      </div>
    </div>
  ), document.body);
}
