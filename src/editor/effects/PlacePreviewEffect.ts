import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import { snap } from '../coords';
import type { SceneHandle } from '../scene';

function toRgba(rgbStr: string, alpha: number): string {
  const m = rgbStr.match(/\d+/g);
  if (!m || m.length < 3) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
}

/** Above this, per-room ghosts get too heavy for mousemove-rate redraws —
 *  fall back to a single dashed bounding box. */
const MAX_GHOST_ROOMS = 300;

/** Ghost preview for an armed `placeRooms` pending: the clipboard's rooms are
 *  drawn as dashed rectangles following the cursor at their relative offsets,
 *  snapped exactly like the eventual paste. */
export class PlacePreviewEffect implements LiveEffect {
  private rects = new Map<number, Konva.Rect>();
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private strokeWidth = 0.06;
  private dash = [0.2, 0.15];

  constructor(
    private readonly settings: { roomSize: number },
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

  private sync(state: EditorState): void {
    if (!this.layer) return;
    const p = state.pending;
    const cursor = state.cursorMap;
    if (!p || p.kind !== 'placeRooms' || !cursor) {
      if (this.rects.size > 0) {
        this.rects.forEach((r) => r.destroy());
        this.rects.clear();
        this.layer.batchDraw();
      }
      return;
    }

    // Same anchor math as the paste commit: snap (or round) the cursor in raw space.
    const snapFn = state.snapToGrid ? (v: number) => snap(v, state.gridStep) : Math.round;
    const dx = snapFn(cursor.x) - p.clipboard.origin.x;
    const dy = snapFn(-cursor.y) - p.clipboard.origin.y;

    const rs = this.settings.roomSize;
    const pad = 0.05;
    const reader = this.sceneRef.current?.reader;
    const specs: Array<{ key: number; x: number; y: number; w: number; h: number; env: number | null }> = [];

    if (p.clipboard.rooms.length > MAX_GHOST_ROOMS) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const { room } of p.clipboard.rooms) {
        const x = room.x + dx;
        const y = -(room.y + dy);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      specs.push({
        key: -1,
        x: minX - rs / 2 - pad,
        y: minY - rs / 2 - pad,
        w: maxX - minX + rs + pad * 2,
        h: maxY - minY + rs + pad * 2,
        env: null,
      });
    } else {
      for (const { origId, room } of p.clipboard.rooms) {
        specs.push({
          key: origId,
          x: room.x + dx - rs / 2 - pad,
          y: -(room.y + dy) - rs / 2 - pad,
          w: rs + pad * 2,
          h: rs + pad * 2,
          env: room.environment ?? 1,
        });
      }
    }

    const wanted = new Set(specs.map((s) => s.key));
    for (const [key, rect] of this.rects) {
      if (!wanted.has(key)) {
        rect.destroy();
        this.rects.delete(key);
      }
    }

    for (const spec of specs) {
      const colorStr = spec.env != null
        ? reader?.getColorValue(spec.env) ?? 'rgb(128,128,128)'
        : 'rgb(143,184,255)';
      let rect = this.rects.get(spec.key);
      if (!rect) {
        rect = new Konva.Rect({
          strokeWidth: this.strokeWidth,
          dash: [...this.dash],
          cornerRadius: 0.04,
          listening: false,
        });
        this.layer.add(rect);
        this.rects.set(spec.key, rect);
      }
      rect.fill(toRgba(colorStr, 0.2));
      rect.stroke(toRgba(colorStr, 0.65));
      rect.x(spec.x);
      rect.y(spec.y);
      rect.width(spec.w);
      rect.height(spec.h);
    }

    this.layer.batchDraw();
  }
}
