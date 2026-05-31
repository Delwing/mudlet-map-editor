import Konva from 'konva';
import { computePathData, type CoordinateTransform, type LiveEffect, type ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';

const ROUTE_COLOR = '#66E64D';
const START_COLOR = '#66E64D';
const END_COLOR = '#ffb000';

/**
 * Draws the active route (store.route.summary.path) on top of the map: a glowing
 * poly-line following the same geometry the renderer uses for paths (via
 * computePathData), plus start/end rings and dots for up/down/in/out
 * transitions. Only the portion of the path on the current area/z is drawn —
 * computePathData filters by area/z and stubs cross-boundary hops, so a
 * multi-area route still shows correctly as you switch areas.
 */
export class RouteEffect implements LiveEffect {
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private nodes: Konva.Shape[] = [];
  /** Lines whose width must track zoom (node + width multiplier). */
  private widthLines: { node: Konva.Line; mult: number }[] = [];
  private rings: Konva.Circle[] = [];
  private scale = 1;
  /** Last-drawn signature, so pointer-move store churn doesn't rebuild the path. */
  private lastSummary: unknown = undefined;
  private lastArea: number | null = null;
  private lastZ = 0;
  private lastDataVersion = -1;

  constructor(private readonly sceneRef: { current: SceneHandle | null }) {}

  attach(layer: Konva.Layer): void {
    this.layer = layer;
    this.unsubscribe = store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  updateViewport(_bounds: ViewportBounds, scale: number, _transform: CoordinateTransform): void {
    this.scale = scale || 1;
    const core = Math.max(0.04, 4 / this.scale);
    for (const { node, mult } of this.widthLines) node.strokeWidth(core * mult);
    for (const ring of this.rings) ring.strokeWidth(Math.max(0.04, 3 / this.scale));
    this.layer?.batchDraw();
  }

  syncPositions(): void {
    // Force a redraw on the next sync (a mutation may have moved path rooms).
    this.lastDataVersion = -1;
    this.sync(store.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.clear();
  }

  private clear(): void {
    for (const n of this.nodes) n.destroy();
    this.nodes = [];
    this.widthLines = [];
    this.rings = [];
  }

  private addLine(points: number[], color: string, mult: number, alpha: number): void {
    if (points.length < 4 || !this.layer) return;
    const core = Math.max(0.04, 4 / this.scale);
    const line = new Konva.Line({
      points,
      stroke: color,
      strokeWidth: core * mult,
      opacity: alpha,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
      perfectDrawEnabled: false,
    });
    this.layer.add(line);
    this.nodes.push(line);
    this.widthLines.push({ node: line, mult });
  }

  private addRing(x: number, y: number, color: string): void {
    if (!this.layer) return;
    const rs = this.sceneRef.current?.settings.roomSize ?? 0.6;
    const ring = new Konva.Circle({
      x, y,
      radius: rs * 0.85,
      stroke: color,
      strokeWidth: Math.max(0.04, 3 / this.scale),
      listening: false,
      perfectDrawEnabled: false,
    });
    this.layer.add(ring);
    this.nodes.push(ring);
    this.rings.push(ring);
  }

  private sync(state: EditorState): void {
    if (!this.layer) return;

    // Skip when nothing the route depends on changed (route identity, area/z,
    // or any map mutation). Pointer-move only touches cursorMap, so this keeps
    // the path stable instead of rebuilding it on every mouse event.
    if (
      state.route.summary === this.lastSummary &&
      state.currentAreaId === this.lastArea &&
      state.currentZ === this.lastZ &&
      state.dataVersion === this.lastDataVersion
    ) {
      return;
    }
    this.lastSummary = state.route.summary;
    this.lastArea = state.currentAreaId;
    this.lastZ = state.currentZ;
    this.lastDataVersion = state.dataVersion;

    this.clear();

    const scene = this.sceneRef.current;
    const path = state.route.summary?.path;
    const areaId = state.currentAreaId;
    if (!scene || !path || path.length < 1 || areaId == null) {
      this.layer.batchDraw();
      return;
    }

    const data = computePathData(scene.reader as never, scene.settings, path, areaId, state.currentZ);

    // Glow halo first (wide, faint), then the bright core on top.
    for (const seg of data.segments) {
      this.addLine(seg.points, ROUTE_COLOR, 2.6, 0.25);
      this.addLine(seg.points, ROUTE_COLOR, 1, 0.95);
    }
    for (const cl of data.customLines) {
      this.addLine(cl.points, ROUTE_COLOR, 2.6, 0.25);
      this.addLine(cl.points, ROUTE_COLOR, 1, 0.95);
    }

    // Up/down/in/out transition markers: a dot on the room that changes level.
    for (const marker of data.innerMarkers) {
      const room = scene.getRenderRoom(marker.room.id);
      if (!room || room.area !== areaId || room.z !== state.currentZ) continue;
      const dot = new Konva.Circle({
        x: room.x, y: room.y,
        radius: Math.max(0.08, 5 / this.scale),
        fill: ROUTE_COLOR,
        listening: false,
        perfectDrawEnabled: false,
      });
      this.layer.add(dot);
      this.nodes.push(dot);
    }

    // Start / end rings (only when the endpoint is on the current plane).
    const startRoom = scene.getRenderRoom(path[0]);
    if (startRoom && startRoom.area === areaId && startRoom.z === state.currentZ) {
      this.addRing(startRoom.x, startRoom.y, START_COLOR);
    }
    const endRoom = scene.getRenderRoom(path[path.length - 1]);
    if (endRoom && endRoom.area === areaId && endRoom.z === state.currentZ) {
      this.addRing(endRoom.x, endRoom.y, END_COLOR);
    }

    this.layer.batchDraw();
  }
}
