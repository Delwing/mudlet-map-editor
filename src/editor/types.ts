import type { MudletColor, MudletRoom } from '../mapIO';

export type LabelFont = {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
};

export const DEFAULT_LABEL_FONT: LabelFont = {
  family: 'Arial',
  size: 30,
  bold: false,
  italic: false,
  underline: false,
  strikeout: false,
};

export type LabelSnapshot = {
  id: number;
  pos: [number, number, number];
  size: [number, number];
  text: string;
  fgColor: MudletColor;
  bgColor: MudletColor;
  noScaling: boolean;
  showOnTop: boolean;
  font: LabelFont;
  /** Text outline color loaded from area userData (system.labelOutlineColor_N). */
  outlineColor?: MudletColor;
  /** Base64 PNG data URL, or empty string if no pixmap. */
  pixMap: string;
};

export type ToolId = 'select' | 'connect' | 'addRoom' | 'delete' | 'pan' | 'customLine' | 'addLabel';

export type Direction =
  | 'north' | 'northeast' | 'east' | 'southeast'
  | 'south' | 'southwest' | 'west' | 'northwest'
  | 'up' | 'down' | 'in' | 'out';

export const CARDINAL_DIRECTIONS: Direction[] = [
  'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest',
  'up', 'down', 'in', 'out',
];

export const OPPOSITE: Record<Direction, Direction> = {
  north: 'south', south: 'north',
  east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest',
  up: 'down', down: 'up',
  in: 'out', out: 'in',
};

// Mudlet stores customLines keyed by short direction names for cardinals
// (e.g. 'n' not 'north'), matching what the renderer expects at lookup time.
export const DIR_SHORT: Record<Direction, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  up: 'up', down: 'down', in: 'in', out: 'out',
};

/** 1-based direction index used by Mudlet's stubs/exitLocks arrays. */
export const DIR_INDEX: Record<Direction, number> = {
  north: 1, northeast: 2, northwest: 3, east: 4, west: 5,
  south: 6, southeast: 7, southwest: 8, up: 9, down: 10, in: 11, out: 12,
};

const SHORT_KEYS = new Set(Object.values(DIR_SHORT));

/** Inverse of DIR_SHORT — short-form cardinal key → full Direction name. */
export const SHORT_TO_DIR: Record<string, Direction> = Object.entries(DIR_SHORT).reduce(
  (acc, [full, short]) => { acc[short] = full as Direction; return acc; },
  {} as Record<string, Direction>,
);

/**
 * Convert a user-typed exit name into the storage key Mudlet / the renderer
 * expect. Cardinal directions must be their short form ('north' → 'n'), while
 * special-exit names are preserved. Case-insensitive for the cardinal mapping.
 */
export function normalizeCustomLineKey(name: string): string {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (lower in DIR_SHORT) return (DIR_SHORT as Record<string, string>)[lower];
  if (SHORT_KEYS.has(lower)) return lower;
  return trimmed;
}

export type Selection =
  | { kind: 'room'; ids: number[] }
  | { kind: 'exit'; fromId: number; toId: number; dir: Direction }
  | { kind: 'customLine'; roomId: number; exitName: string; pointIndex?: number }
  | { kind: 'label'; id: number; areaId: number }
  | null;
export type HoverTarget =
  | { kind: 'room'; id: number; handleDir: Direction | null }
  | { kind: 'exit'; fromId: number; toId: number; dir: Direction }
  | { kind: 'customLine'; roomId: number; exitName: string }
  | { kind: 'label'; id: number; areaId: number }
  | null;

export type PendingDrag = {
  kind: 'drag';
  roomId: number;
  originX: number;
  originY: number;
  /** Origins of other selected rooms for multi-drag; raw Mudlet-space coords. */
  multiOrigins?: { id: number; x: number; y: number }[];
  /** Render-space offset from room centre to click point, to avoid jump on drag start. */
  offsetX: number;
  offsetY: number;
};

export type PendingConnect = {
  kind: 'connect';
  sourceId: number;
  /** Direction chosen from a source handle, or null if the drag started on room body. */
  sourceDir: Direction | null;
  cursorMap: { x: number; y: number } | null;
  hoverTargetId: number | null;
  /** Direction on the target picked from a target handle. Null ⇒ use opposite of sourceDir. */
  targetDir: Direction | null;
};

export type PendingCustomLine = {
  kind: 'customLine';
  roomId: number;
  /** Normalized storage key (short form for cardinals). */
  exitName: string;
  color: MudletColor;
  style: number;   // 1=solid, 2=dash, 3=dot
  arrow: boolean;
  /** Accumulated waypoints in render-space [x, y]. points[0] is the room centre. */
  points: [number, number][];
  /** Current cursor position for preview. */
  cursor: { x: number; y: number } | null;
  /** Raw-map snapshot of the customLine under `exitName` before drawing started; null if none. */
  previousSnapshot: CustomLineSnapshot | null;
  /**
   * Opposite-side stub written on the partner room so the renderer's two-way
   * skip check fires. Null when drawing "one side only" or when no reciprocal
   * cardinal exit exists.
   */
  companion: CustomLineCompanion | null;
};

/** Metadata + pre-draw snapshot of the partner-room stub used for two-way coverage. */
export type CustomLineCompanion = {
  roomId: number;
  /** Short-form cardinal key (e.g. 's' when main side is 'n'). */
  exitName: string;
  previousSnapshot: CustomLineSnapshot | null;
};

export type PendingCustomLinePoint = {
  kind: 'customLinePoint';
  roomId: number;
  exitName: string;
  pointIndex: number;
  /** Raw Mudlet-space snapshot of all points before drag, for undo. */
  originPoints: [number, number][];
};

export type PendingPickExit = {
  kind: 'pickExit';
  fromId: number;
  dir: Direction;
};

export type PendingPickSpecialExit = {
  kind: 'pickSpecialExit';
  fromId: number;
};

export type LabelResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type PendingLabelDrag = {
  kind: 'labelDrag';
  labelId: number;
  areaId: number;
  /** Raw Mudlet-space origin (before drag). */
  originPos: [number, number, number];
  /** Render-space offset from label top-left to click point, to avoid jump on drag start. */
  offsetX: number;
  offsetY: number;
};

export type PendingLabelRect = {
  kind: 'labelRect';
  areaId: number;
  z: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

export type PendingLabelResize = {
  kind: 'labelResize';
  labelId: number;
  areaId: number;
  handle: LabelResizeHandle;
  /** LabelSnapshot.pos of origin (renderX, mudletY, z). */
  originPos: [number, number, number];
  originSize: [number, number];
};

export type PendingMarquee = {
  kind: 'marquee';
  /** Render-space start corner. */
  startX: number;
  startY: number;
  /** Render-space current corner (updated on every pointer-move). */
  currentX: number;
  currentY: number;
  ctrlHeld: boolean;
  /** Room IDs that were selected before the drag began; used for Ctrl toggle. */
  preExistingIds: number[];
};

export type Pending = PendingDrag | PendingConnect | PendingCustomLine | PendingCustomLinePoint | PendingPickExit | PendingPickSpecialExit | PendingMarquee | PendingLabelDrag | PendingLabelRect | PendingLabelResize | null;

export type RoomSnapshot = MudletRoom;

export type CustomLineSnapshot = {
  points: [number, number][];
  color: MudletColor;
  style: number;
  arrow: boolean;
};

/** Opposite-side stub applied alongside a setCustomLine for two-way coverage. */
export type SetCustomLineCompanion = {
  roomId: number;
  exitName: string;
  data: CustomLineSnapshot;
  previous: CustomLineSnapshot | null;
};

export type Command =
  | { kind: 'moveRoom'; id: number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }
  | { kind: 'addRoom'; id: number; room: RoomSnapshot; areaId: number }
  | { kind: 'deleteRoom'; id: number; room: RoomSnapshot; areaId: number; neighborEdits: NeighborEdit[] }
  | { kind: 'addExit'; fromId: number; dir: Direction; toId: number; previous: number; reverse: { fromId: number; dir: Direction; previous: number } | null }
  | { kind: 'removeExit'; fromId: number; dir: Direction; was: number; reverse: { fromId: number; dir: Direction; was: number } | null }
  | { kind: 'removeAllExits'; roomId: number; exits: Array<{ dir: Direction; was: number; reverse: { fromId: number; dir: Direction; was: number } | null }>; specialExits: Array<{ name: string; toId: number }> }
  | { kind: 'setRoomField'; id: number; field: 'name' | 'environment' | 'weight' | 'symbol'; from: string | number; to: string | number }
  | { kind: 'addArea'; id: number; name: string }
  | { kind: 'deleteArea'; id: number; name: string }
  | {
      kind: 'deleteAreaWithRooms';
      areaId: number;
      areaName: string;
      areaSnapshot: any;
      rooms: Array<{ id: number; room: RoomSnapshot }>;
      crossAreaNeighborEdits: NeighborEdit[];
      affectedOtherAreaIds: number[];
    }
  | { kind: 'renameArea'; id: number; from: string; to: string }
  | { kind: 'setCustomEnvColor'; envId: number; from: MudletColor | null; to: MudletColor | null }
  | { kind: 'addSpecialExit'; roomId: number; name: string; toId: number }
  | { kind: 'removeSpecialExit'; roomId: number; name: string; toId: number }
  | { kind: 'setCustomLine'; roomId: number; exitName: string; data: CustomLineSnapshot; previous: CustomLineSnapshot | null; companion?: SetCustomLineCompanion }
  | { kind: 'removeCustomLine'; roomId: number; exitName: string; snapshot: CustomLineSnapshot }
  | { kind: 'moveRoomsToArea'; roomIds: number[]; fromAreaId: number; toAreaId: number }
  | { kind: 'setRoomLock'; id: number; lock: boolean }
  | { kind: 'setDoor'; roomId: number; dir: Direction; from: number; to: number }
  | { kind: 'setExitWeight'; roomId: number; dir: Direction; from: number; to: number }
  | { kind: 'setExitLock'; roomId: number; dir: Direction; lock: boolean }
  | { kind: 'setStub'; roomId: number; dir: Direction; stub: boolean }
  | { kind: 'setUserDataEntry'; roomId: number; key: string; from: string | null; to: string | null }
  | { kind: 'setAreaUserDataEntry'; areaId: number; key: string; from: string | null; to: string | null }
  | { kind: 'setMapUserDataEntry'; key: string; from: string | null; to: string | null }
  | { kind: 'setSpecialExitDoor'; roomId: number; name: string; from: number; to: number }
  | { kind: 'setSpecialExitWeight'; roomId: number; name: string; from: number; to: number }
  | { kind: 'addLabel'; areaId: number; label: LabelSnapshot }
  | { kind: 'deleteLabel'; areaId: number; label: LabelSnapshot }
  | { kind: 'moveLabel'; areaId: number; id: number; from: [number, number, number]; to: [number, number, number] }
  | { kind: 'setLabelText'; areaId: number; id: number; from: string; to: string }
  | { kind: 'setLabelSize'; areaId: number; id: number; from: [number, number]; to: [number, number] }
  | { kind: 'setLabelColors'; areaId: number; id: number; fromFg: MudletColor; toFg: MudletColor; fromBg: MudletColor; toBg: MudletColor }
  | { kind: 'setLabelNoScaling'; areaId: number; id: number; from: boolean; to: boolean }
  | { kind: 'setLabelShowOnTop'; areaId: number; id: number; from: boolean; to: boolean }
  | { kind: 'setLabelFont'; areaId: number; id: number; from: LabelFont; to: LabelFont }
  | { kind: 'setLabelOutlineColor'; areaId: number; id: number; from: MudletColor | undefined; to: MudletColor | undefined }
  | { kind: 'setLabelPixmap'; areaId: number; id: number; from: string; to: string }
  | { kind: 'resizeLabel'; areaId: number; id: number; fromPos: [number, number, number]; toPos: [number, number, number]; fromSize: [number, number]; toSize: [number, number] }
  | { kind: 'batch'; cmds: Command[] };

export type NeighborEdit = { roomId: number; dir: Direction; was: number };

export type LoadedMap = {
  fileName: string;
};
