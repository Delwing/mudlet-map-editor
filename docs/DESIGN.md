# Mudlet Map Editor — Interaction & Tools Design

Browser-side editor for Mudlet `.dat` map files, built on `mudlet-map-renderer` (Konva backend). The editor is primarily mouse-driven; keyboard input is reserved for accelerators (tool switch, undo, delete, cancel).

## 1. Goals & non-goals

**Goals**
- Single-page Vite + React + TS app.
- Load `.dat` → edit interactively → download `.dat`.
- Mouse-first tool palette: move, connect, unlink, add/remove room, add label.
- Live visual feedback through the renderer's overlay system so the editor looks consistent with the rendered map and so edits preview in real time.
- Non-destructive: all edits are applied to the in-memory `MudletMap`; saving re-serializes that model.

**Non-goals (for now)**
- Multi-floor / 3D editing.
- Advanced selection (marquee, lasso, same-attribute select).
- Label editing UI beyond position + text.
- Collaboration / network sync.

## 2. Tool model

One active tool at a time. The tool owns pointer interpretation on the map viewport.

```
┌───────── Toolbar ─────────┐
│ [Select] [Move] [Connect] │
│ [Unlink] [Add Room] [Del] │
│ [Pan]  ·  Undo  Redo      │
└───────────────────────────┘
```

State shape (React):

```ts
type ToolId = 'select' | 'move' | 'connect' | 'unlink' | 'addRoom' | 'delete' | 'pan';

interface EditorState {
  activeTool: ToolId;
  selection: { kind: 'room' | 'label' | 'exit'; id: number } | null;
  hover:     { kind: 'room' | 'label' | 'exit'; id: number } | null;
  pending:   ConnectPending | DragPending | null;   // tool-specific transient state
  snapToGrid: boolean;  // default true
  gridStep: number;     // 1 unit
}
```

Tool switching: click toolbar button or keyboard (`1`–`7`). `Esc` always cancels `pending` and returns focus to `select`.

## 3. Tool catalogue

| Tool      | Primary gesture | Secondary | Purpose |
|-----------|-----------------|-----------|---------|
| Select    | left-click room | `Esc` to clear | Show properties in side panel, pre-requisite for keyboard nudge. |
| Move      | left-drag room  | arrow keys | Reposition one room by integer grid units. Snaps to grid. |
| Connect   | click source → click target (or drag) | `Esc` cancels | Create a bidirectional exit between two rooms. |
| Unlink    | click an exit line | — | Remove exit (prompts: one direction / both). |
| Add Room  | click empty grid cell | — | Creates a new room at cursor coord with next free ID. |
| Delete    | click room / label | `Del` on selection | Remove from area; confirm if it has connected exits. |
| Pan       | left-drag background | middle-drag is always pan | Explicit pan mode; by default middle-mouse + right-mouse pan anywhere. |

All tools except Pan still allow:
- **Middle-mouse drag** → pan
- **Right-mouse drag** → pan
- **Scroll wheel** → zoom at cursor

This is the renderer's default, which we don't override.

## 4. Mouse interaction model

### 4.1 Pointer-event plumbing

The renderer emits only coarse events (`roomclick`, `roomcontextmenu`, `areaexitclick`, `mapclick`, `pan`, `zoom`). That's not enough for drag, rubber-band, or hover.

We add a transparent `<div class="tool-surface" />` absolutely positioned on top of `.map-container`, sized to match. Pointer events hit this div first; the editor decides whether to:

- **Consume** the event (e.g. during an active drag) and not let it reach the renderer.
- **Forward** it by setting `pointer-events: none` while the surface is idle so the renderer keeps full control (zoom, pan, native `roomclick`).

A simpler equivalent: keep the tool surface always `pointer-events: none`, and instead attach our `pointerdown/move/up` listeners to the container itself **in the capture phase**, short-circuiting as needed. Both are reasonable; we'll start with the capture-phase approach because it avoids duplicating hit testing.

### 4.2 Client ↔ map coordinate conversion

The renderer exposes `renderer.getViewportBounds(): {minX,maxX,minY,maxY}` and the container has a DOM rect. We derive:

```ts
function clientToMap(clientX: number, clientY: number) {
  const rect = container.getBoundingClientRect();
  const v = renderer.getViewportBounds();
  return {
    x: v.minX + ((clientX - rect.left) / rect.width)  * (v.maxX - v.minX),
    y: v.minY + ((clientY - rect.top)  / rect.height) * (v.maxY - v.minY),
  };
}
```

This is recomputed every pointer event (cheap). Y orientation follows the viewport bounds, which already encode the renderer's convention.

Snap: `snap = (p, step) => Math.round(p / step) * step`.

The editor stays on the default flat rendering — no Parchment / Sketchy / Isometric / Neon styles. That keeps the client↔map transform linear and lets the two-corner interpolation above stand as the authoritative coordinate converter.

### 4.3 Hit testing

- Rooms & labels: already handled by the renderer, exposed via `roomclick` / `roomcontextmenu` / `areaexitclick`.
- Exits (for the Unlink tool): no dedicated event — we'll need our own hit-test. Each exit is a straight line between two rooms' centers; hit-test is "distance from pointer to line segment < threshold". We iterate the rooms of the current area/plane and test each outgoing exit. Cheap for the scales Mudlet maps operate at (hundreds of rooms per area).
- Empty cell (for Add Room): snap pointer to grid, confirm no room exists at that (x, y, z).

### 4.4 Per-tool gesture details

**Select tool** — `pointerdown` over a room ⇒ `setSelection({kind:'room', id})`; over background ⇒ `clearSelection`.

**Move tool** — `pointerdown` over a room starts a drag. During `pointermove`:
1. Compute `cursorMap = clientToMap(e.clientX, e.clientY)`.
2. Compute `snapped = snap(cursorMap, gridStep)`.
3. If `snapped ≠ current`, mutate in place: `map.rooms[id].x = snapped.x; map.rooms[id].y = snapped.y` and call `renderer.refresh()`. The real room moves live under the cursor — no ghost.

On `pointerup`:
1. If final position ≠ original, push one `moveRoom` command onto the undo stack (origin → final, not the per-pixel intermediates).
2. Otherwise, no-op.

**Connect tool** — two-click model (and also drag-to-target, which is a shortcut for the same thing):
1. First click on a room ⇒ `pending = { kind:'connect', sourceId }`. A rubber-band line overlay follows the cursor (see §5).
2. Hover another room ⇒ the renderer's own `roomclick`-target is our hit test; the rubber-band snaps to the target room's center and shows which cardinal direction the exit will use.
3. Second click ⇒ `createExit(sourceId, targetId)`. Exit direction is the closest cardinal (or diagonal) based on the two rooms' positions. If `Shift` is held, only create one-way. Default is bidirectional (adds the reverse exit if the opposite slot is free).
4. `Esc` or click background ⇒ cancel.

**Unlink tool** — `pointerdown` near an exit segment (our custom hit-test). Popover near cursor: "Remove this direction / Remove both / Cancel". Apply on confirm.

**Add Room tool** — `pointerdown` on empty snapped cell:
1. Next free room ID = `max(Object.keys(map.rooms)) + 1`.
2. New room template: copy default fields from a neighbour if one exists, else use a zeroed default (`environment: -1`, all exits `-1`, `weight: 1`, `name: ""`).
3. Mutate `map.rooms[newId]` and `map.areas[currentAreaId].rooms.push(newId)`.
4. Select the new room.

**Delete tool** — click a room:
1. If the room has exits, confirm. Then for every neighbour that has an exit pointing at this room, null its exit (`-1`).
2. Remove from `map.rooms` and from the owning area's `rooms` array.
3. Clear selection if it was this room.

## 5. Overlay rendering plan

We use **both** overlay surfaces exposed by the renderer:

### 5.1 `SceneOverlay` (static, exports too)

Used for edits that the user may want to persist visually into exported PNG/SVG while authoring:
- Not applicable yet. Export-time overlays are a future concern.

### 5.2 `LiveEffect` (interactive only, Konva layer)

Editor UI that only exists during interaction:

| Overlay        | Shows when                          | Visuals |
|----------------|-------------------------------------|---------|
| `selectionHalo`| selection != null                   | Dashed outline around the selected room/label. Colour: cyan. Tracks the room in real time so it follows during drag. |
| `hoverHalo`    | hover != null && tool can act on it | Soft stroke + pointer cursor feedback. |
| `rubberBand`   | Connect tool with `pending.sourceId`| Dashed line from source centre to snapped target (room centre or cursor). Arrow head on target. Colour depends on hover-target validity: green valid / red invalid. |
| `snapIndicator`| Add Room / Connect (hovering empty) | Small cross at snapped grid coord. |
| `cursorDir`    | Connect hovering target             | Label next to target room saying "north/se/up…" showing resolved exit direction. |

Effects are attached once on renderer mount. Each effect creates its shapes on `attach(layer)` with `listening: false` already the `LiveEffect` default, so they never intercept pointer events.

Each `LiveEffect` receives the Konva layer on attach + viewport updates. They read editor state from a subscription (zustand / a small event bus) and call `layer.batchDraw()` on change.

Sketch (`SelectionHaloEffect`):

```ts
class SelectionHaloEffect implements LiveEffect {
  private ring?: Konva.Rect;
  constructor(private store: EditorStore) {}
  attach(layer: Konva.Layer) {
    this.ring = new Konva.Rect({ stroke: '#00e5ff', strokeWidth: 2, dash: [0.1, 0.1], listening: false });
    layer.add(this.ring);
    this.store.subscribe(() => this.sync(layer));
  }
  updateViewport(_bounds, scale) { this.ring?.strokeWidth(2 / scale); }
  sync(layer: Konva.Layer) { /* read selection, set ring.x/y/width/height */ layer.batchDraw(); }
  destroy() { this.ring?.destroy(); }
}
```

We add them once per renderer instance in the mount effect, and keep them for the renderer's lifetime.

## 6. Commit & redraw strategy

Mutations happen directly on the in-memory `MudletMap` (and therefore on the `MapReader`'s underlying data, which is the same object graph via `buildRendererInput`). `renderer.refresh()` is sufficient to pick up coordinate and exit changes — no `MapReader` rebuild, no `drawArea` replay, no renderer tear-down.

Loop:

1. Mutate `map.rooms[id].x/y` (or whichever field changed).
2. `renderer.refresh()`.
3. LiveEffects read the same state and re-draw their layer.

This keeps drag and other continuous gestures smooth because there's no React re-mount in the hot path. Only loading a new file, switching area, or switching z-level rebuilds the renderer.

## 7. Undo / redo

Command objects, not snapshots:

```ts
type Command =
  | { kind: 'moveRoom'; id: number; from: XY; to: XY }
  | { kind: 'addRoom'; id: number; room: RoomSnapshot; areaId: number }
  | { kind: 'deleteRoom'; id: number; room: RoomSnapshot; areaId: number; affectedExits: ExitRef[] }
  | { kind: 'addExit'; fromId: number; toId: number; dir: Direction; bidirectional: boolean }
  | { kind: 'removeExit'; fromId: number; toId: number; dir: Direction; was: ExitRecord };
```

Stack in the store. `Ctrl+Z` pops and applies the inverse; `Ctrl+Shift+Z` / `Ctrl+Y` re-pushes. Tool gestures that don't mutate (hover, preview) never produce commands.

## 8. Keyboard accelerators

Input is mouse-first; keys are only accelerators.

| Key             | Effect |
|-----------------|--------|
| `1`..`7`        | Switch active tool. |
| `Esc`           | Cancel pending gesture; otherwise clear selection. |
| `Del` / `Backspace` | Delete current selection. |
| `Ctrl/Cmd+Z`    | Undo. |
| `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` | Redo. |
| Arrow keys      | When Move tool is active and a room is selected: nudge by 1 grid step. `Shift` = ×5. |
| `G`             | Toggle snap-to-grid. |
| `F`             | Fit area to viewport (`renderer.fitArea()`). |

## 9. Save / load

Unchanged from the current implementation:
- Load: `File` → `readMapFromBuffer(arrayBuffer) → MudletMap`.
- Save: `writeMapToBuffer(map) → Uint8Array` → `Blob` download.

All editing mutates the same in-memory `MudletMap`, so save always reflects the current scene.

## 10. Renderer API assumptions

- **Partial invalidation.** `renderer.refresh()` picks up mutated room coords / exits from the same `MapReader` data object. No rebuild needed.
- **Overlay pointer events.** `LiveEffect` layer defaults to `listening: false`; overlays do not block the renderer's input pipeline.
- **No style switching.** Editor runs on default flat rendering only, so client↔map is a linear interpolation of `getViewportBounds` + container rect.
- **Hit-testing lives in the editor.** The renderer emits `roomclick` / `roomcontextmenu` / `areaexitclick` for click gestures. For hover-driven tooling (exit hover highlight, Unlink tool) the editor implements its own exit hit-test over the current area's geometry.

## 11. Milestones

1. **M1 — Interaction skeleton**: tool palette, Select + Move with live drag via `renderer.refresh()`, selection halo `LiveEffect`.
2. **M2 — Connect tool** with rubber-band `LiveEffect` and direction inference.
3. **M3 — Add Room / Delete / Unlink** tools.
4. **M4 — Undo / redo stack.**
5. **M5 — Label & properties editing** (side panel): rename room, change environment colour, edit user data.
