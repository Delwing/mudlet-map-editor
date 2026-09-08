import { store, type EditorState } from './store';

/**
 * Bring a map point into view. When it lives on another area / z-level the view
 * switches there first — App's navigateTo effect pans to the point after the
 * rebuild, keeping the current zoom instead of fitting the whole area. Same
 * area and level is a plain pan (panRequest, which also refreshes the scene).
 *
 * `patch` is merged into the state update, so callers can select the thing they
 * are revealing in the same commit.
 */
export function revealPoint(
  target: { areaId: number; z: number; mapX: number; mapY: number },
  patch: Partial<EditorState> = {},
): void {
  const s = store.getState();
  if (target.areaId !== s.currentAreaId || target.z !== s.currentZ) {
    store.setState({
      ...patch,
      currentAreaId: target.areaId,
      currentZ: target.z,
      navigateTo: { mapX: target.mapX, mapY: target.mapY },
    });
    store.bumpStructure();
  } else {
    store.setState({ ...patch, panRequest: { mapX: target.mapX, mapY: target.mapY } });
  }
}

/**
 * Reveal a room by id, switching area / level when needed. Returns false when
 * the room is gone — callers still applying `patch` (e.g. a selection) should
 * handle that case themselves.
 */
export function revealRoom(roomId: number, patch: Partial<EditorState> = {}): boolean {
  const room = store.getState().map?.rooms[roomId];
  if (!room) return false;
  revealPoint({ areaId: room.area, z: room.z, mapX: room.x, mapY: -room.y }, patch);
  return true;
}
