import React, { useEffect, useRef, useState } from 'react';
import { pushBatch, pushCommand } from '../../editor/commands';
import { store, useEditorState } from '../../editor/store';
import type { SceneHandle } from '../../editor/scene';
import type { MudletColor } from '../../mapIO';
import type { Command, LabelFont, LabelSnapshot } from '../../editor/types';
import { generateLabelPixmap } from '../../editor/labelPixmap';
import { CheckboxField, Field, mudletColorToHex, hexToMudletColor } from '../panelShared';
import { warningKey } from './MapPanel';
import { loadAcks, saveAcks, mapAckKey } from '../../editor/warningAcks';
import { FontPicker } from '../FontPicker';

const COMMON_FONTS = [
  'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
  'Impact', 'Lucida Console', 'Palatino Linotype', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana',
];

interface LabelPanelProps {
  selection: { kind: 'label'; id: number; areaId: number };
  sceneRef: { current: SceneHandle | null };
}

const colorEq = (a: MudletColor, b: MudletColor) =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.alpha === b.alpha;

const outlineEq = (a: MudletColor | undefined, b: MudletColor | undefined) => {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return colorEq(a, b);
};

const PX_PER_UNIT = 64;

export function LabelPanel({ selection, sceneRef }: LabelPanelProps) {
  const dataVersion = useEditorState((s) => s.dataVersion);
  const map = useEditorState((s) => s.map);
  const warnings = useEditorState((s) => s.warnings);
  const aspectRatioLocked = useEditorState((s) => s.labelAspectRatioLocked);
  const snap = sceneRef.current?.reader.getLabelSnapshot(selection.areaId, selection.id);

  const [textDraft, setTextDraft] = useState(snap?.text ?? '');
  const [widthDraft, setWidthDraft] = useState(String(snap?.size[0] ?? 4));
  const [heightDraft, setHeightDraft] = useState(String(snap?.size[1] ?? 1));
  const [bgAlphaDraft, setBgAlphaDraft] = useState(snap?.bgColor.alpha ?? 255);
  const [outlineAlphaDraft, setOutlineAlphaDraft] = useState(snap?.outlineColor?.alpha ?? 0);
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

  // Captures color state at the start of a drag session so we push a single undo entry.
  const colorSessionRef = useRef<{ fg: MudletColor; bg: MudletColor } | null>(null);
  const outlineSessionRef = useRef<{ color: MudletColor | undefined } | null>(null);

  useEffect(() => {
    const s = sceneRef.current?.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!textFocused.current) setTextDraft(s?.text ?? '');
    if (!widthFocused.current) setWidthDraft(String(s?.size[0] ?? 4));
    if (!heightFocused.current) setHeightDraft(String(s?.size[1] ?? 1));
    setBgAlphaDraft(s?.bgColor.alpha ?? 255);
    setOutlineAlphaDraft(s?.outlineColor?.alpha ?? 0);
  }, [selection.id, selection.areaId, dataVersion]);

  if (!snap) return <div className="panel-content"><p className="hint">Label not found.</p></div>;

  const pixmapCmd = (label: LabelSnapshot): Command[] => {
    const to = generateLabelPixmap(label);
    if (to === label.pixMap) return [];
    return [{ kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: label.pixMap, to }];
  };

  const commitText = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current || textDraftRef.current === current.text) return;
    const next = { ...current, text: textDraftRef.current };
    pushBatch([{ kind: 'setLabelText', areaId: selection.areaId, id: selection.id, from: current.text, to: next.text }, ...pixmapCmd(next)], scene);
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
    const next = { ...current, size: [w, h] as [number, number] };
    pushBatch([{ kind: 'setLabelSize', areaId: selection.areaId, id: selection.id, from: current.size, to: next.size }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  const startColorSession = () => {
    if (colorSessionRef.current) return;
    colorSessionRef.current = { fg: snap.fgColor, bg: snap.bgColor };
  };

  const commitColors = (newFg: MudletColor, newBg: MudletColor) => {
    const scene = sceneRef.current;
    const from = colorSessionRef.current ?? { fg: snap.fgColor, bg: snap.bgColor };
    colorSessionRef.current = null;
    if (!scene) return;
    if (colorEq(from.fg, newFg) && colorEq(from.bg, newBg)) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    const next = { ...current, fgColor: newFg, bgColor: newBg };
    pushBatch([{ kind: 'setLabelColors', areaId: selection.areaId, id: selection.id, fromFg: from.fg, toFg: newFg, fromBg: from.bg, toBg: newBg }, ...pixmapCmd(next)], scene);
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
    pushBatch([{ kind: 'setLabelFont', areaId: selection.areaId, id: selection.id, from: current.font, to: next }, ...pixmapCmd({ ...current, font: next })], scene);
    scene.refresh();
    store.bumpData();
  };

  const startOutlineSession = () => {
    if (outlineSessionRef.current) return;
    outlineSessionRef.current = { color: snap.outlineColor };
  };

  const commitOutlineColor = (newColor: MudletColor | undefined) => {
    const scene = sceneRef.current;
    const from = outlineSessionRef.current ?? { color: snap.outlineColor };
    outlineSessionRef.current = null;
    if (!scene) return;
    if (outlineEq(from.color, newColor)) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    const next = { ...current, outlineColor: newColor };
    pushBatch([{ kind: 'setLabelOutlineColor', areaId: selection.areaId, id: selection.id, from: from.color, to: newColor }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  const handleFitFontSize = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current || !current.text) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const PADDING = 8;
    const pw = Math.max(1, Math.round(current.size[0] * PX_PER_UNIT));
    const ph = Math.max(1, Math.round(current.size[1] * PX_PER_UNIT));
    const availW = pw - PADDING * 2;
    const availH = ph - PADDING * 2;
    if (availW <= 0 || availH <= 0) return;

    const lines = current.text.split('\n');
    const { font } = current;
    const maxFromHeight = Math.floor(availH / (lines.length * 1.25));
    let lo = 1, hi = maxFromHeight, result = 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      ctx.font = [font.italic ? 'italic' : '', font.bold ? 'bold' : '', `${mid}px`, `"${font.family}", sans-serif`].filter(Boolean).join(' ');
      const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (maxLineW <= availW) { result = mid; lo = mid + 1; } else { hi = mid - 1; }
    }

    if (result === current.font.size) return;
    commitFont({ size: result });
  };

  const handleRegeneratePixmap = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current) return;
    const to = generateLabelPixmap(current);
    if (to === current.pixMap) return;
    pushCommand({ kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: current.pixMap, to }, scene);
    scene.refresh();
    store.bumpData();
  };

  const handleSetImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          const scene = sceneRef.current;
          if (!scene) return;
          const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
          if (!current) return;
          const w = Math.max(0.1, Math.round((img.naturalWidth / PX_PER_UNIT) * 100) / 100);
          const h = Math.max(0.1, Math.round((img.naturalHeight / PX_PER_UNIT) * 100) / 100);
          const cmds: Command[] = [
            { kind: 'setLabelImageSrc', areaId: selection.areaId, id: selection.id, from: current.imageSrc, to: dataUrl },
            { kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: current.pixMap, to: dataUrl },
            { kind: 'setLabelSize', areaId: selection.areaId, id: selection.id, from: current.size, to: [w, h] },
          ];
          pushBatch(cmds, scene);
          scene.refresh();
          store.setState({ labelAspectRatioLocked: true });
          store.bumpData();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleClearImage = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = scene.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!current || !current.imageSrc) return;
    const regenerated = generateLabelPixmap(current);
    const cmds: Command[] = [
      { kind: 'setLabelImageSrc', areaId: selection.areaId, id: selection.id, from: current.imageSrc, to: undefined },
      { kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: current.pixMap, to: regenerated },
    ];
    pushBatch(cmds, scene);
    scene.refresh();
    store.setState({ labelAspectRatioLocked: false });
    store.bumpData();
  };

  const isImageMode = !!snap.imageSrc;
  const fgHex = mudletColorToHex(snap.fgColor);
  const bgHex = mudletColorToHex(snap.bgColor);
  const outlineBase = snap.outlineColor ?? { spec: 1, r: 0, g: 0, b: 0, alpha: 0, pad: 0 };
  const outlineHex = mudletColorToHex(outlineBase);

  const modeBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '4px 0', fontSize: 12, cursor: 'pointer', border: 'none',
    background: active ? 'var(--accent, #00e5ff)' : 'var(--bg2, #2a2a2a)',
    color: active ? '#000' : 'inherit',
  });

  const acks = map ? loadAcks(mapAckKey(map)) : new Set<string>();
  const labelWarnings = warnings.filter(
    (w) => w.kind === 'zeroSizeLabel' && w.labelId === selection.id && w.areaId === selection.areaId && !acks.has(warningKey(w))
  );

  return (
    <div className="panel-content">
      <h3>Label #{selection.id}</h3>
      {labelWarnings.length > 0 && (
        <div className="warnings-list">
          {labelWarnings.map((w, i) => (
            <div key={i} className="warning-row">
              <span className="warning-icon">⚠</span>
              <span className="warning-text">
                <span className="warning-detail">zero-size label</span>
              </span>
              <button
                type="button"
                className="warning-ack-btn"
                onClick={() => {
                  if (!map) return;
                  const key = mapAckKey(map);
                  const next = new Set(loadAcks(key));
                  next.add(warningKey(w));
                  saveAcks(key, next);
                  store.bumpAckVersion();
                }}
              >Ack</button>
            </div>
          ))}
        </div>
      )}
      <p className="hint" style={{ marginBottom: 8 }}>
        Position: ({snap.pos[0]}, {snap.pos[1]}, {snap.pos[2]}) · Drag to move
      </p>

      {/* Mode switch */}
      <div style={{ display: 'flex', marginBottom: 10, border: '1px solid var(--border, #444)', borderRadius: 4, overflow: 'hidden' }}>
        <button style={modeBtnStyle(!isImageMode)} onClick={() => { if (isImageMode) handleClearImage(); }}>
          Text
        </button>
        <button style={{ ...modeBtnStyle(isImageMode), borderLeft: '1px solid var(--border, #444)' }} onClick={() => { if (!isImageMode) handleSetImage(); }}>
          Image
        </button>
      </div>

      {/* Size + AR lock (always visible) */}
      <div className="field-row">
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
        <button
          title={aspectRatioLocked ? 'Aspect ratio locked — click to unlock' : 'Lock aspect ratio for resize'}
          onClick={() => store.setState({ labelAspectRatioLocked: !aspectRatioLocked })}
          style={{
            background: aspectRatioLocked ? 'var(--accent, #00e5ff)' : 'var(--bg2, #2a2a2a)',
            color: aspectRatioLocked ? '#000' : 'inherit',
          }}
        >
          {aspectRatioLocked ? 'AR locked' : 'AR free'}
        </button>
      </div>

      {/* Display options (always visible) */}
      <CheckboxField
        checked={snap.showOnTop}
        onChange={commitShowOnTop}
        description="Show on top (foreground)"
      />
      <CheckboxField
        checked={!snap.noScaling}
        onChange={(v) => commitNoScaling(!v)}
        description="Scale with zoom"
      />

      {/* IMAGE MODE */}
      {isImageMode && (
        <Field label="Image">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <img
              src={snap.imageSrc}
              alt="label image"
              style={{ maxWidth: '100%', border: '1px solid var(--border, #444)', borderRadius: 3 }}
            />
            <button onClick={handleSetImage} style={{ alignSelf: 'flex-start' }}>
              Replace image...
            </button>
          </div>
        </Field>
      )}

      {/* TEXT MODE */}
      {!isImageMode && <>
        <Field label="Text">
          <textarea
            value={textDraft}
            rows={3}
            onChange={(e) => setTextDraft(e.target.value)}
            onFocus={() => { textFocused.current = true; }}
            onBlur={() => { textFocused.current = false; commitText(); }}
            style={{ resize: 'vertical' }}
          />
        </Field>

        <div style={{ display: 'flex', gap: 8 }}>
          <Field label="Text color" as="div">
            <input
              type="color"
              key={`fg-${selection.id}-${fgHex}`}
              defaultValue={fgHex}
              onMouseDown={startColorSession}
              onBlur={(e) => commitColors(hexToMudletColor(e.target.value), snap.bgColor)}
            />
          </Field>
          <Field label="BG color" as="div">
            <input
              type="color"
              key={`bg-${selection.id}-${bgHex}`}
              defaultValue={bgHex}
              onMouseDown={startColorSession}
              onBlur={(e) => commitColors(snap.fgColor, { ...hexToMudletColor(e.target.value), alpha: snap.bgColor.alpha })}
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
              value={bgAlphaDraft}
              style={{ flex: 1 }}
              onPointerDown={startColorSession}
              onChange={(e) => setBgAlphaDraft(parseInt(e.target.value, 10))}
              onPointerUp={(e) => commitColors(snap.fgColor, { ...snap.bgColor, alpha: parseInt((e.target as HTMLInputElement).value, 10) })}
              onBlur={(e) => commitColors(snap.fgColor, { ...snap.bgColor, alpha: parseInt(e.target.value, 10) })}
            />
            <span style={{ minWidth: 28, textAlign: 'right', fontSize: 12, opacity: 0.7 }}>
              {bgAlphaDraft}
            </span>
          </div>
        </Field>

        <Field label="Font" as="div">
          <FontPicker
            value={snap.font.family}
            options={availableFonts}
            onChange={(family) => commitFont({ family })}
          />
        </Field>

        <Field label="Size">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              step={1}
              defaultValue={snap.font.size}
              key={`font-size-${selection.id}-${snap.font.size}`}
              onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) commitFont({ size: v }); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              style={{ width: 60 }}
            />
            <button
              title="Auto-fit font size to fill label area"
              onClick={handleFitFontSize}
              style={{ height: 24, padding: '0 6px', fontSize: 12, border: '1px solid var(--border, #444)', borderRadius: 3, cursor: 'pointer', background: 'var(--bg2, #2a2a2a)', whiteSpace: 'nowrap' }}
            >
              Auto-fit
            </button>
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

        <Field label="Outline color" as="div">
          <input
            type="color"
            key={`outline-${selection.id}-${outlineHex}`}
            defaultValue={outlineHex}
            onMouseDown={startOutlineSession}
            onBlur={(e) => commitOutlineColor({ ...outlineBase, ...hexToMudletColor(e.target.value) })}
          />
        </Field>

        <Field label="Outline alpha">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={outlineAlphaDraft}
              style={{ flex: 1 }}
              onPointerDown={startOutlineSession}
              onChange={(e) => setOutlineAlphaDraft(parseInt(e.target.value, 10))}
              onPointerUp={(e) => {
                const alpha = parseInt((e.target as HTMLInputElement).value, 10);
                commitOutlineColor(alpha === 0 ? undefined : { ...outlineBase, alpha });
              }}
              onBlur={(e) => {
                const alpha = parseInt(e.target.value, 10);
                commitOutlineColor(alpha === 0 ? undefined : { ...outlineBase, alpha });
              }}
            />
            <span style={{ minWidth: 28, textAlign: 'right', fontSize: 12, opacity: 0.7 }}>
              {outlineAlphaDraft}
            </span>
          </div>
        </Field>

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
      </>}
    </div>
  );
}
