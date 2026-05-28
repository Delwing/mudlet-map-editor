import type { CSSProperties, ReactNode } from 'react';
import type { MudletMap, MudletRoom } from '../mapIO';
import type { SwatchSet } from './types';
import type { SceneHandle } from './scene';

export interface PluginCheckResult {
  /** Stable identifier for this warning instance; used to namespace ack keys. */
  id: string;
  /** Bold title shown in the warnings list. */
  message: string;
  /** Optional secondary description. */
  detail?: string;
  /** If set, the "Go" button navigates to this room. */
  roomId?: number;
}

export interface SidebarTab {
  id: string;
  label: ReactNode;
  render(sceneRef: { current: SceneHandle | null }): ReactNode;
}

export interface RoomSectionProps {
  roomId: number;
  room: NonNullable<MudletRoom>;
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
}

export interface RoomPanelSection {
  id: string;
  render(props: RoomSectionProps): ReactNode;
}

/** A button in the toolbar header row's file-action group. Plugins reshape the
 *  list via `toolbarActions` — filter to hide built-ins, map to override
 *  callbacks/labels, or push to add new entries. Built-in ids are 'new',
 *  'load', 'loadUrl', and 'save'. */
export interface ToolbarAction {
  /** Stable id; plugins target a specific action by matching on this. */
  id: string;
  /** Tooltip text shown on hover. */
  title?: string;
  /** Button contents — typically an SVG icon, but any node works. */
  icon?: ReactNode;
  /** Click handler. Ignored when `filePicker` is set. */
  onClick?: () => void;
  /** When set, the action renders as a `<label>` wrapping a hidden `<input
   *  type="file">`; clicking opens the OS file picker and the chosen file is
   *  passed to `onFile`. Used by the built-in "load .dat" entry. */
  filePicker?: { accept: string; onFile: (file: File) => void };
  /** Disable the button (greys out + ignores clicks). */
  disabled?: boolean;
  /** Overlay node rendered on top of the button — used by the built-in
   *  "save" entry to draw the dirty-marker asterisk. */
  badge?: ReactNode;
  /** Inline style for the button/label root. */
  style?: CSSProperties;
  /** Escape hatch: when set, every other field except `id` is ignored and
   *  this node is rendered in place. Use for controls that aren't a single
   *  button (e.g. a dropdown). */
  render?: () => ReactNode;
}

export interface EditorPlugin {
  /** Stable identifier used to namespace plugin warning ack keys. Defaults to array index if omitted. */
  id?: string;
  onAppReady?(): Promise<void>;
  onMapOpened?(map: MudletMap): void;
  onMapClosed?(): void;
  onMapSave?(bytes: Uint8Array): void;
  renderOverlay?(): ReactNode;
  /** Replace the toolbar logo. The first plugin that defines this hook claims
   *  the slot — its return value is rendered as-is (including `null`, which
   *  hides the logo entirely). When no plugin defines it, the built-in Mudlet
   *  logo appears. */
  renderLogo?(): ReactNode;
  /** Reshape the toolbar's file-action button list. The hook receives the
   *  current list (built-ins first, then any earlier-plugin additions) and
   *  returns a new list. Typical uses:
   *    - **Hide** a built-in: `actions.filter(a => a.id !== 'loadUrl')`
   *    - **Replace a callback**: `actions.map(a => a.id === 'save'
   *        ? { ...a, onClick: mySave } : a)` (keeps the button visuals,
   *        swaps the behaviour — onMapSave still fires when the editor
   *        serialises the map elsewhere)
   *    - **Add** a custom button: `[...actions, { id, title, icon, onClick }]`
   *  Plugin transforms are applied in plugin order. */
  toolbarActions?(actions: ToolbarAction[]): ToolbarAction[];
  sidebarTabs?(): SidebarTab[];
  swatchSets?(): SwatchSet[];
  /** Contribute additional sections rendered at the bottom of the room selection panel. */
  roomPanelSections?(): RoomPanelSection[];
  /** Return custom map warnings. Called whenever built-in warnings are recomputed. */
  mapChecks?(map: MudletMap, sceneRef: { current: SceneHandle | null }): PluginCheckResult[];
}
