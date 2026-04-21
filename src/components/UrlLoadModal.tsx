import { useEffect, useState } from 'react';
import { store } from '../editor/store';
import { loadUrlIntoStore } from '../editor/loadFile';

export function UrlLoadModal({ onClose, initialUrl }: { onClose: () => void; initialUrl?: string }) {
  const [urlInput, setUrlInput] = useState(initialUrl ?? '');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const handleLoad = async (url = urlInput.trim()) => {
    if (!url) return;
    setUrlInput(url);
    setLoading(true);
    setProgress(0);
    await loadUrlIntoStore(url, setProgress);
    setLoading(false);
    setProgress(null);
    if (store.getState().map) onClose();
  };

  // Auto-start when opened with a pre-filled URL.
  useEffect(() => {
    if (initialUrl) handleLoad(initialUrl);
  }, []);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div className="modal" style={{ width: 420 }}>
        <div className="modal-header">
          <h2>Load map from URL</h2>
          <button type="button" className="modal-close" disabled={loading} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-add-row">
            <input
              type="url"
              placeholder="https://example.com/map.dat"
              value={urlInput}
              disabled={loading}
              autoFocus={!initialUrl}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLoad();
                if (e.key === 'Escape' && !loading) onClose();
              }}
            />
            <button type="button" disabled={loading || !urlInput.trim()} onClick={() => handleLoad()}>
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
          {loading && (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(143,184,255,0.1)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'rgba(52,100,168,0.85)',
                  width: progress != null ? `${progress}%` : '40%',
                  transition: progress != null ? 'width 0.15s ease' : undefined,
                  animation: progress == null ? 'url-progress-indeterminate 1.4s ease-in-out infinite' : undefined,
                }} />
              </div>
              {progress != null && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#6a7588', textAlign: 'right' }}>{progress}%</div>
              )}
            </div>
          )}
          <p style={{ margin: '10px 0 0', fontSize: 11, color: '#55606f', lineHeight: 1.5 }}>
            The server must allow cross-origin requests (CORS). If loading fails, download the file and use "Load .dat" instead.
          </p>
        </div>
      </div>
    </div>
  );
}
