import { useEffect, useRef, useState } from 'react';
import { pushCommand } from '../../editor/commands';
import { store, useEditorState } from '../../editor/store';
import type { SceneHandle } from '../../editor/scene';
import type { MudletColor } from '../../mapIO';
import type { LabelFont, LabelSnapshot } from '../../editor/types';
import { generateLabelPixmap } from '../../editor/labelPixmap';
import { CheckboxField, Field, mudletColorToHex, hexToMudletColor } from '../panelShared';

const COMMON_FONTS = [
  'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
  'Impact', 'Lucida Console', 'Palatino Linotype', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana',
];

interface LabelPanelProps {
  selection: { kind: 'label'; id: number; areaId: number };
  sceneRef: { current: SceneHandle | null };
}

export function LabelPanel({ selection, sceneRef }: LabelPanelProps) {
  const dataVersion = useEditorState((s) => s.dataVersion);
  const snap = sceneRef.current?.reader.getLabelSnapshot(selection.areaId, selection.id);

  const [textDraft, setTextDraft] = useState(snap?.text ?? '');
  const [widthDraft, setWidthDraft] = useState(String(snap?.size[0] ?? 4));
  const [heightDraft, setHeightDraft] = useState(String(snap?.size[1] ?? 1));
  const [availableFonts, setAvailableFonts] = useState<string[]>(COMMON_FONTS);

  useEffect(() => {
    if (!('queryLocalFonts' in window)) return;
    (window as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts?.().then((fonts) => {
      const families = [...new Set(fonts.map((f) => f.family))].sort() as string[];
      if (families.length > 0) setAvailableFonts(families);
    }).catch(() => {});
  }, []);

  const textFocused = useRef(false);
  const widthFocused = useRef(false);
  const heightFocused = useRef(false);

  const textDraftRef = useRef(textDraft);
  textDraftRef.current = textDraft;
  const widthDraftRef = useRef(widthDraft);
  widthDraftRef.current = widthDraft;
  const heightDraftRef = useRef(heightDraft);
  heightDraftRef.current = heightDraft;

  // Sync drafts when snapshot changes externally (undo, resize handle drag).
  // Skip focused fields to avoid clobbering mid-edit.
  useEffect(() => {
    const s = sceneRef.current?.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!textFocused.current) setTextDraft(s?.text ?? '');
    if (!widthFocused.current) setWidthDraft(String(s?.size[0] ?? 4));
    if (!heightFocused.current) setHeightDraft(String(s?.size[1] ?? 1));
  }, [selection.id, selection.areaId, dataVersion]);

  if (!snap) return <div className="panel-content"><p className="hint">Label not found.</p></div>;

  const regeneratePixmap = (label: LabelSnapshot, scene: SceneHandle, previousPixMap: string) => {
    const dataUrl = generateLabelPixmap(label);
    if (dataUrl === previousPixMap) return;
    pushCommand({ kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: previousPixMap, to: dataUrl }, scene);
  };

  const commitText = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current || textDraftRef.current === current.text) return;
    pushCommand({ kind: 'setLabelText', areaId: selection.areaId, id: selection.id, from: current.text, to: textDraftRef.current }, scene);
    regeneratePixmap({ ...current, text: textDraftRef.current }, scene, current.pixMap);
    scene.refresh();
    store.bumpData();
  };

  const commitSize = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    const w = parseFloat(widthDraftRef.current);
    const h = parseFloat(heightDraftRef.current);
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return;
    if (w === current.size[0] && h === current.size[1]) return;
    pushCommand({ kind: 'setLabelSize', areaId: selection.areaId, id: selection.id, from: current.size, to: [w, h] }, scene);
    regeneratePixmap({ ...current, size: [w, h] }, scene, current.pixMap);
    scene.refresh();
    store.bumpData();
  };

  const commitColors = (newFg: MudletColor, newBg: MudletColor) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    pushCommand({
      kind: 'setLabelColors',
      areaId: selection.areaId,
      id: selection.id,
      fromFg: current.fgColor,
      toFg: newFg,
      fromBg: current.bgColor,
      toBg: newBg,
    }, scene);
    regeneratePixmap({ ...current, fgColor: newFg, bgColor: newBg }, scene, current.pixMap);
    scene.refresh();
    store.bumpData();
  };

  const commitNoScaling = (val: boolean) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current || current.noScaling === val) return;
    pushCommand({ kind: 'setLabelNoScaling', areaId: selection.areaId, id: selection.id, from: current.noScaling, to: val }, scene);
    scene.refresh();
    store.bumpData();
  };

  const commitShowOnTop = (val: boolean) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current || current.showOnTop === val) return;
    pushCommand({ kind: 'setLabelShowOnTop', areaId: selection.areaId, id: selection.id, from: current.showOnTop, to: val }, scene);
    scene.refresh();
    store.bumpData();
  };

  const commitFont = (patch: Partial<LabelFont>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    const next: LabelFont = { ...current.font, ...patch };
    pushCommand({ kind: 'setLabelFont', areaId: selection.areaId, id: selection.id, from: current.font, to: next }, scene);
    regeneratePixmap({ ...current, font: next }, scene, current.pixMap);
    scene.refresh();
    store.bumpData();
  };

  const commitOutlineColor = (color: MudletColor | undefined) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    pushCommand({ kind: 'setLabelOutlineColor', areaId: selection.areaId, id: selection.id, from: current.outlineColor, to: color }, scene);
    regeneratePixmap({ ...current, outlineColor: color }, scene, current.pixMap);
    scene.refresh();
    store.bumpData();
  };

  const handleRegeneratePixmap = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    regeneratePixmap(current, scene, current.pixMap);
    scene.refresh();
    store.bumpData();
  };

  return (
    <div className="panel-content">
      <h3>Label #{selection.id}</h3>
      <p className="hint" style={{ marginBottom: 8 }}>
        Position: ({snap.pos[0]}, {snap.pos[1]}, {snap.pos[2]}) · Drag to move
      </p>

      <Field label="Text">
        <input
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onFocus={() => { textFocused.current = true; }}
          onBlur={() => { textFocused.current = false; commitText(); }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8 }}>
        <Field label="Width">
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={widthDraft}
            onChange={(e) => setWidthDraft(e.target.value)}
            onFocus={() => { widthFocused.current = true; }}
            onBlur={() => { widthFocused.current = false; commitSize(); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            style={{ width: 70 }}
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={heightDraft}
            onChange={(e) => setHeightDraft(e.target.value)}
            onFocus={() => { heightFocused.current = true; }}
            onBlur={() => { heightFocused.current = false; commitSize(); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            style={{ width: 70 }}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Field label="Text color">
          <input
            type="color"
            value={mudletColorToHex(snap.fgColor)}
            onChange={(e) => commitColors(hexToMudletColor(e.target.value), snap.bgColor)}
          />
        </Field>
        <Field label="BG color">
          <input
            type="color"
            value={mudletColorToHex(snap.bgColor)}
            onChange={(e) => commitColors(snap.fgColor, { ...hexToMudletColor(e.target.value), alpha: snap.bgColor.alpha })}
          />
        </Field>
      </div>

      <Field label="BG alpha">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <input
            type="range"
            min={0}
            max={255}
            step={1}
            value={snap.bgColor.alpha}
            style={{ flex: 1 }}
            onChange={(e) => commitColors(snap.fgColor, { ...snap.bgColor, alpha: parseInt(e.target.value, 10) })}
          />
          <span style={{ minWidth: 28, textAlign: 'right', fontSize: 12, opacity: 0.7 }}>
            {snap.bgColor.alpha}
          </span>
        </div>
      </Field>

      <Field label="Font">
        <input
          list="label-font-list"
          defaultValue={snap.font.family}
          key={`font-family-${selection.id}`}
          onBlur={(e) => { const v = e.target.value.trim(); if (v) commitFont({ family: v }); }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          style={{ flex: 1 }}
        />
        <datalist id="label-font-list">
          {availableFonts.map((f) => <option key={f} value={f} />)}
        </datalist>
      </Field>

      <Field label="Size">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            min={1}
            max={256}
            step={1}
            defaultValue={snap.font.size}
            key={`font-size-${selection.id}`}
            onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) commitFont({ size: v }); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            style={{ width: 60 }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              ['B', 'bold',      { fontWeight: 'bold' }],
              ['I', 'italic',    { fontStyle: 'italic' }],
              ['U', 'underline', { textDecoration: 'underline' }],
              ['S', 'strikeout', { textDecoration: 'line-through' }],
            ] as const).map(([label, key, style]) => (
              <button
                key={key}
                title={key}
                onClick={() => commitFont({ [key]: !snap.font[key] })}
                style={{
                  width: 24, height: 24, padding: 0, fontSize: 12,
                  background: snap.font[key] ? 'var(--accent, #00e5ff)' : 'var(--bg2, #2a2a2a)',
                  color: snap.font[key] ? '#000' : 'inherit',
                  border: '1px solid var(--border, #444)',
                  borderRadius: 3, cursor: 'pointer',
                  ...style,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Field>

      <Field label="Outline color">
        <input
          type="color"
          value={mudletColorToHex(snap.outlineColor ?? { spec: 1, r: 0, g: 0, b: 0, alpha: 255, pad: 0 })}
          onChange={(e) => commitOutlineColor({ ...(snap.outlineColor ?? { spec: 1, r: 0, g: 0, b: 0, alpha: 255, pad: 0 }), ...hexToMudletColor(e.target.value) })}
        />
      </Field>

      <Field label="Outline alpha">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <input
            type="range"
            min={0}
            max={255}
            step={1}
            value={snap.outlineColor?.alpha ?? 0}
            style={{ flex: 1 }}
            onChange={(e) => {
              const alpha = parseInt(e.target.value, 10);
              const base = snap.outlineColor ?? { spec: 1, r: 0, g: 0, b: 0, alpha: 0, pad: 0 };
              commitOutlineColor(alpha === 0 ? undefined : { ...base, alpha });
            }}
          />
          <span style={{ minWidth: 28, textAlign: 'right', fontSize: 12, opacity: 0.7 }}>
            {snap.outlineColor?.alpha ?? 0}
          </span>
        </div>
      </Field>

      <CheckboxField
        label="Position"
        checked={snap.showOnTop}
        onChange={commitShowOnTop}
        description="Show on top (foreground)"
      />

      <CheckboxField
        label="Zoom scaling"
        checked={!snap.noScaling}
        onChange={(v) => commitNoScaling(!v)}
        description="Scale with zoom"
      />

      <Field label="Pixmap">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          {snap.pixMap ? (
            <img
              src={snap.pixMap}
              alt="label pixmap"
              style={{ maxWidth: '100%', border: '1px solid var(--border, #444)', borderRadius: 3 }}
            />
          ) : (
            <span className="hint">No pixmap stored</span>
          )}
          <button onClick={handleRegeneratePixmap} style={{ alignSelf: 'flex-start' }}>
            Regenerate pixmap
          </button>
        </div>
      </Field>
    </div>
  );
}
