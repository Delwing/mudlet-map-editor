import { useSyncExternalStore } from 'react';
import type { MudletMap, MudletRoom } from '../mapIO';
import type { Command, HitItem, HoverTarget, LoadedMap, Pending, Selection, SwatchSet, ToolId } from './types';

export type RoomClipboard = {
  /** Rooms captured at copy time; origId preserved for internal-exit remap. */
  rooms: Array<{ origId: number; room: MudletRoom }>;
  /** Centroid of source rooms in raw Mudlet space — paste offset is computed relative to this. */
  origin: { x: number; y: number; z: number };
};

const SWATCH_SETS_KEY = 'mudlet-swatch-sets';
const ACTIVE_SET_KEY = 'mudlet-active-swatch-set';
const ACTIVE_SWATCH_KEY = 'mudlet-active-swatch';

const USER_SETTINGS_KEY = 'mudlet-editor-settings';

interface UserSettings {
  snapToGrid: boolean;
}

function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_KEY);
    if (raw) return { snapToGrid: true, ...JSON.parse(raw) };
  } catch {}
  return { snapToGrid: true };
}

export function saveUserSettings(patch: Partial<UserSettings>): void {
  try {
    const current = loadUserSettings();
    localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

function loadSwatchState(): { swatchSets: SwatchSet[]; activeSwatchSetId: string | null; activeSwatchId: string | null } {
  try {
    const raw = localStorage.getItem(SWATCH_SETS_KEY);
    const sets: SwatchSet[] = raw ? JSON.parse(raw) : [];
    return {
      swatchSets: sets,
      activeSwatchSetId: localStorage.getItem(ACTIVE_SET_KEY),
      activeSwatchId: localStorage.getItem(ACTIVE_SWATCH_KEY),
    };
  } catch {
    return { swatchSets: [], activeSwatchSetId: null, activeSwatchId: null };
  }
}

export function saveSwatchState(sets: SwatchSet[], activeSetId: string | null, activeSwatchId: string | null): void {
  try {
    localStorage.setItem(SWATCH_SETS_KEY, JSON.stringify(sets));
    if (activeSetId != null) localStorage.setItem(ACTIVE_SET_KEY, activeSetId);
    else localStorage.removeItem(ACTIVE_SET_KEY);
    if (activeSwatchId != null) localStorage.setItem(ACTIVE_SWATCH_KEY, activeSwatchId);
    else localStorage.removeItem(ACTIVE_SWATCH_KEY);
  } catch {}
}

export type SpreadShrinkState = {
  mode: 'spread' | 'shrink';
  factor: number;
  centerMode: 'centroid' | 'anchor';
  anchorRoomId: number | null;
};

export interface EditorState {
  map: MudletMap | null;
  loaded: LoadedMap | null;
  currentAreaId: number | null;
  currentZ: number;
  activeTool: ToolId;
  selection: Selection;
  hover: HoverTarget;
  pending: Pending;
  snapToGrid: boolean;
  gridStep: number;
  /** When true (Space held), pointer input defers to the renderer's pan regardless of active tool. */
  spaceHeld: boolean;
  undo: Command[];
  redo: Command[];
  status: string;
  /** Bumped on structural changes (room added/removed, area/z changed) that need a full rebuild. */
  structureVersion: number;
  /** Bumped on every mutation (coord, exits, props) to trigger React re-renders of panels. */
  dataVersion: number;
  /** Snapped cursor position in render-space, tracked by tools that show a snap indicator. */
  snapCursor: { x: number; y: number } | null;
  /** Last pointer position over the map in render-space (y-down), updated on every pointermove. */
  cursorMap: { x: number; y: number } | null;
  /** In-memory clipboard of copied rooms. Not persisted across reloads. */
  clipboard: RoomClipboard | null;
  sidebarTab: string;
  panelCollapsed: boolean;
  contextMenu: ContextMenuState;
  savedUndoLength: number;
  /** When set, the next area/z navigation pans to this map-space point instead of fitting. Consumed and cleared by App. */
  navigateTo: { mapX: number; mapY: number } | null;
  /** When set, App pans to this map-space point without changing area/z. Consumed and cleared by App. */
  panRequest: { mapX: number; mapY: number } | null;
  /** Tracks the last Alt+click position (integer cell) and cycle index for overlapping-element cycling. */
  hitCycle: { x: number; y: number; index: number } | null;
  /** When true, label resize preserves the aspect ratio at the start of the drag. */
  labelAspectRatioLocked: boolean;
  swatchSets: SwatchSet[];
  pluginSwatchSets: SwatchSet[];
  activeSwatchSetId: string | null;
  activeSwatchId: string | null;
  swatchPaletteOpen: boolean;
  sessionId: string | null;
  spreadShrink: SpreadShrinkState | null;
}

export type ContextMenuState =
  | {
      kind: 'customLinePoint';
      roomId: number;
      exitName: string;
      pointIndex: number;
      screenX: number;
      screenY: number;
    }
  | {
      kind: 'room';
      roomId: number;
      screenX: number;
      screenY: number;
    }
  | {
      kind: 'disambiguate';
      hits: HitItem[];
      screenX: number;
      screenY: number;
    }
  | {
      kind: 'label';
      areaId: number;
      labelId: number;
      screenX: number;
      screenY: number;
    }
  | null;

const swatchInit = loadSwatchState();
const userSettings = loadUserSettings();
const initial: EditorState = {
  map: null,
  loaded: null,
  currentAreaId: null,
  currentZ: 0,
  activeTool: 'select',
  selection: null,
  hover: null,
  pending: null,
  snapToGrid: userSettings.snapToGrid,
  gridStep: 1,
  spaceHeld: false,
  undo: [],
  redo: [],
  status: 'Load a Mudlet .dat file to begin.',
  structureVersion: 0,
  dataVersion: 0,
  snapCursor: null,
  cursorMap: null,
  clipboard: null,
  sidebarTab: 'selection',
  panelCollapsed: false,
  contextMenu: null,
  savedUndoLength: 0,
  navigateTo: null,
  panRequest: null,
  hitCycle: null,
  labelAspectRatioLocked: false,
  swatchSets: swatchInit.swatchSets,
  pluginSwatchSets: [],
  activeSwatchSetId: swatchInit.activeSwatchSetId,
  activeSwatchId: swatchInit.activeSwatchId,
  swatchPaletteOpen: false,
  sessionId: null,
  spreadShrink: null,
};

type Listener = (state: EditorState) => void;

class Store {
  private state: EditorState = initial;
  private listeners = new Set<Listener>();

  getState = (): EditorState => this.state;

  setState = (patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => {
    let next = typeof patch === 'function' ? patch(this.state) : patch;
    if ('selection' in next && next.selection !== this.state.selection && next.selection !== null && !('sidebarTab' in next)) {
      next = { ...next, sidebarTab: 'selection' };
    }
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l(this.state));
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener) as unknown as void;
  };

  bumpData = () => this.setState((s) => ({ dataVersion: s.dataVersion + 1 }));
  bumpStructure = () =>
    this.setState((s) => ({
      structureVersion: s.structureVersion + 1,
      dataVersion: s.dataVersion + 1,
    }));
}

export const store = new Store();

export function useEditorState<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(initial),
  );
}
