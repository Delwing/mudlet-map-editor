import { useEffect, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { SidePanel } from './components/SidePanel';
import { ContextMenu } from './components/ContextMenu';
import { store, useEditorState } from './editor/store';
import { createScene, type SceneHandle } from './editor/scene';
import { buildDeleteNeighborEdits, pushCommand, redoOnce, undoOnce } from './editor/commands';
import { finishCustomLine, restorePendingCustomLine } from './editor/tools';
import type { Command, ToolId } from './editor/types';

// Toolbar: 12px from top + ~48px height + 16px gap = 76px. Side panel: always use expanded width (440px).
const VIEW_INSETS = { top: 76, right: 464, bottom: 24, left: 24 };

const TOOL_KEYS: Record<string, ToolId> = {
  '1': 'select',
  '2': 'connect',
  '3': 'unlink',
  '4': 'addRoom',
  '5': 'delete',
  '6': 'pan',
};

// Raw Mudlet convention: +y = north (visually up). ArrowUp must increment raw.y.
const NUDGE: Record<string, { dx: number; dy: number }> = {
  ArrowLeft:  { dx: -1, dy:  0 },
  ArrowRight: { dx:  1, dy:  0 },
  ArrowUp:    { dx:  0, dy:  1 },
  ArrowDown:  { dx:  0, dy: -1 },
};

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);

  const map = useEditorState((s) => s.map);
  const mapLoaded = map != null;
  const currentAreaId = useEditorState((s) => s.currentAreaId);
  const currentZ = useEditorState((s) => s.currentZ);
  const activeTool = useEditorState((s) => s.activeTool);
  const pending = useEditorState((s) => s.pending);
  const spaceHeld = useEditorState((s) => s.spaceHeld);
  const panelCollapsed = useEditorState((s) => s.panelCollapsed);

  // Scene lifecycle: keyed on the raw map reference, so a file load (new MudletMap
  // identity) tears down and recreates the scene, while in-place mutations
  // (add/remove room, move, etc.) do NOT.
  useEffect(() => {
    if (!map || !containerRef.current) return;
    const scene = createScene(map, containerRef.current);
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [map]);

  // Area / z-level switch: redraw and fit. (fitArea resets pan+zoom, which is
  // the expected behaviour when you explicitly switch areas.)
  // Exception: when navigateTo is set, pan to that point instead of fitting (keeps zoom).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !mapLoaded || currentAreaId == null) return;
    const nav = store.getState().navigateTo;
    if (nav) {
      store.setState({ navigateTo: null });
      scene.setAreaAt(currentAreaId, currentZ, nav.mapX, nav.mapY);
    } else {
      scene.setArea(currentAreaId, currentZ, VIEW_INSETS);
    }
  }, [currentAreaId, currentZ, mapLoaded]);

  // Cursor styling per tool (Space-held forces grab/grabbing regardless of active tool).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (spaceHeld) {
      const onDown = () => { el.style.cursor = 'grabbing'; };
      const onUp = () => { el.style.cursor = 'grab'; };
      el.style.cursor = 'grab';
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      return () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
    }
    if (pending?.kind === 'pickExit' || pending?.kind === 'pickSpecialExit') {
      el.style.cursor = 'crosshair';
      return;
    }
    const cursorByTool: Record<ToolId, string> = {
      select: 'default',
      connect: 'crosshair',
      unlink: 'crosshair',
      addRoom: 'crosshair',
      delete: 'not-allowed',
      pan: 'grab',
      customLine: 'crosshair',  // activated from side panel, not toolbar
    };
    el.style.cursor = cursorByTool[activeTool];
  }, [activeTool, spaceHeld, pending]);

  // Keyboard accelerators.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const tag = (t as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Space') {
        if (store.getState().spaceHeld) store.setState({ spaceHeld: false });
      }
    };
    const onBlur = () => {
      if (store.getState().spaceHeld) store.setState({ spaceHeld: false });
    };

    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while the user is typing in an input.
      if (isTyping(e.target)) return;

      if (e.code === 'Space') {
        // Prevent page scroll; hold-to-pan while pressed.
        e.preventDefault();
        if (!store.getState().spaceHeld) store.setState({ spaceHeld: true });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        performUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        performRedo();
        return;
      }
      if (e.key === 'Enter') {
        const s = store.getState();
        if (s.pending?.kind === 'customLine') {
          finishCustomLine(s.pending);
        }
        return;
      }
      if (e.key === 'Escape') {
        const s = store.getState();
        if (s.pending) {
          if (s.pending.kind === 'customLine' && sceneRef.current) {
            restorePendingCustomLine(s.pending, sceneRef.current);
          }
          store.setState({ pending: null, activeTool: s.pending.kind === 'customLine' ? 'select' : s.activeTool, status: 'Cancelled.' });
          store.bumpData();
        } else if (s.selection) {
          store.setState({ selection: null });
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        store.setState((s) => ({ snapToGrid: !s.snapToGrid }));
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        sceneRef.current?.renderer.fitArea(VIEW_INSETS);
        return;
      }

      if (TOOL_KEYS[e.key]) {
        const s = store.getState();
        if (s.pending?.kind === 'customLine' && sceneRef.current) {
          restorePendingCustomLine(s.pending, sceneRef.current);
          store.bumpData();
        }
        store.setState({ activeTool: TOOL_KEYS[e.key], pending: null });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const s = store.getState();
        if (!s.map || s.currentAreaId == null) return;
        const ids = Object.entries(s.map.rooms)
          .filter(([, r]) => r && r.area === s.currentAreaId && r.z === s.currentZ)
          .map(([k]) => Number(k));
        if (ids.length > 0) store.setState({ selection: { kind: 'room', ids } });
        return;
      }

      // Arrow-key nudge for selected room (single selection only).
      if (NUDGE[e.key]) {
        const s = store.getState();
        if (s.activeTool !== 'select' || !s.selection || s.selection.kind !== 'room' || !s.map) return;
        if (s.selection.ids.length !== 1) return;
        const selId = s.selection.ids[0];
        const room = s.map.rooms[selId];
        if (!room) return;
        e.preventDefault();
        const step = (e.shiftKey ? 5 : 1) * s.gridStep;
        const nudge = NUDGE[e.key];
        const from = { x: room.x, y: room.y, z: room.z };
        const nextX = room.x + nudge.dx * step;
        const nextY = room.y + nudge.dy * step;
        // reader.moveRoom expects render coords (Y-flipped); pass -nextY.
        sceneRef.current?.reader.moveRoom(selId, nextX, -nextY, room.z);
        const to = { x: room.x, y: room.y, z: room.z };
        store.setState((st) => ({
          undo: [...st.undo, { kind: 'moveRoom', id: selId, from, to }],
          redo: [],
        }));
        sceneRef.current?.refresh();
        store.bumpData();
        store.setState({ status: `Moved room ${selId} → (${room.x}, ${room.y}, ${room.z})` });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('editor:undo', performUndo as EventListener);
    window.addEventListener('editor:redo', performRedo as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('editor:undo', performUndo as EventListener);
      window.removeEventListener('editor:redo', performRedo as EventListener);
    };
  }, []);

  const deleteSelection = () => {
    const s = store.getState();
    if (!s.map) return;
    const sel = s.selection;
    if (!sel) return;

    if (sel.kind === 'room') {
      if (s.currentAreaId == null) return;
      if (sel.ids.length > 1) {
        const cmds: Command[] = [];
        for (const id of sel.ids) {
          const room = s.map.rooms[id];
          if (!room) continue;
          cmds.push({
            kind: 'deleteRoom',
            id,
            room: { ...room },
            areaId: room.area,
            neighborEdits: buildDeleteNeighborEdits(s.map, id),
          });
        }
        if (cmds.length === 0) return;
        pushCommand({ kind: 'batch', cmds }, sceneRef.current);
        sceneRef.current?.refresh();
        store.setState({ selection: null, status: `Deleted ${cmds.length} rooms` });
        store.bumpStructure();
        return;
      }
      const id = sel.ids[0];
      const room = s.map.rooms[id];
      if (!room) return;
      const snapshot = { ...room };
      const neighborEdits = buildDeleteNeighborEdits(s.map, id);
      pushCommand({
        kind: 'deleteRoom',
        id,
        room: snapshot,
        areaId: room.area,
        neighborEdits,
      }, sceneRef.current);
      sceneRef.current?.refresh();
      store.setState({ selection: null, status: `Deleted room ${id}` });
      store.bumpStructure();
      return;
    }

    if (sel.kind === 'exit') {
      const fromRoom = s.map.rooms[sel.fromId];
      const toRoom = s.map.rooms[sel.toId];
      if (!fromRoom || !toRoom) return;
      const OPP: Record<string, string> = {
        north:'south',south:'north',east:'west',west:'east',
        northeast:'southwest',southwest:'northeast',northwest:'southeast',southeast:'northwest',
        up:'down',down:'up',in:'out',out:'in',
      };
      const reverseDir = OPP[sel.dir] as import('./editor/types').Direction;
      const isBidi = (toRoom as any)[reverseDir] === sel.fromId;
      pushCommand({
        kind: 'removeExit',
        fromId: sel.fromId,
        dir: sel.dir,
        was: sel.toId,
        reverse: isBidi ? { fromId: sel.toId, dir: reverseDir, was: sel.fromId } : null,
      }, sceneRef.current);
      sceneRef.current?.refresh();
      store.bumpData();
      store.setState({ selection: null, status: `Removed exit ${sel.fromId} → ${sel.toId}` });
      return;
    }

    if (sel.kind === 'customLine') {
      const room = s.map.rooms[sel.roomId];
      const pts = room?.customLines?.[sel.exitName];
      if (!room || !pts) return;
      const color = room.customLinesColor?.[sel.exitName] ?? { spec: 1, alpha: 255, r: 255, g: 255, b: 255 };
      const style = room.customLinesStyle?.[sel.exitName] ?? 1;
      const arrow = room.customLinesArrow?.[sel.exitName] ?? false;

      // A specific waypoint is sub-selected → remove just that point. Falling
      // through to whole-line deletion would be surprising after the user
      // explicitly picked a single waypoint.
      if (sel.pointIndex != null && sel.pointIndex >= 0 && sel.pointIndex < pts.length) {
        const newPoints = pts.filter((_, i) => i !== sel.pointIndex);
        pushCommand({
          kind: 'setCustomLine',
          roomId: sel.roomId,
          exitName: sel.exitName,
          data: { points: newPoints, color, style, arrow },
          previous: { points: [...pts] as [number, number][], color, style, arrow },
        }, sceneRef.current);
        sceneRef.current?.refresh();
        store.bumpData();
        store.setState({
          selection: { kind: 'customLine', roomId: sel.roomId, exitName: sel.exitName },
          status: `Removed waypoint from '${sel.exitName}' on room ${sel.roomId}`,
        });
        return;
      }

      pushCommand({
        kind: 'removeCustomLine',
        roomId: sel.roomId,
        exitName: sel.exitName,
        snapshot: { points: pts, color, style, arrow },
      }, sceneRef.current);
      sceneRef.current?.refresh();
      store.bumpData();
      store.setState({ selection: null, status: `Removed custom line '${sel.exitName}'` });
      return;
    }
  };

  const performUndo = () => {
    const { changed, structural } = undoOnce(sceneRef.current);
    if (!changed) return;
    sceneRef.current?.refresh();
    if (structural) store.bumpStructure();
    else store.bumpData();
    store.setState({ status: 'Undone' });
  };

  const performRedo = () => {
    const { changed, structural } = redoOnce(sceneRef.current);
    if (!changed) return;
    sceneRef.current?.refresh();
    if (structural) store.bumpStructure();
    else store.bumpData();
    store.setState({ status: 'Redone' });
  };

  return (
    <div className={`app${panelCollapsed ? ' panel-collapsed' : ''}`}>
      <div className="map-viewport">
        <div ref={containerRef} className="map-container" />
        {!mapLoaded && <div className="empty-state">No map loaded.</div>}
        <Toolbar />
        {pending?.kind === 'connect' && (
          <div className="pending-badge">
            Connect: pick target (click a room) · Shift = one-way · Esc cancels
          </div>
        )}
        {pending?.kind === 'customLine' && (
          <div className="pending-badge">
            Custom line: click to add waypoints · double-click or Enter to finish · Esc cancels
          </div>
        )}
        <SidePanel sceneRef={sceneRef} />
      </div>
      <ContextMenu sceneRef={sceneRef} />
    </div>
  );
}
