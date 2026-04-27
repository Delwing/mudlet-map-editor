import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';

/** Room silhouette preview at the snapped cell — used for Add Room. */
export class SnapIndicatorEffect implements LiveEffect {
  private rect?: Konva.Rect;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;

  constructor(private readonly settings: { roomSize: number }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    const rs = this.settings.roomSize;
    this.rect = new Konva.Rect({
      width: rs,
      height: rs,
      offsetX: rs / 2,
      offsetY: rs / 2,
      fill: 'rgba(143, 184, 255, 0.25)',
      stroke: '#8fb8ff',
      strokeWidth: 0.04,
      cornerRadius: 0.04,
      listening: false,
      visible: false,
    });
    layer.add(this.rect);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    if (this.rect) {
      this.rect.strokeWidth(Math.max(0.02, 1.5 / scale));
      this.layer?.batchDraw();
    }
  }

  syncPositions(): void {
    this.sync(store.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.rect?.destroy();
  }

  private sync(state: EditorState): void {
    if (!this.rect || !this.layer) return;
    const c = state.activeTool === 'addRoom' ? state.snapCursor : null;
    if (!c) {
      if (this.rect.visible()) {
        this.rect.visible(false);
        this.layer.batchDraw();
      }
      return;
    }
    const rs = this.settings.roomSize;
    this.rect.width(rs);
    this.rect.height(rs);
    this.rect.offsetX(rs / 2);
    this.rect.offsetY(rs / 2);
    this.rect.x(c.x);
    this.rect.y(c.y);
    this.rect.visible(true);
    this.layer.batchDraw();
  }
}
