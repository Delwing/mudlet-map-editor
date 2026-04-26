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
import { LabelHaloEffect } from './effects/LabelHaloEffect';
import { SelectionCenterEffect } from './effects/SelectionCenterEffect';
import { GhostRoomsEffect } from './effects/GhostRoomsEffect';
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
  settings.labelRenderMode = 'image'

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
  const customLinePreview = new CustomLinePreviewEffect(sceneRef);
  const selectedLink = new SelectedLinkEffect(sceneRef, settings.roomSize);
  const labelHalo = new LabelHaloEffect(sceneRef);
  const selectionCenter = new SelectionCenterEffect(sceneRef);
  const ghostRooms = new GhostRoomsEffect(settings.roomSize, sceneRef);

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
    () => renderer.getViewportBounds(),
  );

  const konva = renderer.konvaBackend!;
  konva.addLiveEffect('editor.marquee', marquee);
  konva.addLiveEffect('editor.selection', selectionHalo);
  konva.addLiveEffect('editor.hover', hoverHalo);
  konva.addLiveEffect('editor.rubberband', rubberBand);
  konva.addLiveEffect('editor.snap', snapIndicator);
  konva.addLiveEffect('editor.connectHandles', connectHandles);
  konva.addLiveEffect('editor.customLinePreview', customLinePreview);
  konva.addLiveEffect('editor.selectedLink', selectedLink);
  konva.addLiveEffect('editor.labelHalo', labelHalo);
  konva.addLiveEffect('editor.selectionCenter', selectionCenter);
  konva.addLiveEffect('editor.ghostRooms', ghostRooms);
  konva.addLiveEffect('editor.gridOverlay', gridOverlay);

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
        renderer.camera.panToMapPoint(0, 0);
      } else {
        renderer.fitArea(insets);
      }
      // Renderer skips applyViewportToStage for empty areas, so the grid overlay
      // won't get updateViewport. Sync it explicitly here.
      gridOverlay.syncVisibility();
    },
    setAreaAt(areaId, z, mapX, mapY) {
      renderer.drawArea(areaId, z);
      renderer.camera.panToMapPoint(mapX, mapY);
      gridOverlay.syncVisibility();
    },
    refresh() { renderer.refresh(); selectionHalo.syncPositions(); labelHalo.syncPositions(); selectionCenter.syncPositions(); ghostRooms.syncPositions(); },
    destroy() {
      delete container.dataset.editorCursor;
      detach();
      konva.removeLiveEffect('editor.selection');
      konva.removeLiveEffect('editor.hover');
      konva.removeLiveEffect('editor.rubberband');
      konva.removeLiveEffect('editor.snap');
      konva.removeLiveEffect('editor.connectHandles');
      marquee.destroy();
      konva.removeLiveEffect('editor.marquee');
      selectionHalo.destroy();
      hoverHalo.destroy();
      rubberBand.destroy();
      snapIndicator.destroy();
      connectHandles.destroy();
      customLinePreview.destroy();
      konva.removeLiveEffect('editor.customLinePreview');
      selectedLink.destroy();
      konva.removeLiveEffect('editor.selectedLink');
      labelHalo.destroy();
      konva.removeLiveEffect('editor.labelHalo');
      selectionCenter.destroy();
      konva.removeLiveEffect('editor.selectionCenter');
      ghostRooms.destroy();
      konva.removeLiveEffect('editor.ghostRooms');
      gridOverlay.destroy();
      konva.removeLiveEffect('editor.gridOverlay');
      renderer.destroy();
    },
  };

  sceneRef.current = handle;

  const detach = attachPointerController({
    renderer,
    container,
    settings,
    refresh: () => handle.refresh(),
    scene: handle,
  });

  return handle;
}
