import { useState, type RefObject } from 'react';
import type { SceneHandle } from '../editor/scene';

type RoomShape = 'rectangle' | 'circle' | 'roundedRectangle';

export type PersistedRendererSettings = {
  roomShape: RoomShape;
  roomSize: number;
  lineWidth: number;
  lineColor: string;
  borders: boolean;
  frameMode: boolean;
  coloredMode: boolean;
  emboss: boolean;
  backgroundColor: string;
  areaName: boolean;
};

// Matches scene.ts editor overrides on top of createSettings() defaults.
const DEFAULTS: PersistedRendererSettings = {
  roomShape: 'rectangle',
  roomSize: 0.6,
  lineWidth: 0.025,
  lineColor: '#e1ffe1',
  borders: true,
  frameMode: false,
  coloredMode: false,
  emboss: false,
  backgroundColor: '#000000',
  areaName: false,
};

const RENDERER_SETTINGS_KEY = 'mudlet-renderer-settings';

export function loadRendererSettings(): Partial<PersistedRendererSettings> {
  try {
    const raw = localStorage.getItem(RENDERER_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function persistRendererSettings(patch: Partial<PersistedRendererSettings>): void {
  try {
    const current = loadRendererSettings();
    localStorage.setItem(RENDERER_SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

export function applyRendererSettings(scene: SceneHandle, settings: Partial<PersistedRendererSettings>): void {
  const s = scene.settings;
  if (settings.roomShape !== undefined) s.roomShape = settings.roomShape;
  if (settings.roomSize !== undefined) s.roomSize = settings.roomSize;
  if (settings.lineWidth !== undefined) s.lineWidth = settings.lineWidth;
  if (settings.lineColor !== undefined) s.lineColor = settings.lineColor;
  if (settings.borders !== undefined) s.borders = settings.borders;
  if (settings.frameMode !== undefined) s.frameMode = settings.frameMode;
  if (settings.coloredMode !== undefined) s.coloredMode = settings.coloredMode;
  if (settings.emboss !== undefined) s.emboss = settings.emboss;
  if (settings.backgroundColor !== undefined) s.backgroundColor = settings.backgroundColor;
  if (settings.areaName !== undefined) s.areaName = settings.areaName;
}

function toHex(color: string): string {
  if (color.startsWith('#')) return color.slice(0, 7);
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');
  return '#ffffff';
}

export function RendererSettingsModal({
  onClose,
  sceneRef,
}: {
  onClose: () => void;
  sceneRef: RefObject<SceneHandle | null>;
}) {
  const s = sceneRef.current?.settings;

  const [roomShape, setRoomShape] = useState<RoomShape>(s?.roomShape ?? DEFAULTS.roomShape);
  const [roomSize, setRoomSize] = useState(s?.roomSize ?? DEFAULTS.roomSize);
  const [borders, setBorders] = useState(s?.borders ?? DEFAULTS.borders);
  const [frameMode, setFrameMode] = useState(s?.frameMode ?? DEFAULTS.frameMode);
  const [coloredMode, setColoredMode] = useState(s?.coloredMode ?? DEFAULTS.coloredMode);
  const [emboss, setEmboss] = useState(s?.emboss ?? DEFAULTS.emboss);
  const [lineWidth, setLineWidth] = useState(s?.lineWidth ?? DEFAULTS.lineWidth);
  const [lineColor, setLineColor] = useState(toHex(s?.lineColor ?? DEFAULTS.lineColor));
  const [backgroundColor, setBackgroundColor] = useState(toHex(s?.backgroundColor ?? DEFAULTS.backgroundColor));
  const [areaName, setAreaName] = useState(s?.areaName ?? DEFAULTS.areaName);

  function applyLive(patch: Partial<PersistedRendererSettings>) {
    const scene = sceneRef.current;
    if (!scene) return;
    applyRendererSettings(scene, patch);
    persistRendererSettings(patch);
    scene.refresh();
  }

  function resetToDefaults() {
    setRoomShape(DEFAULTS.roomShape);
    setRoomSize(DEFAULTS.roomSize);
    setBorders(DEFAULTS.borders);
    setFrameMode(DEFAULTS.frameMode);
    setColoredMode(DEFAULTS.coloredMode);
    setEmboss(DEFAULTS.emboss);
    setLineWidth(DEFAULTS.lineWidth);
    setLineColor(DEFAULTS.lineColor);
    setBackgroundColor(DEFAULTS.backgroundColor);
    setAreaName(DEFAULTS.areaName);
    const scene = sceneRef.current;
    if (!scene) return;
    applyRendererSettings(scene, DEFAULTS);
    try { localStorage.removeItem(RENDERER_SETTINGS_KEY); } catch {}
    scene.refresh();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Renderer Settings</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="settings-reset-btn" onClick={resetToDefaults} title="Reset all to defaults">
              Reset
            </button>
            <button className="modal-close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>
        <div className="modal-body settings-modal-body">

          <section className="settings-section">
            <h3 className="settings-section-title">Room</h3>

            <div className="settings-row">
              <span className="settings-label">Shape</span>
              <div className="settings-radio-group">
                {(['rectangle', 'roundedRectangle', 'circle'] as RoomShape[]).map((shape) => (
                  <label key={shape} className="settings-radio">
                    <input
                      type="radio"
                      name="roomShape"
                      value={shape}
                      checked={roomShape === shape}
                      onChange={() => { setRoomShape(shape); applyLive({ roomShape: shape }); }}
                    />
                    {shape === 'rectangle' ? 'Rectangle' : shape === 'roundedRectangle' ? 'Rounded' : 'Circle'}
                  </label>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">Size</span>
              <div className="settings-slider-group">
                <input
                  type="range"
                  min={0.2}
                  max={1.5}
                  step={0.05}
                  value={roomSize}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setRoomSize(v);
                    applyLive({ roomSize: v });
                  }}
                />
                <span className="settings-value">{roomSize.toFixed(2)}</span>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">Style</span>
              <div className="settings-checkbox-group">
                <label className="settings-checkbox">
                  <input type="checkbox" checked={borders} onChange={(e) => { setBorders(e.target.checked); applyLive({ borders: e.target.checked }); }} />
                  Borders
                </label>
                <label className="settings-checkbox">
                  <input type="checkbox" checked={frameMode} onChange={(e) => { setFrameMode(e.target.checked); applyLive({ frameMode: e.target.checked }); }} />
                  Frame
                </label>
                <label className="settings-checkbox">
                  <input type="checkbox" checked={coloredMode} onChange={(e) => { setColoredMode(e.target.checked); applyLive({ coloredMode: e.target.checked }); }} />
                  Colored
                </label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={emboss}
                    disabled={roomShape === 'circle'}
                    onChange={(e) => { setEmboss(e.target.checked); applyLive({ emboss: e.target.checked }); }}
                  />
                  <span style={roomShape === 'circle' ? { opacity: 0.4 } : undefined}>Emboss</span>
                </label>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Lines</h3>

            <div className="settings-row">
              <span className="settings-label">Width</span>
              <div className="settings-slider-group">
                <input
                  type="range"
                  min={0.005}
                  max={0.1}
                  step={0.005}
                  value={lineWidth}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setLineWidth(v);
                    applyLive({ lineWidth: v });
                  }}
                />
                <span className="settings-value">{lineWidth.toFixed(3)}</span>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">Color</span>
              <div className="settings-color-row">
                <input
                  type="color"
                  value={lineColor}
                  onChange={(e) => { setLineColor(e.target.value); applyLive({ lineColor: e.target.value }); }}
                  className="settings-color-input"
                />
                <span className="settings-color-value">{lineColor}</span>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Background</h3>

            <div className="settings-row">
              <span className="settings-label">Color</span>
              <div className="settings-color-row">
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => { setBackgroundColor(e.target.value); applyLive({ backgroundColor: e.target.value }); }}
                  className="settings-color-input"
                />
                <span className="settings-color-value">{backgroundColor}</span>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">Area name</span>
              <label className="settings-checkbox">
                <input type="checkbox" checked={areaName} onChange={(e) => { setAreaName(e.target.checked); applyLive({ areaName: e.target.checked }); }} />
                Show on map
              </label>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
