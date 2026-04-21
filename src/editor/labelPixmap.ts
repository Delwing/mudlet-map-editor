import type { LabelSnapshot } from './types';

const PX_PER_UNIT = 64;

function mudletColorToCss(c: { r: number; g: number; b: number; alpha: number }): string {
  return `rgba(${c.r},${c.g},${c.b},${(c.alpha / 255).toFixed(3)})`;
}

/**
 * Render a label into an offscreen canvas sized to label.size (in map units
 * × PX_PER_UNIT) and return a PNG data URL.
 *
 * The background fills the entire rect. Text is centered horizontally and
 * vertically. Multi-line text is split on '\n'. Font decorations (underline,
 * strikeout) are drawn manually so they work across all browsers.
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

  // Background
  ctx.fillStyle = mudletColorToCss(label.bgColor);
  ctx.fillRect(0, 0, pw, ph);

  if (!label.text) return canvas.toDataURL('image/png');

  const { font } = label;
  ctx.font = [
    font.italic ? 'italic' : '',
    font.bold ? 'bold' : '',
    `${font.size}px`,
    `"${font.family}", sans-serif`,
  ].filter(Boolean).join(' ');
  ctx.fillStyle = mudletColorToCss(label.fgColor);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const lines = label.text.split('\n');
  const lineHeight = font.size * 1.25;
  const totalTextH = lines.length * lineHeight;
  const startY = (ph - totalTextH) / 2 + lineHeight / 2;
  const cx = pw / 2;

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    if (label.outlineColor && label.outlineColor.alpha > 0) {
      ctx.strokeStyle = mudletColorToCss(label.outlineColor);
      ctx.lineWidth = Math.max(1, font.size / 12);
      ctx.lineJoin = 'round';
      ctx.strokeText(lines[i], cx, y, pw);
    }
    ctx.fillText(lines[i], cx, y, pw);

    if (font.underline || font.strikeout) {
      const lw = ctx.measureText(lines[i]).width;
      const x0 = cx - lw / 2;
      const x1 = cx + lw / 2;
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

  return canvas.toDataURL('image/png');
}

// Buffer is injected at runtime by vite-plugin-node-polyfills.
const Buf = (globalThis as any).Buffer as {
  from(data: string, encoding: string): Uint8Array;
  alloc(size: number): Uint8Array;
};

/** Convert a PNG data URL to a Buffer for storage in the binary map. */
export function dataUrlToBuffer(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return base64 ? Buf.from(base64, 'base64') : Buf.alloc(0);
}
