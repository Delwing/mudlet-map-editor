import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';

function toRgba(rgbStr: string, alpha: number): string {
  const m = rgbStr.match(/\d+/g);
  if (!m || m.length < 3) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
}

export class GhostRoomsEffect implements LiveEffect {
  private rects = new Map<number, Konva.Rect>();
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private strokeWidth = 0.06;
  private dash = [0.2, 0.15];

  constructor(
    private readonly roomSize: number,
    private readonly sceneRef: { current: SceneHandle | null },
  ) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    this.strokeWidth = Math.max(0.03, 2 / scale);
    this.dash = [Math.max(0.1, 6 / scale), Math.max(0.08, 5 / scale)];
    this.rects.forEach((r) => {
      r.strokeWidth(this.strokeWidth);
      r.dash([...this.dash]);
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

  private computePositions(state: EditorState): Map<number, { x: number; y: number }> {
    const result = new Map<number, { x: number; y: number }>();
    const { selection, spreadShrink, currentAreaId, currentZ } = state;
    const scene = this.sceneRef.current;
    if (!spreadShrink || !selection || selection.kind !== 'room' || !scene) return result;

    const rooms: { id: number; x: number; y: number }[] = [];
    for (const id of selection.ids) {
      const room = scene.getRenderRoom(id);
      if (!room || room.z !== currentZ || room.area !== currentAreaId) continue;
      rooms.push({ id, x: room.x, y: room.y });
    }
    if (rooms.length < 2) return result;

    let cx: number, cy: number;
    if (spreadShrink.centerMode === 'anchor' && spreadShrink.anchorRoomId !== null) {
      const anchor = scene.getRenderRoom(spreadShrink.anchorRoomId);
      cx = anchor ? anchor.x : rooms.reduce((s, r) => s + r.x, 0) / rooms.length;
      cy = anchor ? anchor.y : rooms.reduce((s, r) => s + r.y, 0) / rooms.length;
    } else {
      cx = rooms.reduce((s, r) => s + r.x, 0) / rooms.length;
      cy = rooms.reduce((s, r) => s + r.y, 0) / rooms.length;
    }
    const { factor } = spreadShrink;
    const snapFn = state.snapToGrid
      ? (v: number) => Math.round(v / state.gridStep) * state.gridStep
      : (v: number) => v;

    for (const { id, x, y } of rooms) {
      result.set(id, {
        x: snapFn(cx + (x - cx) * factor),
        y: snapFn(cy + (y - cy) * factor),
      });
    }
    return result;
  }

  private sync(state: EditorState): void {
    if (!this.layer) return;

    const scene = this.sceneRef.current;
    const positions = this.computePositions(state);

    for (const [id, rect] of this.rects) {
      if (!positions.has(id)) {
        rect.destroy();
        this.rects.delete(id);
      }
    }

    const pad = 0.05;
    const size = this.roomSize + pad * 2;

    for (const [id, pos] of positions) {
      const liveRoom = scene?.getRenderRoom(id);
      const colorStr = scene?.reader.getColorValue(liveRoom?.env ?? 1) ?? 'rgb(128,128,128)';
      const fill = toRgba(colorStr, 0.2);
      const stroke = toRgba(colorStr, 0.65);

      let rect = this.rects.get(id);
      if (!rect) {
        rect = new Konva.Rect({
          strokeWidth: this.strokeWidth,
          dash: [...this.dash],
          cornerRadius: 0.04,
          listening: false,
        });
        this.layer.add(rect);
        this.rects.set(id, rect);
      }
      rect.fill(fill);
      rect.stroke(stroke);
      rect.x(pos.x - this.roomSize / 2 - pad);
      rect.y(pos.y - this.roomSize / 2 - pad);
      rect.width(size);
      rect.height(size);
    }

    this.layer.batchDraw();
  }
}
