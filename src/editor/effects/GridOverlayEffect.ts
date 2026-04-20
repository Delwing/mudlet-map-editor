import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store } from '../store';

function scaleAlpha(color: string, factor: number): string {
  const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  if (!m) return color;
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${Math.min(1, a * factor)})`;
}

/**
 * Fallback grid drawn on the LiveEffect layer for empty area/z levels where the
 * renderer's own GridRenderer never fires (it returns early when there's no plane).
 * Matches the renderer's grid color, line width, and cell size exactly.
 * Draws subtle x=0 and y=0 axis lines plus a fixed-size (0,0) label at the origin.
 */
export class GridOverlayEffect implements LiveEffect {
  private gridShape?: Konva.Shape;
  private axisShape?: Konva.Shape;
  private labelShape?: Konva.Text;
  private layer?: Konva.Layer;
  private bounds: ViewportBounds = { minX: -20, maxX: 20, minY: -20, maxY: 20 };
  private scale = 1;
  private unsubscribe?: () => void;

  constructor(
    private readonly gridColor: string,
    private readonly gridLineWidth: number,
    private readonly gridSize: number,
    private readonly getIsEmpty: () => boolean,
    private readonly getViewportBounds: () => ViewportBounds,
  ) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;

    this.gridShape = new Konva.Shape({
      listening: false,
      visible: false,
      stroke: this.gridColor,
      strokeWidth: this.gridLineWidth,
      sceneFunc: (ctx, shape) => {
        const { minX, maxX, minY, maxY } = this.bounds;
        const step = this.gridSize;
        const x0 = Math.floor(minX / step) * step - step;
        const x1 = Math.ceil(maxX / step) * step + step;
        const y0 = Math.floor(minY / step) * step - step;
        const y1 = Math.ceil(maxY / step) * step + step;

        ctx.beginPath();
        for (let x = x0; x <= x1; x += step) {
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y1);
        }
        for (let y = y0; y <= y1; y += step) {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
        ctx.strokeShape(shape);
      },
    });

    this.axisShape = new Konva.Shape({
      listening: false,
      visible: false,
      stroke: scaleAlpha(this.gridColor, 2),
      strokeWidth: this.gridLineWidth * 2,
      sceneFunc: (ctx, shape) => {
        const { minX, maxX, minY, maxY } = this.bounds;
        ctx.beginPath();
        ctx.moveTo(0, minY - this.gridSize);
        ctx.lineTo(0, maxY + this.gridSize);
        ctx.moveTo(minX - this.gridSize, 0);
        ctx.lineTo(maxX + this.gridSize, 0);
        ctx.strokeShape(shape);
      },
    });

    this.labelShape = new Konva.Text({
      listening: false,
      visible: false,
      x: 4 / this.scale,
      y: 4 / this.scale,
      text: '(0,0)',
      fontSize: this.gridSize,
      fontFamily: 'monospace',
      fill: scaleAlpha(this.gridColor, 2),
    });

    layer.add(this.gridShape);
    layer.add(this.axisShape);
    layer.add(this.labelShape);
    this.unsubscribe = store.subscribe(() => this.syncVisibility());
  }

  updateViewport(bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    this.bounds = bounds;
    this.scale = scale || 1;
    if (this.labelShape) {
      this.labelShape.fontSize(this.gridSize);
      this.labelShape.x(4 / this.scale);
      this.labelShape.y(4 / this.scale);
    }
    this.layer?.batchDraw();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.gridShape?.destroy();
    this.axisShape?.destroy();
    this.labelShape?.destroy();
  }

  syncVisibility(): void {
    if (!this.gridShape || !this.axisShape || !this.labelShape || !this.layer) return;
    const isEmpty = this.getIsEmpty();
    if (isEmpty) {
      // updateViewport may not have fired for an empty area (renderer skips
      // applyViewportToStage when there's no plane), so refresh bounds now.
      this.bounds = this.getViewportBounds();
    }
    if (this.gridShape.visible() !== isEmpty) {
      this.gridShape.visible(isEmpty);
      this.axisShape.visible(isEmpty);
      this.labelShape.visible(isEmpty);
      this.layer.batchDraw();
    }
  }
}
