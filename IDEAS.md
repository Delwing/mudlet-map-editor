# Ideas

Future features under consideration. Not prioritized.

## Pathfinding preview

Given a source and target room, overlay the shortest path using existing exit weights and `locked` flags. Cheap validation that weight data is consistent, and useful for spot-checking large areas.

- Source: selected room; target: Shift+click or a second picker
- Honor `locked` exits (skip), respect weights, step across areas if an area exit exists
- Draw as a highlighted polyline over the existing exits (LiveEffect overlay)

## Expanded warnings panel

`MapPanel` already has a warnings section (zero-size labels, self-linking rooms). Extend with:

- Orphan rooms (no inbound or outbound exits)
- One-way exits (A→B exists but B→A does not)
- Exits pointing to deleted/missing room IDs
- Rooms positioned outside any area, or duplicate coords within an area
- Custom lines with zero or one waypoints

Each warning should be clickable to navigate/select the offender.

## Configurable grid spacing

Grid step is currently hardcoded to 1. Expose as a per-map setting:

- UI in a settings panel or the MapPanel
- Snap, nudge (arrow keys), and paste-offset all read from this value
- Persist in map user data so it travels with the `.dat`

## Ctrl+drag in connect mode creates the target room

In the `connect` tool, if the drag ends on empty space while Ctrl is held, create a new room at the snapped drop point and connect to it in one gesture. Avoids the current two-step (addRoom → connect) flow when extending a map outward.

- Direction inferred from the drag vector (same logic as the existing connect handles)
- Reverse exit added automatically (matches current connect behavior)
- Single undoable batch command

## Turn commands into objects

Current `applyCommand` / `revertCommand` in `src/editor/commands.ts` are large switch statements over a discriminated union. Replace each `kind` with a class (or factory returning `{ apply, revert, structural }`) so the dispatch is polymorphic and each command's forward/inverse logic lives in one place.

- Keeps plain-data serialization for the undo stack (persistable to IndexedDB)
- Makes the batch fast-paths (bulk addRoom / deleteRoom) easier to extend without growing the switch
- Opens the door to per-command metadata: label for HistoryPanel, merge-with-previous hint for drag-nudges

## Configurable renderer visuals

Surface the knobs that `mudlet-map-renderer` already exposes (and add more where it makes sense):

- Room size, border width, exit line width, arrow size
- Font for room names / labels
- Background color, grid color/opacity
- Per-view toggles (show IDs, show weights, show door markers)

Live-apply via `renderer.refresh()`; persist to localStorage as editor-wide defaults.
