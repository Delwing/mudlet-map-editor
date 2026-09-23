import type { MudletColor } from '../mapIO';
import type { LabelFont, LabelSnapshot, LabelStyleParamValue, LabelStyleParams } from './types';
import { inkBlockHeight, middleBaselineInkOffset } from './labelPixmap';

/** Distance in pixmap px from each edge of the label box. */
export interface LabelInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Drawing context handed to a {@link LabelStyle} hook. It exposes the live
 * 2D canvas context (already DPR-scaled, so draw in logical px), the label
 * rect, the label snapshot, the (possibly transformed) text, the style's own
 * settings, and the built-in rendering of every stage for a style to reuse.
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
  /** The style's settings for this label, every declared param filled in (defaults included). */
  params: Readonly<LabelStyleParams>;
  /** Where text may go: padding, border and the style's `contentInsets`, per edge. */
  box: LabelInsets;
  /** Inset to keep text clear of, per axis — padding plus border. Kept for older
   *  styles; `box` also carries `contentInsets` and differs per edge. */
  padding: { x: number; y: number };
  /** Border stroke width that actually paints, 0 when the label has none. */
  borderWidth: number;
  /** The built-in rendering of each stage, to call before, after or instead of your own. */
  default: {
    /** Fill the whole rect with the label's background colour. */
    background(): void;
    /** The built-in multi-line text layout inside `box` (font, outline, underline/strikeout). */
    text(): void;
    /** Stroke the label's border flush inside the rect. */
    border(): void;
  };
  /** Same as `default.text()`. */
  defaultDrawText(): void;
  /** Convert a Mudlet color to a CSS `rgba()` string. */
  colorToCss(c: MudletColor): string;
}

/** Context for {@link LabelStyle.contentInsets}: the box, not yet drawn. */
export interface LabelLayoutContext {
  label: LabelSnapshot;
  params: Readonly<LabelStyleParams>;
  /** Box width in pixmap px. */
  width: number;
  /** Box height in pixmap px. */
  height: number;
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
  /** The style's settings for this label, defaults included. */
  params: Readonly<LabelStyleParams>;
  /** CSS `font` shorthand for the label's font at a given size. */
  fontString(font: LabelFont, size?: number): string;
  /** Size of the text under the built-in layout. */
  defaultMeasure(): { width: number; height: number };
}

/**
 * One setting a style declares for itself. The label panel builds a control
 * for each, the label stores the values (`LabelSnapshot.styleParams`), and the
 * draw hooks read them back, defaults filled in, as `c.params`.
 */
export type LabelStyleParam = { id: string; name: string } & (
  | { type: 'enum'; options: { value: string; name: string }[]; default: string }
  | { type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { type: 'bool'; default: boolean }
  /** '#rrggbb'. */
  | { type: 'color'; default: string }
);

/** Label-panel controls a style can switch off when it draws that part its own way. */
export type LabelStyleControl = 'background' | 'outline' | 'border' | 'padding' | 'align';

/**
 * A registered label appearance. Plugins contribute these via the
 * `labelStyles()` plugin hook; the label stores the chosen style by `id`.
 *
 * A style can own the whole label: every stage is a hook, and the built-in
 * rendering of each is on `c.default`, so a style decides stage by stage
 * whether to reuse it, wrap it or skip it. Every hook is optional — an omitted
 * stage renders the default way. The draw order is:
 *   transformText → drawBackground → drawText → decorate → drawBorder
 */
export interface LabelStyle {
  /** Stable id persisted on the label and in area userData. */
  id: string;
  /** Human-readable name shown in the label panel's style dropdown. */
  name: string;
  /** The style's own settings, shown in the label panel under the style. */
  params?: LabelStyleParam[];
  /** Panel controls this style has no use for; `false` hides one. Everything shows by default. */
  uses?: Partial<Record<LabelStyleControl, boolean>>;
  /** Transform the raw text before layout (e.g. UPPERCASE). */
  transformText?(text: string, label: LabelSnapshot, params: Readonly<LabelStyleParams>): string;
  /** Extra room text keeps off each edge, on top of padding and border — the
   *  run of a slanted side, a ribbon's notch. Honoured by the built-in text
   *  layout, by "fit to text" and by "auto-fit". Fitting sizes the height first,
   *  so side insets may follow the height; keep top/bottom independent of the
   *  width, or fitting only approximates them. */
  contentInsets?(c: LabelLayoutContext): Partial<LabelInsets>;
  /** Replace the default background fill. When omitted, the label bg color fills the rect. */
  drawBackground?(c: LabelDrawContext): void;
  /** Draw the text. Return `true` to fully replace the built-in layout; otherwise the default runs. */
  drawText?(c: LabelDrawContext): boolean | void;
  /** Final pass drawn on top of background + text — glow, shadow, ornaments, etc. */
  decorate?(c: LabelDrawContext): void;
  /** Replace the border stroke — e.g. to follow a shape the background drew. Runs
   *  whether or not the label has a border; `c.borderWidth` is 0 when it has none. */
  drawBorder?(c: LabelDrawContext): void;
  /** Measure the laid-out text. Needed only by styles whose `drawText` lays text
   *  out differently from the built-in, so sizing to the text stays accurate. */
  measureText?(c: LabelMeasureContext): { width: number; height: number };
}

function paramValueFits(param: LabelStyleParam, value: LabelStyleParamValue | undefined): boolean {
  switch (param.type) {
    case 'enum': return typeof value === 'string' && param.options.some((o) => o.value === value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'bool': return typeof value === 'boolean';
    case 'color': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  }
}

/**
 * A label's settings for its style, every declared param present: the label's
 * own value where it holds a usable one, the param's default otherwise. Values
 * for params the style doesn't declare are passed through untouched.
 */
export function resolveStyleParams(style: LabelStyle, label: LabelSnapshot): LabelStyleParams {
  const out: LabelStyleParams = { ...label.styleParams };
  for (const p of style.params ?? []) {
    const v = out[p.id];
    if (!paramValueFits(p, v)) { out[p.id] = p.default; continue; }
    if (p.type === 'number') out[p.id] = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v as number));
  }
  return out;
}

/** Whether a style shows a given label-panel control. */
export function styleUses(style: LabelStyle, control: LabelStyleControl): boolean {
  return style.uses?.[control] !== false;
}

/** The built-in default: plain text, no extra styling. Equivalent to no style. */
export const PLAIN_STYLE: LabelStyle = { id: 'plain', name: 'Plain' };

/** Per-glyph sizing used by {@link CAPS_BIG_INITIALS_STYLE}: the first *letter*
 *  of every word keeps the label's font size, the rest shrink.
 *
 *  Two things never take the enlargement. Anything a word opens with that is
 *  not a letter — a bracket, a quote, a dash, a digit — stays small and passes
 *  the initial along to the letter behind it. And a bracketed aside is left
 *  alone entirely: "(WYSPA)" is an annotation on the name rather than a name,
 *  so nothing inside the brackets is enlarged. The word after the closing
 *  bracket starts fresh. */
function capsSegments(line: string, bigSize: number, smallSize: number): { ch: string; size: number }[] {
  const segs: { ch: string; size: number }[] = [];
  let wantInitial = true;
  let depth = 0;
  for (const ch of line) {
    if (ch === '(') { depth++; segs.push({ ch, size: smallSize }); continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); wantInitial = true; segs.push({ ch, size: smallSize }); continue; }
    if (/\s/.test(ch)) { wantInitial = true; segs.push({ ch, size: smallSize }); continue; }
    // Inside brackets nothing grows, and the pending initial is left intact so
    // the word carrying the aside can still claim it afterwards.
    if (depth > 0) { segs.push({ ch, size: smallSize }); continue; }
    const isLetter = /\p{L}/u.test(ch);
    segs.push({ ch, size: wantInitial && isLetter ? bigSize : smallSize });
    if (isLetter) wantInitial = false;
  }
  return segs;
}

/** Tallest size a line actually draws at — the big initial, unless nothing on
 *  the line claims one (no letters, or all of them bracketed) and it is drawn
 *  entirely small. */
function capsLineMaxSize(line: string, bigSize: number, smallSize: number): number {
  return Math.max(smallSize, ...capsSegments(line, bigSize, smallSize).map((s) => s.size));
}

const capsSmallSize = (size: number) => Math.max(1, Math.round(size / 1.7));

/**
 * Reference style: forces UPPERCASE and renders the first letter of every word
 * larger than the rest — the first letter, not the first character, and nothing
 * inside brackets, which are asides rather than names. Demonstrates a full `drawText` takeover (per-glyph
 * sizing, which the default all-or-nothing layout can't express) alongside
 * `transformText` and the matching `measureText`.
 */
const CAPS_BIG_INITIALS_STYLE: LabelStyle = {
  id: 'capsBigInitials',
  name: 'Caps + Big Initials',
  transformText: (text) => text.toUpperCase(),
  drawText(c) {
    const { ctx, width, height, label, text, box } = c;
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

    const lines = text.split('\n');
    const lineHeight = bigSize * 1.25;
    // Measured against the largest glyph on the line, which is what sets its ascent.
    ctx.font = fontStr(capsLineMaxSize(lines[0], bigSize, smallSize));
    const startY = box.top + (height - box.top - box.bottom - lines.length * lineHeight) / 2 + lineHeight / 2
      + middleBaselineInkOffset(ctx, lines[0], lines[lines.length - 1]);

    for (let i = 0; i < lines.length; i++) {
      const segs = capsSegments(lines[i], bigSize, smallSize);

      let lineW = 0;
      for (const s of segs) { ctx.font = fontStr(s.size); lineW += ctx.measureText(s.ch).width; }

      let x = align === 'left' ? box.left : align === 'right' ? width - box.right - lineW : box.left + (width - box.left - box.right - lineW) / 2;
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
    // Height off the largest glyph's ink, matching how the width follows the
    // glyphs — see inkBlockHeight.
    ctx.font = c.fontString(label.font, capsLineMaxSize(lines[0], bigSize, smallSize));
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

/** Whether two labels' style settings match; no settings and an empty set are the same. */
export function styleParamsEq(a: LabelStyleParams | undefined, b: LabelStyleParams | undefined): boolean {
  const ka = Object.keys(a ?? {}), kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => b !== undefined && a![k] === b[k]);
}
