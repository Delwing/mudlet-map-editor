import type { MapRenderer, Settings } from 'mudlet-map-renderer';
import { clientToMap, snap } from './coords';
import { pushCommand, buildDeleteNeighborEdits } from './commands';
import { allHitsAt, exitAt, customLineAt, customLinePointAt, customLineSegmentAt, handleDirFor, labelAt, labelResizeHandleAt, roomAtCell } from './hitTest';
import {
  createDefaultRoom,
  getExit,
  inferDirection,
  nextRoomId,
  OPPOSITE,
  is2DCardinal,
} from './mapHelpers';
import { store } from './store';
import { DEFAULT_LABEL_FONT, CARDINAL_DIRECTIONS } from './types';
import type { Direction, HitItem, HoverTarget, Selection, ToolId } from './types';
import type { SceneHandle } from './scene';

export interface ToolContext {
  renderer: MapRenderer;
  container: HTMLElement;
  settings: Settings;
  refresh: () => void;
  scene: SceneHandle;
}

export interface Tool {
  id: ToolId;
  cursor?: string;
  onPointerDown?(ev: PointerEvent, ctx: ToolContext): boolean;
  onPointerMove?(ev: PointerEvent, ctx: ToolContext): boolean | void;
  onPointerUp?(ev: PointerEvent, ctx: ToolContext): boolean | void;
  onContextMenu?(ev: MouseEvent, ctx: ToolContext): boolean | void;
  onCancel?(ctx: ToolContext): void;
}

type PickSpecialExitCb = (roomId: number) => void;
let specialExitPickCb: PickSpecialExitCb | null = null;

export function registerSpecialExitPickCb(cb: PickSpecialExitCb | null): void {
  specialExitPickCb = cb;
}

/** Map coord in RENDER space (what renderer & culling use; y grows down). */
function mapCoord(ctx: ToolContext, ev: { clientX: number; clientY: number }) {
  return clientToMap(ctx.renderer, ctx.container, ev.clientX, ev.clientY);
}

function snappedCoord(ctx: ToolContext, ev: { clientX: number; clientY: number }) {
  const c = mapCoord(ctx, ev);
  const s = store.getState();
  if (!s.snapToGrid) return c;
  return { x: snap(c.x, s.gridStep), y: snap(c.y, s.gridStep) };
}

function activeContext() {
  const s = store.getState();
  if (!s.map || s.currentAreaId == null) return null;
  return { map: s.map, areaId: s.currentAreaId, z: s.currentZ, state: s };
}

/** Hit-test using the renderer's own spatial index. Returns render-space room or null. */
function roomUnder(ctx: ToolContext, ev: { clientX: number; clientY: number }) {
  if (!activeContext()) return null;
  const rect = ctx.container.getBoundingClientRect();
  const pt = ctx.renderer.backend.viewport.clientToMapPoint(ev.clientX, ev.clientY, {
    left: rect.left,
    top: rect.top,
  });
  if (!pt) return null;
  const hit = (ctx.renderer.backend as any).culling?.findRoomAtMapPoint?.(pt.x, pt.y) as
    | { id: number }
    | null
    | undefined;
  if (!hit) return null;
  return ctx.scene.getRenderRoom(hit.id) ?? null;
}

/** Minimum render-space travel before an empty-space drag becomes a marquee (not a click). */
const MARQUEE_THRESHOLD = 0.15;

/**
 * Combo tool: click a room to select it, drag to move it, click empty to clear selection.
 * Drag vs click is detected naturally — a drag only "moves" when the snapped cursor cell
 * differs from the room's current cell, so micro-jitter on a click doesn't trigger a move.
 */
export const selectTool: Tool = {
  id: 'select',
  cursor: 'default',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0) return false;
    const s = store.getState();
    if (s.contextMenu) store.setState({ contextMenu: null });

    if (s.pending?.kind === 'pickExit') {
      const target = roomUnder(ctx, ev);
      if (target && s.map) {
        const { fromId, dir } = s.pending;
        const rawFrom = s.map.rooms[fromId];
        if (rawFrom) {
          const previous = getExit(rawFrom, dir);
          pushCommand({ kind: 'addExit', fromId, dir, toId: target.id, previous, reverse: null }, ctx.scene);
          ctx.refresh();
          store.bumpData();
          store.setState({ pending: null, selection: { kind: 'room', ids: [fromId] }, status: `Exit ${dir} → room ${target.id} added.` });
        }
      }
      return true;
    }

    if (s.pending?.kind === 'pickSpecialExit') {
      const target = roomUnder(ctx, ev);
      const fromId = s.pending.fromId;
      if (target && specialExitPickCb) specialExitPickCb(target.id);
      store.setState({ pending: null, selection: { kind: 'room', ids: [fromId] } });
      return true;
    }

    if (s.pending?.kind === 'pickSwatch') {
      const target = roomUnder(ctx, ev);
      if (target && s.map) {
        const raw = s.map.rooms[target.id];
        if (raw) {
          window.dispatchEvent(new CustomEvent('editor:swatchRoomPicked', {
            detail: { symbol: raw.symbol ?? '', environment: raw.environment ?? -1 },
          }));
        }
      }
      store.setState({ pending: null });
      return true;
    }

    const c = mapCoord(ctx, ev);
    const ac = activeContext();

    // Alt+click: cycle through all overlapping elements at this cell.
    if (ev.altKey) {
      const hits = ac ? allHitsAt(ctx.renderer, ac.map, ac.areaId, ac.z, c.x, c.y, ctx.settings.roomSize, ctx.scene.reader) : [];
      if (hits.length > 0) {
        const cellX = Math.round(c.x);
        const cellY = Math.round(c.y);
        const cycle = s.hitCycle;
        const sameCell = cycle && cycle.x === cellX && cycle.y === cellY;
        const newIndex = sameCell ? (cycle.index + 1) % hits.length : 0;
        const hit = hits[newIndex];
        store.setState({
          hitCycle: { x: cellX, y: cellY, index: newIndex },
          selection: hitToSelection(hit),
          sidebarTab: 'selection',
          status: `Selected ${hitStatusLabel(hit)} (${newIndex + 1}/${hits.length})`,
        });
      }
      return true;
    }
    // Any normal click resets the cycle.
    store.setState({ hitCycle: null });

    // If a custom line is selected, check for waypoint handle hit first.
    if (s.selection?.kind === 'customLine' && ac) {
      const ptIdx = customLinePointAt(
        ctx.renderer, s.selection.roomId, s.selection.exitName,
        c.x, c.y, ctx.settings.roomSize,
      );
      if (ptIdx !== null) {
        const rawRoom = s.map?.rooms[s.selection.roomId];
        const originPoints = rawRoom?.customLines?.[s.selection.exitName]
          ? [...rawRoom.customLines[s.selection.exitName]] as [number, number][]
          : [];
        store.setState({
          selection: { kind: 'customLine', roomId: s.selection.roomId, exitName: s.selection.exitName, pointIndex: ptIdx },
          pending: {
            kind: 'customLinePoint',
            roomId: s.selection.roomId,
            exitName: s.selection.exitName,
            pointIndex: ptIdx,
            originPoints,
          },
        });
        ctx.container.setPointerCapture(ev.pointerId);
        return true;
      }
    }

    // Label hit test — resize handles first, then body, checked before rooms.
    if (ac) {
      // Check resize handles if this label is already selected.
      if (s.selection?.kind === 'label') {
        const sel = s.selection;
        const rawLabel = ctx.scene.reader.getLabelSnapshot(sel.areaId, sel.id);
        if (rawLabel) {
          const bounds = { x: rawLabel.pos[0], y: -rawLabel.pos[1], w: rawLabel.size[0], h: rawLabel.size[1] };
          const rect = ctx.container.getBoundingClientRect();
          const pt0 = ctx.renderer.backend.viewport.clientToMapPoint(0, 0, { left: rect.left, top: rect.top });
          const pt1 = ctx.renderer.backend.viewport.clientToMapPoint(8, 0, { left: rect.left, top: rect.top });
          const hitRadius = (pt0 && pt1) ? Math.abs(pt1.x - pt0.x) : 0.25;
          const handle = labelResizeHandleAt(bounds, c.x, c.y, hitRadius);
          if (handle) {
            store.setState({
              pending: {
                kind: 'labelResize',
                labelId: sel.id,
                areaId: sel.areaId,
                handle,
                originPos: [...rawLabel.pos] as [number, number, number],
                originSize: [...rawLabel.size] as [number, number],
              },
            });
            ctx.container.setPointerCapture(ev.pointerId);
            return true;
          }
        }
      }

      const lbl = labelAt(ac.areaId, ac.z, c.x, c.y, ctx.scene.reader);
      if (lbl) {
        const rawLabel = ctx.scene.reader.getLabelSnapshot(lbl.areaId, lbl.id);
        const labelRenderX = rawLabel ? rawLabel.pos[0] : 0;
        const labelRenderY = rawLabel ? -rawLabel.pos[1] : 0;
        store.setState({
          selection: { kind: 'label', id: lbl.id, areaId: lbl.areaId },
          pending: rawLabel ? {
            kind: 'labelDrag',
            labelId: lbl.id,
            areaId: lbl.areaId,
            originPos: [...rawLabel.pos] as [number, number, number],
            offsetX: c.x - labelRenderX,
            offsetY: c.y - labelRenderY,
          } : null,
          sidebarTab: 'selection',
        });
        ctx.container.setPointerCapture(ev.pointerId);
        return true;
      }
    }

    let room = roomUnder(ctx, ev);
    // When rooms are stacked at the same cell, prefer any selected room at that cell
    // so Alt+click-then-drag (single) and multi-drag both operate on the chosen rooms.
    if (room && s.selection?.kind === 'room') {
      const hit = room;
      const selId = s.selection.ids.find(id => {
        const r = ctx.scene.getRenderRoom(id);
        return r && r.x === hit.x && r.y === hit.y;
      });
      if (selId != null) room = ctx.scene.getRenderRoom(selId) ?? room;
    }
    if (room) {
      const raw = s.map?.rooms[room.id];
      if (!raw) return true;

      if (ev.shiftKey) {
        // Always add to selection (never remove).
        const currentIds = s.selection?.kind === 'room' ? s.selection.ids : [];
        if (!currentIds.includes(room.id)) {
          store.setState({ selection: { kind: 'room', ids: [...currentIds, room.id] } });
        }
        return true;
      }

      if (ev.ctrlKey || ev.metaKey) {
        // Toggle this room in/out of the selection.
        const currentIds = s.selection?.kind === 'room' ? s.selection.ids : [];
        const idx = currentIds.indexOf(room.id);
        const newIds = idx >= 0 ? currentIds.filter((id) => id !== room.id) : [...currentIds, room.id];
        store.setState({ selection: newIds.length === 0 ? null : { kind: 'room', ids: newIds } });
        return true;
      }

      // Regular click: if this room is already part of a multi-selection, keep
      // the whole selection and prepare to drag all of them together. Otherwise
      // reduce to single selection.
      const currentSel = s.selection;
      const isInMultiSel =
        currentSel?.kind === 'room' && currentSel.ids.length > 1 && currentSel.ids.includes(room.id);

      const multiOrigins = isInMultiSel
        ? (currentSel as { kind: 'room'; ids: number[] }).ids
            .filter((id) => id !== room.id)
            .flatMap((id) => {
              const r = s.map?.rooms[id];
              return r ? [{ id, x: r.x, y: r.y }] : [];
            })
        : undefined;

      const allDragIds = [room.id, ...(multiOrigins?.map(o => o.id) ?? [])];
      const customLineSnapshots: NonNullable<import('./types').PendingDrag['customLineSnapshots']> = [];
      for (const id of allDragIds) {
        const r = s.map?.rooms[id];
        if (!r) continue;
        for (const exitName of Object.keys(r.customLines ?? {})) {
          const pts = r.customLines[exitName];
          if (!pts || pts.length === 0) continue;
          customLineSnapshots.push({
            roomId: id,
            exitName,
            points: pts.map(p => [p[0], p[1]]) as [number, number][],
            color: r.customLinesColor?.[exitName] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
            style: r.customLinesStyle?.[exitName] ?? 1,
            arrow: r.customLinesArrow?.[exitName] ?? false,
          });
        }
      }
      store.setState({
        selection: isInMultiSel ? (currentSel as NonNullable<typeof currentSel>) : { kind: 'room', ids: [room.id] },
        pending: { kind: 'drag', roomId: room.id, originX: raw.x, originY: raw.y, multiOrigins, offsetX: c.x - room.x, offsetY: c.y - room.y, ...(customLineSnapshots.length ? { customLineSnapshots } : {}) },
      });
      ctx.container.setPointerCapture(ev.pointerId);
      return true;
    }
    // No room — check custom lines then exits.
    if (ac) {
      const cl = customLineAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
      if (cl) {
        store.setState({ selection: { kind: 'customLine', roomId: cl.roomId, exitName: cl.exitName } });
        return true;
      }
      const exit = exitAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
      if (exit) {
        store.setState({ selection: { kind: 'exit', fromId: exit.fromId, toId: exit.toId, dir: exit.dir } });
        return true;
      }
    }
    // Empty space: start a marquee drag. A tiny movement that stays under
    // MARQUEE_THRESHOLD is treated as a click and clears the selection on up.
    const mc = mapCoord(ctx, ev);
    store.setState({
      pending: {
        kind: 'marquee',
        startX: mc.x, startY: mc.y,
        currentX: mc.x, currentY: mc.y,
        ctrlHeld: ev.ctrlKey || ev.metaKey,
        shiftHeld: ev.shiftKey,
        preExistingIds: s.selection?.kind === 'room' ? s.selection.ids : [],
      },
    });
    ctx.container.setPointerCapture(ev.pointerId);
    return true;
  },
  onPointerMove(ev, ctx) {
    const s = store.getState();

    if (s.pending?.kind === 'customLinePoint') {
      const c = snappedCoord(ctx, ev);
      ctx.scene.reader.setCustomLinePoint(s.pending.roomId, s.pending.exitName, s.pending.pointIndex, c.x, c.y);
      ctx.refresh();
      store.bumpData();
      return true;
    }

    if (s.pending?.kind === 'marquee') {
      const c = mapCoord(ctx, ev);
      const p = { ...s.pending, currentX: c.x, currentY: c.y };
      const minX = Math.min(p.startX, c.x);
      const maxX = Math.max(p.startX, c.x);
      const minY = Math.min(p.startY, c.y);
      const maxY = Math.max(p.startY, c.y);
      const hit = roomsInRect(minX, maxX, minY, maxY);
      let newIds: number[];
      if (p.ctrlHeld) {
        const pre = new Set(p.preExistingIds);
        for (const id of hit) { if (pre.has(id)) pre.delete(id); else pre.add(id); }
        newIds = [...pre];
      } else if (p.shiftHeld) {
        const pre = new Set(p.preExistingIds);
        for (const id of hit) pre.add(id);
        newIds = [...pre];
      } else {
        newIds = hit;
      }
      store.setState({
        pending: p,
        selection: newIds.length === 0 ? null : { kind: 'room', ids: newIds },
      });
      return true;
    }

    if (s.pending?.kind === 'labelDrag') {
      const raw = mapCoord(ctx, ev);
      const rawPos = { x: raw.x - s.pending.offsetX, y: raw.y - s.pending.offsetY };
      const pos = s.snapToGrid ? { x: snap(rawPos.x, s.gridStep), y: snap(rawPos.y, s.gridStep) } : rawPos;
      const current = ctx.scene.reader.getLabelSnapshot(s.pending.areaId, s.pending.labelId);
      const dx = current ? pos.x - current.pos[0] : 1;
      const dy = current ? pos.y - (-current.pos[1]) : 1;
      if (dx !== 0 || dy !== 0) {
        ctx.scene.reader.moveLabel(s.pending.areaId, s.pending.labelId, pos.x, pos.y);
        ctx.refresh();
        store.bumpData();
      }
      return true;
    }

    if (s.pending?.kind === 'labelResize') {
      const c = mapCoord(ctx, ev);
      const p = s.pending;
      const lockedRatio = s.labelAspectRatioLocked && p.originSize[1] > 0 ? p.originSize[0] / p.originSize[1] : undefined;
      const nb = computeResizeBounds(p.handle, p.originPos[0], -p.originPos[1], p.originSize[0], p.originSize[1], c.x, c.y, lockedRatio);
      const current = ctx.scene.reader.getLabelSnapshot(p.areaId, p.labelId);
      const changed = !current || nb.x !== current.pos[0] || nb.y !== -current.pos[1]
        || nb.w !== current.size[0] || nb.h !== current.size[1];
      if (changed) {
        ctx.scene.reader.moveLabel(p.areaId, p.labelId, nb.x, nb.y);
        ctx.scene.reader.setLabelSize(p.areaId, p.labelId, nb.w, nb.h);
        ctx.scene.refresh();
      }
      return true;
    }

    if (s.pending?.kind !== 'drag') {
      updateHover(ctx, ev);
      return false;
    }
    const render = ctx.scene.getRenderRoom(s.pending.roomId);
    if (!render) return true;
    const raw = mapCoord(ctx, ev);
    const centreRaw = { x: raw.x - s.pending.offsetX, y: raw.y - s.pending.offsetY };
    const target = s.snapToGrid
      ? { x: snap(centreRaw.x, s.gridStep), y: snap(centreRaw.y, s.gridStep) }
      : centreRaw;
    const dx = target.x - render.x;
    const dy = target.y - render.y;
    if (dx !== 0 || dy !== 0) {
      ctx.scene.reader.moveRoom(s.pending.roomId, target.x, target.y, render.z);
      if (s.pending.multiOrigins) {
        for (const { id } of s.pending.multiOrigins) {
          const r = ctx.scene.getRenderRoom(id);
          if (r) ctx.scene.reader.moveRoom(id, r.x + dx, r.y + dy, r.z);
        }
      }
      if (s.pending.customLineSnapshots?.length) {
        // Total raw-space delta from origin (render x = raw x; render y = -raw y)
        const dxRaw = target.x - s.pending.originX;
        const dyRaw = -target.y - s.pending.originY;
        for (const snap of s.pending.customLineSnapshots) {
          const newPts = snap.points.map(([px, py]) => [px + dxRaw, py + dyRaw] as [number, number]);
          ctx.scene.reader.setCustomLine(snap.roomId, snap.exitName, newPts, snap.color, snap.style, snap.arrow);
        }
      }
      ctx.refresh();
      store.bumpData();
    }
    return true;
  },
  onPointerUp(ev, ctx) {
    const s = store.getState();
    try { ctx.container.releasePointerCapture(ev.pointerId); } catch {}

    if (s.pending?.kind === 'customLinePoint' && s.map) {
      const pending = s.pending;
      const rawRoom = s.map.rooms[pending.roomId];
      const rawPoints = rawRoom?.customLines?.[pending.exitName];
      const newPoints: [number, number][] = rawPoints ? [...rawPoints] : [];
      const rawColor = rawRoom?.customLinesColor?.[pending.exitName]
        ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
      const rawStyle = rawRoom?.customLinesStyle?.[pending.exitName] ?? 1;
      const rawArrow = rawRoom?.customLinesArrow?.[pending.exitName] ?? false;
      // A plain click (no drag) now sub-selects the waypoint — don't pollute the
      // undo stack with a no-op. Compare against the captured origin points.
      const moved = newPoints.length !== pending.originPoints.length
        || newPoints.some((p, i) => p[0] !== pending.originPoints[i][0] || p[1] !== pending.originPoints[i][1]);
      if (moved) {
        store.setState((st) => ({
          undo: [...st.undo, {
            kind: 'setCustomLine' as const,
            roomId: pending.roomId,
            exitName: pending.exitName,
            data: { points: newPoints, color: rawColor, style: rawStyle, arrow: rawArrow },
            previous: { points: pending.originPoints, color: rawColor, style: rawStyle, arrow: rawArrow },
          }],
          redo: [],
          pending: null,
        }));
      } else {
        store.setState({ pending: null });
      }
      return true;
    }

    if (s.pending?.kind === 'marquee') {
      try { ctx.container.releasePointerCapture(ev.pointerId); } catch {}
      const p = s.pending;
      const dx = Math.abs(p.currentX - p.startX);
      const dy = Math.abs(p.currentY - p.startY);
      // Selection is already live-updated by onPointerMove. For a bare click
      // (no significant drag) without Ctrl, clear the selection.
      if (dx <= MARQUEE_THRESHOLD && dy <= MARQUEE_THRESHOLD && !p.ctrlHeld && !p.shiftHeld) {
        store.setState({ selection: null });
      }
      store.setState({ pending: null });
      return true;
    }

    if (s.pending?.kind === 'labelDrag' && s.map) {
      const pending = s.pending;
      const snap = ctx.scene.reader.getLabelSnapshot(pending.areaId, pending.labelId);
      const moved = snap && (
        snap.pos[0] !== pending.originPos[0] ||
        snap.pos[1] !== pending.originPos[1]
      );
      if (moved && snap) {
        store.setState((st) => ({
          undo: [...st.undo, {
            kind: 'moveLabel' as const,
            areaId: pending.areaId,
            id: pending.labelId,
            from: pending.originPos,
            to: [...snap.pos] as [number, number, number],
          }],
          redo: [],
          status: `Moved label ${pending.labelId}`,
        }));
      }
      store.setState({ pending: null });
      return true;
    }

    if (s.pending?.kind === 'labelResize' && s.map) {
      const pending = s.pending;
      const snap = ctx.scene.reader.getLabelSnapshot(pending.areaId, pending.labelId);
      const changed = snap && (
        snap.pos[0] !== pending.originPos[0] ||
        snap.pos[1] !== pending.originPos[1] ||
        snap.size[0] !== pending.originSize[0] ||
        snap.size[1] !== pending.originSize[1]
      );
      if (changed && snap) {
        store.setState((st) => ({
          undo: [...st.undo, {
            kind: 'resizeLabel' as const,
            areaId: pending.areaId,
            id: pending.labelId,
            fromPos: pending.originPos,
            toPos: [...snap.pos] as [number, number, number],
            fromSize: pending.originSize,
            toSize: [...snap.size] as [number, number],
          }],
          redo: [],
          status: `Resized label ${pending.labelId}`,
        }));
        store.bumpData();
      }
      store.setState({ pending: null });
      return true;
    }

    if (s.pending?.kind !== 'drag' || !s.map) return false;
    const pending = s.pending;
    const raw = s.map.rooms[pending.roomId];
    if (raw && (raw.x !== pending.originX || raw.y !== pending.originY)) {
      const cmds: import('./types').Command[] = [{
        kind: 'moveRoom',
        id: pending.roomId,
        from: { x: pending.originX, y: pending.originY, z: raw.z },
        to: { x: raw.x, y: raw.y, z: raw.z },
      }];
      if (pending.multiOrigins) {
        for (const { id, x: fromX, y: fromY } of pending.multiOrigins) {
          const r = s.map.rooms[id];
          if (r && (r.x !== fromX || r.y !== fromY)) {
            cmds.push({ kind: 'moveRoom', id, from: { x: fromX, y: fromY, z: r.z }, to: { x: r.x, y: r.y, z: r.z } });
          }
        }
      }
      if (pending.customLineSnapshots) {
        for (const snap of pending.customLineSnapshots) {
          const room = s.map.rooms[snap.roomId];
          if (!room) continue;
          const curPts = room.customLines[snap.exitName];
          if (!curPts) continue;
          const changed = curPts.length !== snap.points.length || curPts.some((p, i) => p[0] !== snap.points[i][0] || p[1] !== snap.points[i][1]);
          if (changed) {
            cmds.push({
              kind: 'setCustomLine',
              roomId: snap.roomId,
              exitName: snap.exitName,
              data: { points: [...curPts] as [number, number][], color: snap.color, style: snap.style, arrow: snap.arrow },
              previous: { points: snap.points, color: snap.color, style: snap.style, arrow: snap.arrow },
            });
          }
        }
      }
      const roomMoveCount = cmds.filter(c => c.kind === 'moveRoom').length;
      const cmd = cmds.length === 1 ? cmds[0] : { kind: 'batch' as const, cmds };
      store.setState((st) => ({ undo: [...st.undo, cmd], redo: [] }));
      store.setState({
        status: roomMoveCount > 1
          ? `Moved ${roomMoveCount} rooms`
          : `Moved room ${pending.roomId} → (${raw.x}, ${raw.y}, ${raw.z})`,
      });
    }
    store.setState({ pending: null });
    return true;
  },
  onContextMenu(ev, ctx) {
    const s = store.getState();
    if (!s.map) return false;

    // When the spread/shrink popup is open, right-click on any room sets it as the anchor.
    if (s.spreadShrink) {
      const hit = roomUnder(ctx, ev);
      if (hit) {
        store.setState({ spreadShrink: { ...s.spreadShrink, centerMode: 'anchor', anchorRoomId: hit.id } });
        return true;
      }
    }

    const c = mapCoord(ctx, ev);
    const ac = activeContext();

    // Multiple elements overlap → show disambiguate menu so the user can pick.
    // Exits and custom lines are excluded: they have no context menu, so a
    // room+exit or room+customLine combo should just show the room menu directly.
    if (ac) {
      const hits = allHitsAt(ctx.renderer, ac.map, ac.areaId, ac.z, c.x, c.y, ctx.settings.roomSize, ctx.scene.reader)
        .filter(h => h.kind !== 'exit' && h.kind !== 'customLine');
      if (hits.length > 1) {
        store.setState({
          contextMenu: { kind: 'disambiguate', hits, screenX: ev.clientX, screenY: ev.clientY },
        });
        return true;
      }
    }

    // Single element: existing behavior.
    const roomHit = roomUnder(ctx, ev);
    if (roomHit) {
      store.setState({
        contextMenu: {
          kind: 'room',
          roomId: roomHit.id,
          screenX: ev.clientX,
          screenY: ev.clientY,
        },
      });
      return true;
    }

    if (ac) {
      const lblHit = labelAt(ac.areaId, ac.z, c.x, c.y, ctx.scene.reader);
      if (lblHit) {
        store.setState({
          selection: { kind: 'label', id: lblHit.id, areaId: lblHit.areaId },
          contextMenu: { kind: 'label', areaId: lblHit.areaId, labelId: lblHit.id, screenX: ev.clientX, screenY: ev.clientY },
          sidebarTab: 'selection',
        });
        return true;
      }
    }

    if (s.selection?.kind !== 'customLine') return false;
    const sel = s.selection;
    const rawRoom = s.map.rooms[sel.roomId];
    const points = rawRoom?.customLines?.[sel.exitName];
    if (!rawRoom || !points) return false;

    // Waypoint under cursor → show a context menu offering to delete it.
    const ptIdx = customLinePointAt(ctx.renderer, sel.roomId, sel.exitName, c.x, c.y, ctx.settings.roomSize);
    if (ptIdx !== null) {
      store.setState({
        selection: { kind: 'customLine', roomId: sel.roomId, exitName: sel.exitName, pointIndex: ptIdx },
        contextMenu: {
          kind: 'customLinePoint',
          roomId: sel.roomId,
          exitName: sel.exitName,
          pointIndex: ptIdx,
          screenX: ev.clientX,
          screenY: ev.clientY,
        },
      });
      return true;
    }

    // Line segment under cursor → insert a waypoint there.
    const seg = customLineSegmentAt(ctx.renderer, sel.roomId, sel.exitName, c.x, c.y, ctx.settings.roomSize);
    if (seg !== null) {
      const sc = snappedCoord(ctx, ev);
      insertCustomLinePoint(ctx, sel.roomId, sel.exitName, seg.insertIndex, sc.x, sc.y);
      return true;
    }
    return false;
  },
  onCancel(ctx) {
    const s = store.getState();
    if (s.pending?.kind === 'marquee') {
      store.setState({ pending: null });
      return;
    }
    if (s.pending?.kind === 'customLinePoint' && s.map) {
      // Restore original points
      const rawRoom = s.map.rooms[s.pending.roomId];
      if (rawRoom) {
        rawRoom.customLines[s.pending.exitName] = s.pending.originPoints;
        ctx.scene.reader.getArea(rawRoom.area)?.markDirty();
        ctx.refresh();
      }
    } else if (s.pending?.kind === 'labelDrag') {
      ctx.scene.reader.moveLabel(s.pending.areaId, s.pending.labelId, s.pending.originPos[0], -s.pending.originPos[1]);
      ctx.refresh();
    } else if (s.pending?.kind === 'labelResize') {
      ctx.scene.reader.moveLabel(s.pending.areaId, s.pending.labelId, s.pending.originPos[0], -s.pending.originPos[1]);
      ctx.scene.reader.setLabelSize(s.pending.areaId, s.pending.labelId, s.pending.originSize[0], s.pending.originSize[1]);
      ctx.refresh();
    } else if (s.pending?.kind === 'drag' && s.map) {
      const raw = s.map.rooms[s.pending.roomId];
      if (raw) {
        ctx.scene.reader.moveRoom(s.pending.roomId, s.pending.originX, -s.pending.originY, raw.z);
      }
      if (s.pending.multiOrigins) {
        for (const { id, x, y } of s.pending.multiOrigins) {
          const r = s.map.rooms[id];
          if (r) ctx.scene.reader.moveRoom(id, x, -y, r.z);
        }
      }
      if (s.pending.customLineSnapshots) {
        for (const snap of s.pending.customLineSnapshots) {
          ctx.scene.reader.setCustomLine(snap.roomId, snap.exitName, snap.points, snap.color, snap.style, snap.arrow);
        }
      }
      ctx.refresh();
    }
    store.setState({ pending: null });
  },
};

/** Return IDs of rooms in the current area/z whose render-space centre falls within the given render-space rect. */
function roomsInRect(minX: number, maxX: number, minY: number, maxY: number): number[] {
  const s = store.getState();
  if (!s.map || s.currentAreaId == null) return [];
  const ids: number[] = [];
  for (const [key, room] of Object.entries(s.map.rooms)) {
    if (!room || room.area !== s.currentAreaId || room.z !== s.currentZ) continue;
    // Raw storage: x same, y negated relative to render space.
    const rx = room.x;
    const ry = -room.y;
    if (rx >= minX && rx <= maxX && ry >= minY && ry <= maxY) ids.push(Number(key));
  }
  return ids;
}

/**
 * Insert a waypoint at raw index `insertIndex` on the given customLine.
 * Render-space cursor coords are converted to raw (y-flipped) storage here.
 */
function insertCustomLinePoint(
  ctx: ToolContext,
  roomId: number,
  exitName: string,
  insertIndex: number,
  renderX: number,
  renderY: number,
): void {
  const s = store.getState();
  if (!s.map) return;
  const rawRoom = s.map.rooms[roomId];
  const current = rawRoom?.customLines?.[exitName];
  if (!rawRoom || !current) return;
  const color = rawRoom.customLinesColor?.[exitName] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
  const style = rawRoom.customLinesStyle?.[exitName] ?? 1;
  const arrow = rawRoom.customLinesArrow?.[exitName] ?? false;
  // Raw indices run in the same order as drawn segments: drawn segment i
  // spans drawn[i]→drawn[i+1], so inserting at raw index `i` (with i=0 meaning
  // before the existing first waypoint) puts the new point inside segment i.
  const clamped = Math.max(0, Math.min(insertIndex, current.length));
  const newPoints: [number, number][] = [...current];
  newPoints.splice(clamped, 0, [renderX, -renderY]);
  const previous = { points: [...current] as [number, number][], color, style, arrow };
  const data = { points: newPoints, color, style, arrow };
  pushCommand({ kind: 'setCustomLine', roomId, exitName, data, previous }, ctx.scene);
  ctx.refresh();
  store.bumpData();
  store.setState({
    selection: { kind: 'customLine', roomId, exitName, pointIndex: clamped },
    status: `Added waypoint to '${exitName}' on room ${roomId}`,
  });
}

/**
 * Connect is a drag interaction. Pointer-down on a room picks the source; if
 * the cursor is near one of the 8 handle positions (corners + midpoints) the
 * source direction is fixed explicitly. Otherwise the direction is inferred
 * from the target on drop.
 */
export const connectTool: Tool = {
  id: 'connect',
  cursor: 'crosshair',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0) return false;
    const room = roomUnder(ctx, ev);
    if (!room) {
      const s = store.getState();
      if (s.pending?.kind === 'connect') {
        store.setState({ pending: null, status: 'Connect cancelled.' });
      }
      return true;
    }
    const c = mapCoord(ctx, ev);
    const sourceDir = handleDirFor(c, { x: room.x, y: room.y }, ctx.settings.roomSize);
    store.setState({
      pending: {
        kind: 'connect',
        sourceId: room.id,
        sourceDir,
        cursorMap: c,
        hoverTargetId: null,
        targetDir: null,
      },
      selection: { kind: 'room', ids: [room.id] },
      status: sourceDir
        ? `Connect ${room.id} ${sourceDir.toUpperCase()} → drop on target · Shift = one-way`
        : `Connect ${room.id} → drop on target (direction inferred) · Shift = one-way`,
    });
    try { ctx.container.setPointerCapture(ev.pointerId); } catch {}
    return true;
  },
  onPointerMove(ev, ctx) {
    const s = store.getState();
    const c = mapCoord(ctx, ev);
    const room = roomUnder(ctx, ev);
    const hoverTargetId = room ? room.id : null;
    if (s.pending?.kind === 'connect') {
      // If hovering a room other than the source, try to lock onto a handle.
      let targetDir: import('./types').Direction | null = null;
      if (room && room.id !== s.pending.sourceId) {
        targetDir = handleDirFor(c, { x: room.x, y: room.y }, ctx.settings.roomSize);
      }
      store.setState({
        pending: { ...s.pending, cursorMap: c, hoverTargetId, targetDir },
      });
      return true;
    }
    updateHover(ctx, ev);
    return false;
  },
  onPointerUp(ev, ctx) {
    const s = store.getState();
    if (s.pending?.kind !== 'connect') return false;
    const pending = s.pending;
    try { ctx.container.releasePointerCapture(ev.pointerId); } catch {}
    if (pending.hoverTargetId != null && pending.hoverTargetId !== pending.sourceId) {
      createConnection(ctx, pending.sourceId, pending.hoverTargetId, pending.sourceDir, pending.targetDir, ev.shiftKey);
    } else {
      store.setState({ status: 'Connect cancelled.' });
    }
    store.setState({ pending: null });
    return true;
  },
  onCancel() {
    store.setState({ pending: null });
  },
};

function createConnection(
  ctx: ToolContext,
  sourceId: number,
  targetId: number,
  explicitSourceDir: import('./types').Direction | null,
  explicitTargetDir: import('./types').Direction | null,
  oneWay: boolean,
) {
  const source = ctx.scene.getRenderRoom(sourceId);
  const target = ctx.scene.getRenderRoom(targetId);
  if (!source || !target) return;
  const dir = explicitSourceDir ?? inferDirection(source.x, source.y, target.x, target.y);
  if (!is2DCardinal(dir)) return;
  const rawSource = store.getState().map?.rooms[sourceId];
  const rawTarget = store.getState().map?.rooms[targetId];
  if (!rawSource || !rawTarget) return;
  const previous = getExit(rawSource, dir);
  // Target direction: explicit handle if provided, else the strict opposite.
  const reverseDir = explicitTargetDir ?? OPPOSITE[dir];
  const isValidReverse = is2DCardinal(reverseDir);
  const reverseExisting = isValidReverse ? getExit(rawTarget, reverseDir) : -1;
  const reverse = oneWay || !isValidReverse
    ? null
    : reverseExisting === -1 || reverseExisting === sourceId
      ? { fromId: targetId, dir: reverseDir, previous: reverseExisting }
      : null;
  pushCommand({
    kind: 'addExit',
    fromId: sourceId,
    dir,
    toId: targetId,
    previous,
    reverse,
  }, ctx.scene);
  ctx.refresh();
  store.bumpData();
  const msg = reverse
    ? `Connected ${sourceId}.${dir} ↔ ${targetId}.${reverseDir}`
    : `Connected ${sourceId}.${dir} → ${targetId}`;
  store.setState({ status: msg });
}

export const unlinkTool: Tool = {
  id: 'unlink',
  cursor: 'crosshair',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0) return false;
    const ac = activeContext();
    if (!ac) return false;
    const c = mapCoord(ctx, ev);

    const room = roomUnder(ctx, ev);
    const halfBody = ctx.settings.roomSize / 2;
    const onRoomBody = !!room
      && Math.abs(c.x - room.x) <= halfBody
      && Math.abs(c.y - room.y) <= halfBody;

    if (!onRoomBody) {
      const cl = customLineAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
      if (cl) {
        const raw = ac.map.rooms[cl.roomId];
        const points = raw?.customLines?.[cl.exitName] ?? [];
        const color = raw?.customLinesColor?.[cl.exitName] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
        const style = raw?.customLinesStyle?.[cl.exitName] ?? 1;
        const arrow = raw?.customLinesArrow?.[cl.exitName] ?? false;
        pushCommand({
          kind: 'removeCustomLine',
          roomId: cl.roomId,
          exitName: cl.exitName,
          snapshot: { points, color, style, arrow },
        }, ctx.scene);
        ctx.refresh();
        store.bumpData();
        const s = store.getState();
        if (s.selection?.kind === 'customLine' && s.selection.roomId === cl.roomId && s.selection.exitName === cl.exitName) {
          store.setState({ selection: null });
        }
        store.setState({ status: `Removed custom line '${cl.exitName}' from room ${cl.roomId}` });
        return true;
      }

      const exit = exitAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
      if (exit) {
        const fromRoom = ac.map.rooms[exit.fromId];
        if (!fromRoom) return true;
        const opposite = OPPOSITE[exit.dir];
        const toRoom = ac.map.rooms[exit.toId];
        const reverse = toRoom && is2DCardinal(opposite) && getExit(toRoom, opposite) === exit.fromId
          ? { fromId: exit.toId, dir: opposite, was: exit.fromId }
          : null;
        pushCommand({
          kind: 'removeExit',
          fromId: exit.fromId,
          dir: exit.dir,
          was: exit.toId,
          reverse,
        }, ctx.scene);
        ctx.refresh();
        store.bumpData();
        const s = store.getState();
        if (s.selection?.kind === 'exit' && s.selection.fromId === exit.fromId && s.selection.dir === exit.dir) {
          store.setState({ selection: null });
        }
        store.setState({
          status: reverse
            ? `Removed exit ${exit.fromId}.${exit.dir} ↔ ${exit.toId}.${opposite}`
            : `Removed exit ${exit.fromId}.${exit.dir} → ${exit.toId}`,
        });
        return true;
      }
    }

    if (!room) {
      store.setState({ status: 'No exit, custom line, or room under cursor.' });
      return true;
    }
    const raw = ac.map.rooms[room.id];
    if (!raw) return true;
    const exits: Array<{ dir: Direction; was: number; reverse: { fromId: number; dir: Direction; was: number } | null }> = [];
    for (const dir of CARDINAL_DIRECTIONS) {
      const was = getExit(raw, dir);
      if (was === -1) continue;
      const toRoom = ac.map.rooms[was];
      const opposite = OPPOSITE[dir];
      const reverse = toRoom && getExit(toRoom, opposite) === room.id
        ? { fromId: was, dir: opposite, was: room.id }
        : null;
      exits.push({ dir, was, reverse });
    }
    const specialExits = Object.entries(raw.mSpecialExits).map(([name, toId]) => ({ name, toId: toId as number }));
    if (exits.length === 0 && specialExits.length === 0) {
      store.setState({ status: `Room ${room.id} has no exits.` });
      return true;
    }
    pushCommand({ kind: 'removeAllExits', roomId: room.id, exits, specialExits }, ctx.scene);
    ctx.refresh();
    store.bumpData();
    store.setState({ status: `Removed all exits from room ${room.id}` });
    return true;
  },
  onPointerMove(ev, ctx) {
    updateHover(ctx, ev);
  },
};

export const addRoomTool: Tool = {
  id: 'addRoom',
  cursor: 'crosshair',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0) return false;
    const ac = activeContext();
    if (!ac) return false;
    const { x: rx, y: ry } = snappedCoord(ctx, ev);
    // RENDER→raw flip for storage.
    const rawX = rx;
    const rawY = -ry;
    if (roomAtCell(ac.map, ac.areaId, rawX, rawY, ac.z)) {
      store.setState({ status: 'Cell is already occupied.' });
      return true;
    }
    const id = nextRoomId(ac.map);
    const room = createDefaultRoom(id, ac.areaId, rawX, rawY, ac.z);
    pushCommand({ kind: 'addRoom', id, room, areaId: ac.areaId }, ctx.scene);
    ctx.refresh();
    store.bumpStructure();
    if (ev.ctrlKey || ev.metaKey) {
      store.setState({ status: `Added room ${id} at (${rawX}, ${rawY}, ${ac.z})` });
    } else {
      store.setState({
        activeTool: 'select',
        selection: { kind: 'room', ids: [id] },
        status: `Added room ${id} at (${rawX}, ${rawY}, ${ac.z})`,
      });
    }
    return true;
  },
  onPointerMove(ev, ctx) {
    const c = snappedCoord(ctx, ev);
    store.setState({ snapCursor: c });
    updateHover(ctx, ev);
  },
};

export const deleteTool: Tool = {
  id: 'delete',
  cursor: 'not-allowed',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0) return false;
    const ac = activeContext();
    if (!ac) return false;
    const c = mapCoord(ctx, ev);

    // Label hit test — checked first (labels are free-form, not tied to rooms).
    const lbl = labelAt(ac.areaId, ac.z, c.x, c.y, ctx.scene.reader);
    if (lbl) {
      const snap = ctx.scene.reader.getLabelSnapshot(lbl.areaId, lbl.id);
      if (snap) {
        pushCommand({ kind: 'deleteLabel', areaId: lbl.areaId, label: snap }, ctx.scene);
        ctx.refresh();
        store.bumpData();
        const s = store.getState();
        if (s.selection?.kind === 'label' && s.selection.id === lbl.id) {
          store.setState({ selection: null });
        }
        store.setState({ status: `Deleted label ${lbl.id}` });
      }
      return true;
    }

    const room = roomUnder(ctx, ev);
    const halfBody = ctx.settings.roomSize / 2;
    const onRoomBody = !!room
      && Math.abs(c.x - room.x) <= halfBody
      && Math.abs(c.y - room.y) <= halfBody;

    if (!onRoomBody) {
      const cl = customLineAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
      if (cl) {
        const raw = ac.map.rooms[cl.roomId];
        const points = raw?.customLines?.[cl.exitName] ?? [];
        const color = raw?.customLinesColor?.[cl.exitName]
          ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
        const style = raw?.customLinesStyle?.[cl.exitName] ?? 1;
        const arrow = raw?.customLinesArrow?.[cl.exitName] ?? false;
        pushCommand({
          kind: 'removeCustomLine',
          roomId: cl.roomId,
          exitName: cl.exitName,
          snapshot: { points, color, style, arrow },
        }, ctx.scene);
        ctx.refresh();
        store.bumpData();
        const s = store.getState();
        if (s.selection?.kind === 'customLine' && s.selection.roomId === cl.roomId && s.selection.exitName === cl.exitName) {
          store.setState({ selection: null });
        }
        store.setState({ status: `Removed custom line '${cl.exitName}' from room ${cl.roomId}` });
        return true;
      }

      const exit = exitAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
      if (exit) {
        const fromRoom = ac.map.rooms[exit.fromId];
        if (!fromRoom) return true;
        const opposite = OPPOSITE[exit.dir];
        const toRoom = ac.map.rooms[exit.toId];
        const reverse = toRoom && is2DCardinal(opposite) && getExit(toRoom, opposite) === exit.fromId
          ? { fromId: exit.toId, dir: opposite, was: exit.fromId }
          : null;
        pushCommand({
          kind: 'removeExit',
          fromId: exit.fromId,
          dir: exit.dir,
          was: exit.toId,
          reverse,
        }, ctx.scene);
        ctx.refresh();
        store.bumpData();
        const s = store.getState();
        if (s.selection?.kind === 'exit' && s.selection.fromId === exit.fromId && s.selection.dir === exit.dir) {
          store.setState({ selection: null });
        }
        store.setState({
          status: reverse
            ? `Removed exit ${exit.fromId}.${exit.dir} ↔ ${exit.toId}.${opposite}`
            : `Removed exit ${exit.fromId}.${exit.dir} → ${exit.toId}`,
        });
        return true;
      }
    }

    if (!room) {
      store.setState({ status: 'No exit, custom line, or room under cursor.' });
      return true;
    }
    const raw = ac.map.rooms[room.id];
    if (!raw) return true;
    const snapshot = { ...raw };
    const neighborEdits = buildDeleteNeighborEdits(ac.map, room.id);
    pushCommand({
      kind: 'deleteRoom',
      id: room.id,
      room: snapshot,
      areaId: ac.areaId,
      neighborEdits,
    }, ctx.scene);
    ctx.refresh();
    store.bumpStructure();
    const s = store.getState();
    if (s.selection?.kind === 'room' && s.selection.ids.includes(room.id)) {
      store.setState({ selection: null });
    }
    store.setState({ status: `Deleted room ${room.id}` });
    return true;
  },
  onPointerMove(ev, ctx) {
    updateHover(ctx, ev);
  },
};

let panDragging = false;

export const panTool: Tool = {
  id: 'pan',
  cursor: 'grab',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0 || ev.pointerType !== 'mouse') return false;
    ctx.renderer.backend.viewport.startDrag(ev.clientX, ev.clientY);
    panDragging = true;
    return true;
  },
  onPointerMove(ev, ctx) {
    if (ev.pointerType !== 'mouse') return;
    if (!panDragging) {
      // Space was held mid-drag from another tool — lazy-start if a button is held.
      if (ev.buttons === 0) return;
      ctx.renderer.backend.viewport.startDrag(ev.clientX, ev.clientY);
      panDragging = true;
    }
    ctx.renderer.backend.viewport.updateDrag(ev.clientX, ev.clientY);
    ctx.refresh();
    return true;
  },
  onPointerUp(_ev, ctx) {
    if (!panDragging) return false;
    ctx.renderer.backend.viewport.endDrag();
    panDragging = false;
    return true;
  },
  onCancel(ctx) {
    if (panDragging) {
      ctx.renderer.backend.viewport.endDrag();
      panDragging = false;
    }
  },
};

export const customLineTool: Tool = {
  id: 'customLine',
  cursor: 'crosshair',
  onPointerDown(ev, ctx) {
    const s = store.getState();
    if (!s.pending || s.pending.kind !== 'customLine') return false;
    if (ev.button !== 0) return false;

    const c = snappedCoord(ctx, ev);
    const nextPoints: [number, number][] = [...s.pending.points, [c.x, c.y]];
    commitPendingCustomLine(s.pending, nextPoints, ctx);
    store.setState({ pending: { ...s.pending, points: nextPoints, cursor: c } });
    store.bumpData();
    return true;
  },
  onContextMenu(_ev, ctx) {
    const s = store.getState();
    if (s.pending?.kind !== 'customLine') return false;
    finishCustomLine(s.pending, ctx);
    return true;
  },
  onPointerMove(ev, ctx) {
    const s = store.getState();
    const c = snappedCoord(ctx, ev);
    if (s.pending?.kind === 'customLine') {
      store.setState({ pending: { ...s.pending, cursor: c } });
      return true;
    }
    updateHover(ctx, ev);
    return false;
  },
  onPointerUp() { return false; },
  onCancel(ctx) {
    const s = store.getState();
    if (s.pending?.kind === 'customLine' && ctx) {
      restorePendingCustomLine(s.pending, ctx.scene);
    }
    store.setState({ pending: null, status: 'Custom line cancelled.' });
    store.bumpData();
  },
};

/** Write the in-progress custom line (waypoints after the room centre) to raw and refresh. */
function commitPendingCustomLine(
  pending: import('./types').PendingCustomLine,
  points: [number, number][],
  ctx: ToolContext,
): void {
  // points[0] is the room centre (preview-only); skip it, y-flip the rest.
  const rawPoints: [number, number][] = points.slice(1).map(([x, y]) => [x, -y]);
  ctx.scene.reader.setCustomLine(
    pending.roomId,
    pending.exitName,
    rawPoints,
    pending.color,
    pending.style,
    pending.arrow,
  );
  ctx.refresh();
}

/**
 * Revert any raw mutations made during the in-progress draw. Safe to call even
 * when no raw write happened yet (restores / removes based on previousSnapshot).
 */
export function restorePendingCustomLine(
  pending: import('./types').PendingCustomLine,
  scene: SceneHandle,
): void {
  if (pending.previousSnapshot) {
    const p = pending.previousSnapshot;
    scene.reader.setCustomLine(pending.roomId, pending.exitName, p.points, p.color, p.style, p.arrow);
  } else {
    scene.reader.removeCustomLine(pending.roomId, pending.exitName);
  }
  if (pending.companion) {
    const c = pending.companion;
    if (c.previousSnapshot) {
      const p = c.previousSnapshot;
      scene.reader.setCustomLine(c.roomId, c.exitName, p.points, p.color, p.style, p.arrow);
    } else {
      scene.reader.removeCustomLine(c.roomId, c.exitName);
    }
  }
  scene.refresh();
}

export function finishCustomLine(pending: import('./types').PendingCustomLine, ctx?: ToolContext): void {
  if (!store.getState().map) return;

  // No waypoints placed → treat as cancel.
  if (pending.points.length < 2) {
    if (ctx) restorePendingCustomLine(pending, ctx.scene);
    store.setState({ pending: null, activeTool: 'select', status: 'Need at least 1 waypoint — cancelled.' });
    store.bumpData();
    return;
  }

  // Raw already holds the committed points (written live during drawing).
  // pending.points[0] is the room centre; skip it, y-flip the rest.
  const rawPoints: [number, number][] = pending.points.slice(1).map(([x, y]) => [x, -y]);

  const emptyStub = {
    points: [] as [number, number][],
    color: pending.color, style: pending.style, arrow: false,
  };

  // Push undo-only entry: raw was mutated as we drew, so no re-apply needed here.
  store.setState((st) => ({
    undo: [...st.undo, {
      kind: 'setCustomLine' as const,
      roomId: pending.roomId,
      exitName: pending.exitName,
      data: { points: rawPoints, color: pending.color, style: pending.style, arrow: pending.arrow },
      previous: pending.previousSnapshot,
      companion: pending.companion
        ? {
            roomId: pending.companion.roomId,
            exitName: pending.companion.exitName,
            data: emptyStub,
            previous: pending.companion.previousSnapshot,
          }
        : undefined,
    }],
    redo: [],
  }));

  store.bumpData();
  store.setState({
    pending: null,
    activeTool: 'select',
    status: `Custom line '${pending.exitName}' saved on room ${pending.roomId}`,
  });
}

function computeResizeBounds(
  handle: import('./types').LabelResizeHandle,
  lx: number, ly: number, lw: number, lh: number,
  cx: number, cy: number,
  lockedRatio?: number,
): { x: number; y: number; w: number; h: number } {
  let left = lx, right = lx + lw, top = ly, bottom = ly + lh;
  switch (handle) {
    case 'nw': left = cx; top = cy; break;
    case 'n':  top = cy; break;
    case 'ne': right = cx; top = cy; break;
    case 'e':  right = cx; break;
    case 'se': right = cx; bottom = cy; break;
    case 's':  bottom = cy; break;
    case 'sw': left = cx; bottom = cy; break;
    case 'w':  left = cx; break;
  }
  let x = Math.min(left, right);
  let y = Math.min(top, bottom);
  let w = Math.max(0.1, Math.abs(right - left));
  let h = Math.max(0.1, Math.abs(bottom - top));

  if (lockedRatio && lockedRatio > 0) {
    switch (handle) {
      case 'e': case 'w':
        h = w / lockedRatio;
        break;
      case 'n': case 's':
        w = h * lockedRatio;
        break;
      case 'nw': {
        const dw = Math.abs(w - lw), dh = Math.abs(h - lh);
        if (dw >= dh) { h = w / lockedRatio; y = (ly + lh) - h; }
        else { w = h * lockedRatio; x = (lx + lw) - w; }
        break;
      }
      case 'ne': {
        const dw = Math.abs(w - lw), dh = Math.abs(h - lh);
        if (dw >= dh) { h = w / lockedRatio; y = (ly + lh) - h; }
        else { w = h * lockedRatio; }
        break;
      }
      case 'se': {
        const dw = Math.abs(w - lw), dh = Math.abs(h - lh);
        if (dw >= dh) { h = w / lockedRatio; }
        else { w = h * lockedRatio; }
        break;
      }
      case 'sw': {
        const dw = Math.abs(w - lw), dh = Math.abs(h - lh);
        if (dw >= dh) { h = w / lockedRatio; }
        else { w = h * lockedRatio; x = (lx + lw) - w; }
        break;
      }
    }
    w = Math.max(0.1, w);
    h = Math.max(0.1, h);
  }

  return { x, y, w, h };
}

function nextLabelId(map: import('../mapIO').MudletMap): number {
  let max = 0;
  for (const arr of Object.values(map.labels ?? {})) {
    for (const l of (arr as any[])) { if (l.id > max) max = l.id; }
  }
  return max + 1;
}

export const addLabelTool: Tool = {
  id: 'addLabel',
  cursor: 'crosshair',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0) return false;
    const ac = activeContext();
    if (!ac) return false;
    const c = snappedCoord(ctx, ev);
    store.setState({
      pending: { kind: 'labelRect', areaId: ac.areaId, z: ac.z, startX: c.x, startY: c.y, currentX: c.x, currentY: c.y },
    });
    ctx.container.setPointerCapture(ev.pointerId);
    return true;
  },
  onPointerMove(ev, ctx) {
    const s = store.getState();
    if (s.pending?.kind === 'labelRect') {
      const c = mapCoord(ctx, ev);
      store.setState({ pending: { ...s.pending, currentX: c.x, currentY: c.y } });
      return true;
    }
    const c = snappedCoord(ctx, ev);
    store.setState({ snapCursor: c });
    updateHover(ctx, ev);
  },
  onPointerUp(ev, ctx) {
    const s = store.getState();
    if (s.pending?.kind !== 'labelRect') return false;
    try { ctx.container.releasePointerCapture(ev.pointerId); } catch {}
    const p = s.pending;
    const ac = activeContext();
    if (!ac) { store.setState({ pending: null }); return true; }

    const dragW = Math.abs(p.currentX - p.startX);
    const dragH = Math.abs(p.currentY - p.startY);
    const w = dragW < 0.5 ? 4 : dragW;
    const h = dragH < 0.5 ? 1 : dragH;
    const x = dragW < 0.5 ? p.startX : Math.min(p.startX, p.currentX);
    const y = dragH < 0.5 ? p.startY : Math.min(p.startY, p.currentY);

    const id = nextLabelId(ac.map);
    const label: import('./types').LabelSnapshot = {
      id,
      pos: [x, -y, p.z],
      size: [w, h],
      text: 'Label',
      fgColor: { spec: 1, alpha: 255, r: 255, g: 255, b: 255 },
      bgColor: { spec: 1, alpha: 128, r: 0, g: 0, b: 0 },
      noScaling: false,
      showOnTop: false,
      font: { ...DEFAULT_LABEL_FONT },
      pixMap: '',  // reader.addLabel generates the pixmap from text+font+colors
    };
    pushCommand({ kind: 'addLabel', areaId: p.areaId, label }, ctx.scene);
    ctx.refresh();
    store.bumpData();
    store.setState({
      activeTool: 'select',
      pending: null,
      selection: { kind: 'label', id, areaId: p.areaId },
      sidebarTab: 'selection',
      status: `Added label at (${x}, ${-y})`,
    });
    return true;
  },
  onCancel() {
    store.setState({ pending: null });
  },
};

export function getActiveSwatch(s: import('./store').EditorState): import('./types').Swatch | null {
  if (!s.activeSwatchSetId || !s.activeSwatchId) return null;
  const set = [...s.swatchSets, ...s.pluginSwatchSets].find(ss => ss.id === s.activeSwatchSetId);
  return set?.swatches.find(sw => sw.id === s.activeSwatchId) ?? null;
}

function applySwatchAt(ctx: ToolContext, ev: PointerEvent, swatch: import('./types').Swatch): void {
  const s = store.getState();
  if (s.pending?.kind !== 'paint') return;
  const room = roomUnder(ctx, ev);
  if (!room) return;
  if (s.pending.painted.some(p => p.id === room.id)) return;
  const rawRoom = s.map?.rooms[room.id];
  if (!rawRoom) return;
  const prevSymbol = rawRoom.symbol ?? '';
  const prevEnv = rawRoom.environment ?? -1;
  ctx.scene.reader.setRoomField(room.id, 'symbol', swatch.symbol);
  ctx.scene.reader.setRoomField(room.id, 'environment', swatch.environment);
  ctx.refresh();
  store.bumpData();
  const painted = [...s.pending.painted, { id: room.id, prevSymbol, prevEnv }];
  store.setState({ pending: { kind: 'paint', painted } });
}

export const paintTool: Tool = {
  id: 'paint',
  cursor: 'cell',
  onPointerDown(ev, ctx) {
    if (ev.button !== 0) return false;
    const s = store.getState();
    const swatch = getActiveSwatch(s);
    if (!swatch) {
      store.setState({ status: 'No swatch selected — open the Swatches palette first.' });
      return true;
    }
    store.setState({ pending: { kind: 'paint', painted: [] } });
    ctx.container.setPointerCapture(ev.pointerId);
    applySwatchAt(ctx, ev, swatch);
    return true;
  },
  onPointerMove(ev, ctx) {
    const s = store.getState();
    if (s.pending?.kind !== 'paint') { updateHover(ctx, ev); return false; }
    const swatch = getActiveSwatch(s);
    if (swatch) applySwatchAt(ctx, ev, swatch);
    return true;
  },
  onPointerUp(ev, ctx) {
    const s = store.getState();
    if (s.pending?.kind !== 'paint') return false;
    try { ctx.container.releasePointerCapture(ev.pointerId); } catch {}
    const painted = s.pending.painted;
    const swatch = getActiveSwatch(s);
    if (painted.length > 0 && swatch) {
      const cmds: import('./types').Command[] = [];
      for (const { id, prevSymbol, prevEnv } of painted) {
        if (prevSymbol !== swatch.symbol)
          cmds.push({ kind: 'setRoomField', id, field: 'symbol', from: prevSymbol, to: swatch.symbol });
        if (prevEnv !== swatch.environment)
          cmds.push({ kind: 'setRoomField', id, field: 'environment', from: prevEnv, to: swatch.environment });
      }
      if (cmds.length > 0) {
        const cmd = cmds.length === 1 ? cmds[0] : { kind: 'batch' as const, cmds };
        store.setState((st) => ({ undo: [...st.undo, cmd], redo: [] }));
      }
      store.setState({ status: `Painted "${swatch.name}" on ${painted.length} room${painted.length > 1 ? 's' : ''}` });
    }
    store.setState({ pending: null });
    return true;
  },
  onCancel(ctx) {
    const s = store.getState();
    if (s.pending?.kind !== 'paint') return;
    for (const { id, prevSymbol, prevEnv } of s.pending.painted) {
      ctx.scene.reader.setRoomField(id, 'symbol', prevSymbol);
      ctx.scene.reader.setRoomField(id, 'environment', prevEnv);
    }
    if (s.pending.painted.length > 0) ctx.refresh();
    store.setState({ pending: null });
  },
};

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  connect: connectTool,
  unlink: unlinkTool,
  addRoom: addRoomTool,
  delete: deleteTool,
  pan: panTool,
  customLine: customLineTool,
  addLabel: addLabelTool,
  paint: paintTool,
};

export function hitToSelection(hit: HitItem): Selection {
  switch (hit.kind) {
    case 'room': return { kind: 'room', ids: [hit.id] };
    case 'label': return { kind: 'label', id: hit.id, areaId: hit.areaId };
    case 'customLine': return { kind: 'customLine', roomId: hit.roomId, exitName: hit.exitName };
    case 'exit': return { kind: 'exit', fromId: hit.fromId, toId: hit.toId, dir: hit.dir };
  }
}

export function hitStatusLabel(hit: HitItem): string {
  switch (hit.kind) {
    case 'room': return `room ${hit.id}`;
    case 'label': return `label ${hit.id}`;
    case 'customLine': return `custom line '${hit.exitName}' on room ${hit.roomId}`;
    case 'exit': return `exit ${hit.dir} (${hit.fromId}→${hit.toId})`;
  }
}

function updateHover(ctx: ToolContext, ev: PointerEvent) {
  const ac = activeContext();
  if (!ac) return;
  const c = mapCoord(ctx, ev);
  const room = roomUnder(ctx, ev);
  let target: HoverTarget = null;
  if (room) {
    const handleDir = handleDirFor(c, { x: room.x, y: room.y }, ctx.settings.roomSize);
    target = { kind: 'room', id: room.id, handleDir };
  } else {
    const lbl = labelAt(ac.areaId, ac.z, c.x, c.y, ctx.scene.reader);
    if (lbl) {
      target = { kind: 'label', id: lbl.id, areaId: lbl.areaId };
    } else {
      // Custom lines take priority over cardinal exits for hover (they're on top visually).
      const cl = customLineAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
      if (cl) {
        target = { kind: 'customLine', roomId: cl.roomId, exitName: cl.exitName };
      } else {
        const exit = exitAt(ctx.renderer, c.x, c.y, ctx.settings.roomSize);
        if (exit) target = { kind: 'exit', ...exit };
      }
    }
  }
  const current = store.getState().hover;
  if (!hoverEquals(current, target)) {
    store.setState({ hover: target });
  }
}

function hoverEquals(a: HoverTarget, b: HoverTarget): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'room' && b.kind === 'room') return a.id === b.id && a.handleDir === b.handleDir;
  if (a.kind === 'exit' && b.kind === 'exit')
    return a.fromId === b.fromId && a.toId === b.toId && a.dir === b.dir;
  if (a.kind === 'customLine' && b.kind === 'customLine')
    return a.roomId === b.roomId && a.exitName === b.exitName;
  if (a.kind === 'label' && b.kind === 'label')
    return a.id === b.id && a.areaId === b.areaId;
  return false;
}
