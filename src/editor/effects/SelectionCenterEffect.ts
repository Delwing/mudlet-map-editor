import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';

export class SelectionCenterEffect implements LiveEffect {
  private hLine?: Konva.Line;
  private vLine?: Konva.Line;
  private dot?: Konva.Circle;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;

  constructor(private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    const lineProps = { stroke: 'rgba(0, 229, 255, 0.7)', strokeWidth: 0.05, listening: false, visible: false };
    this.hLine = new Konva.Line({ ...lineProps, points: [0, 0, 0, 0] });
    this.vLine = new Konva.Line({ ...lineProps, points: [0, 0, 0, 0] });
    this.dot = new Konva.Circle({ radius: 0.07, fill: 'rgba(0, 229, 255, 0.6)', listening: false, visible: false });
    layer.add(this.hLine);
    layer.add(this.vLine);
    layer.add(this.dot);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    const sw = Math.max(0.02, 1.5 / scale);
    this.hLine?.strokeWidth(sw);
    this.vLine?.strokeWidth(sw);
    this.layer?.batchDraw();
  }

  syncPositions(): void {
    this.sync(store.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.hLine?.destroy();
    this.vLine?.destroy();
    this.dot?.destroy();
  }

  private sync(state: EditorState): void {
    if (!this.layer) return;
    const sel = state.selection;
    const scene = this.sceneRef.current;

    const hide = () => {
      this.hLine?.visible(false);
      this.vLine?.visible(false);
      this.dot?.visible(false);
      this.layer!.batchDraw();
    };

    if (!sel || sel.kind !== 'room' || sel.ids.length < 2 || !scene) return hide();

    const { spreadShrink } = state;
    let cx: number, cy: number;

    if (spreadShrink?.centerMode === 'anchor' && spreadShrink.anchorRoomId !== null) {
      const anchor = scene.getRenderRoom(spreadShrink.anchorRoomId);
      if (!anchor) return hide();
      cx = anchor.x;
      cy = anchor.y;
    } else {
      const coords: { x: number; y: number }[] = [];
      for (const id of sel.ids) {
        const room = scene.getRenderRoom(id);
        if (!room || room.z !== state.currentZ || room.area !== state.currentAreaId) continue;
        coords.push({ x: room.x, y: room.y });
      }
      if (coords.length < 2) return hide();
      cx = coords.reduce((s, r) => s + r.x, 0) / coords.length;
      cy = coords.reduce((s, r) => s + r.y, 0) / coords.length;
    }

    const arm = 0.3;

    this.hLine!.points([cx - arm, cy, cx + arm, cy]);
    this.hLine!.visible(true);
    this.vLine!.points([cx, cy - arm, cx, cy + arm]);
    this.vLine!.visible(true);
    this.dot!.x(cx);
    this.dot!.y(cy);
    this.dot!.visible(true);
    this.layer!.batchDraw();
  }
}
