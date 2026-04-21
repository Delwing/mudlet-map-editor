import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';

function getHandlePositions(bx: number, by: number, bw: number, bh: number) {
  return [
    { id: 'nw', x: bx,          y: by          },
    { id: 'n',  x: bx + bw / 2, y: by          },
    { id: 'ne', x: bx + bw,     y: by          },
    { id: 'e',  x: bx + bw,     y: by + bh / 2 },
    { id: 'se', x: bx + bw,     y: by + bh     },
    { id: 's',  x: bx + bw / 2, y: by + bh     },
    { id: 'sw', x: bx,          y: by + bh     },
    { id: 'w',  x: bx,          y: by + bh / 2 },
  ];
}

export class LabelHaloEffect implements LiveEffect {
  private selRect?: Konva.Rect;
  private hoverRect?: Konva.Rect;
  private previewRect?: Konva.Rect;
  private handles: Konva.Rect[] = [];
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private strokeWidth = 0.06;
  private handleSize = 0.12;

  constructor(private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;

    this.hoverRect = new Konva.Rect({
      stroke: '#ffd080',
      strokeWidth: this.strokeWidth,
      fill: 'transparent',
      cornerRadius: 0.04,
      listening: false,
      visible: false,
    });
    this.selRect = new Konva.Rect({
      stroke: '#00e5ff',
      strokeWidth: this.strokeWidth,
      dash: [0.2, 0.15],
      fill: 'transparent',
      cornerRadius: 0.04,
      listening: false,
      visible: false,
    });
    this.previewRect = new Konva.Rect({
      stroke: '#00e5ff',
      strokeWidth: this.strokeWidth,
      dash: [0.2, 0.15],
      fill: 'rgba(0,229,255,0.05)',
      listening: false,
      visible: false,
    });

    for (let i = 0; i < 8; i++) {
      const h = new Konva.Rect({
        fill: '#00e5ff',
        stroke: '#003040',
        strokeWidth: 0.02,
        listening: false,
        visible: false,
      });
      this.handles.push(h);
      layer.add(h);
    }

    layer.add(this.hoverRect);
    layer.add(this.selRect);
    layer.add(this.previewRect);

    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    this.strokeWidth = Math.max(0.03, 2 / scale);
    this.handleSize = Math.max(0.08, 8 / scale);
    const dash = [Math.max(0.1, 6 / scale), Math.max(0.08, 5 / scale)];

    this.selRect?.strokeWidth(this.strokeWidth);
    this.selRect?.dash(dash);
    this.hoverRect?.strokeWidth(this.strokeWidth);
    this.previewRect?.strokeWidth(this.strokeWidth);
    this.previewRect?.dash(dash);

    for (const h of this.handles) h.strokeWidth(Math.max(0.01, 1 / scale));

    // Re-sync to reposition handles at updated size.
    this.sync(store.getState());
    this.layer?.batchDraw();
  }

  syncPositions(): void {
    this.sync(store.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.selRect?.destroy();
    this.hoverRect?.destroy();
    this.previewRect?.destroy();
    for (const h of this.handles) h.destroy();
    this.handles = [];
  }

  private getLabelBounds(areaId: number, labelId: number, z: number): { x: number; y: number; w: number; h: number } | null {
    const scene = this.sceneRef.current;
    if (!scene) return null;
    const area = scene.reader.getArea(areaId);
    if (!area) return null;
    const plane = area.getPlane(z);
    if (!plane) return null;
    const label = plane.getLabels().find((l: any) => (l.labelId ?? l.id) === labelId);
    if (!label) return null;
    return { x: label.X, y: -label.Y, w: label.Width, h: label.Height };
  }

  private applyBounds(rect: Konva.Rect, bounds: { x: number; y: number; w: number; h: number } | null, pad = 0.05): void {
    if (!bounds) { rect.visible(false); return; }
    rect.x(bounds.x - pad);
    rect.y(bounds.y - pad);
    rect.width(bounds.w + pad * 2);
    rect.height(bounds.h + pad * 2);
    rect.visible(true);
  }

  private updateHandles(bounds: { x: number; y: number; w: number; h: number } | null): void {
    if (!bounds) {
      for (const h of this.handles) h.visible(false);
      return;
    }
    const pad = 0.05;
    const bx = bounds.x - pad;
    const by = bounds.y - pad;
    const bw = bounds.w + pad * 2;
    const bh = bounds.h + pad * 2;
    const hs = this.handleSize;
    const positions = getHandlePositions(bx, by, bw, bh);
    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i];
      const pos = positions[i];
      h.x(pos.x - hs / 2);
      h.y(pos.y - hs / 2);
      h.width(hs);
      h.height(hs);
      h.visible(true);
    }
  }

  private sync(state: EditorState): void {
    if (!this.layer || !this.selRect || !this.hoverRect || !this.previewRect) return;
    const z = state.currentZ;

    const sel = state.selection?.kind === 'label' ? state.selection : null;
    const selBounds = sel ? this.getLabelBounds(sel.areaId, sel.id, z) : null;
    this.applyBounds(this.selRect, selBounds);
    this.updateHandles(selBounds);

    const hov = state.hover?.kind === 'label' ? state.hover : null;
    const hovIsSel = hov && sel && hov.id === sel.id && hov.areaId === sel.areaId;
    this.applyBounds(this.hoverRect, hov && !hovIsSel ? this.getLabelBounds(hov.areaId, hov.id, z) : null);

    // Draw creation preview rect.
    const p = state.pending?.kind === 'labelRect' ? state.pending : null;
    if (p) {
      const x = Math.min(p.startX, p.currentX);
      const y = Math.min(p.startY, p.currentY);
      const w = Math.abs(p.currentX - p.startX);
      const h = Math.abs(p.currentY - p.startY);
      this.previewRect.x(x);
      this.previewRect.y(y);
      this.previewRect.width(w || 4);
      this.previewRect.height(h || 1);
      this.previewRect.visible(true);
    } else {
      this.previewRect.visible(false);
    }

    this.layer.batchDraw();
  }
}
