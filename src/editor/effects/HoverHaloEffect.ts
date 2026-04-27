import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';
import {Shape} from "konva/lib/Shape";

const HALO_COLOR = '#ffcc00';
const HALO_OPACITY = 0.9;
// Matches the constants in the renderer's SpecialExitStyle.ts arrow math.
const CUSTOM_LINE_ARROW_LENGTH = 0.3;
const CUSTOM_LINE_ARROW_WIDTH = 0.2;

export class HoverHaloEffect implements LiveEffect {
  private roomRect?: Konva.Rect;
  private linkGroup?: Konva.Group;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private currentScale = 1;

  constructor(private readonly settings: { roomSize: number }, private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.roomRect = new Konva.Rect({
      stroke: HALO_COLOR,
      strokeWidth: 0.06,
      listening: false,
      visible: false,
      cornerRadius: 0.04,
      opacity: 0.85,
    });
    this.linkGroup = new Konva.Group({ listening: false, visible: false });
    layer.add(this.roomRect);
    layer.add(this.linkGroup);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    this.currentScale = scale;
    const linkStroke = Math.max(0.04, 2.5 / scale);
    if (this.roomRect) this.roomRect.strokeWidth(Math.max(0.025, 1.5 / scale));
    this.linkGroup?.getChildren().forEach((c) => {
      if (c instanceof Shape) c.strokeWidth(linkStroke);
    });
    this.layer?.batchDraw();
  }

  syncPositions(): void {
    this.sync(store.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.roomRect?.destroy();
    this.linkGroup?.destroy();
  }

  private sync(state: EditorState): void {
    if (!this.roomRect || !this.linkGroup || !this.layer) return;
    const h = state.hover;
    const scene = this.sceneRef.current;

    this.linkGroup.destroyChildren();
    this.linkGroup.visible(false);

    if (!h || !scene) {
      if (this.roomRect.visible()) this.roomRect.visible(false);
      this.layer.batchDraw();
      return;
    }

    if (h.kind === 'room') {
      const room = scene.getRenderRoom(h.id);
      if (!room || room.z !== state.currentZ || room.area !== state.currentAreaId) {
        this.roomRect.visible(false);
        this.layer.batchDraw();
        return;
      }
      const pad = 0.12;
      const rs = this.settings.roomSize;
      const size = rs + pad * 2;
      this.roomRect.x(room.x - rs / 2 - pad);
      this.roomRect.y(room.y - rs / 2 - pad);
      this.roomRect.width(size);
      this.roomRect.height(size);
      this.roomRect.visible(true);
      this.layer.batchDraw();
      return;
    }

    this.roomRect.visible(false);
    const linkStroke = Math.max(0.04, 2.5 / this.currentScale);

    if (h.kind === 'exit') {
      const entry = scene.renderer.getDrawnExits().find((e) =>
        (e.a === h.fromId && e.b === h.toId) ||
        (e.a === h.toId && e.b === h.fromId),
      );
      if (!entry) { this.layer.batchDraw(); return; }
      for (const line of entry.data.lines) {
        this.linkGroup.add(new Konva.Line({
          points: [...line.points],
          stroke: HALO_COLOR,
          strokeWidth: linkStroke,
          dash: line.dash ? [...line.dash] : undefined,
          listening: false,
          lineCap: 'round',
          opacity: HALO_OPACITY,
        }));
      }
      for (const arrow of entry.data.arrows) {
        this.linkGroup.add(new Konva.Arrow({
          points: [...arrow.points],
          stroke: HALO_COLOR,
          fill: HALO_COLOR,
          strokeWidth: linkStroke,
          dash: arrow.dash ? [...arrow.dash] : undefined,
          pointerLength: arrow.pointerLength,
          pointerWidth: arrow.pointerWidth,
          listening: false,
          opacity: HALO_OPACITY,
        }));
      }
      this.linkGroup.visible(true);
    } else if (h.kind === 'stub') {
      const stub = scene.renderer.getDrawnStubs().find((s) =>
        s.roomId === h.roomId && s.direction === h.dir,
      );
      if (!stub) { this.layer.batchDraw(); return; }
      this.linkGroup.add(new Konva.Line({
        points: [stub.x1, stub.y1, stub.x2, stub.y2],
        stroke: HALO_COLOR,
        strokeWidth: linkStroke,
        listening: false,
        lineCap: 'round',
        opacity: HALO_OPACITY,
      }));
      this.linkGroup.visible(true);
    } else if (h.kind === 'customLine') {
      const spec = scene.renderer.getDrawnSpecialExits().find((e) =>
        e.roomId === h.roomId && e.exitName === h.exitName,
      );
      if (!spec) { this.layer.batchDraw(); return; }
      const shape = spec.hasArrow && spec.points.length >= 4
        ? new Konva.Arrow({
            points: [...spec.points],
            stroke: HALO_COLOR,
            fill: HALO_COLOR,
            strokeWidth: linkStroke,
            dash: spec.dash ? [...spec.dash] : undefined,
            pointerLength: CUSTOM_LINE_ARROW_LENGTH,
            pointerWidth: CUSTOM_LINE_ARROW_WIDTH,
            listening: false,
            lineCap: 'round',
            lineJoin: 'round',
            opacity: HALO_OPACITY,
          })
        : new Konva.Line({
            points: [...spec.points],
            stroke: HALO_COLOR,
            strokeWidth: linkStroke,
            dash: spec.dash ? [...spec.dash] : undefined,
            listening: false,
            lineCap: 'round',
            lineJoin: 'round',
            opacity: HALO_OPACITY,
          });
      this.linkGroup.add(shape);
      this.linkGroup.visible(true);
    }

    this.layer.batchDraw();
  }
}
