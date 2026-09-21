import { Buffer } from 'buffer';
import type { Command, LabelSnapshot } from './types';
import { generateLabelPixmap } from './labelPixmap';

/**
 * What a `setLabelPixmap` command records in place of the pixmap itself.
 *
 * Holding every label's before/after PNG in the undo stack made each label
 * edit cost tens of KB — for the whole session, and again in every autosave,
 * which clones the stack. Most of those images carry no information: a pixmap
 * the editor drew is a pure function of the label's properties, and the stack
 * already records every property change. So a command stores one of:
 *
 * - {@link PIXMAP_REGEN} — "whatever the label's properties render to". Resolved
 *   after the whole top-level command has been applied or reverted, so it sees
 *   the final text, size, font… rather than a half-reverted label.
 * - `pixmap:pool:<key>` — an image the editor can't reproduce (a pixmap that
 *   came with the loaded file, an uploaded picture), kept once in
 *   {@link pixmapPool} however many commands refer to it.
 * - a plain data URL — what older sessions stored; still applied as-is.
 */
export const PIXMAP_REGEN = 'pixmap:regen';
const POOL_PREFIX = 'pixmap:pool:';

/** Non-reproducible pixmaps referenced from the undo/redo stacks, as PNG bytes. */
const pool = new Map<string, Uint8Array>();

function base64Of(dataUrl: string): string {
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Keep a pixmap in the pool and return its reference; identical images share one entry. */
export function poolPixmap(dataUrl: string): string {
  const b64 = base64Of(dataUrl);
  if (!b64) return '';
  const bytes = Buffer.from(b64, 'base64');
  // FNV-1a over the base64 text; the length and a collision suffix make it unique.
  let h = 0x811c9dc5;
  for (let i = 0; i < b64.length; i++) { h ^= b64.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const base = `${(h >>> 0).toString(36)}-${bytes.length}`;
  for (let n = 0; ; n++) {
    const key = n === 0 ? base : `${base}-${n}`;
    const have = pool.get(key);
    if (!have) { pool.set(key, new Uint8Array(bytes)); return POOL_PREFIX + key; }
    if (bytesEqual(have, bytes)) return POOL_PREFIX + key;
  }
}

/**
 * Reference for a pixmap `label` currently shows: {@link PIXMAP_REGEN} when
 * re-rendering the label reproduces it exactly, the pool otherwise. Only an
 * exact match counts, so anything the editor might not reproduce byte for byte
 * (a file's original pixmap, a font that has since changed) is kept verbatim.
 */
export function pixmapRefFor(dataUrl: string, label: LabelSnapshot | null): string {
  if (!dataUrl) return '';
  if (label && !label.imageSrc && generateLabelPixmap(label) === dataUrl) return PIXMAP_REGEN;
  return poolPixmap(dataUrl);
}

/**
 * The data URL a stored reference stands for, or `null` for {@link PIXMAP_REGEN},
 * which the caller renders from the label once its properties have settled.
 */
export function resolvePixmapRef(ref: string): string | null {
  if (ref === PIXMAP_REGEN) return null;
  if (!ref.startsWith(POOL_PREFIX)) return ref;
  const bytes = pool.get(ref.slice(POOL_PREFIX.length));
  return bytes ? `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` : '';
}

/** Pool entries the given commands refer to — what a saved session needs to carry. */
export function collectPooledPixmaps(stacks: Command[][]): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const visit = (cmd: Command) => {
    if (cmd.kind === 'batch') { cmd.cmds.forEach(visit); return; }
    if (cmd.kind !== 'setLabelPixmap') return;
    for (const ref of [cmd.from, cmd.to]) {
      if (!ref.startsWith(POOL_PREFIX)) continue;
      const key = ref.slice(POOL_PREFIX.length);
      const bytes = pool.get(key);
      if (bytes) out[key] = bytes;
    }
  };
  for (const stack of stacks) stack.forEach(visit);
  return out;
}

/** Replace the pool — empty for a freshly loaded map, a saved session's entries on restore. */
export function resetPixmapPool(entries?: Record<string, Uint8Array>): void {
  pool.clear();
  for (const [key, bytes] of Object.entries(entries ?? {})) pool.set(key, bytes);
}
