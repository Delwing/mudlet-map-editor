import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import { inferDirection, is2DCardinal, getExit, OPPOSITE } from '../mapHelpers';
import type { SceneHandle } from '../scene';
import { HANDLE_OFFSETS } from '../hitTest';
import type { Direction } from '../types';

const ROOM_SIZE_FOR_HANDLES = 0.6; // matches the renderer's default roomSize

function handleOffsetFor(dir: Direction): { ox: number; oy: number } {
  for (const [ox, oy, d] of HANDLE_OFFSETS) if (d === dir) return { ox, oy };
  return { ox: 0, oy: 0 };
}

export class RubberBandEffect implements LiveEffect {
  private line?: Konva.Arrow;
  private dirLabel?: Konva.Text;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;

  constructor(private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.line = new Konva.Arrow({
      points: [0, 0, 0, 0],
      stroke: '#7fff9f',
      fill: '#7fff9f',
      strokeWidth: 0.08,
      pointerLength: 0.3,
      pointerWidth: 0.3,
      listening: false,
      visible: false,
      dash: [0.2, 0.15],
    });
    this.dirLabel = new Konva.Text({
      fontSize: 0.4,
      fill: '#7fff9f',
      fontStyle: 'bold',
      listening: false,
      visible: false,
    });
    layer.add(this.line);
    layer.add(this.dirLabel);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    if (this.line) this.line.strokeWidth(Math.max(0.03, 2 / scale));
    if (this.dirLabel) this.dirLabel.fontSize(Math.max(0.2, 14 / scale));
    this.layer?.batchDraw();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.line?.destroy();
    this.dirLabel?.destroy();
  }

  private sync(state: EditorState): void {
    if (!this.line || !this.dirLabel || !this.layer) return;
    const p = state.pending;
    const scene = this.sceneRef.current;
    if (!p || p.kind !== 'connect' || !scene || !state.map) {
      if (this.line.visible() || this.dirLabel.visible()) {
        this.line.visible(false);
        this.dirLabel.visible(false);
        this.layer.batchDraw();
      }
      return;
    }
    const source = scene.getRenderRoom(p.sourceId);
    if (!source) return;
    const target = p.hoverTargetId != null ? scene.getRenderRoom(p.hoverTargetId) : null;

    const rs = scene.settings.roomSize ?? ROOM_SIZE_FOR_HANDLES;
    const half = rs / 2;

    // Start point: source handle if picked, else source centre.
    let startX = source.x;
    let startY = source.y;
    if (p.sourceDir) {
      const { ox, oy } = handleOffsetFor(p.sourceDir);
      startX = source.x + ox * half;
      startY = source.y + oy * half;
    }

    // End point: target handle if picked, else target centre, else cursor.
    let endX: number;
    let endY: number;
    if (target && p.targetDir) {
      const { ox, oy } = handleOffsetFor(p.targetDir);
      endX = target.x + ox * half;
      endY = target.y + oy * half;
    } else if (target) {
      endX = target.x;
      endY = target.y;
    } else {
      endX = p.cursorMap?.x ?? source.x;
      endY = p.cursorMap?.y ?? source.y;
    }

    // Resolve the intended exit direction — same logic as createConnection.
    let ok = true;
    let dirText = '';
    if (target && target !== source) {
      const dir = p.sourceDir ?? inferDirection(source.x, source.y, target.x, target.y);
      if (!is2DCardinal(dir)) {
        ok = false;
        dirText = `${dir}?`;
      } else {
        const reverseDir = p.targetDir ?? OPPOSITE[dir];
        dirText = `${dir} / ${reverseDir}`;
        const rawSource = state.map.rooms[p.sourceId];
        const existing = rawSource ? getExit(rawSource, dir) : -1;
        if (existing !== -1 && existing !== p.hoverTargetId) ok = false;
      }
    }
    const color = ok ? '#7fff9f' : '#ff7f7f';

    this.line.points([startX, startY, endX, endY]);
    this.line.stroke(color);
    this.line.fill(color);
    this.line.visible(true);

    if (dirText) {
      this.dirLabel.text(dirText);
      this.dirLabel.fill(color);
      this.dirLabel.x((startX + endX) / 2 + 0.2);
      this.dirLabel.y((startY + endY) / 2 + 0.2);
      this.dirLabel.visible(true);
    } else {
      this.dirLabel.visible(false);
    }
    this.layer.batchDraw();
  }
}
