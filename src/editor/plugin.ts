import type { ReactNode } from 'react';
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

export interface EditorPlugin {
  /** Stable identifier used to namespace plugin warning ack keys. Defaults to array index if omitted. */
  id?: string;
  onAppReady?(): Promise<void>;
  onMapOpened?(map: MudletMap): void;
  onMapClosed?(): void;
  onMapSave?(bytes: Uint8Array): void;
  renderOverlay?(): ReactNode;
  sidebarTabs?(): SidebarTab[];
  swatchSets?(): SwatchSet[];
  /** Contribute additional sections rendered at the bottom of the room selection panel. */
  roomPanelSections?(): RoomPanelSection[];
  /** Return custom map warnings. Called whenever built-in warnings are recomputed. */
  mapChecks?(map: MudletMap, sceneRef: { current: SceneHandle | null }): PluginCheckResult[];
}
