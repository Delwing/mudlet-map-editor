import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';

const HALO_COLOR = '#00e5ff';
const HALO_SHADOW = {
  shadowColor: HALO_COLOR,
  shadowBlur: 4,
  shadowOpacity: 0.8,
};
// Matches the constants in the renderer's SpecialExitStyle.ts arrow math.
const CUSTOM_LINE_ARROW_LENGTH = 0.3;
const CUSTOM_LINE_ARROW_WIDTH = 0.2;

/** Highlights the currently selected exit line or custom line. */
export class SelectedLinkEffect implements LiveEffect {
  private group?: Konva.Group;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;

  constructor(
    private readonly sceneRef: { current: SceneHandle | null },
    _roomSize: number,
  ) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.group = new Konva.Group({ listening: false, visible: false });
    layer.add(this.group);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    if (!this.group) return;
    const w = Math.max(0.04, 3 / scale);
    const r = Math.max(0.08, 5 / scale);
    this.group.getChildren().forEach((c) => {
      if (c instanceof Konva.Line || c instanceof Konva.Arrow) c.strokeWidth(w);
      if (c instanceof Konva.Circle) c.radius(r);
    });
    this.layer?.batchDraw();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.group?.destroy();
  }

  private sync(state: EditorState): void {
    if (!this.group || !this.layer) return;
    const sel = state.selection;
    const scene = this.sceneRef.current;

    this.group.destroyChildren();

    if (!sel || !scene) {
      if (this.group.visible()) { this.group.visible(false); this.layer.batchDraw(); }
      return;
    }

    if (sel.kind === 'exit') {
      const entry = scene.renderer.getDrawnExits().find((e) =>
        (e.a === sel.fromId && e.b === sel.toId) ||
        (e.a === sel.toId && e.b === sel.fromId),
      );
      if (!entry) { this.group.visible(false); this.layer.batchDraw(); return; }

      for (const line of entry.data.lines) {
        this.group.add(new Konva.Line({
          points: [...line.points],
          stroke: HALO_COLOR,
          strokeWidth: 0.08,
          dash: line.dash ? [...line.dash] : undefined,
          listening: false,
          ...HALO_SHADOW,
        }));
      }
      for (const arrow of entry.data.arrows) {
        this.group.add(new Konva.Arrow({
          points: [...arrow.points],
          stroke: HALO_COLOR,
          fill: HALO_COLOR,
          strokeWidth: 0.08,
          dash: arrow.dash ? [...arrow.dash] : undefined,
          pointerLength: arrow.pointerLength,
          pointerWidth: arrow.pointerWidth,
          listening: false,
          ...HALO_SHADOW,
        }));
      }

      this.group.visible(true);
      this.layer.batchDraw();
      return;
    }

    if (sel.kind === 'customLine') {
      const spec = scene.renderer.getDrawnSpecialExits().find((e) =>
        e.roomId === sel.roomId && e.exitName === sel.exitName,
      );
      if (!spec) { this.group.visible(false); this.layer.batchDraw(); return; }

      const shape = spec.hasArrow && spec.points.length >= 4
        ? new Konva.Arrow({
            points: [...spec.points],
            stroke: HALO_COLOR,
            fill: HALO_COLOR,
            strokeWidth: 0.08,
            dash: spec.dash ? [...spec.dash] : undefined,
            pointerLength: CUSTOM_LINE_ARROW_LENGTH,
            pointerWidth: CUSTOM_LINE_ARROW_WIDTH,
            listening: false,
            ...HALO_SHADOW,
          })
        : new Konva.Line({
            points: [...spec.points],
            stroke: HALO_COLOR,
            strokeWidth: 0.08,
            dash: spec.dash ? [...spec.dash] : undefined,
            listening: false,
            ...HALO_SHADOW,
          });
      this.group.add(shape);

      // Room-centre anchor (drawn[0..1] is the prepended room centre).
      this.group.add(new Konva.Circle({
        x: spec.points[0], y: spec.points[1],
        radius: 0.1,
        fill: '#1a2030',
        stroke: HALO_COLOR,
        strokeWidth: 0.04,
        listening: false,
      }));

      // Waypoint handles — drawn points after the room centre. The raw
      // pointIndex `k` corresponds to drawn index (k + 1) because the renderer
      // prepends the room centre.
      const selectedIdx = sel.pointIndex;
      for (let i = 2; i + 1 < spec.points.length; i += 2) {
        const rawIdx = i / 2 - 1;
        const isSelected = selectedIdx != null && selectedIdx === rawIdx;
        this.group.add(new Konva.Circle({
          x: spec.points[i], y: spec.points[i + 1],
          radius: isSelected ? 0.14 : 0.1,
          fill: isSelected ? '#ffffff' : HALO_COLOR,
          stroke: isSelected ? HALO_COLOR : '#ffffff',
          strokeWidth: isSelected ? 0.06 : 0.04,
          listening: false,
        }));
      }

      this.group.visible(true);
      this.layer.batchDraw();
      return;
    }

    this.group.visible(false);
    this.layer.batchDraw();
  }
}
