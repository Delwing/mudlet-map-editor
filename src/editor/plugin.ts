import type { ReactNode } from 'react';
import type { MudletMap, MudletRoom } from '../mapIO';
import type { SwatchSet } from './types';
import type { SceneHandle } from './scene';

export interface SidebarTab {
  id: string;
  label: string;
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
  onAppReady?(): Promise<void>;
  onMapOpened?(map: MudletMap): void;
  onMapClosed?(): void;
  onMapSave?(bytes: Uint8Array): void;
  renderOverlay?(): ReactNode;
  sidebarTabs?(): SidebarTab[];
  swatchSets?(): SwatchSet[];
  /** Contribute additional sections rendered at the bottom of the room selection panel. */
  roomPanelSections?(): RoomPanelSection[];
}
