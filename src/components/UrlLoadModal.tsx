import { useState } from 'react';
import { store } from '../editor/store';
import { readMapFromBytes } from '../mapIO';

export function UrlLoadModal({ onClose }: { onClose: () => void }) {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const handleLoad = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setLoading(true);
    setProgress(0);
    try {
      store.setState({ status: 'Fetching…' });
      const resp = await fetch(url);
      if (!resp.ok) {
        store.setState({ status: `Failed to load URL: HTTP ${resp.status} ${resp.statusText}` });
        return;
      }
      const total = Number(resp.headers.get('content-length')) || 0;
      const reader = resp.body!.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setProgress(total > 0 ? Math.round((received / total) * 100) : null);
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
      const fileName = url.split('/').pop()?.split('?')[0] || 'map.dat';
      const map = readMapFromBytes(merged.buffer);
      const firstAreaId = Number(Object.keys(map.areaNames)[0] ?? -1);
      const resolvedArea = Number.isNaN(firstAreaId) ? null : firstAreaId;
      store.setState({
        map,
        loaded: { fileName },
        currentAreaId: resolvedArea,
        currentZ: 0,
        selection: null,
        hover: null,
        pending: null,
        undo: [],
        redo: [],
        savedUndoLength: 0,
        status: `Loaded ${fileName} · ${Object.keys(map.rooms).length} rooms · ${Object.keys(map.areaNames).length} areas`,
        sessionId: null,
      });
      store.bumpStructure();
      onClose();
    } catch (err) {
      store.setState({ status: `Failed to load URL: ${(err as Error).message}` });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

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
              autoFocus
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLoad();
                if (e.key === 'Escape' && !loading) onClose();
              }}
            />
            <button type="button" disabled={loading || !urlInput.trim()} onClick={handleLoad}>
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
