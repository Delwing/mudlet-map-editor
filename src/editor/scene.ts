import { MapRenderer, createSettings, type Settings } from 'mudlet-map-renderer';
import type { MudletMap } from '../mapIO';
import { EditorMapReader, type LiveRoom } from './reader/EditorMapReader';
import { SelectionHaloEffect } from './effects/SelectionHaloEffect';
import { HoverHaloEffect } from './effects/HoverHaloEffect';
import { RubberBandEffect } from './effects/RubberBandEffect';
import { SnapIndicatorEffect } from './effects/SnapIndicatorEffect';
import { ConnectHandlesEffect } from './effects/ConnectHandlesEffect';
import { CustomLinePreviewEffect } from './effects/CustomLinePreviewEffect';
import { SelectedLinkEffect } from './effects/SelectedLinkEffect';
import { GridOverlayEffect } from './effects/GridOverlayEffect';
import { MarqueeEffect } from './effects/MarqueeEffect';
import { attachPointerController } from './pointerController';
import { store } from './store';

export interface SceneHandle {
  renderer: MapRenderer;
  reader: EditorMapReader;
  settings: Settings;
  /** Render-space room (y flipped). Reads pass through to raw. */
  getRenderRoom(id: number): LiveRoom | undefined;
  /** Switch displayed area / z-level. Redraws and fits the viewport. */
  setArea(areaId: number, z: number, insets?: { top?: number; right?: number; bottom?: number; left?: number }): void;
  /** Switch displayed area / z-level and pan to a specific map-space point, keeping the current zoom. */
  setAreaAt(areaId: number, z: number, mapX: number, mapY: number): void;
  refresh(): void;
  destroy(): void;
}

export function createScene(map: MudletMap, container: HTMLDivElement): SceneHandle {
  const settings = createSettings();
  settings.gridEnabled = true;
  settings.highlightCurrentRoom = false;
  settings.areaName = false;

  container.dataset.editorCursor = 'true';

  const reader = new EditorMapReader(map);
  const renderer = new MapRenderer(reader as any, settings, container);

  const sceneRef: { current: SceneHandle | null } = { current: null };

  const marquee = new MarqueeEffect();
  const selectionHalo = new SelectionHaloEffect(settings.roomSize, sceneRef);
  const hoverHalo = new HoverHaloEffect(settings.roomSize, sceneRef);
  const rubberBand = new RubberBandEffect(sceneRef);
  const snapIndicator = new SnapIndicatorEffect(settings.roomSize);
  const connectHandles = new ConnectHandlesEffect(settings.roomSize, sceneRef);
  const customLinePreview = new CustomLinePreviewEffect();
  const selectedLink = new SelectedLinkEffect(sceneRef, settings.roomSize);
  const gridOverlay = new GridOverlayEffect(
    settings.gridColor,
    settings.gridLineWidth,
    settings.gridSize,
    () => {
      const s = store.getState();
      if (s.currentAreaId == null) return false;
      const area = reader.getArea(s.currentAreaId);
      if (!area) return false;
      return area.getRooms().every(r => r.z !== s.currentZ);
    },
    () => renderer.backend.viewport.getViewportBounds(),
  );

  renderer.addLiveEffect('editor.marquee', marquee);
  renderer.addLiveEffect('editor.selection', selectionHalo);
  renderer.addLiveEffect('editor.hover', hoverHalo);
  renderer.addLiveEffect('editor.rubberband', rubberBand);
  renderer.addLiveEffect('editor.snap', snapIndicator);
  renderer.addLiveEffect('editor.connectHandles', connectHandles);
  renderer.addLiveEffect('editor.customLinePreview', customLinePreview);
  renderer.addLiveEffect('editor.selectedLink', selectedLink);
  renderer.addLiveEffect('editor.gridOverlay', gridOverlay);

  const handle: SceneHandle = {
    renderer,
    reader,
    settings,
    getRenderRoom(id) { return reader.getRoom(id); },
    setArea(areaId, z, insets?) {
      renderer.drawArea(areaId, z);
      const area = reader.getArea(areaId);
      const isEmpty = !area || area.getRooms().every(r => r.z !== z);
      if (isEmpty) {
        renderer.backend.viewport.panToMapPoint(0, 0);
      } else {
        renderer.fitArea(insets);
      }
      // Renderer skips applyViewportToStage for empty areas, so the grid overlay
      // won't get updateViewport. Sync it explicitly here.
      gridOverlay.syncVisibility();
    },
    setAreaAt(areaId, z, mapX, mapY) {
      renderer.drawArea(areaId, z);
      renderer.backend.viewport.panToMapPoint(mapX, mapY);
      gridOverlay.syncVisibility();
    },
    refresh() { renderer.refresh(); },
    destroy() {
      delete container.dataset.editorCursor;
      detach();
      renderer.removeLiveEffect('editor.selection');
      renderer.removeLiveEffect('editor.hover');
      renderer.removeLiveEffect('editor.rubberband');
      renderer.removeLiveEffect('editor.snap');
      renderer.removeLiveEffect('editor.connectHandles');
      marquee.destroy();
      renderer.removeLiveEffect('editor.marquee');
      selectionHalo.destroy();
      hoverHalo.destroy();
      rubberBand.destroy();
      snapIndicator.destroy();
      connectHandles.destroy();
      customLinePreview.destroy();
      renderer.removeLiveEffect('editor.customLinePreview');
      selectedLink.destroy();
      renderer.removeLiveEffect('editor.selectedLink');
      gridOverlay.destroy();
      renderer.removeLiveEffect('editor.gridOverlay');
      renderer.destroy();
    },
  };

  sceneRef.current = handle;

  const detach = attachPointerController({
    renderer,
    container,
    settings,
    refresh: () => renderer.refresh(),
    scene: handle,
  });

  return handle;
}
