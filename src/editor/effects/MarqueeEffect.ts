import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';

export class MarqueeEffect implements LiveEffect {
  private rect?: Konva.Rect;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.rect = new Konva.Rect({
      stroke: '#00e5ff',
      strokeWidth: 0.06,
      fill: 'rgba(0, 229, 255, 0.08)',
      dash: [0.3, 0.2],
      cornerRadius: 0.02,
      listening: false,
      visible: false,
    });
    layer.add(this.rect);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    if (this.rect) {
      this.rect.strokeWidth(Math.max(0.02, 1.5 / scale));
      this.rect.dash([Math.max(0.1, 5 / scale), Math.max(0.07, 3 / scale)]);
    }
    this.layer?.batchDraw();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.rect?.destroy();
  }

  private sync(state: EditorState): void {
    if (!this.rect || !this.layer) return;
    const p = state.pending;
    if (p?.kind !== 'marquee') {
      if (this.rect.visible()) {
        this.rect.visible(false);
        this.layer.batchDraw();
      }
      return;
    }
    const x = Math.min(p.startX, p.currentX);
    const y = Math.min(p.startY, p.currentY);
    const w = Math.abs(p.currentX - p.startX);
    const h = Math.abs(p.currentY - p.startY);
    this.rect.x(x);
    this.rect.y(y);
    this.rect.width(w);
    this.rect.height(h);
    this.rect.visible(true);
    this.layer.batchDraw();
  }
}
