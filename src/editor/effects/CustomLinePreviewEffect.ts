import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';
import { SHORT_TO_DIR } from '../types';
import { getExit } from '../mapHelpers';

const CROSSHAIR_COLOR = 'rgba(255, 220, 60, 0.9)';
const CROSSHAIR_ARM = 0.55;

/** Draws waypoints + in-progress line while the custom line tool is active. */
export class CustomLinePreviewEffect implements LiveEffect {
  private group?: Konva.Group;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private currentScale = 1;

  constructor(private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.group = new Konva.Group({ listening: false, visible: false });
    layer.add(this.group);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    this.currentScale = scale;
    if (!this.group) return;
    const w = Math.max(0.02, 1.5 / scale);
    this.group.getChildren().forEach((rawChild) => {
      const child = rawChild as any;
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

    const sel = state.selection;
    const isDrawing = p?.kind === 'customLine' && p.points.length > 0;
    const isSelected = !isDrawing && sel?.kind === 'customLine';

    if (!isDrawing && !isSelected) {
      if (this.group.visible()) {
        this.group.visible(false);
        this.layer.batchDraw();
      }
      return;
    }

    this.group.destroyChildren();
    const strokeW = Math.max(0.02, 1.5 / this.currentScale);

    if (isDrawing && p?.kind === 'customLine') {
      const color = `rgb(${p.color.r},${p.color.g},${p.color.b})`;

      // Committed segments are drawn by the renderer itself (we write through to raw
      // on every waypoint add). Here we only draw the dashed cursor-preview segment
      // and waypoint dot handles.

      if (p.cursor && p.points.length >= 1) {
        const last = p.points[p.points.length - 1];
        const preview = new Konva.Line({
          points: [last[0], last[1], p.cursor.x, p.cursor.y],
          stroke: color,
          strokeWidth: strokeW,
          dash: [0.2, 0.15],
          listening: false,
          opacity: 0.6,
        });
        this.group.add(preview);
      }

      for (const [x, y] of p.points) {
        const dot = new Konva.Circle({
          x, y,
          radius: Math.max(0.05, 4 / this.currentScale),
          fill: color,
          listening: false,
        });
        this.group.add(dot);
      }
    }

    // Draw crosshair on the target room — during drawing and while a line is selected/edited.
    const crosshairSource = isDrawing && p?.kind === 'customLine'
      ? { roomId: p.roomId, exitName: p.exitName }
      : isSelected && sel?.kind === 'customLine'
        ? { roomId: sel.roomId, exitName: sel.exitName }
        : null;

    if (crosshairSource) {
      const targetRoom = this.resolveTargetRoom(state, crosshairSource.roomId, crosshairSource.exitName);
      if (targetRoom) {
        const { x, y } = targetRoom;
        const arm = CROSSHAIR_ARM;
        const hLine = new Konva.Line({
          points: [x - arm, y, x + arm, y],
          stroke: CROSSHAIR_COLOR,
          strokeWidth: strokeW,
          listening: false,
          lineCap: 'round',
        });
        const vLine = new Konva.Line({
          points: [x, y - arm, x, y + arm],
          stroke: CROSSHAIR_COLOR,
          strokeWidth: strokeW,
          listening: false,
          lineCap: 'round',
        });
        this.group.add(hLine);
        this.group.add(vLine);
      }
    }

    this.group.visible(true);
    this.layer.batchDraw();
  }

  private resolveTargetRoom(
    state: EditorState,
    roomId: number,
    exitName: string,
  ): { x: number; y: number } | null {
    const scene = this.sceneRef.current;
    const map = state.map;
    if (!scene || !map) return null;

    const raw = map.rooms[roomId];
    if (!raw) return null;

    let targetId: number | undefined;
    const dir = SHORT_TO_DIR[exitName];
    if (dir) {
      const id = getExit(raw, dir);
      if (id > 0) targetId = id;
    } else {
      const id = raw.mSpecialExits?.[exitName];
      if (id != null && id > 0) targetId = id;
    }

    if (targetId == null) return null;
    const renderRoom = scene.getRenderRoom(targetId);
    if (!renderRoom) return null;
    if (renderRoom.area !== state.currentAreaId || renderRoom.z !== state.currentZ) return null;
    return { x: renderRoom.x, y: renderRoom.y };
  }
}
