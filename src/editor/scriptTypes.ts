/**
 * Ambient TypeScript declarations for the script sandbox, loaded into Monaco
 * via addExtraLib() so the editor gives full type-aware autocomplete, hover,
 * and signature help.
 *
 * Keep in sync with the `api` object in `script.ts`.
 */

export const SCRIPT_TYPES_DTS = `
declare type Direction =
  | 'north' | 'south' | 'east' | 'west'
  | 'northeast' | 'northwest' | 'southeast' | 'southwest'
  | 'up' | 'down' | 'in' | 'out';

/** Frozen read-only snapshot of a room. Re-query via room() / findRooms() after mutations to see updates. */
declare interface Room {
  readonly id: number;
  /** X coordinate (raw). */
  readonly x: number;
  /** Y coordinate (raw Mudlet, +y = north). */
  readonly y: number;
  readonly z: number;
  readonly area: number;
  readonly name: string;
  /** Environment / env id (paint colour index). */
  readonly environment: number;
  /** Room symbol / character. */
  readonly symbol: string;
  readonly weight: number;
  readonly isLocked: boolean;
  readonly userData: Readonly<Record<string, string>>;
  readonly doors: Readonly<Record<string, number>>;
  readonly exitWeights: Readonly<Record<string, number>>;
  readonly specialExits: Readonly<Record<string, number>>;
  readonly stubs: readonly number[];
  readonly exitLocks: readonly number[];
  /**
   * Custom lines on this room, keyed by short cardinal direction ('n', 'ne', …)
   * or special-exit name. Use DIR_SHORT to map a full Direction to its short key.
   */
  readonly customLines: Readonly<Record<string, {
    readonly points: readonly (readonly [number, number])[];
    readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number; readonly spec: number };
    /** 1 = solid, 2 = dash, 3 = dot, 4 = dashDot, 5 = dashDotDot. */
    readonly style: number;
    readonly arrow: boolean;
  }>>;
  /** Target room id, or -1. */
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
  readonly northeast: number;
  readonly northwest: number;
  readonly southeast: number;
  readonly southwest: number;
  readonly up: number;
  readonly down: number;
  readonly in: number;
  readonly out: number;
}

declare interface Area {
  readonly id: number;
  readonly name: string;
}

declare interface Env {
  readonly id: number;
  /** True if env has a custom colour override (map.mCustomEnvColors). */
  readonly custom: boolean;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** '#rrggbb'. */
  readonly hex: string;
  /** 'rgb(r,g,b)' — same string the renderer uses. */
  readonly rgb: string;
}

/** A label colour as scripts read it. */
declare interface LabelColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0 = fully transparent, 255 = opaque. */
  readonly alpha: number;
  /** '#rrggbb'. */
  readonly hex: string;
  /** '#rrggbbaa'. */
  readonly hexa: string;
}

declare interface LabelFont {
  readonly family: string;
  /** Font size in pixmap px. */
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikeout: boolean;
}

/** Frozen read-only snapshot of a label. Re-query via label() / findLabels() after mutations to see updates. */
declare interface Label {
  /** Label id — unique within its area only. */
  readonly id: number;
  readonly areaId: number;
  /** X of the top-left corner (raw). */
  readonly x: number;
  /** Y of the top-left corner (raw Mudlet, +y = north). */
  readonly y: number;
  readonly z: number;
  /** Box width in map units. */
  readonly width: number;
  /** Box height in map units. */
  readonly height: number;
  /** Label text; lines separated by newlines. */
  readonly text: string;
  readonly font: LabelFont;
  readonly fgColor: LabelColor;
  /** Background; alpha 0 is transparent. */
  readonly bgColor: LabelColor;
  readonly outlineColor: LabelColor | null;
  /** Frame drawn around the box, or null. */
  readonly border: { readonly width: number; readonly color: LabelColor } | null;
  /** Inner padding in pixmap px; null means the default for the alignment. */
  readonly padding: number | readonly [number, number] | null;
  readonly textAlign: 'left' | 'center' | 'right';
  /** Label style id; 'plain' when none. See labelStyles(). */
  readonly style: string;
  /** The style's own settings, defaults filled in. See labelStyles() for what each style has. */
  readonly styleParams: Readonly<Record<string, string | number | boolean>>;
  /** Mudlet draws the label at a fixed pixel size instead of scaling it with the map. */
  readonly noScaling: boolean;
  /** Drawn above rooms rather than below. */
  readonly showOnTop: boolean;
  /** The label shows an uploaded picture, not text. */
  readonly isImage: boolean;
}

/** '#rrggbb', '#rrggbbaa' or { r, g, b, alpha? }. */
declare type LabelColorInput = string | { r: number; g: number; b: number; alpha?: number };

/** Properties updateLabel() can change. Omitted fields are kept. */
declare interface LabelPatch {
  text?: string;
  /** Merged into the current font — { size: 24 } keeps the family. */
  font?: Partial<{ family: string; size: number; bold: boolean; italic: boolean; underline: boolean; strikeout: boolean }>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fgColor?: LabelColorInput;
  bgColor?: LabelColorInput;
  /** null removes the outline. */
  outlineColor?: LabelColorInput | null;
  /** null removes the border; without a colour it follows the text colour. */
  border?: { width?: number; color?: LabelColorInput } | null;
  /** Pixmap px: one value, [horizontal, vertical], or null for the default. */
  padding?: number | [number, number] | null;
  textAlign?: 'left' | 'center' | 'right';
  /** A style id from labelStyles(), or 'plain'. Switching style resets its settings. */
  style?: string;
  /** Merged into the style's settings; null resets them to the defaults. */
  styleParams?: Record<string, string | number | boolean> | null;
  noScaling?: boolean;
  showOnTop?: boolean;
  /** Resize the box to the (new) text afterwards: both axes, or just one. */
  fitToText?: boolean | 'width' | 'height';
}

declare interface CustomLineColor {
  r: number; g: number; b: number; alpha?: number;
}

declare interface CustomLineOptions {
  color?: string | CustomLineColor;
  style?: 'solid' | 'dash' | 'dot' | 'dashDot' | 'dashDotDot' | number;
  arrow?: boolean;
}

declare interface ConnectOptions {
  direction?: Direction;
  oneWay?: boolean;
}

// ── Read ───────────────────────────────────────────────────────────────

/** Return a fresh snapshot array of all rooms. */
declare function rooms(): Room[];
/** Return rooms matching the predicate. */
declare function findRooms(pred: (r: Room) => boolean): Room[];
/** Return a snapshot of one room, or undefined. */
declare function room(id: number): Room | undefined;
/** List of all areas. */
declare function areas(): Area[];
/** Lookup one area by id. */
declare function area(id: number): Area;
/** List of every environment known to the map (default palette + custom + ids used by rooms). */
declare function envs(): Env[];
/** Look up one environment by id. Returns undefined if unknown and unused. */
declare function env(id: number): Env | undefined;
/** Cardinal direction between two rooms, inferred from map coordinates. */
declare function directionBetween(fromId: number, toId: number): Direction | null;

/** The area currently shown in the editor. */
declare const currentAreaId: number | null;
/** Current z-level shown in the editor. */
declare const currentZ: number;
/** All cardinal directions. */
declare const DIRS: readonly Direction[];
/**
 * Full Direction name → short key used to index room.exitWeights / room.doors /
 * room.customLines. E.g. DIR_SHORT.north === 'n', DIR_SHORT.northeast === 'ne'.
 * 'up' / 'down' / 'in' / 'out' map to themselves.
 */
declare const DIR_SHORT: Readonly<Record<Direction, string>>;
/** Ids of rooms currently selected in the editor. Empty array if no rooms are selected. */
declare function getSelection(): number[];
/** Every label on the map, across all areas. */
declare function labels(): Label[];
/** Labels matching the predicate, e.g. findLabels(l => l.font.family === 'Arial' && l.font.size === 30). */
declare function findLabels(pred: (l: Label) => boolean): Label[];
/** One label, or undefined. Label ids are only unique within their area. */
declare function label(areaId: number, id: number): Label | undefined;
/** The label selected in the editor, or null when the selection is not a label. */
declare function getSelectedLabel(): { areaId: number; id: number } | null;
/** Label styles available to updateLabel({ style }). 'plain' is the unstyled default. */
declare function labelStyles(): {
  id: string;
  name: string;
  /** The style's own settings, for updateLabel({ styleParams }). */
  params: { id: string; name: string; type: 'enum' | 'number' | 'bool' | 'color'; default: string | number | boolean; options?: { value: string; name: string }[]; min?: number; max?: number; step?: number }[];
}[];
/** Label presets (templates) available to applyLabelPreset(). */
declare function labelPresets(): { id: string; name: string }[];

// ── I/O ────────────────────────────────────────────────────────────────

/** Append to the script Log panel. */
declare function log(...args: any[]): void;

declare const console: {
  /** Alias for log(). */
  log(...args: any[]): void;
};

// ── Write (collected into one undo batch) ──────────────────────────────

/** Set a room name. */
declare function setRoomName(id: number, name: string): void;
/** Set a room environment (paint colour). */
declare function setRoomEnv(id: number, env: number): void;
/** Set a room symbol / character. */
declare function setRoomSymbol(id: number, symbol: string): void;
/** Set a room weight. */
declare function setRoomWeight(id: number, weight: number): void;
/** Lock / unlock a room. */
declare function setRoomLock(id: number, locked: boolean): void;
/** Move a room. Coords are raw Mudlet (y = north is +). */
declare function moveRoom(id: number, x: number, y: number, z: number): void;
/** Set a cardinal exit. toId < 0 removes it. */
declare function setExit(fromId: number, dir: Direction, toId: number): void;
/** Set door state: 0=none, 1=open, 2=closed, 3=locked. */
declare function setDoor(roomId: number, dir: Direction, value: number): void;
/** Set exit traversal weight. */
declare function setExitWeight(roomId: number, dir: Direction, value: number): void;
/** Lock / unlock an exit. */
declare function setExitLock(roomId: number, dir: Direction, locked: boolean): void;
/** Add / remove a stub. */
declare function setStub(roomId: number, dir: Direction, stub: boolean): void;
/** Set a room userData entry. Pass null to delete. */
declare function setUserData(roomId: number, key: string, value: string | null): void;
/** Set a special (named) exit. toId < 0 removes it. */
declare function setSpecialExit(roomId: number, name: string, toId: number): void;
/** Link two rooms. Direction inferred from coords for 2D cardinals; pass { direction } for up/down/in/out. */
declare function connectRooms(fromId: number, toId: number, options?: ConnectOptions): Direction | null;
/** Remove a cardinal exit (and its reverse unless oneWay: true). */
declare function disconnect(fromId: number, dir: Direction, options?: { oneWay?: boolean }): void;
/** Draw a custom line on a room exit. Points are raw Mudlet [x, y] pairs. */
declare function setCustomLine(roomId: number, exitName: string, points: Array<[number, number]>, options?: CustomLineOptions): void;
/** Remove a custom line from a room exit. */
declare function removeCustomLine(roomId: number, exitName: string): void;
/**
 * Change any of a label's properties at once; omitted fields are kept. The
 * pixmap is re-rendered like a label-panel edit; image labels keep their
 * picture. Returns true if anything changed.
 */
declare function updateLabel(areaId: number, id: number, patch: LabelPatch): boolean;
/** Apply a label preset (template) by id or name — see labelPresets(). Returns true if anything changed. */
declare function applyLabelPreset(areaId: number, id: number, preset: string): boolean;
`.trim();
