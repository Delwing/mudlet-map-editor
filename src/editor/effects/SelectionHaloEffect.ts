import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';

export class SelectionHaloEffect implements LiveEffect {
  private rects = new Map<number, Konva.Rect>();
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private strokeWidth = 0.08;
  private dash = [0.2, 0.15];

  constructor(private readonly settings: { roomSize: number }, private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    this.strokeWidth = Math.max(0.03, 2 / scale);
    this.dash = [Math.max(0.1, 6 / scale), Math.max(0.08, 5 / scale)];
    this.rects.forEach((rect) => {
      rect.strokeWidth(this.strokeWidth);
      rect.dash([...this.dash]);
    });
    this.layer?.batchDraw();
  }

  syncPositions(): void {
    this.sync(store.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.rects.forEach((r) => r.destroy());
    this.rects.clear();
  }

  private sync(state: EditorState): void {
    if (!this.layer) return;
    const sel = state.selection;
    const scene = this.sceneRef.current;

    const wanted = new Set<number>();
    if (sel?.kind === 'room' && scene) {
      for (const id of sel.ids) {
        const room = scene.getRenderRoom(id);
        if (!room || room.z !== state.currentZ || room.area !== state.currentAreaId) continue;
        wanted.add(id);
      }
    }

    // Remove rects no longer needed.
    for (const [id, rect] of this.rects) {
      if (!wanted.has(id)) {
        rect.destroy();
        this.rects.delete(id);
      }
    }

    // Update or create rects for wanted IDs.
    const pad = 0.18;
    const rs = this.settings.roomSize;
    const size = rs + pad * 2;
    for (const id of wanted) {
      const room = scene!.getRenderRoom(id)!;
      const x = room.x - rs / 2 - pad;
      const y = room.y - rs / 2 - pad;
      let rect = this.rects.get(id);
      if (!rect) {
        rect = new Konva.Rect({
          stroke: '#00e5ff',
          strokeWidth: this.strokeWidth,
          dash: [...this.dash],
          cornerRadius: 0.05,
          listening: false,
        });
        this.layer.add(rect);
        this.rects.set(id, rect);
      }
      rect.x(x);
      rect.y(y);
      rect.width(size);
      rect.height(size);
      rect.visible(true);
    }

    this.layer.batchDraw();
  }
}
