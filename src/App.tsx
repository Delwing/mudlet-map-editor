import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { HelpModal } from './components/HelpModal';
import { UrlLoadModal } from './components/UrlLoadModal';
import { SidePanel } from './components/SidePanel';
import { ContextMenu } from './components/ContextMenu';
import { SessionsPanel } from './components/SessionsPanel';
import { SwatchPalette } from './components/SwatchPalette';
import { SearchPanel } from './components/SearchPanel';
import { SpreadShrinkPopup } from './components/SpreadShrinkPopup';
import { store, useEditorState, saveUserSettings } from './editor/store';
import { createScene, type SceneHandle } from './editor/scene';
import { buildCustomLineMoveCommands, buildDeleteNeighborEdits, buildDeleteNeighborEditsForMany, pushCommand, redoOnce, undoOnce } from './editor/commands';
import { finishCustomLine, restorePendingCustomLine } from './editor/tools';
import type { Command, ToolId } from './editor/types';
import { saveSession } from './editor/session';
import { loadFileIntoStore } from './editor/loadFile';
import type { EditorPlugin, RoomPanelSection } from './editor/plugin';

// Toolbar: 12px from top + ~44px header row + ~32px tools row + 16px gap = 104px. Side panel: always use expanded width (440px).
const VIEW_INSETS = { top: 104, right: 464, bottom: 24, left: 24 };

const TOOL_KEYS: Record<string, ToolId> = {
  '1': 'select',
  '2': 'connect',
  '3': 'unlink',
  '4': 'addRoom',
  '5': 'addLabel',
  '6': 'delete',
  '7': 'pan',
  '8': 'paint',
};

// Raw Mudlet convention: +y = north (visually up). ArrowUp must increment raw.y.
const NUDGE: Record<string, { dx: number; dy: number }> = {
  ArrowLeft:  { dx: -1, dy:  0 },
  ArrowRight: { dx:  1, dy:  0 },
  ArrowUp:    { dx:  0, dy:  1 },
  ArrowDown:  { dx:  0, dy: -1 },
};

export default function App({ plugins = [], title = 'Mudlet Map Editor' }: { plugins?: EditorPlugin[]; title?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);

  const map = useEditorState((s) => s.map);
  const swatchPaletteOpen = useEditorState((s) => s.swatchPaletteOpen);
  const mapLoaded = map != null;
  const currentAreaId = useEditorState((s) => s.currentAreaId);
  const currentZ = useEditorState((s) => s.currentZ);
  const activeTool = useEditorState((s) => s.activeTool);
  const pending = useEditorState((s) => s.pending);
  const hover = useEditorState((s) => s.hover);
  const spaceHeld = useEditorState((s) => s.spaceHeld);
  const panelCollapsed = useEditorState((s) => s.panelCollapsed);
  const dataVersion = useEditorState((s) => s.dataVersion);
  const panRequest = useEditorState((s) => s.panRequest);
  const [showHelp, setShowHelp] = useState(false);
  const [showUrlLoad, setShowUrlLoad] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [autoLoadUrl, setAutoLoadUrl] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('map');
  });

  const pluginSwatchSets = useMemo(() => plugins.flatMap((p) => p.swatchSets?.() ?? []), [plugins]);
  const pluginSidebarTabs = useMemo(() => plugins.flatMap((p) => p.sidebarTabs?.() ?? []), [plugins]);
  const pluginRoomSections = useMemo<RoomPanelSection[]>(() => plugins.flatMap((p) => p.roomPanelSections?.() ?? []), [plugins]);

  useEffect(() => {
    store.setState({ pluginSwatchSets });
  }, [pluginSwatchSets]);

  // onAppReady: run all plugins once on mount (fire-and-forget).
  useEffect(() => {
    if (plugins.length === 0) return;
    (async () => { for (const p of plugins) await p.onAppReady?.(); })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // onMapOpened / onMapClosed: fire on map identity transitions.
  const prevMapRef = useRef(map);
  useEffect(() => {
    const prev = prevMapRef.current;
    prevMapRef.current = map;
    if (map && map !== prev) {
      for (const p of plugins) p.onMapOpened?.(map);
    } else if (prev && !map) {
      for (const p of plugins) p.onMapClosed?.();
    }
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scene lifecycle: keyed on the raw map reference, so a file load (new MudletMap
  // identity) tears down and recreates the scene, while in-place mutations
  // (add/remove room, move, etc.) do NOT.
  useEffect(() => {
    if (!map || !containerRef.current) return;
    const scene = createScene(map, containerRef.current);
    sceneRef.current = scene;
    const { currentAreaId, currentZ } = store.getState();
    if (currentAreaId != null) {
      scene.setArea(currentAreaId, currentZ, VIEW_INSETS);
    }
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

  // Pan to a room in the current area/z without resetting the view fit.
  useEffect(() => {
    if (!panRequest || !sceneRef.current) return;
    store.setState({ panRequest: null });
    sceneRef.current.renderer.backend.viewport.panToMapPoint(panRequest.mapX, panRequest.mapY);
    sceneRef.current.refresh();
  }, [panRequest]);

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
    if (pending?.kind === 'pickExit' || pending?.kind === 'pickSpecialExit' || pending?.kind === 'pickSwatch') {
      el.style.cursor = 'crosshair';
      return;
    }
    const cursorByTool: Record<ToolId, string> = {
      select: hover ? 'pointer' : 'default',
      connect: 'crosshair',
      unlink: 'crosshair',
      addRoom: 'crosshair',
      delete: 'not-allowed',
      pan: 'grab',
      customLine: 'crosshair',
      addLabel: 'crosshair',
      paint: 'cell',
    };
    el.style.cursor = cursorByTool[activeTool];
  }, [activeTool, hover, spaceHeld, pending]);

  // Auto-save session to IndexedDB whenever the map changes (debounced).
  useEffect(() => {
    const { map, loaded, undo, currentAreaId, currentZ, sessionId } = store.getState();
    if (!map || !loaded) return;
    const timer = setTimeout(() => {
      saveSession(loaded.fileName, map, undo, currentAreaId, currentZ, sessionId ?? undefined)
        .then((id) => { if (!sessionId) store.setState({ sessionId: id }); })
        .catch(console.error);
    }, 1500);
    return () => clearTimeout(timer);
  }, [dataVersion]);

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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch((v) => !v);
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
        store.setState((s) => {
          saveUserSettings({ snapToGrid: !s.snapToGrid });
          return { snapToGrid: !s.snapToGrid };
        });
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

      // Arrow-key nudge for selected room or label (single selection only).
      if (NUDGE[e.key]) {
        const s = store.getState();
        if (s.activeTool !== 'select' || !s.selection || !s.map) return;

        if (s.selection.kind === 'label') {
          const { id, areaId } = s.selection;
          const snap = sceneRef.current?.reader.getLabelSnapshot(areaId, id);
          if (!snap) return;
          e.preventDefault();
          const step = (e.shiftKey ? 5 : 1) * s.gridStep;
          const nudge = NUDGE[e.key];
          const dx = nudge.dx * step;
          const dy = nudge.dy * step;
          const from: [number, number, number] = [...snap.pos] as [number, number, number];
          const to: [number, number, number] = [snap.pos[0] + dx, snap.pos[1] + dy, snap.pos[2]];
          sceneRef.current?.reader.moveLabel(areaId, id, to[0], -to[1]);
          store.setState((st) => ({ undo: [...st.undo, { kind: 'moveLabel', areaId, id, from, to }], redo: [] }));
          sceneRef.current?.refresh();
          store.bumpData();
          store.setState({ status: `Moved label ${id}` });
          return;
        }

        if (s.selection.kind !== 'room') return;
        e.preventDefault();
        const step = (e.shiftKey ? 5 : 1) * s.gridStep;
        const nudge = NUDGE[e.key];
        const dx = nudge.dx * step;
        const dy = nudge.dy * step;
        const allCmds: Command[] = [];
        for (const selId of s.selection.ids) {
          const room = s.map.rooms[selId];
          if (!room) continue;
          const from = { x: room.x, y: room.y, z: room.z };
          const clCmds = buildCustomLineMoveCommands(s.map, selId, dx, dy);
          sceneRef.current?.reader.moveRoom(selId, room.x + dx, -(room.y + dy), room.z);
          const to = { x: room.x, y: room.y, z: room.z };
          for (const cmd of clCmds) {
            if (cmd.kind === 'setCustomLine') {
              sceneRef.current?.reader.setCustomLine(cmd.roomId, cmd.exitName, cmd.data.points, cmd.data.color, cmd.data.style, cmd.data.arrow);
            }
          }
          allCmds.push({ kind: 'moveRoom', id: selId, from, to }, ...clCmds);
        }
        if (allCmds.length === 0) return;
        const undoCmd: Command = allCmds.length === 1 ? allCmds[0] : { kind: 'batch', cmds: allCmds };
        store.setState((st) => ({ undo: [...st.undo, undoCmd], redo: [] }));
        sceneRef.current?.refresh();
        store.bumpData();
        const { ids } = s.selection;
        store.setState({ status: ids.length === 1 ? `Moved room ${ids[0]} → (${s.map.rooms[ids[0]]?.x}, ${s.map.rooms[ids[0]]?.y}, ${s.map.rooms[ids[0]]?.z})` : `Moved ${ids.length} rooms` });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    const performFit = () => sceneRef.current?.renderer.fitArea(VIEW_INSETS);
    window.addEventListener('editor:undo', performUndo as EventListener);
    window.addEventListener('editor:redo', performRedo as EventListener);
    window.addEventListener('editor:fit', performFit);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('editor:undo', performUndo as EventListener);
      window.removeEventListener('editor:redo', performRedo as EventListener);
      window.removeEventListener('editor:fit', performFit);
    };
  }, []);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.name.endsWith('.dat'));
      if (file) loadFileIntoStore(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
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
        const neighborEditsMap = buildDeleteNeighborEditsForMany(s.map, sel.ids);
        const cmds: Command[] = [];
        for (const id of sel.ids) {
          const room = s.map.rooms[id];
          if (!room) continue;
          cmds.push({
            kind: 'deleteRoom',
            id,
            room: { ...room },
            areaId: room.area,
            neighborEdits: neighborEditsMap.get(id) ?? [],
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

    if (sel.kind === 'label') {
      const snap = sceneRef.current?.reader.getLabelSnapshot(sel.areaId, sel.id);
      if (!snap) return;
      pushCommand({ kind: 'deleteLabel', areaId: sel.areaId, label: snap }, sceneRef.current);
      sceneRef.current?.refresh();
      store.bumpData();
      store.setState({ selection: null, status: `Deleted label ${sel.id}` });
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
        {!mapLoaded && <SessionsPanel />}
        <Toolbar title={title} onHelpClick={() => setShowHelp(true)} onLoadFromUrl={() => setShowUrlLoad(true)} onSave={(bytes) => { for (const p of plugins) p.onMapSave?.(bytes); }} onSearchClick={() => setShowSearch((v) => !v)} />
<SidePanel sceneRef={sceneRef} extraTabs={pluginSidebarTabs} pluginRoomSections={pluginRoomSections} />
      </div>
      <ContextMenu sceneRef={sceneRef} />
      {swatchPaletteOpen && <SwatchPalette sceneRef={sceneRef} />}
      {plugins.map((p, i) => <Fragment key={i}>{p.renderOverlay?.()}</Fragment>)}
      {showSearch && mapLoaded && <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onMouseDown={() => setShowSearch(false)} />
        <SearchPanel onClose={() => setShowSearch(false)} />
      </>}
      <SpreadShrinkPopup sceneRef={sceneRef} />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {(showUrlLoad || autoLoadUrl) && (
        <UrlLoadModal
          initialUrl={autoLoadUrl ?? undefined}
          onClose={() => { setShowUrlLoad(false); setAutoLoadUrl(null); }}
        />
      )}
    </div>
  );
}
