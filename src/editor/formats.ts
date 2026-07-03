import { readMapFromBytes, writeMapToBytes, type MudletMap } from '../mapIO';
import { mudletJsonFormat } from './mudletJsonFormat';

/** Context passed to a format's `parse` so it can key behaviour off the source. */
export interface MapFormatParseContext {
  /** Name of the file (or URL basename) the bytes came from. */
  fileName: string;
}

/**
 * A map import/export format. Formats are codecs between raw file bytes and the
 * editor's canonical in-memory model (`MudletMap`). The renderer, commands and
 * reader all operate on `MudletMap`, so any format — a different `.dat` variant,
 * SQLite, JSON, plaintext, etc. — just needs to translate to and from it.
 *
 * The built-in {@link mudletDatFormat} handles Mudlet `.dat`. Plugins contribute
 * or replace formats via the `mapFormats` hook.
 */
export interface MapFormat {
  /** Stable identifier. Stored as the active format so saves round-trip. */
  id: string;
  /** Human-readable label shown in the save-format chooser. */
  label: string;
  /**
   * File extensions this format owns (leading dot, e.g. `['.dat']`). The first
   * entry is used as the default extension when saving.
   */
  extensions: string[];
  /**
   * `accept` attribute for the load file-picker. Defaults to `extensions`
   * joined with commas when omitted.
   */
  accept?: string;
  /**
   * Decide whether this format handles a given filename. Defaults to a
   * case-insensitive suffix match against `extensions`.
   */
  matches?(fileName: string): boolean;
  /** Parse raw file bytes into the canonical model. May be async. */
  parse(bytes: ArrayBuffer, ctx: MapFormatParseContext): MudletMap | Promise<MudletMap>;
  /** Serialize the canonical model back to file bytes. May be async. */
  serialize(map: MudletMap): Uint8Array | Promise<Uint8Array>;
}

export const MUDLET_DAT_FORMAT_ID = 'mudlet-dat';

/** Built-in Mudlet `.dat` binary format. Always the fallback if no plugin format matches. */
export const mudletDatFormat: MapFormat = {
  id: MUDLET_DAT_FORMAT_ID,
  label: 'Mudlet map (.dat)',
  extensions: ['.dat'],
  parse: (bytes) => readMapFromBytes(bytes),
  serialize: (map) => writeMapToBytes(map),
};

/** The formats the core app ships with, before any plugin transforms. */
export const builtInFormats: MapFormat[] = [mudletDatFormat, mudletJsonFormat];

// Module-level registry. App composes plugin formats once on mount and calls
// setMapFormats; everything else reads the registry through the helpers below.
let registered: MapFormat[] = [...builtInFormats];

/** Replace the active format list. Empty input falls back to the built-in format. */
export function setMapFormats(formats: MapFormat[]): void {
  registered = formats.length ? formats : [mudletDatFormat];
}

export function getMapFormats(): MapFormat[] {
  return registered;
}

export function getMapFormat(id: string | null | undefined): MapFormat | undefined {
  return registered.find((f) => f.id === id);
}

/** The format used when none is otherwise resolvable (first registered, or Mudlet `.dat`). */
export function defaultMapFormat(): MapFormat {
  return registered[0] ?? mudletDatFormat;
}

function formatMatches(format: MapFormat, fileName: string): boolean {
  if (format.matches) return format.matches(fileName);
  const lower = fileName.toLowerCase();
  return format.extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
}

/** The format that claims a filename, or `undefined` if none does (no fallback). */
export function matchFormatForFile(fileName: string): MapFormat | undefined {
  return registered.find((f) => formatMatches(f, fileName));
}

/** Like {@link matchFormatForFile} but falls back to {@link defaultMapFormat}. */
export function pickFormatForFile(fileName: string): MapFormat {
  return matchFormatForFile(fileName) ?? defaultMapFormat();
}

/** Combined `accept` string for the load picker across every registered format. */
export function combinedAccept(): string {
  const parts = new Set<string>();
  for (const f of registered) {
    const tokens = f.accept ? f.accept.split(',') : f.extensions;
    for (const token of tokens) {
      const trimmed = token.trim();
      if (trimmed) parts.add(trimmed);
    }
  }
  return [...parts].join(',');
}
