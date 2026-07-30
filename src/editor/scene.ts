import { MapRenderer, createSettings, type LodEventDetail, type Settings } from 'mudlet-map-renderer';
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
import { PlacePreviewEffect } from './effects/PlacePreviewEffect';
import { RouteEffect } from './effects/RouteEffect';
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
  // Keep hidden rooms on-screen so they stay selectable/editable — the renderer's
  // default "hide" mode would drop them (and their exits) from the scene entirely.
  settings.hiddenRooms = 'dashed';

  // Big maps: let the renderer fall back to its cheaper tiers on a dense plane
  // (rooms-only vector, then a raster overview) instead of building a vector
  // scene it can't afford. The switch is zoom-based, so zooming in always
  // returns to full detail.
  settings.lodEnabled = true;
  // …but never trade away pointer picking: every editor tool picks through
  // `renderer.hitTester`. The budget is measured against the rooms a plane
  // materialises, which EditorMapReader narrows to the viewport — so this only
  // ever fires where the vector tier itself is already at its room budget, and
  // losing picking there costs more than the index does. Raster mode drops the
  // index regardless; that we handle with a hint (see LodBadge).
  settings.lodHitTestBudget = Number.POSITIVE_INFINITY;

  container.dataset.editorCursor = 'true';

  const reader = new EditorMapReader(map);
  const renderer = new MapRenderer(reader as any, settings, container);

  const sceneRef: { current: SceneHandle | null } = { current: null };

  const marquee = new MarqueeEffect();
  const selectionHalo = new SelectionHaloEffect(settings, sceneRef);
  const hoverHalo = new HoverHaloEffect(settings, sceneRef);
  const rubberBand = new RubberBandEffect(sceneRef);
  const snapIndicator = new SnapIndicatorEffect(settings);
  const connectHandles = new ConnectHandlesEffect(settings, sceneRef);
  const customLinePreview = new CustomLinePreviewEffect(sceneRef);
  const selectedLink = new SelectedLinkEffect(sceneRef, settings);
  const labelHalo = new LabelHaloEffect(sceneRef);
  const selectionCenter = new SelectionCenterEffect(sceneRef);
  const ghostRooms = new GhostRoomsEffect(settings, sceneRef);
  const placePreview = new PlacePreviewEffect(settings, sceneRef);
  const route = new RouteEffect(sceneRef);

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

  renderer.addLiveEffect('editor.marquee', marquee);
  renderer.addLiveEffect('editor.selection', selectionHalo);
  renderer.addLiveEffect('editor.hover', hoverHalo);
  renderer.addLiveEffect('editor.rubberband', rubberBand);
  renderer.addLiveEffect('editor.snap', snapIndicator);
  renderer.addLiveEffect('editor.connectHandles', connectHandles);
  renderer.addLiveEffect('editor.customLinePreview', customLinePreview);
  renderer.addLiveEffect('editor.selectedLink', selectedLink);
  renderer.addLiveEffect('editor.labelHalo', labelHalo);
  renderer.addLiveEffect('editor.selectionCenter', selectionCenter);
  renderer.addLiveEffect('editor.ghostRooms', ghostRooms);
  renderer.addLiveEffect('editor.placePreview', placePreview);
  renderer.addLiveEffect('editor.route', route);
  renderer.addLiveEffect('editor.gridOverlay', gridOverlay);

  // Mirror the renderer's LOD decision into the store (badge + tool guards).
  // Emitted on every scene build, so guard against redundant store writes.
  const onLod = (d: LodEventDetail) => {
    const prev = store.getState().lod;
    if (prev && prev.mode === d.mode && prev.planeRoomCount === d.planeRoomCount &&
        prev.visibleEstimate === d.visibleEstimate && prev.hitTestActive === d.hitTestActive) return;
    store.setState({ lod: { ...d } });
  };
  renderer.on('lod', onLod);

  const handle: SceneHandle = {
    renderer,
    reader,
    settings,
    getRenderRoom(id) { return reader.getRoom(id); },
    setArea(areaId, z, insets?) {
      // An empty plane emits no `lod` event, so clear first rather than leave
      // the previous plane's tier showing.
      store.setState({ lod: null });
      renderer.drawArea(areaId, z);
      const area = reader.getArea(areaId);
      const isEmpty = !area || area.getRooms().every(r => r.z !== z);
      if (isEmpty) {
        renderer.camera.panToMapPoint(0, 0);
      } else {
        renderer.fitArea(insets);
      }
      // `drawArea` built the scene for the camera as it was *before* the fit, and
      // with a viewport-narrowed reader that window can hold none of the new
      // area. The renderer notices the camera moved and schedules a rebuild on
      // the next animation frame; rebuild now instead, so the area is right in
      // this frame — and at all in a hidden tab, where rAF never runs.
      renderer.refresh();
      // Renderer skips applyViewportToStage for empty areas, so the grid overlay
      // won't get updateViewport. Sync it explicitly here.
      gridOverlay.syncVisibility();
    },
    setAreaAt(areaId, z, mapX, mapY) {
      store.setState({ lod: null });
      renderer.drawArea(areaId, z);
      renderer.camera.panToMapPoint(mapX, mapY);
      renderer.refresh();   // same reason as setArea: don't wait for the scheduled frame
      gridOverlay.syncVisibility();
    },
    refresh() { renderer.refresh(); selectionHalo.syncPositions(); hoverHalo.syncPositions(); snapIndicator.syncPositions(); connectHandles.syncPositions(); labelHalo.syncPositions(); selectionCenter.syncPositions(); ghostRooms.syncPositions(); placePreview.syncPositions(); route.syncPositions(); },
    destroy() {
      delete container.dataset.editorCursor;
      detach();
      renderer.off('lod', onLod);
      store.setState({ lod: null });
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
      labelHalo.destroy();
      renderer.removeLiveEffect('editor.labelHalo');
      selectionCenter.destroy();
      renderer.removeLiveEffect('editor.selectionCenter');
      ghostRooms.destroy();
      renderer.removeLiveEffect('editor.ghostRooms');
      placePreview.destroy();
      renderer.removeLiveEffect('editor.placePreview');
      route.destroy();
      renderer.removeLiveEffect('editor.route');
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
    refresh: () => handle.refresh(),
    scene: handle,
  });

  return handle;
}
