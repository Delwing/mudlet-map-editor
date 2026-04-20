import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';

/** Draws waypoints + in-progress line while the custom line tool is active. */
export class CustomLinePreviewEffect implements LiveEffect {
  private group?: Konva.Group;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.group = new Konva.Group({ listening: false, visible: false });
    layer.add(this.group);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    if (!this.group) return;
    const w = Math.max(0.02, 1.5 / scale);
    this.group.getChildren().forEach((child) => {
      if (child instanceof Konva.Line || child instanceof Konva.Arrow) child.strokeWidth(w);
      if (child instanceof Konva.Circle) child.radius(Math.max(0.05, 4 / scale));
    });
    this.layer?.batchDraw();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.group?.destroy();
  }

  private sync(state: EditorState): void {
    if (!this.group || !this.layer) return;
    const p = state.pending;

    if (!p || p.kind !== 'customLine' || p.points.length === 0) {
      if (this.group.visible()) {
        this.group.visible(false);
        this.layer.batchDraw();
      }
      return;
    }

    this.group.destroyChildren();

    const color = `rgb(${p.color.r},${p.color.g},${p.color.b})`;

    // Committed segments are drawn by the renderer itself (we write through to raw
    // on every waypoint add). Here we only draw the dashed cursor-preview segment
    // and waypoint dot handles.

    if (p.cursor && p.points.length >= 1) {
      const last = p.points[p.points.length - 1];
      const preview = new Konva.Line({
        points: [last[0], last[1], p.cursor.x, p.cursor.y],
        stroke: color,
        strokeWidth: 0.06,
        dash: [0.2, 0.15],
        listening: false,
        opacity: 0.6,
      });
      this.group.add(preview);
    }

    for (const [x, y] of p.points) {
      const dot = new Konva.Circle({
        x, y,
        radius: 0.08,
        fill: color,
        listening: false,
      });
      this.group.add(dot);
    }

    this.group.visible(true);
    this.layer.batchDraw();
  }
}
