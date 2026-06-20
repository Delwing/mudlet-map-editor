/**
 * Editor-side helpers for the per-room flags Mudlet stores in `userData`:
 * hidden state, custom border colour and border thickness. The renderer (2.4.0+)
 * reads these same keys; we re-export its constants so the key strings live in
 * exactly one place, and add the inverse conversions the editor needs to write
 * them back in Mudlet's own format.
 *
 * Mudlet keeps these in userData (rather than typed binary fields) so older map
 * files stay forward-compatible — the binary writer does not carry them yet, so
 * userData is the fallback storage the renderer documents.
 */
import {
  ROOM_UI_HIDDEN,
  ROOM_UI_BORDER_COLOR,
  ROOM_UI_BORDER_THICKNESS,
} from 'mudlet-map-renderer';

export { ROOM_UI_HIDDEN, ROOM_UI_BORDER_COLOR, ROOM_UI_BORDER_THICKNESS };

/**
 * Key Mudlet/the renderer read for a room's per-room symbol colour. Stored as a
 * plain `#rrggbb` hex (unlike the border colour, which uses the Qt `#aarrggbb`
 * form). Kept here so the literal lives in one place.
 */
export const ROOM_SYMBOL_COLOR = 'system.fallback_symbol_color';

/** Value Mudlet writes for a hidden room (case-insensitive `"true"`). */
export const HIDDEN_TRUE = 'true';

export const BORDER_THICKNESS_MIN = 1;
export const BORDER_THICKNESS_MAX = 10;

/** Whether a stored userData value marks the room hidden. */
export function isHiddenValue(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.toLowerCase() === HIDDEN_TRUE;
}

/**
 * Convert a stored border colour to a `#rrggbb` hex for `<input type="color">`.
 * Accepts Mudlet's Qt `#AARRGGBB` form (alpha first — what {@link hexToQtColor}
 * writes and what Mudlet itself stores) as well as a plain `#rrggbb`. Anything
 * unrecognised falls back to white.
 */
export function qtColorToHex(value: string | undefined | null): string {
  if (!value) return '#ffffff';
  const v = value.trim();
  const argb = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{6})$/.exec(v);
  if (argb) return ('#' + argb[2]).toLowerCase();
  const rgb = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (rgb) return ('#' + rgb[1]).toLowerCase();
  return '#ffffff';
}

/**
 * Convert a `#rrggbb` hex (from `<input type="color">`) to Mudlet's Qt
 * `#AARRGGBB` form with a fully-opaque alpha, matching `QColor::name(HexArgb)`
 * so the value round-trips back into Mudlet.
 */
export function hexToQtColor(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  return m ? ('#ff' + m[1]).toLowerCase() : '#ffffffff';
}

/** Clamp a border thickness to Mudlet's 1..10 range (rounding to an integer). */
export function clampThickness(n: number): number {
  return Math.min(BORDER_THICKNESS_MAX, Math.max(BORDER_THICKNESS_MIN, Math.round(n)));
}

/**
 * The userData entries a swatch contributes beyond the typed symbol/environment
 * fields: symbol colour, border colour and border thickness. Only properties the
 * swatch actually defines (non-null) are emitted, so applying a swatch never
 * clears a room flag the swatch is silent about. Values are already in the format
 * the renderer/Mudlet store (plain hex for symbol colour, Qt `#aarrggbb` for the
 * border colour, an integer string for thickness).
 */
export function swatchUserDataEntries(swatch: {
  symbolColor?: string | null;
  borderColor?: string | null;
  borderThickness?: number | null;
}): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  if (swatch.symbolColor != null) entries.push({ key: ROOM_SYMBOL_COLOR, value: swatch.symbolColor });
  if (swatch.borderColor != null) entries.push({ key: ROOM_UI_BORDER_COLOR, value: hexToQtColor(swatch.borderColor) });
  if (swatch.borderThickness != null) entries.push({ key: ROOM_UI_BORDER_THICKNESS, value: String(clampThickness(swatch.borderThickness)) });
  return entries;
}
