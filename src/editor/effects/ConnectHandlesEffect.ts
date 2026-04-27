import Konva from 'konva';
import type { CoordinateTransform, LiveEffect, ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';
import { HANDLE_OFFSETS } from '../hitTest';
import type { Direction } from '../types';

/**
 * Shows 8 handle dots (corners + midpoints) on the room currently under the
 * cursor while the Connect tool is active. Highlights the handle under the
 * cursor or the one the user grabbed during a drag.
 */
type HandleSet = {
  group: Konva.Group;
  handles: Map<Direction, Konva.Circle>;
};

export class ConnectHandlesEffect implements LiveEffect {
  private source?: HandleSet;
  private target?: HandleSet;
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;

  constructor(private readonly settings: { roomSize: number }, private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.source = this.buildHandleSet();
    this.target = this.buildHandleSet();
    layer.add(this.source.group);
    layer.add(this.target.group);
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    const r = Math.max(0.06, 6 / scale);
    const sw = Math.max(0.015, 1.5 / scale);
    for (const set of [this.source, this.target]) {
      if (!set) continue;
      for (const c of set.handles.values()) {
        c.radius(r);
        c.strokeWidth(sw);
      }
    }
    this.layer?.batchDraw();
  }

  syncPositions(): void {
    this.sync(store.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.source?.group.destroy();
    this.target?.group.destroy();
  }

  private buildHandleSet(): HandleSet {
    const group = new Konva.Group({ listening: false, visible: false });
    const handles = new Map<Direction, Konva.Circle>();
    for (const [, , dir] of HANDLE_OFFSETS) {
      const c = new Konva.Circle({
        radius: this.settings.roomSize * 0.12,
        fill: 'rgba(143, 184, 255, 0.85)',
        stroke: '#cfe1ff',
        strokeWidth: this.settings.roomSize * 0.02,
        listening: false,
      });
      handles.set(dir, c);
      group.add(c);
    }
    return { group, handles };
  }

  private placeHandles(
    set: HandleSet,
    room: { x: number; y: number },
    activeDir: Direction | null,
    mode: 'idle' | 'hover' | 'drag-source' | 'drag-target',
  ): void {
    const half = this.settings.roomSize / 2;
    // Only the active handle changes colour — others stay at a uniform base
    // so the user doesn't see all 8 redraw when the cursor crosses sector boundaries.
    const baseFill = 'rgba(143, 184, 255, 0.85)';
    const baseStroke = '#cfe1ff';
    const activeFill = mode === 'drag-source' || mode === 'drag-target' ? '#7fff9f' : '#ffd27f';
    const activeStroke = mode === 'drag-source' || mode === 'drag-target' ? '#ffffff' : '#cfe1ff';
    for (const [ox, oy, dir] of HANDLE_OFFSETS) {
      const c = set.handles.get(dir)!;
      c.x(room.x + ox * half);
      c.y(room.y + oy * half);
      c.fill(dir === activeDir ? activeFill : baseFill);
      c.stroke(dir === activeDir ? activeStroke : baseStroke);
    }
    set.group.visible(true);
  }

  private hide(set?: HandleSet) {
    if (set?.group.visible()) set.group.visible(false);
  }

  private sync(state: EditorState): void {
    if (!this.source || !this.target || !this.layer) return;
    const scene = this.sceneRef.current;
    if (!scene || state.activeTool !== 'connect') {
      this.hide(this.source);
      this.hide(this.target);
      this.layer.batchDraw();
      return;
    }

    let sourceRoomId: number | null = null;
    let sourceActiveDir: Direction | null = null;
    let targetRoomId: number | null = null;
    let targetActiveDir: Direction | null = null;

    if (state.pending?.kind === 'connect') {
      sourceRoomId = state.pending.sourceId;
      sourceActiveDir = state.pending.sourceDir;
      if (state.pending.hoverTargetId != null && state.pending.hoverTargetId !== sourceRoomId) {
        targetRoomId = state.pending.hoverTargetId;
        targetActiveDir = state.pending.targetDir;
      }
    } else if (state.hover?.kind === 'room') {
      sourceRoomId = state.hover.id;
      // Preview which handle the user would grab if they clicked right now.
      sourceActiveDir = state.hover.handleDir;
    }

    const isDragging = state.pending?.kind === 'connect';
    if (sourceRoomId == null) {
      this.hide(this.source);
      this.hide(this.target);
    } else {
      const room = scene.getRenderRoom(sourceRoomId);
      if (room) {
        this.placeHandles(
          this.source,
          { x: room.x, y: room.y },
          sourceActiveDir,
          isDragging ? 'drag-source' : 'hover',
        );
      } else this.hide(this.source);
    }

    if (targetRoomId == null) {
      this.hide(this.target);
    } else {
      const room = scene.getRenderRoom(targetRoomId);
      if (room) this.placeHandles(this.target, { x: room.x, y: room.y }, targetActiveDir, 'drag-target');
      else this.hide(this.target);
    }

    this.layer.batchDraw();
  }
}
