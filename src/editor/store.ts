import { useSyncExternalStore } from 'react';
import type { MudletMap } from '../mapIO';
import type { Command, HitItem, HoverTarget, LoadedMap, Pending, Selection, ToolId } from './types';

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
  sidebarTab: 'selection' | 'areas' | 'envs' | 'history' | 'map';
  panelCollapsed: boolean;
  contextMenu: ContextMenuState;
  savedUndoLength: number;
  /** When set, the next area/z navigation pans to this map-space point instead of fitting. Consumed and cleared by App. */
  navigateTo: { mapX: number; mapY: number } | null;
  /** Tracks the last Alt+click position (integer cell) and cycle index for overlapping-element cycling. */
  hitCycle: { x: number; y: number; index: number } | null;
  /** When true, label resize preserves the aspect ratio at the start of the drag. */
  labelAspectRatioLocked: boolean;
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
  | null;

const initial: EditorState = {
  map: null,
  loaded: null,
  currentAreaId: null,
  currentZ: 0,
  activeTool: 'select',
  selection: null,
  hover: null,
  pending: null,
  snapToGrid: true,
  gridStep: 1,
  spaceHeld: false,
  undo: [],
  redo: [],
  status: 'Load a Mudlet .dat file to begin.',
  structureVersion: 0,
  dataVersion: 0,
  snapCursor: null,
  sidebarTab: 'selection',
  panelCollapsed: false,
  contextMenu: null,
  savedUndoLength: 0,
  navigateTo: null,
  hitCycle: null,
  labelAspectRatioLocked: false,
};

type Listener = (state: EditorState) => void;

class Store {
  private state: EditorState = initial;
  private listeners = new Set<Listener>();

  getState = (): EditorState => this.state;

  setState = (patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
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
