import { Buffer } from 'buffer';
import type { LabelPadding, LabelSnapshot } from './types';
import { getLabelStyle, type LabelDrawContext, type LabelMeasureContext } from './labelStyles';
import { resolveSupersample } from './labelPolicy';

export const PX_PER_UNIT = 64;

/**
 * Supersampling factor to actually use for a label — {@link LabelPolicy.supersample},
 * except for a `noScaling` label. Mudlet pins those to the pixmap's own pixel
 * size instead of scaling it into the label rect, so a larger pixmap there
 * means a larger label on screen rather than a sharper one; they stay at 1x
 * whatever the policy says. (That also fixes them under the default
 * `devicePixelRatio`, which used to make them come out oversized in Mudlet when
 * the map was edited on a hi-dpi screen.)
 */
function pixmapScale(label: LabelSnapshot): number {
  return label.noScaling ? 1 : resolveSupersample();
}

/** Line height used by the built-in text layout, as a multiple of the font size. */
export const LINE_HEIGHT_FACTOR = 1.25;

function mudletColorToCss(c: { r: number; g: number; b: number; alpha: number }): string {
  return `rgba(${c.r},${c.g},${c.b},${(c.alpha / 255).toFixed(3)})`;
}

/** CSS `font` shorthand for a label's font, optionally at another size. */
export function labelFontString(font: LabelSnapshot['font'], size = font.size): string {
  return [
    font.italic ? 'italic' : '',
    font.bold ? 'bold' : '',
    `${size}px`,
    `"${font.family}", sans-serif`,
  ].filter(Boolean).join(' ');
}

/**
 * Height of a block of text measured from its ink, not its em boxes.
 *
 * Widths already come from the glyphs, so measuring height off the em box —
 * which reserves ascender and descender room that caps, most label text, never
 * fills — is what makes a "fit to text" box read as having a bigger gap above
 * and below than at its sides. Interior line spacing stays on `lineHeight`;
 * only the first line's ascent and the last line's descent bound the block.
 *
 * Falls back to the em-box height where the browser reports no metrics.
 * `ctx.font` must already be set.
 */
export function inkBlockHeight(ctx: CanvasRenderingContext2D, lines: string[], lineHeight: number): number {
  const ascent = ctx.measureText(lines[0]).actualBoundingBoxAscent;
  const descent = ctx.measureText(lines[lines.length - 1]).actualBoundingBoxDescent;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return lines.length * lineHeight;
  return ascent + descent + (lines.length - 1) * lineHeight;
}

/**
 * How far down to nudge text drawn with `textBaseline: 'middle'` so that the
 * glyphs' ink ends up centred rather than the em square.
 *
 * 'middle' centres the em box, and that box reserves descender room which
 * caps-only text — most map labels — never fills, so the text reads as sitting
 * high with a visibly larger gap beneath it. `measureText` reports its bounding
 * box relative to the current baseline, so the correction is half the
 * difference between the ink above the anchor and the ink below it.
 *
 * `ctx.font` must already be the font the lines are drawn in; a caller mixing
 * sizes within a line should set the largest, which is what sets the ascent.
 * Returns 0 where the browser doesn't report the metrics.
 */
export function middleBaselineInkOffset(ctx: CanvasRenderingContext2D, firstLine: string, lastLine: string): number {
  const ascent = ctx.measureText(firstLine).actualBoundingBoxAscent;
  const descent = ctx.measureText(lastLine).actualBoundingBoxDescent;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return 0;
  return (ascent - descent) / 2;
}

/**
 * A label's padding in pixmap px, per axis. An explicit `label.padding` applies
 * to every alignment — a single value to both axes, a pair as
 * `[horizontal, vertical]`. Without one the historical behaviour stands:
 * centered text runs edge to edge, left/right text keeps a small gap off the
 * border.
 */
export function resolveLabelPadding(label: LabelSnapshot): { x: number; y: number } {
  const p = label.padding;
  if (p !== undefined) {
    const [x, y] = Array.isArray(p) ? p : [p, p];
    return { x: Math.max(0, x), y: Math.max(0, y) };
  }
  const auto = (label.textAlign ?? 'center') === 'center' ? 0 : Math.max(2, Math.round(label.font.size * 0.2));
  return { x: auto, y: auto };
}

/** Collapse a padding pair whose axes agree back to the single value. */
export function normaliseLabelPadding(padding: LabelPadding): LabelPadding {
  return Array.isArray(padding) && padding[0] === padding[1] ? padding[0] : padding;
}

/** Whether two paddings mean the same thing, a pair and its collapsed form included. */
export function labelPaddingEq(a: LabelPadding | undefined, b: LabelPadding | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const [ax, ay] = Array.isArray(a) ? a : [a, a];
  const [bx, by] = Array.isArray(b) ? b : [b, b];
  return ax === bx && ay === by;
}

/** Border thickness that actually paints, 0 when the label has no visible border. */
function visibleBorderWidth(label: LabelSnapshot): number {
  const b = label.border;
  return b && b.width > 0 && b.color.alpha > 0 ? b.width : 0;
}

/**
 * Built-in text layout: centered horizontally and vertically, multi-line split
 * on '\n', with manual underline/strikeout so they work across all browsers.
 * Exposed to styles via `LabelDrawContext.defaultDrawText`.
 */
function drawDefaultText(ctx: CanvasRenderingContext2D, label: LabelSnapshot, text: string, pw: number, ph: number): void {
  if (!text) return;
  const { font } = label;
  ctx.font = labelFontString(font);
  ctx.fillStyle = mudletColorToCss(label.fgColor);
  ctx.textBaseline = 'middle';

  const align = label.textAlign ?? 'center';
  const pad = resolveLabelPadding(label).x + visibleBorderWidth(label);
  const maxW = Math.max(1, pw - pad * 2);
  const anchorX = align === 'left' ? pad : align === 'right' ? pw - pad : pw / 2;
  ctx.textAlign = align;

  const lines = text.split('\n');
  const lineHeight = font.size * LINE_HEIGHT_FACTOR;
  const totalTextH = lines.length * lineHeight;
  const startY = (ph - totalTextH) / 2 + lineHeight / 2
    + middleBaselineInkOffset(ctx, lines[0], lines[lines.length - 1]);

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    if (label.outlineColor && label.outlineColor.alpha > 0) {
      ctx.strokeStyle = mudletColorToCss(label.outlineColor);
      ctx.lineWidth = Math.max(1, font.size / 12);
      ctx.lineJoin = 'round';
      ctx.strokeText(lines[i], anchorX, y, maxW);
    }
    ctx.fillText(lines[i], anchorX, y, maxW);

    if (font.underline || font.strikeout) {
      const lw = Math.min(ctx.measureText(lines[i]).width, maxW);
      const x0 = align === 'left' ? anchorX : align === 'right' ? anchorX - lw : anchorX - lw / 2;
      const x1 = x0 + lw;
      ctx.strokeStyle = mudletColorToCss(label.fgColor);
      ctx.lineWidth = Math.max(1, font.size / 14);
      if (font.underline) {
        const uy = y + font.size * 0.6;
        ctx.beginPath(); ctx.moveTo(x0, uy); ctx.lineTo(x1, uy); ctx.stroke();
      }
      if (font.strikeout) {
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      }
    }
  }
}

/** Stroke the label's border flush inside the rect, so no part of it clips. */
function drawBorder(ctx: CanvasRenderingContext2D, label: LabelSnapshot, pw: number, ph: number): void {
  const width = visibleBorderWidth(label);
  if (!width) return;
  const lw = Math.min(width, Math.min(pw, ph) / 2);
  ctx.strokeStyle = mudletColorToCss(label.border!.color);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'miter';
  ctx.strokeRect(lw / 2, lw / 2, Math.max(0, pw - lw), Math.max(0, ph - lw));
}

/**
 * Render a label into an offscreen canvas sized to label.size (in map units
 * × PX_PER_UNIT) and return a PNG data URL.
 *
 * The label's registered style (looked up by `label.styleId`) hooks into the
 * draw pipeline: transformText → drawBackground → drawText → decorate. Any
 * stage a style doesn't override falls back to the built-in behavior, so the
 * default ('plain' / no style) is byte-identical to the un-styled render.
 * The border is a label property rather than part of a style, so it is stroked
 * last and every style can carry one.
 */
export function generateLabelPixmap(label: LabelSnapshot): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const pw = Math.max(1, Math.round(label.size[0] * PX_PER_UNIT));
  const ph = Math.max(1, Math.round(label.size[1] * PX_PER_UNIT));
  // Everything below draws in nominal px; the scale transform is what turns
  // the whole render — font size, padding, border, outline — into a 2x one.
  const ss = pixmapScale(label);
  canvas.width = pw * ss;
  canvas.height = ph * ss;
  ctx.scale(ss, ss);

  const style = getLabelStyle(label.styleId);
  const text = style.transformText ? style.transformText(label.text, label) : label.text;

  const drawCtx: LabelDrawContext = {
    ctx,
    width: pw,
    height: ph,
    label,
    text,
    padding: (() => { const p = resolveLabelPadding(label), b = visibleBorderWidth(label); return { x: p.x + b, y: p.y + b }; })(),
    defaultDrawText: () => drawDefaultText(ctx, label, text, pw, ph),
    colorToCss: mudletColorToCss,
  };

  // Background — default fills the whole rect with the label bg color.
  if (style.drawBackground) {
    style.drawBackground(drawCtx);
  } else {
    ctx.fillStyle = mudletColorToCss(label.bgColor);
    ctx.fillRect(0, 0, pw, ph);
  }

  // Text — a style may fully take over by returning true from drawText.
  if (text) {
    const handled = style.drawText ? style.drawText(drawCtx) === true : false;
    if (!handled) drawDefaultText(ctx, label, text, pw, ph);
  }

  // Decoration runs last, even for empty text (e.g. a glow on a blank label).
  style.decorate?.(drawCtx);
  drawBorder(ctx, label, pw, ph);

  return canvas.toDataURL('image/png');
}

/**
 * Whether a label of this size can be re-rendered on every pointer-move of a
 * resize. Encoding the PNG dominates the cost, so past this many pixels the
 * live repaint is skipped and the pixmap is rebuilt once, on pointer-up. The
 * budget counts the pixels actually encoded, supersampling included.
 */
export function canRepaintLive(size: [number, number]): boolean {
  const ss = resolveSupersample();
  return size[0] * size[1] * PX_PER_UNIT * PX_PER_UNIT * ss * ss <= 1_200_000;
}

/** Scratch 2D context kept for text metrics; nothing is ever painted on it. */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/**
 * Size of a label's text block in pixmap px, ignoring the box it sits in.
 * Styles that lay text out themselves refine it through `measureText`.
 */
export function measureLabelText(label: LabelSnapshot): { width: number; height: number } {
  const ctx = getMeasureContext();
  if (!ctx) return { width: 0, height: 0 };
  const style = getLabelStyle(label.styleId);
  const text = style.transformText ? style.transformText(label.text, label) : label.text;

  const defaultMeasure = () => {
    if (!text) return { width: 0, height: 0 };
    ctx.font = labelFontString(label.font);
    const lines = text.split('\n');
    return {
      width: Math.max(...lines.map((l) => ctx.measureText(l).width)),
      height: inkBlockHeight(ctx, lines, label.font.size * LINE_HEIGHT_FACTOR),
    };
  };

  if (!style.measureText) return defaultMeasure();
  const c: LabelMeasureContext = { ctx, label, text, fontString: labelFontString, defaultMeasure };
  return style.measureText(c);
}

/**
 * Label box size (in map units) that exactly holds the current text plus its
 * padding and border — what the panel's "fit to text" writes.
 */
export function labelSizeForText(label: LabelSnapshot): [number, number] {
  const pad = resolveLabelPadding(label);
  const border = visibleBorderWidth(label);
  const { width, height } = measureLabelText(label);
  const toUnits = (px: number) => Math.max(0.1, Math.round((px / PX_PER_UNIT) * 100) / 100);
  return [toUnits(width + (pad.x + border) * 2), toUnits(height + (pad.y + border) * 2)];
}

/**
 * Largest font size whose text still fits the label's box, padding and border
 * included — what the panel's "auto-fit" writes.
 */
export function fontSizeToFit(label: LabelSnapshot): number {
  const ctx = getMeasureContext();
  if (!ctx || !label.text) return label.font.size;
  const pad = resolveLabelPadding(label);
  const border = visibleBorderWidth(label);
  const availW = Math.round(label.size[0] * PX_PER_UNIT) - (pad.x + border) * 2;
  const availH = Math.round(label.size[1] * PX_PER_UNIT) - (pad.y + border) * 2;
  if (availW <= 0 || availH <= 0) return label.font.size;

  const lineCount = label.text.split('\n').length;
  let lo = 1, hi = Math.floor(availH / (lineCount * LINE_HEIGHT_FACTOR)), result = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { width } = measureLabelText({ ...label, font: { ...label.font, size: mid } });
    if (width <= availW) { result = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return result;
}

/** Convert a PNG data URL to a Buffer for storage in the binary map. */
export function dataUrlToBuffer(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return base64 ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
}
