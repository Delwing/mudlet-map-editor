import { MapRenderer, createSettings } from 'mudlet-map-renderer';
import type { MudletMap } from '../../mapIO';
import { EditorMapReader } from '../reader/EditorMapReader';
import { DiffHighlightOverlay, collectHighlights, type DiffHighlight } from './DiffHighlightOverlay';
import type { MapDiff } from './mapDiff';

export interface DiffPane {
  renderer: MapRenderer;
  reader: EditorMapReader;
  overlay: DiffHighlightOverlay;
  setView(areaId: number, z: number): void;
  /** Show or hide the diff highlight tints. */
  setHighlightsEnabled(enabled: boolean): void;
  /** Emphasize a single change by its key (or clear with null). */
  setHover(key: string | null): void;
  /** Pan to a map-space room/point (raw Mudlet coords; Y is flipped internally). */
  panToRoom(rawX: number, rawY: number): void;
  destroy(): void;
}

/** A bare, read-only renderer pane for one side of a map diff. */
export function createDiffPane(
  map: MudletMap,
  container: HTMLDivElement,
  diff: MapDiff,
  side: 'old' | 'new',
): DiffPane {
  const settings = createSettings();
  settings.gridEnabled = true;
  settings.highlightCurrentRoom = false;
  settings.areaName = false;
  settings.labelRenderMode = 'image';

  const reader = new EditorMapReader(map);
  const renderer = new MapRenderer(reader as any, settings, container);

  const highlights: DiffHighlight[] = collectHighlights(diff, map, side, settings.roomSize);
  const overlay = new DiffHighlightOverlay(highlights);
  renderer.addSceneOverlay('diff.highlight', overlay);

  // The renderer only reacts to window / DOM 'resize' events, which a flex
  // pane never fires — so the Konva stage keeps its creation-time size when the
  // modal opens or the divider is dragged. Observe the container and push the
  // new size to the camera (which resizes the stage and redraws).
  let lastW = container.clientWidth;
  let lastH = container.clientHeight;
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    if (w > 0 && h > 0) renderer.camera.setSize(w, h);
  });
  resizeObserver.observe(container);

  return {
    renderer,
    reader,
    overlay,
    setView(areaId, z) {
      renderer.drawArea(areaId, z);
      overlay.setView(areaId, z);
      const area = reader.getArea(areaId);
      const isEmpty = !area || area.getRooms().every((r) => r.z !== z);
      if (isEmpty) {
        renderer.camera.panToMapPoint(0, 0);
      } else {
        renderer.fitArea();
      }
    },
    setHighlightsEnabled(enabled) {
      overlay.setEnabled(enabled);
    },
    setHover(key) {
      overlay.setHoverKey(key);
    },
    panToRoom(rawX, rawY) {
      // EditorMapReader negates Y, so render-space Y = -rawY.
      renderer.camera.panToMapPoint(rawX, -rawY);
    },
    destroy() {
      resizeObserver.disconnect();
      renderer.removeSceneOverlay('diff.highlight');
      renderer.destroy();
    },
  };
}

/** Copy zoom + center from one pane to another (programmatic; emits no events). */
export function alignCamera(from: DiffPane, to: DiffPane): void {
  const b = from.renderer.getViewportBounds();
  to.renderer.setZoom(from.renderer.getZoom());
  to.renderer.camera.panToMapPoint((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  to.renderer.refresh();
}

/**
 * Mirror pan/zoom between two panes. Returns an unsubscribe function.
 * Reentrancy is guarded so a mirrored move does not echo back.
 */
export function linkCameras(a: DiffPane, b: DiffPane): () => void {
  let syncing = false;

  const mirror = (from: DiffPane, to: DiffPane) => () => {
    if (syncing) return;
    syncing = true;
    try {
      const b = from.renderer.getViewportBounds();
      to.renderer.setZoom(from.renderer.getZoom());
      to.renderer.camera.panToMapPoint((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
      to.renderer.refresh();
    } finally {
      syncing = false;
    }
  };

  const aToB = mirror(a, b);
  const bToA = mirror(b, a);
  // Mirror both pan (drag) and zoom (wheel) interactions.
  a.renderer.on('pan', aToB);
  a.renderer.on('zoom', aToB);
  b.renderer.on('pan', bToA);
  b.renderer.on('zoom', bToA);

  return () => {
    a.renderer.off('pan', aToB);
    a.renderer.off('zoom', aToB);
    b.renderer.off('pan', bToA);
    b.renderer.off('zoom', bToA);
  };
}
