import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labelDiffCommands, pushBatch, pushCommand } from '../../editor/commands';
import { store, useEditorState, saveUserSettings } from '../../editor/store';
import type { SceneHandle } from '../../editor/scene';
import type { MudletColor } from '../../mapIO';
import type { Command, LabelPadding, LabelBorder, LabelFont, LabelSnapshot, LabelTextAlign } from '../../editor/types';
import {
  PX_PER_UNIT,
  fontSizeToFit,
  generateLabelPixmap,
  labelPaddingEq,
  normaliseLabelPadding,
  labelSizeForText,
  resolveLabelPadding,
} from '../../editor/labelPixmap';
import { getLabelStyles } from '../../editor/labelStyles';
import { applyLabelPreset, getLabelPresets, renderLabelPresetPreview, type LabelPreset } from '../../editor/labelPresets';
import { CheckboxField, Field, ColorSwatch, mudletColorToHex, hexToMudletColor } from '../panelShared';
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

/** Border width a label gets when the border is first switched on. */
const defaultBorderWidth = (label: LabelSnapshot) =>
  Math.max(2, Math.round(Math.min(label.size[0], label.size[1]) * PX_PER_UNIT * 0.04));

/** Traditional paragraph-alignment icon: four horizontal bars anchored per side. */
function AlignIcon({ align }: { align: LabelTextAlign }) {
  const full = 12;
  const x0 = 1;
  return (
    <svg width={14} height={12} viewBox="0 0 14 12" aria-hidden focusable="false">
      {[1, 0.6, 1, 0.6].map((frac, i) => {
        const len = full * frac;
        const x = align === 'left' ? x0 : align === 'right' ? x0 + (full - len) : x0 + (full - len) / 2;
        const y = 2 + i * 2.6;
        return <line key={i} x1={x} y1={y} x2={x + len} y2={y} stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />;
      })}
    </svg>
  );
}

/** The preset strip: each button previews its preset, rendered by the preset itself. */
function PresetRow({ presets, activeId, onApply, onClear }: {
  presets: LabelPreset[];
  activeId: string | null;
  onApply: (preset: LabelPreset) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation('panels');
  const previews = useMemo(() => presets.map((p) => renderLabelPresetPreview(p, p.name)), [presets]);
  const active = presets.find((p) => p.id === activeId) ?? null;

  return (
    <div className="label-presets">
      <div className="label-preset-strip">
        {presets.map((preset, i) => (
          <button
            key={preset.id}
            type="button"
            className={`label-preset${preset.id === activeId ? ' active' : ''}`}
            title={preset.name}
            onClick={() => onApply(preset)}
          >
            <img src={previews[i]} alt="" />
            <span>{preset.name}</span>
          </button>
        ))}
      </div>
      <p className="hint label-preset-hint">
        {active ? t('label.presetForNew', { name: active.name }) : t('label.presetHint')}
        {active && (
          <button type="button" className="label-preset-clear" title={t('label.presetClear')} onClick={onClear}>×</button>
        )}
      </p>
    </div>
  );
}

export function LabelPanel({ selection, sceneRef }: LabelPanelProps) {
  const { t } = useTranslation('panels');
  const dataVersion = useEditorState((s) => s.dataVersion);
  const map = useEditorState((s) => s.map);
  const warnings = useEditorState((s) => s.warnings);
  const aspectRatioLocked = useEditorState((s) => s.labelAspectRatioLocked);
  const labelPresetId = useEditorState((s) => s.labelPresetId);
  const snap = sceneRef.current?.reader.getLabelSnapshot(selection.areaId, selection.id);

  const [textDraft, setTextDraft] = useState(snap?.text ?? '');
  const [widthDraft, setWidthDraft] = useState(String(snap?.size[0] ?? 4));
  const [heightDraft, setHeightDraft] = useState(String(snap?.size[1] ?? 1));
  const [bgAlphaDraft, setBgAlphaDraft] = useState(snap?.bgColor.alpha ?? 255);
  const [outlineAlphaDraft, setOutlineAlphaDraft] = useState(snap?.outlineColor?.alpha ?? 0);
  const [borderAlphaDraft, setBorderAlphaDraft] = useState(snap?.border?.color.alpha ?? 255);
  const [availableFonts, setAvailableFonts] = useState<string[]>(COMMON_FONTS);
  const presets = getLabelPresets();

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

  // A colour session spans one visit to a picker: the label is repainted live on
  // every change, and the snapshot taken when the picker opened is what the
  // single undo entry reverts to.
  const colorSessionRef = useRef<LabelSnapshot | null>(null);
  const outlineSessionRef = useRef<LabelSnapshot | null>(null);
  const borderSessionRef = useRef<LabelSnapshot | null>(null);

  // A session normally commits on the picker's blur — but the click that ends
  // one is usually a click on the map, which changes the selection and unmounts
  // this panel in the same gesture. React's focusout is delegated from the root,
  // so it never reaches a handler whose element has already gone, and the change
  // stayed on the label with nothing on the undo stack. Flushing on the way out
  // catches exactly that: the panel is gone, but the reader still holds the
  // previewed colours and the session still holds what to undo back to.
  const flushSessionsRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    // Captured now, so the cleanup commits against the selection it belongs to
    // rather than whichever one replaced it.
    const flush = flushSessionsRef.current;
    return () => flush?.();
  }, [selection.areaId, selection.id]);

  useEffect(() => {
    const s = sceneRef.current?.reader.getLabelSnapshot(selection.areaId, selection.id);
    if (!textFocused.current) setTextDraft(s?.text ?? '');
    if (!widthFocused.current) setWidthDraft(String(s?.size[0] ?? 4));
    if (!heightFocused.current) setHeightDraft(String(s?.size[1] ?? 1));
    setBgAlphaDraft(s?.bgColor.alpha ?? 255);
    setOutlineAlphaDraft(s?.outlineColor?.alpha ?? 0);
    setBorderAlphaDraft(s?.border?.color.alpha ?? 255);
  }, [selection.id, selection.areaId, dataVersion]);

  if (!snap) return <div className="panel-content"><p className="hint">{t('label.notFound')}</p></div>;

  const current = () => sceneRef.current?.reader.getLabelSnapshot(selection.areaId, selection.id) ?? null;

  const pixmapCmd = (label: LabelSnapshot): Command[] => {
    const to = generateLabelPixmap(label);
    if (to === label.pixMap) return [];
    return [{ kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: label.pixMap, to }];
  };

  /**
   * Repaint the label in place, without touching the undo stack — the live
   * feedback half of a colour session. The matching commit records the change.
   */
  const preview = (next: LabelSnapshot) => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.reader.setLabelColors(selection.areaId, selection.id, next.fgColor, next.bgColor);
    scene.reader.setLabelOutlineColor(selection.areaId, selection.id, next.outlineColor);
    scene.reader.setLabelBorder(selection.areaId, selection.id, next.border);
    scene.reader.setLabelPixmap(selection.areaId, selection.id, generateLabelPixmap(next));
    scene.refresh();
  };

  /** Commit the end of a colour session as one undo entry against its origin snapshot. */
  const commitSession = (ref: React.RefObject<LabelSnapshot | null>, next: LabelSnapshot) => {
    const scene = sceneRef.current;
    const from = ref.current ?? snap;
    ref.current = null;
    if (!scene) return;
    const cmds = labelDiffCommands(selection.areaId, selection.id, from, next);
    if (cmds.length === 0) return;
    const pixMap = generateLabelPixmap(next);
    if (pixMap !== from.pixMap) {
      cmds.push({ kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: from.pixMap, to: pixMap });
    }
    pushBatch(cmds, scene);
    scene.refresh();
    store.bumpData();
  };

  flushSessionsRef.current = () => {
    const cur = current();
    if (!cur) return;
    for (const ref of [colorSessionRef, outlineSessionRef, borderSessionRef]) {
      if (ref.current) commitSession(ref, cur);
    }
  };

  const commitText = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const cur = current();
    if (!cur || textDraftRef.current === cur.text) return;
    const next = { ...cur, text: textDraftRef.current };
    pushBatch([{ kind: 'setLabelText', areaId: selection.areaId, id: selection.id, from: cur.text, to: next.text }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  const commitSize = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const cur = current();
    if (!cur) return;
    const w = parseFloat(widthDraftRef.current);
    const h = parseFloat(heightDraftRef.current);
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return;
    if (w === cur.size[0] && h === cur.size[1]) return;
    applySize(cur, [w, h]);
  };

  /** Resize the box and re-render the text at its unchanged font size. */
  const applySize = (cur: LabelSnapshot, size: [number, number]) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const next = { ...cur, size };
    pushBatch([{ kind: 'setLabelSize', areaId: selection.areaId, id: selection.id, from: cur.size, to: next.size }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  const startColorSession = () => { if (!colorSessionRef.current) colorSessionRef.current = snap; };
  const startOutlineSession = () => { if (!outlineSessionRef.current) outlineSessionRef.current = snap; };
  const startBorderSession = () => { if (!borderSessionRef.current) borderSessionRef.current = snap; };

  const commitNoScaling = (val: boolean) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur || cur.noScaling === val) return;
    pushCommand({ kind: 'setLabelNoScaling', areaId: selection.areaId, id: selection.id, from: cur.noScaling, to: val }, scene);
    scene.refresh();
    store.bumpData();
  };

  const commitShowOnTop = (val: boolean) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur || cur.showOnTop === val) return;
    pushCommand({ kind: 'setLabelShowOnTop', areaId: selection.areaId, id: selection.id, from: cur.showOnTop, to: val }, scene);
    scene.refresh();
    store.bumpData();
  };

  const commitStyle = (styleId: string) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur) return;
    const to = styleId === 'plain' ? undefined : styleId;
    if ((cur.styleId ?? undefined) === to) return;
    const next = { ...cur, styleId: to };
    pushBatch([{ kind: 'setLabelStyle', areaId: selection.areaId, id: selection.id, from: cur.styleId, to }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  const commitAlign = (align: LabelTextAlign) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur) return;
    const to = align === 'center' ? undefined : align;
    if ((cur.textAlign ?? undefined) === to) return;
    const next = { ...cur, textAlign: to };
    pushBatch([{ kind: 'setLabelAlign', areaId: selection.areaId, id: selection.id, from: cur.textAlign, to }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  const commitFont = (patch: Partial<LabelFont>) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur) return;
    const next: LabelFont = { ...cur.font, ...patch };
    pushBatch([{ kind: 'setLabelFont', areaId: selection.areaId, id: selection.id, from: cur.font, to: next }, ...pixmapCmd({ ...cur, font: next })], scene);
    scene.refresh();
    store.bumpData();
  };

  const commitPadding = (padding: LabelPadding) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur) return;
    // Stored collapsed when the axes agree; the two inputs stay on screen
    // regardless, because paddingSplit is what decides that.
    const to = normaliseLabelPadding(padding);
    if (labelPaddingEq(cur.padding, to)) return;
    const next = { ...cur, padding: to };
    pushBatch([{ kind: 'setLabelPadding', areaId: selection.areaId, id: selection.id, from: cur.padding, to }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  /** Write one axis, leaving the other where it is. */
  const commitPaddingAxis = (axis: 'x' | 'y', value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    const cur = current();
    if (!cur) return;
    const { x, y } = resolveLabelPadding(cur);
    commitPadding(axis === 'x' ? [value, y] : [x, value]);
  };

  const commitBorder = (border: LabelBorder | undefined) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur) return;
    const next = { ...cur, border };
    pushBatch([{ kind: 'setLabelBorder', areaId: selection.areaId, id: selection.id, from: cur.border, to: border }, ...pixmapCmd(next)], scene);
    scene.refresh();
    store.bumpData();
  };

  const commitOutlineColor = (newColor: MudletColor | undefined) => {
    const from = outlineSessionRef.current ?? snap;
    if (outlineEq(from.outlineColor, newColor)) { outlineSessionRef.current = null; return; }
    const cur = current();
    if (!cur) { outlineSessionRef.current = null; return; }
    commitSession(outlineSessionRef, { ...cur, outlineColor: newColor });
  };

  /** Size the box to the text it holds, keeping the font size and padding. */
  const handleFitToText = () => {
    const cur = current();
    if (!cur || !cur.text) return;
    const size = labelSizeForText(cur);
    if (size[0] === cur.size[0] && size[1] === cur.size[1]) return;
    applySize(cur, size);
  };

  const handleFitFontSize = () => {
    const cur = current();
    if (!cur || !cur.text) return;
    const size = fontSizeToFit(cur);
    if (size === cur.font.size) return;
    commitFont({ size });
  };

  const handleApplyPreset = (preset: LabelPreset) => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur) return;
    store.setState({ labelPresetId: preset.id });
    saveUserSettings({ labelPresetId: preset.id });
    const next = applyLabelPreset(cur, preset);
    const cmds = labelDiffCommands(selection.areaId, selection.id, cur, next);
    cmds.push(...pixmapCmd(next));
    if (cmds.length === 0) return;
    pushBatch(cmds, scene);
    scene.refresh();
    store.bumpData();
  };

  const handleRegeneratePixmap = () => {
    const scene = sceneRef.current;
    const cur = current();
    if (!scene || !cur) return;
    const to = generateLabelPixmap(cur);
    if (to === cur.pixMap) return;
    pushCommand({ kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: cur.pixMap, to }, scene);
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
          const cur = current();
          if (!scene || !cur) return;
          const w = Math.max(0.1, Math.round((img.naturalWidth / PX_PER_UNIT) * 100) / 100);
          const h = Math.max(0.1, Math.round((img.naturalHeight / PX_PER_UNIT) * 100) / 100);
          const cmds: Command[] = [
            { kind: 'setLabelImageSrc', areaId: selection.areaId, id: selection.id, from: cur.imageSrc, to: dataUrl },
            { kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: cur.pixMap, to: dataUrl },
            { kind: 'setLabelSize', areaId: selection.areaId, id: selection.id, from: cur.size, to: [w, h] },
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
    const cur = current();
    if (!scene || !cur || !cur.imageSrc) return;
    const regenerated = generateLabelPixmap(cur);
    const cmds: Command[] = [
      { kind: 'setLabelImageSrc', areaId: selection.areaId, id: selection.id, from: cur.imageSrc, to: undefined },
      { kind: 'setLabelPixmap', areaId: selection.areaId, id: selection.id, from: cur.pixMap, to: regenerated },
    ];
    pushBatch(cmds, scene);
    scene.refresh();
    store.setState({ labelAspectRatioLocked: false });
    store.bumpData();
  };

  const isImageMode = !!snap.imageSrc;
  const resolvedPadding = resolveLabelPadding(snap);
  const paddingKey = `${resolvedPadding.x}-${resolvedPadding.y}`;
  const fgHex = mudletColorToHex(snap.fgColor);
  const bgHex = mudletColorToHex(snap.bgColor);
  const outlineBase = snap.outlineColor ?? { spec: 1, r: 0, g: 0, b: 0, alpha: 0, pad: 0 };
  const outlineHex = mudletColorToHex(outlineBase);
  const borderColor = snap.border?.color ?? snap.fgColor;
  const borderHex = mudletColorToHex(borderColor);

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
      <h3>{t('label.heading', { id: selection.id })}</h3>
      {labelWarnings.length > 0 && (
        <div className="warnings-list">
          {labelWarnings.map((w, i) => (
            <div key={i} className="warning-row">
              <span className="warning-icon">⚠</span>
              <span className="warning-text">
                <span className="warning-detail">{t('label.zeroSizeWarning')}</span>
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
              >{t('label.ack')}</button>
            </div>
          ))}
        </div>
      )}
      <p className="hint" style={{ marginBottom: 8 }}>
        {t('label.position', { x: snap.pos[0], y: snap.pos[1], z: snap.pos[2] })}
      </p>

      <div style={{ display: 'flex', marginBottom: 10, border: '1px solid var(--border, #444)', borderRadius: 4, overflow: 'hidden' }}>
        <button style={modeBtnStyle(!isImageMode)} onClick={() => { if (isImageMode) handleClearImage(); }}>
          {t('label.modeText')}
        </button>
        <button style={{ ...modeBtnStyle(isImageMode), borderLeft: '1px solid var(--border, #444)' }} onClick={() => { if (!isImageMode) handleSetImage(); }}>
          {t('label.modeImage')}
        </button>
      </div>

      {!isImageMode && presets.length > 0 && (
        <PresetRow
          presets={presets}
          activeId={labelPresetId}
          onApply={handleApplyPreset}
          onClear={() => { store.setState({ labelPresetId: null }); saveUserSettings({ labelPresetId: null }); }}
        />
      )}

      <div className="field-row">
        <Field label={t('label.width')}>
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
        <Field label={t('label.height')}>
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
          title={aspectRatioLocked ? t('label.aspectLocked') : t('label.aspectFree')}
          onClick={() => store.setState({ labelAspectRatioLocked: !aspectRatioLocked })}
          style={{
            background: aspectRatioLocked ? 'var(--accent, #00e5ff)' : 'var(--bg2, #2a2a2a)',
            color: aspectRatioLocked ? '#000' : 'inherit',
          }}
        >
          {aspectRatioLocked ? t('label.arLocked') : t('label.arFree')}
        </button>
      </div>

      {!isImageMode && (
        <div className="field-row">
          <Field label={t('label.paddingX')}>
            <input
              type="number"
              min={0}
              step={1}
              title={t('label.paddingXTitle')}
              defaultValue={resolveLabelPadding(snap).x}
              key={`padding-x-${selection.id}-${paddingKey}-${snap.font.size}`}
              onBlur={(e) => commitPaddingAxis('x', parseInt(e.target.value, 10))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              style={{ width: 70 }}
            />
          </Field>
          <Field label={t('label.paddingY')}>
            <input
              type="number"
              min={0}
              step={1}
              title={t('label.paddingYTitle')}
              defaultValue={resolveLabelPadding(snap).y}
              key={`padding-y-${selection.id}-${paddingKey}-${snap.font.size}`}
              onBlur={(e) => commitPaddingAxis('y', parseInt(e.target.value, 10))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              style={{ width: 70 }}
            />
          </Field>
          <button title={t('label.fitToTextTitle')} onClick={handleFitToText} disabled={!snap.text}>
            {t('label.fitToText')}
          </button>
        </div>
      )}

      <CheckboxField
        checked={snap.showOnTop}
        onChange={commitShowOnTop}
        description={t('label.showOnTop')}
      />
      <CheckboxField
        checked={!snap.noScaling}
        onChange={(v) => commitNoScaling(!v)}
        description={t('label.scaleWithZoom')}
      />

      {isImageMode && (
        <Field label={t('label.image')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <img
              src={snap.imageSrc}
              alt="label image"
              style={{ maxWidth: '100%', border: '1px solid var(--border, #444)', borderRadius: 3 }}
            />
            <button onClick={handleSetImage} style={{ alignSelf: 'flex-start' }}>
              {t('label.replaceImage')}
            </button>
          </div>
        </Field>
      )}

      {!isImageMode && <>
        <Field label={t('label.text')}>
          <textarea
            value={textDraft}
            rows={3}
            onChange={(e) => setTextDraft(e.target.value)}
            onFocus={() => { textFocused.current = true; }}
            onBlur={() => { textFocused.current = false; commitText(); }}
            style={{ resize: 'vertical' }}
          />
        </Field>

        <Field label={t('label.style')}>
          <select
            value={snap.styleId ?? 'plain'}
            onChange={(e) => commitStyle(e.target.value)}
            style={{ flex: 1 }}
          >
            {getLabelStyles().map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={t('label.textColor')} as="div">
            <ColorSwatch
              color={fgHex}
              onActivate={startColorSession}
              inputKey={`fg-${selection.id}-${fgHex}`}
              inputProps={{
                defaultValue: fgHex,
                // Live while the picker is open; the undo entry lands on close.
                onChange: (e) => { startColorSession(); preview({ ...snap, fgColor: hexToMudletColor((e.target as HTMLInputElement).value) }); },
                onBlur: (e) => {
                  const cur = current();
                  if (cur) commitSession(colorSessionRef, { ...cur, fgColor: hexToMudletColor((e.target as HTMLInputElement).value) });
                },
              }}
            />
          </Field>
          <Field label={t('label.bgColor')} as="div">
            <ColorSwatch
              color={bgHex}
              onActivate={startColorSession}
              inputKey={`bg-${selection.id}-${bgHex}`}
              inputProps={{
                defaultValue: bgHex,
                onChange: (e) => {
                  startColorSession();
                  preview({ ...snap, bgColor: { ...hexToMudletColor((e.target as HTMLInputElement).value), alpha: snap.bgColor.alpha } });
                },
                onBlur: (e) => {
                  const cur = current();
                  if (cur) commitSession(colorSessionRef, { ...cur, bgColor: { ...hexToMudletColor((e.target as HTMLInputElement).value), alpha: cur.bgColor.alpha } });
                },
              }}
            />
          </Field>
        </div>

        <Field label={t('label.bgAlpha')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={bgAlphaDraft}
              style={{ flex: 1 }}
              onPointerDown={startColorSession}
              onChange={(e) => {
                const alpha = parseInt(e.target.value, 10);
                startColorSession();
                setBgAlphaDraft(alpha);
                preview({ ...snap, bgColor: { ...snap.bgColor, alpha } });
              }}
              onPointerUp={(e) => {
                const cur = current();
                if (cur) commitSession(colorSessionRef, { ...cur, bgColor: { ...cur.bgColor, alpha: parseInt((e.target as HTMLInputElement).value, 10) } });
              }}
              onBlur={(e) => {
                const cur = current();
                if (cur) commitSession(colorSessionRef, { ...cur, bgColor: { ...cur.bgColor, alpha: parseInt(e.target.value, 10) } });
              }}
            />
            <span style={{ minWidth: 28, textAlign: 'right', fontSize: 12, opacity: 0.7 }}>
              {bgAlphaDraft}
            </span>
          </div>
        </Field>

        <Field label={t('label.font')} as="div">
          <FontPicker
            value={snap.font.family}
            options={availableFonts}
            onChange={(family) => commitFont({ family })}
            searchPlaceholder={t('label.fontSearchPlaceholder')}
          />
        </Field>

        <Field label={t('label.size')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
              title={t('label.autoFitTitle')}
              onClick={handleFitFontSize}
              style={{ height: 24, padding: '0 6px', fontSize: 12, border: '1px solid var(--border, #444)', borderRadius: 3, cursor: 'pointer', background: 'var(--bg2, #2a2a2a)', whiteSpace: 'nowrap' }}
            >
              {t('label.autoFit')}
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
            <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid var(--border, #444)', paddingLeft: 8 }}>
              {(['left', 'center', 'right'] as const).map((value) => {
                const active = (snap.textAlign ?? 'center') === value;
                const title = value === 'left' ? t('label.alignLeft') : value === 'right' ? t('label.alignRight') : t('label.alignCenter');
                return (
                  <button
                    key={value}
                    title={title}
                    onClick={() => commitAlign(value)}
                    style={{
                      width: 24, height: 24, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: active ? 'var(--accent, #00e5ff)' : 'var(--bg2, #2a2a2a)',
                      color: active ? '#000' : 'inherit',
                      border: '1px solid var(--border, #444)',
                      borderRadius: 3, cursor: 'pointer',
                    }}
                  >
                    <AlignIcon align={value} />
                  </button>
                );
              })}
            </div>
          </div>
        </Field>

        <Field label={t('label.outlineColor')} as="div">
          <ColorSwatch
            color={outlineHex}
            empty={snap.outlineColor === undefined}
            onActivate={startOutlineSession}
            inputKey={`outline-${selection.id}-${outlineHex}`}
            inputProps={{
              defaultValue: outlineHex,
              onChange: (e) => {
                startOutlineSession();
                const alpha = snap.outlineColor?.alpha || 255;
                preview({ ...snap, outlineColor: { ...outlineBase, ...hexToMudletColor((e.target as HTMLInputElement).value), alpha } });
              },
              onBlur: (e) => {
                const alpha = snap.outlineColor?.alpha || 255;
                commitOutlineColor({ ...outlineBase, ...hexToMudletColor((e.target as HTMLInputElement).value), alpha });
              },
            }}
          />
        </Field>

        <Field label={t('label.outlineAlpha')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={outlineAlphaDraft}
              style={{ flex: 1 }}
              onPointerDown={startOutlineSession}
              onChange={(e) => {
                const alpha = parseInt(e.target.value, 10);
                startOutlineSession();
                setOutlineAlphaDraft(alpha);
                preview({ ...snap, outlineColor: alpha === 0 ? undefined : { ...outlineBase, alpha } });
              }}
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

        <CheckboxField
          checked={!!snap.border}
          onChange={(on) => commitBorder(on ? { width: defaultBorderWidth(snap), color: { ...snap.fgColor } } : undefined)}
          description={t('label.border')}
        />

        {snap.border && <>
          <div className="field-row">
            <Field label={t('label.borderWidth')}>
              <input
                type="number"
                min={1}
                step={1}
                defaultValue={snap.border.width}
                key={`border-width-${selection.id}-${snap.border.width}`}
                onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) commitBorder({ ...snap.border!, width: v }); }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                style={{ width: 70 }}
              />
            </Field>
            <Field label={t('label.borderColor')} as="div">
              <ColorSwatch
                color={borderHex}
                onActivate={startBorderSession}
                inputKey={`border-${selection.id}-${borderHex}`}
                inputProps={{
                  defaultValue: borderHex,
                  onChange: (e) => {
                    startBorderSession();
                    preview({ ...snap, border: { ...snap.border!, color: { ...borderColor, ...hexToMudletColor((e.target as HTMLInputElement).value) } } });
                  },
                  onBlur: (e) => {
                    const cur = current();
                    if (cur?.border) {
                      commitSession(borderSessionRef, { ...cur, border: { ...cur.border, color: { ...cur.border.color, ...hexToMudletColor((e.target as HTMLInputElement).value) } } });
                    }
                  },
                }}
              />
            </Field>
          </div>

          <Field label={t('label.borderAlpha')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <input
                type="range"
                min={0}
                max={255}
                step={1}
                value={borderAlphaDraft}
                style={{ flex: 1 }}
                onPointerDown={startBorderSession}
                onChange={(e) => {
                  const alpha = parseInt(e.target.value, 10);
                  startBorderSession();
                  setBorderAlphaDraft(alpha);
                  preview({ ...snap, border: { ...snap.border!, color: { ...borderColor, alpha } } });
                }}
                onPointerUp={(e) => {
                  const cur = current();
                  const alpha = parseInt((e.target as HTMLInputElement).value, 10);
                  if (cur?.border) commitSession(borderSessionRef, { ...cur, border: { ...cur.border, color: { ...cur.border.color, alpha } } });
                }}
                onBlur={(e) => {
                  const cur = current();
                  const alpha = parseInt(e.target.value, 10);
                  if (cur?.border) commitSession(borderSessionRef, { ...cur, border: { ...cur.border, color: { ...cur.border.color, alpha } } });
                }}
              />
              <span style={{ minWidth: 28, textAlign: 'right', fontSize: 12, opacity: 0.7 }}>
                {borderAlphaDraft}
              </span>
            </div>
          </Field>
        </>}

        <Field label={t('label.pixmap')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            {snap.pixMap ? (
              <img
                src={snap.pixMap}
                alt="label pixmap"
                style={{ maxWidth: '100%', border: '1px solid var(--border, #444)', borderRadius: 3 }}
              />
            ) : (
              <span className="hint">{t('label.noPixmap')}</span>
            )}
            <button onClick={handleRegeneratePixmap} style={{ alignSelf: 'flex-start' }}>
              {t('label.regeneratePixmap')}
            </button>
          </div>
        </Field>
      </>}
    </div>
  );
}
