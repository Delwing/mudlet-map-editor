import Konva from 'konva';
import { computePathData, type CoordinateTransform, type LiveEffect, type ViewportBounds } from 'mudlet-map-renderer';
import { store, type EditorState } from '../store';
import type { SceneHandle } from '../scene';

const END_COLOR = '#ffb000';
/** The active route's path from before the last edit that changed it. */
const PREVIOUS_COLOR = '#ff5c5c';

/** How a path is stroked: width multiplier over the zoom-tracking core width. */
type Stroke = { color: string; mult: number; alpha: number; dashed?: boolean };

/**
 * Draws the route finder's routes on top of the map: a glowing poly-line per
 * visible route, following the same geometry the renderer uses for paths (via
 * computePathData), plus dots for up/down/in/out transitions. The active route
 * is drawn last and widest, with start/end rings, and — when an edit changed
 * it — its old path dashed underneath, so a weight tweak shows where the route
 * used to go. Only the portion of a path on the current area/z is drawn —
 * computePathData filters by area/z and stubs cross-boundary hops, so a
 * multi-area route still shows correctly as you switch areas.
 */
export class RouteEffect implements LiveEffect {
  private layer?: Konva.Layer;
  private unsubscribe?: () => void;
  private nodes: Konva.Shape[] = [];
  /** Lines whose width (and dash) must track zoom. */
  private widthLines: { node: Konva.Line; mult: number; dashed: boolean }[] = [];
  private rings: Konva.Circle[] = [];
  private scale = 1;
  /** Last-drawn signature, so pointer-move store churn doesn't rebuild the paths. */
  private lastRoute: unknown = undefined;
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
    const core = this.coreWidth();
    for (const { node, mult, dashed } of this.widthLines) {
      node.strokeWidth(core * mult);
      if (dashed) node.dash(this.dash());
    }
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

  private coreWidth(): number {
    return Math.max(0.04, 4 / this.scale);
  }

  private dash(): number[] {
    return [Math.max(0.12, 10 / this.scale), Math.max(0.08, 7 / this.scale)];
  }

  private clear(): void {
    for (const n of this.nodes) n.destroy();
    this.nodes = [];
    this.widthLines = [];
    this.rings = [];
  }

  private addLine(points: number[], { color, mult, alpha, dashed = false }: Stroke): void {
    if (points.length < 4 || !this.layer) return;
    const line = new Konva.Line({
      points,
      stroke: color,
      strokeWidth: this.coreWidth() * mult,
      opacity: alpha,
      lineCap: dashed ? 'butt' : 'round',
      lineJoin: 'round',
      dash: dashed ? this.dash() : undefined,
      listening: false,
      perfectDrawEnabled: false,
    });
    this.layer.add(line);
    this.nodes.push(line);
    this.widthLines.push({ node: line, mult, dashed });
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

  /** Draw the on-plane part of one path with the given strokes (drawn in order). */
  private drawPath(scene: SceneHandle, path: number[], areaId: number, z: number, strokes: Stroke[], markerColor: string | null): void {
    if (!this.layer || path.length < 1) return;
    const data = computePathData(scene.reader as never, scene.settings, path, areaId, z);
    for (const stroke of strokes) {
      for (const seg of data.segments) this.addLine(seg.points, stroke);
      for (const cl of data.customLines) this.addLine(cl.points, stroke);
    }
    if (!markerColor) return;

    // Up/down/in/out transition markers: a dot on the room that changes level.
    for (const marker of data.innerMarkers) {
      const room = scene.getRenderRoom(marker.room.id);
      if (!room || room.area !== areaId || room.z !== z) continue;
      const dot = new Konva.Circle({
        x: room.x, y: room.y,
        radius: Math.max(0.08, 5 / this.scale),
        fill: markerColor,
        listening: false,
        perfectDrawEnabled: false,
      });
      this.layer.add(dot);
      this.nodes.push(dot);
    }
  }

  private sync(state: EditorState): void {
    if (!this.layer) return;

    // Skip when nothing the routes depend on changed (route state identity,
    // area/z, or any map mutation). Pointer-move only touches cursorMap, so this
    // keeps the paths stable instead of rebuilding them on every mouse event.
    if (
      state.route === this.lastRoute &&
      state.currentAreaId === this.lastArea &&
      state.currentZ === this.lastZ &&
      state.dataVersion === this.lastDataVersion
    ) {
      return;
    }
    this.lastRoute = state.route;
    this.lastArea = state.currentAreaId;
    this.lastZ = state.currentZ;
    this.lastDataVersion = state.dataVersion;

    this.clear();

    const scene = this.sceneRef.current;
    const areaId = state.currentAreaId;
    if (!scene || areaId == null) {
      this.layer.batchDraw();
      return;
    }
    const z = state.currentZ;
    const { routes, activeId } = state.route;
    const active = routes.find((r) => r.id === activeId && r.visible);

    // Other routes first and thinner, so the active one reads on top where they share rooms.
    for (const r of routes) {
      if (r === active || !r.visible || !r.summary) continue;
      this.drawPath(scene, r.summary.path, areaId, z, [
        { color: r.color, mult: 2, alpha: 0.18 },
        { color: r.color, mult: 0.7, alpha: 0.8 },
      ], r.color);
    }
    if (!active) {
      this.layer.batchDraw();
      return;
    }

    if (active.previous) {
      this.drawPath(scene, active.previous.path, areaId, z, [
        { color: PREVIOUS_COLOR, mult: 0.8, alpha: 0.85, dashed: true },
      ], null);
    }

    const path = active.summary?.path;
    if (path && path.length > 0) {
      // Glow halo first (wide, faint), then the bright core on top.
      this.drawPath(scene, path, areaId, z, [
        { color: active.color, mult: 2.6, alpha: 0.25 },
        { color: active.color, mult: 1, alpha: 0.95 },
      ], active.color);

      // Start / end rings (only when the endpoint is on the current plane).
      const startRoom = scene.getRenderRoom(path[0]);
      if (startRoom && startRoom.area === areaId && startRoom.z === z) {
        this.addRing(startRoom.x, startRoom.y, active.color);
      }
      const endRoom = scene.getRenderRoom(path[path.length - 1]);
      if (endRoom && endRoom.area === areaId && endRoom.z === z) {
        this.addRing(endRoom.x, endRoom.y, END_COLOR);
      }
    }

    this.layer.batchDraw();
  }
}
