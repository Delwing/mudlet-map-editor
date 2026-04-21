import type { ReactNode } from 'react';
import type { MudletMap } from '../mapIO';
import type { SwatchSet } from './types';
import type { SceneHandle } from './scene';

export interface SidebarTab {
  id: string;
  label: string;
  render(sceneRef: { current: SceneHandle | null }): ReactNode;
}

export interface EditorPlugin {
  onAppReady?(): Promise<void>;
  onMapOpened?(map: MudletMap): void;
  onMapClosed?(): void;
  onMapSave?(bytes: Uint8Array): void;
  renderOverlay?(): ReactNode;
  sidebarTabs?(): SidebarTab[];
  swatchSets?(): SwatchSet[];
}
