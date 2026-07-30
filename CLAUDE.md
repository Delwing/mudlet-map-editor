# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # tsc -b && vite build (type-check then bundle)
npm run preview   # Preview production build
```

No test or lint scripts are configured.

## Architecture

Browser-based map editor for Mudlet `.dat` binary map files. Built with React + TypeScript + Vite + Konva (via `mudlet-map-renderer`).

### Data Flow

```
Binary .dat file
  → mudlet-map-binary-reader → MudletMap (in-memory model)
  → EditorMapReader (adapter, Y-flip)
  → MapRenderer (Konva canvas) + LiveEffect overlays
```

### Core Layers

**State** (`src/editor/store.ts`)  
Single centralized store with `store.setState()` and a `useEditorState()` React hook. Tracks active tool, selection, pending gestures, undo/redo stacks. Two version counters: `structureVersion` (rooms added/removed) and `dataVersion` (any mutation).

**Command System** (`src/editor/commands.ts`)  
All map mutations go through `applyCommand()`. Commands are plain objects pushed to an undo stack. `applyCommand` mutates the `MudletMap`, syncs the renderer via `EditorMapReader`, then calls `renderer.refresh()`.

**Tool System** (`src/editor/tools.ts`, `src/editor/pointerController.ts`)  
9 tools: `select`, `connect`, `unlink`, `addRoom`, `addLabel`, `delete`, `pan`, `customLine`, `paint`. Each implements `onPointerDown/Move/Up/Cancel`. The pointer controller routes events to the active tool; holding Space temporarily switches any tool to pan.

**EditorMapReader** (`src/editor/reader/EditorMapReader.ts`)  
Adapter wrapping `MudletMap`. All getters/setters negate Y so the rest of the editor works in Mudlet convention (+Y = North), while the renderer uses canvas convention (+Y = down). **Never bypass this adapter when touching room coordinates.**

Bulk operation invariant: `EditorArea.addRoomLive` and `removeRoomById` each call `rebuildPlanes`, so N calls = O(N²) cost. For any operation touching multiple rooms, use the bulk variants — `addRoomsLive(rooms[])` and `removeRoomsById(Set<number>)` — which rebuild once per area. The reader exposes `addRooms` and `removeRooms` as bulk equivalents of `addRoom`/`removeRoom`. Batch fast paths in `applyCommand`/`revertCommand` exist for `deleteRoom` batches; to hit them on initial apply, use `pushCommand({ kind: 'batch', cmds })` rather than `pushBatch`, since `pushBatch` applies each sub-command individually before wrapping.

Viewport narrowing: the reader is a `ViewportDataSource` (the renderer duck-types `viewportAware`), so the renderer pushes padded camera bounds through `setViewport` before every build and `EditorPlane.getRooms()` returns only the rooms inside that window — a scene rebuild, which happens on *every pointermove* of a drag, costs O(viewport) instead of O(level). Consequences when writing editor code:

- **`plane.getRooms()` is the viewport; `plane.getAllRooms()` is the level.** Anything reasoning about the whole level (marquee, counts, bounds) must use `getAllRooms`. `EditorArea.getRooms()` is always complete.
- `plane.getBounds()` stays full-level on purpose, so `fitArea` still frames everything.
- Exits are paired per build from the visible rooms (`getLinkExits`), not cached area-wide. Nothing needs to invalidate exits after a room changes z-level or area — the `zIndex` snapshot that used to go stale is recomputed every build. Pairing resolves the far endpoint through an area-scoped lookup, so a link leaving the viewport still renders two-way; cross-*area* links stay one-sided, which is what makes the renderer draw them as area exits.
- Room coordinate changes must reach `EditorArea.roomMoved` (via `reader.moveRoom`) so `PlaneRoomIndex` re-files the room. Mutating `raw.x/y` directly leaves the spatial index stale and the room can vanish from the viewport query.

**LiveEffects** (`src/editor/effects/`)  
8 Konva overlays drawn on top of the renderer: selection halo, hover halo, rubber band (connect preview), snap indicator, connect handles, custom line preview, selected link highlight, grid overlay. Effects read store state and re-draw when `renderer.refresh()` is called.

### Coordinate System

| Space | Convention |
|-------|-----------|
| Client | Screen pixels |
| Map (Mudlet raw) | +Y = North (up) |
| Render (Konva) | +Y = Down |

Use `clientToMap()` (`src/editor/coords.ts`) to convert pointer events to snapped map coordinates. Pass raw (un-negated) Y to `EditorMapReader` — it handles the flip internally.

### Key Files

- `src/editor/types.ts` — all shared types (ToolId, Direction, Command, Selection, Pending…)
- `src/editor/hitTest.ts` — hit detection for rooms, exits, custom line waypoints
- `src/editor/reader/PlaneRoomIndex.ts` — mutable spatial hash backing viewport narrowing (O(1) room move/add/remove)
- `src/editor/mapHelpers.ts` — direction inference, exit lookup utilities
- `src/editor/session.ts` — IndexedDB persistence: save/load/list/clear sessions
- `src/mapIO.ts` — thin wrapper around `mudlet-map-binary-reader` for file load/save
- `src/App.tsx` — keyboard shortcut handlers, top-level layout, auto-save to IndexedDB
- `src/components/SessionsPanel.tsx` — UI for listing/restoring/deleting saved sessions
- `src/components/SwatchPalette.tsx` — draggable palette for symbol+environment presets
- `src/components/UrlLoadModal.tsx` — load a `.dat` file from a remote URL

### External Dependencies

- `mudlet-map-renderer` — Konva-based renderer, not used directly (only via `SceneHandle` in `src/editor/scene.ts`)
- `mudlet-map-binary-reader` — parse/serialize Mudlet `.dat` binary format
- `vite-plugin-node-polyfills` — required because binary reader uses Node APIs (Buffer, stream, etc.) not available in browsers
