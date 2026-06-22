import { Buffer } from 'buffer';
import type { LabelSnapshot } from './types';
import { getLabelStyle, type LabelDrawContext } from './labelStyles';

const PX_PER_UNIT = 64;

function mudletColorToCss(c: { r: number; g: number; b: number; alpha: number }): string {
  return `rgba(${c.r},${c.g},${c.b},${(c.alpha / 255).toFixed(3)})`;
}

/**
 * Built-in text layout: centered horizontally and vertically, multi-line split
 * on '\n', with manual underline/strikeout so they work across all browsers.
 * Exposed to styles via `LabelDrawContext.defaultDrawText`.
 */
function drawDefaultText(ctx: CanvasRenderingContext2D, label: LabelSnapshot, text: string, pw: number, ph: number): void {
  if (!text) return;
  const { font } = label;
  ctx.font = [
    font.italic ? 'italic' : '',
    font.bold ? 'bold' : '',
    `${font.size}px`,
    `"${font.family}", sans-serif`,
  ].filter(Boolean).join(' ');
  ctx.fillStyle = mudletColorToCss(label.fgColor);
  ctx.textBaseline = 'middle';

  const align = label.textAlign ?? 'center';
  // Edge padding so left/right text isn't flush against the border.
  const pad = align === 'center' ? 0 : Math.max(2, Math.round(font.size * 0.2));
  const maxW = Math.max(1, pw - pad * 2);
  const anchorX = align === 'left' ? pad : align === 'right' ? pw - pad : pw / 2;
  ctx.textAlign = align;

  const lines = text.split('\n');
  const lineHeight = font.size * 1.25;
  const totalTextH = lines.length * lineHeight;
  const startY = (ph - totalTextH) / 2 + lineHeight / 2;

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

/**
 * Render a label into an offscreen canvas sized to label.size (in map units
 * × PX_PER_UNIT) and return a PNG data URL.
 *
 * The label's registered style (looked up by `label.styleId`) hooks into the
 * draw pipeline: transformText → drawBackground → drawText → decorate. Any
 * stage a style doesn't override falls back to the built-in behavior, so the
 * default ('plain' / no style) is byte-identical to the un-styled render.
 */
export function generateLabelPixmap(label: LabelSnapshot): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const pw = Math.max(1, Math.round(label.size[0] * PX_PER_UNIT));
  const ph = Math.max(1, Math.round(label.size[1] * PX_PER_UNIT));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = pw * dpr;
  canvas.height = ph * dpr;
  ctx.scale(dpr, dpr);

  const style = getLabelStyle(label.styleId);
  const text = style.transformText ? style.transformText(label.text, label) : label.text;

  const drawCtx: LabelDrawContext = {
    ctx,
    width: pw,
    height: ph,
    label,
    text,
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

  // Decoration runs last, even for empty text (e.g. a border on a blank label).
  style.decorate?.(drawCtx);

  return canvas.toDataURL('image/png');
}

/** Convert a PNG data URL to a Buffer for storage in the binary map. */
export function dataUrlToBuffer(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return base64 ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
}
