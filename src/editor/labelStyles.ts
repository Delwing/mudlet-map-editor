import type { MudletColor } from '../mapIO';
import type { LabelFont, LabelSnapshot } from './types';
import { inkBlockHeight, middleBaselineInkOffset } from './labelPixmap';

/**
 * Drawing context handed to a {@link LabelStyle} hook. It exposes the live
 * 2D canvas context (already DPR-scaled, so draw in logical px), the label
 * rect, the label snapshot, the (possibly transformed) text, and helpers for
 * reusing the built-in rendering.
 */
export interface LabelDrawContext {
  /** DPR-scaled 2D context. Draw in logical pixels (0..width, 0..height). */
  ctx: CanvasRenderingContext2D;
  /** Logical width in px (label.size[0] × PX_PER_UNIT). */
  width: number;
  /** Logical height in px. */
  height: number;
  /** The label being rendered. */
  label: LabelSnapshot;
  /** Text after `transformText` has run (defaults to `label.text`). */
  text: string;
  /** Inset to keep text clear of on every side — the label's padding plus any border. */
  padding: number;
  /** Run the built-in centered multi-line text layout (font, outline, underline/strikeout). */
  defaultDrawText(): void;
  /** Convert a Mudlet color to a CSS `rgba()` string. */
  colorToCss(c: MudletColor): string;
}

/**
 * Context for {@link LabelStyle.measureText} — the metrics counterpart of
 * {@link LabelDrawContext}, used by "fit to text" and "auto-fit font size".
 */
export interface LabelMeasureContext {
  /** Scratch 2D context for `measureText`; nothing drawn on it is shown. */
  ctx: CanvasRenderingContext2D;
  /** The label being measured. */
  label: LabelSnapshot;
  /** Text after `transformText` has run. */
  text: string;
  /** CSS `font` shorthand for the label's font at a given size. */
  fontString(font: LabelFont, size?: number): string;
  /** Size of the text under the built-in layout. */
  defaultMeasure(): { width: number; height: number };
}

/**
 * A registered label appearance. Plugins contribute these via the
 * `labelStyles()` plugin hook; the label stores the chosen style by `id`.
 *
 * Every hook is optional — omitted stages fall back to the default rendering,
 * so a style only overrides what it cares about. The draw order is:
 *   transformText → drawBackground → drawText → decorate
 * The label's border, being a label property rather than part of a style, is
 * stroked after all of them.
 */
export interface LabelStyle {
  /** Stable id persisted on the label and in area userData. */
  id: string;
  /** Human-readable name shown in the label panel's style dropdown. */
  name: string;
  /** Transform the raw text before layout (e.g. UPPERCASE). */
  transformText?(text: string, label: LabelSnapshot): string;
  /** Replace the default background fill. When omitted, the label bg color fills the rect. */
  drawBackground?(c: LabelDrawContext): void;
  /** Draw the text. Return `true` to fully replace the built-in layout; otherwise the default runs. */
  drawText?(c: LabelDrawContext): boolean | void;
  /** Final pass drawn on top of background + text — glow, shadow, ornaments, etc. */
  decorate?(c: LabelDrawContext): void;
  /** Measure the laid-out text. Needed only by styles whose `drawText` lays text
   *  out differently from the built-in, so sizing to the text stays accurate. */
  measureText?(c: LabelMeasureContext): { width: number; height: number };
}

/** The built-in default: plain text, no extra styling. Equivalent to no style. */
export const PLAIN_STYLE: LabelStyle = { id: 'plain', name: 'Plain' };

/** Per-glyph sizing used by {@link CAPS_BIG_INITIALS_STYLE}: the first glyph of
 *  every word keeps the label's font size, the rest shrink. */
function capsSegments(line: string, bigSize: number, smallSize: number): { ch: string; size: number }[] {
  const segs: { ch: string; size: number }[] = [];
  let atWordStart = true;
  for (const ch of line) {
    if (ch === ' ') { atWordStart = true; segs.push({ ch, size: smallSize }); continue; }
    segs.push({ ch, size: atWordStart ? bigSize : smallSize });
    atWordStart = false;
  }
  return segs;
}

const capsSmallSize = (size: number) => Math.max(1, Math.round(size / 1.7));

/**
 * Reference style: forces UPPERCASE and renders the first letter of every word
 * larger than the rest. Demonstrates a full `drawText` takeover (per-glyph
 * sizing, which the default all-or-nothing layout can't express) alongside
 * `transformText` and the matching `measureText`.
 */
const CAPS_BIG_INITIALS_STYLE: LabelStyle = {
  id: 'capsBigInitials',
  name: 'Caps + Big Initials',
  transformText: (text) => text.toUpperCase(),
  drawText(c) {
    const { ctx, width, height, label, text } = c;
    const { font } = label;
    const bigSize = font.size;
    const smallSize = capsSmallSize(font.size);
    const fontStr = (size: number) => [
      font.italic ? 'italic' : '',
      font.bold ? 'bold' : '',
      `${size}px`,
      `"${font.family}", sans-serif`,
    ].filter(Boolean).join(' ');

    const fill = c.colorToCss(label.fgColor);
    const hasOutline = !!label.outlineColor && label.outlineColor.alpha > 0;
    const outline = hasOutline ? c.colorToCss(label.outlineColor!) : '';

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const align = label.textAlign ?? 'center';
    const pad = c.padding;

    const lines = text.split('\n');
    const lineHeight = bigSize * 1.25;
    // Measured against the big initial, which is what sets each line's ascent.
    ctx.font = fontStr(bigSize);
    const startY = (height - lines.length * lineHeight) / 2 + lineHeight / 2
      + middleBaselineInkOffset(ctx, lines[0], lines[lines.length - 1]);

    for (let i = 0; i < lines.length; i++) {
      const segs = capsSegments(lines[i], bigSize, smallSize);

      let lineW = 0;
      for (const s of segs) { ctx.font = fontStr(s.size); lineW += ctx.measureText(s.ch).width; }

      let x = align === 'left' ? pad : align === 'right' ? width - pad - lineW : (width - lineW) / 2;
      const lineCenter = startY + i * lineHeight;
      for (const s of segs) {
        ctx.font = fontStr(s.size);
        const w = ctx.measureText(s.ch).width;
        // Halfway between pure middle-centering and a shared baseline: smaller
        // glyphs drop partway toward the big initials' baseline instead of
        // staying centered on the same midline.
        const y = lineCenter + (bigSize - s.size) * 0.16;
        if (hasOutline) {
          ctx.strokeStyle = outline;
          ctx.lineWidth = Math.max(1, s.size / 12);
          ctx.lineJoin = 'round';
          ctx.strokeText(s.ch, x, y);
        }
        ctx.fillStyle = fill;
        ctx.fillText(s.ch, x, y);
        x += w;
      }
    }
    return true;
  },
  measureText(c) {
    const { ctx, label, text } = c;
    if (!text) return { width: 0, height: 0 };
    const bigSize = label.font.size;
    const smallSize = capsSmallSize(bigSize);
    const lines = text.split('\n');
    let width = 0;
    for (const line of lines) {
      let lineW = 0;
      for (const s of capsSegments(line, bigSize, smallSize)) {
        ctx.font = c.fontString(label.font, s.size);
        lineW += ctx.measureText(s.ch).width;
      }
      width = Math.max(width, lineW);
    }
    // Height off the big initial's ink, matching how the width follows the
    // glyphs — see inkBlockHeight.
    ctx.font = c.fontString(label.font, bigSize);
    return { width, height: inkBlockHeight(ctx, lines, bigSize * 1.25) };
  },
};

const BUILT_IN: LabelStyle[] = [PLAIN_STYLE, CAPS_BIG_INITIALS_STYLE];

let registry: LabelStyle[] = BUILT_IN;

/**
 * Replace the plugin-contributed styles. Built-ins always come first; plugin
 * styles are appended. A plugin may override a built-in by reusing its id —
 * lookup returns the last match.
 */
export function registerLabelStyles(styles: LabelStyle[]): void {
  registry = [...BUILT_IN, ...styles];
}

/** All registered styles (built-ins first), for populating UI. */
export function getLabelStyles(): LabelStyle[] {
  return registry;
}

/** Resolve a style by id, falling back to {@link PLAIN_STYLE}. Last match wins so plugins can override built-ins. */
export function getLabelStyle(id: string | undefined): LabelStyle {
  if (!id) return PLAIN_STYLE;
  for (let i = registry.length - 1; i >= 0; i--) {
    if (registry[i].id === id) return registry[i];
  }
  return PLAIN_STYLE;
}
