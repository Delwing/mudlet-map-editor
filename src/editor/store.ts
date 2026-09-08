import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { MudletMap, MudletRoom } from '../mapIO';
import type { SidebarTab } from './plugin';
import type { Command, HitItem, HoverTarget, LoadedMap, Pending, Selection, SwatchSet, ToolId } from './types';
import type { MapWarning } from './warnings';
import type { PathFindingAlgorithm, RouteSummary } from './pathfinding';
import type { IncomingRooms, PeerInfo } from './peers';
import { MUDLET_DAT_FORMAT_ID } from './formats';

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
  panelWidth: number;
  /** Per-tab overrides of the selection-awareness defaults, keyed by tab id. */
  tabAwareness: Record<string, TabSelectionAwareness>;
}

const DEFAULT_PANEL_WIDTH = 440;
const DEFAULT_USER_SETTINGS: UserSettings = { snapToGrid: true, panelWidth: DEFAULT_PANEL_WIDTH, tabAwareness: {} };

function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_USER_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_USER_SETTINGS };
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

/**
 * Progress of an in-flight map load. Each phase is a long *synchronous* block on
 * the main thread (~0.5s parse, ~1s scene build for a 27k-room map), so the flag
 * is set — and the browser given a frame to paint it — before the block starts,
 * not during it. Cleared once the scene is on screen (see App).
 */
export type LoadingState = {
  phase: 'fetching' | 'parsing' | 'preparing';
  fileName: string;
  /** Download completion 0–100. Only ever set while `fetching`, and only when the server sent a length. */
  pct: number | null;
};

/**
 * Latest level-of-detail tier the renderer reported for the displayed plane
 * (mirror of its `lod` event). `null` while no map/plane is drawn — a plane the
 * renderer skips as empty emits nothing, so scene.setArea clears this first.
 */
export type LodState = {
  /** 'vector' = full detail, 'roomsOnly' = exit lines dropped, 'raster' = pixel overview. */
  mode: 'vector' | 'roomsOnly' | 'raster';
  planeRoomCount: number;
  visibleEstimate: number;
  /** False when pointer picking is unavailable — tools that need a hit bail out. */
  hitTestActive: boolean;
};

/** Route-finder (speedwalk) panel state. `summary.path` is what RouteEffect draws. */
export type RouteState = {
  fromId: number | null;
  toId: number | null;
  algorithm: PathFindingAlgorithm;
  summary: RouteSummary | null;
  status: 'idle' | 'found' | 'noPath' | 'sameRoom' | 'missing';
};

export interface EditorState {
  map: MudletMap | null;
  loaded: LoadedMap | null;
  /** Id of the format the current map was loaded with / will be saved as by default.
   *  Resolved against the format registry (see editor/formats.ts). */
  formatId: string;
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
  status: string | null;
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
  panelExpanded: boolean;
  /** Side panel width in pixels (persisted). Ignored when the panel is collapsed or modal-expanded. */
  panelWidth: number;
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
  /** Route-finder panel + the path RouteEffect renders. */
  route: RouteState;
  warningAckVersion: number;
  /** Cached map warnings; recomputed in App after each command lands. */
  warnings: MapWarning[];
  /** Other same-origin editor tabs with a map open — cross-tab copy targets. */
  peers: PeerInfo[];
  /** Rooms sent from another tab, shown in a banner until placed or dismissed. */
  incomingRooms: IncomingRooms | null;
  /** Renderer LOD tier for the displayed plane — drives the overview badge and tool guards. */
  lod: LodState | null;
  /** In-flight map load, or null. Drives MapLoadingOverlay. */
  loading: LoadingState | null;
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
  formatId: MUDLET_DAT_FORMAT_ID,
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
  status: null,
  structureVersion: 0,
  dataVersion: 0,
  snapCursor: null,
  cursorMap: null,
  clipboard: null,
  sidebarTab: 'selection',
  panelCollapsed: false,
  panelExpanded: false,
  panelWidth: userSettings.panelWidth,
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
  route: { fromId: null, toId: null, algorithm: 'astar', summary: null, status: 'idle' },
  warningAckVersion: 0,
  warnings: [],
  peers: [],
  incomingRooms: null,
  lod: null,
  loading: null,
};

/** How a sidebar tab reacts to the selection changing. A tab that claims the
 *  matching flag stays open; anything else yields to the Selection tab. */
export interface TabSelectionAwareness {
  selectionAware?: boolean;
  multiSelectionAware?: boolean;
}

/** A tab the settings modal can configure. Built-ins carry no label — the modal
 *  translates `panels:sidebar.<id>`; plugin tabs bring their own label node. */
export interface RegisteredTab {
  id: string;
  label: ReactNode | null;
}

/** Built-in tab ids, in tab-bar order. The Selection tab itself is the fallback
 *  every other tab falls back *to*, so it is never listed. */
const BUILTIN_CONFIGURABLE_TABS = ['areas', 'envs', 'history', 'map', 'script', 'route'] as const;

const BUILTIN_TAB_AWARENESS: Record<string, TabSelectionAwareness> = {
  // The script panel operates on whatever is selected, so reselecting rooms
  // must not yank the user out of a half-written script.
  script: { selectionAware: true, multiSelectionAware: true },
};

/** Plugin-contributed tabs, with the awareness defaults they declared. */
let pluginTabs: SidebarTab[] = [];
/** User overrides from the settings modal — they win over both default layers. */
let userTabAwareness: Record<string, TabSelectionAwareness> = userSettings.tabAwareness;

/**
 * Publish the plugin-contributed sidebar tabs to the registry. Replaces any
 * previous registration. Their `selectionAware` / `multiSelectionAware` flags
 * become that tab's defaults, and the tab shows up in the settings modal next
 * to the built-ins so the user can override them like any other.
 */
export function registerPluginSidebarTabs(tabs: SidebarTab[]): void {
  pluginTabs = tabs;
}

/** Every tab whose selection behaviour is user-configurable, built-ins first. */
export function listConfigurableTabs(): RegisteredTab[] {
  return [
    ...BUILTIN_CONFIGURABLE_TABS.map((id) => ({ id, label: null })),
    ...pluginTabs.map((tab) => ({ id: tab.id, label: tab.label })),
  ];
}

/** Effective awareness of a tab: built-in default, plugin default, user override. */
export function getTabSelectionAwareness(tabId: string): TabSelectionAwareness {
  const plugin = pluginTabs.find((tab) => tab.id === tabId);
  return {
    ...BUILTIN_TAB_AWARENESS[tabId],
    ...(plugin && { selectionAware: plugin.selectionAware, multiSelectionAware: plugin.multiSelectionAware }),
    ...userTabAwareness[tabId],
  };
}

/** Persist a user override for one tab. */
export function setTabSelectionAwareness(tabId: string, patch: TabSelectionAwareness): void {
  userTabAwareness = { ...userTabAwareness, [tabId]: { ...getTabSelectionAwareness(tabId), ...patch } };
  saveUserSettings({ tabAwareness: userTabAwareness });
}

/** Drop every user override, restoring built-in and plugin defaults. */
export function resetTabSelectionAwareness(): void {
  userTabAwareness = {};
  saveUserSettings({ tabAwareness: {} });
}

function tabKeepsSelection(tabId: string, selection: Selection): boolean {
  const caps = getTabSelectionAwareness(tabId);
  const multi = selection?.kind === 'room' && selection.ids.length > 1;
  return multi ? !!caps.multiSelectionAware : !!caps.selectionAware;
}

type Listener = (state: EditorState) => void;

class Store {
  private state: EditorState = initial;
  private listeners = new Set<Listener>();

  getState = (): EditorState => this.state;

  setState = (patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => {
    let next = typeof patch === 'function' ? patch(this.state) : patch;
    // Selecting an element normally jumps to the Selection tab — unless the open
    // tab declares itself selection-aware (see registerSelectionAwareTabs).
    if (
      'selection' in next &&
      next.selection !== this.state.selection &&
      next.selection !== null &&
      !('sidebarTab' in next) &&
      !tabKeepsSelection(this.state.sidebarTab, next.selection ?? null)
    ) {
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
  bumpAckVersion = () => this.setState((s) => ({ warningAckVersion: s.warningAckVersion + 1 }));
}

export const store = new Store();

/**
 * Mark the map as saved at the current undo depth, clearing the toolbar's dirty
 * marker.
 *
 * The built-in save folds this into its own state update. Exported for plugins
 * that take over the save action via `EditorPlugin.toolbarActions` and persist
 * the map somewhere other than a file: without it their save would leave the
 * asterisk showing.
 */
export function markMapSaved(): void {
  store.setState((s) => ({ savedUndoLength: s.undo.length }));
}

export function useEditorState<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(initial),
  );
}
