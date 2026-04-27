import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MudletMap } from '../mapIO';
import type { SceneHandle } from '../editor/scene';

interface EnvPickerProps {
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
  currentEnvId: number;
  onSelect: (envId: number) => void;
  onClose: () => void;
}

export function EnvPicker({ map, sceneRef, currentEnvId, onSelect, onClose }: EnvPickerProps) {
  const { t } = useTranslation('envs');
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const reader = sceneRef.current?.reader;

  const ids = new Set<number>();
  for (const c of Object.keys(map.envColors)) ids.add(Number(c));
  for (const c of Object.keys(map.mCustomEnvColors)) ids.add(Number(c));
  for (const r of Object.values(map.rooms)) {
    if (r.environment != null && r.environment > 0) ids.add(r.environment);
  }

  const filterNum = filter.trim();
  const envs = Array.from(ids)
    .sort((a, b) => a - b)
    .filter((id) => !filterNum || String(id).startsWith(filterNum))
    .map((envId) => ({ envId, color: reader ? reader.getColorValue(envId) : 'rgb(114,1,0)' }));

  return (
    <div ref={ref} className="env-picker-popup">
      <input
        className="env-picker-filter"
        placeholder={t('filterByIdPlaceholder')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <div className="env-picker-scroll">
        <div className="env-picker-grid">
          <button
            type="button"
            className={`env-picker-swatch${currentEnvId === -1 ? ' selected' : ''}`}
            style={{ background: 'rgb(114,1,0)' }}
            title={t('noneTitle')}
            onClick={() => { onSelect(-1); onClose(); }}
          >
            <span className="env-picker-id">−</span>
          </button>
          {envs.map(({ envId, color }) => (
            <button
              key={envId}
              type="button"
              className={`env-picker-swatch${envId === currentEnvId ? ' selected' : ''}`}
              style={{ background: color }}
              title={t('envTitle', { id: envId })}
              onClick={() => { onSelect(envId); onClose(); }}
            >
              <span className="env-picker-id">{envId}</span>
            </button>
          ))}
          {envs.length === 0 && <span style={{ color: '#55606f', fontSize: 11, padding: '4px 2px' }}>{t('noMatch')}</span>}
        </div>
      </div>
    </div>
  );
}
