import type { MudletMap } from '../mapIO';
import { store } from './store';
import { findNeighborsPointingAt, getExit } from './mapHelpers';
import type { Command, NeighborEdit } from './types';
import { DIR_SHORT, DIR_INDEX } from './types';
import type { SceneHandle } from './scene';

/**
 * Apply a command. When a `scene` is provided, mutations go through
 * `scene.reader` so the renderer stays in sync automatically. When it is
 * omitted (tests, etc.) we mutate the raw map directly — the caller is
 * responsible for triggering a rebuild.
 */
export function applyCommand(map: MudletMap, cmd: Command, scene?: SceneHandle | null): { structural: boolean } {
  const reader = scene?.reader;
  switch (cmd.kind) {
    case 'moveRoom': {
      if (reader) {
        // Raw coords → render coords (flip Y).
        reader.moveRoom(cmd.id, cmd.to.x, -cmd.to.y, cmd.to.z);
      } else {
        const room = map.rooms[cmd.id];
        if (room) { room.x = cmd.to.x; room.y = cmd.to.y; room.z = cmd.to.z; }
      }
      return { structural: false };
    }
    case 'addRoom': {
      map.rooms[cmd.id] = { ...cmd.room };
      const area = map.areas[cmd.areaId];
      if (area && !area.rooms.includes(cmd.id)) area.rooms.push(cmd.id);
      if (reader) reader.addRoom(cmd.id, map.rooms[cmd.id]);
      return { structural: true };
    }
    case 'deleteRoom': {
      for (const edit of cmd.neighborEdits) {
        const neighbor = map.rooms[edit.roomId];
        if (neighbor) (neighbor as any)[edit.dir] = -1;
      }
      if (reader) {
        reader.removeRoom(cmd.id);
      } else {
        delete map.rooms[cmd.id];
        const area = map.areas[cmd.areaId];
        if (area) {
          const idx = area.rooms.indexOf(cmd.id);
          if (idx !== -1) area.rooms.splice(idx, 1);
        }
      }
      return { structural: true };
    }
    case 'addExit': {
      if (reader) {
        reader.setExit(cmd.fromId, cmd.dir, cmd.toId);
        if (cmd.reverse) reader.setExit(cmd.reverse.fromId, cmd.reverse.dir, cmd.fromId);
      } else {
        const from = map.rooms[cmd.fromId];
        if (from) (from as any)[cmd.dir] = cmd.toId;
        if (cmd.reverse) {
          const rev = map.rooms[cmd.reverse.fromId];
          if (rev) (rev as any)[cmd.reverse.dir] = cmd.fromId;
        }
      }
      return { structural: false };
    }
    case 'removeExit': {
      if (reader) {
        reader.setExit(cmd.fromId, cmd.dir, -1);
        if (cmd.reverse) reader.setExit(cmd.reverse.fromId, cmd.reverse.dir, -1);
      } else {
        const from = map.rooms[cmd.fromId];
        if (from) (from as any)[cmd.dir] = -1;
        if (cmd.reverse) {
          const rev = map.rooms[cmd.reverse.fromId];
          if (rev) (rev as any)[cmd.reverse.dir] = -1;
        }
      }
      return { structural: false };
    }
    case 'setRoomField': {
      if (reader) {
        reader.setRoomField(cmd.id, cmd.field, cmd.to);
      } else {
        const room = map.rooms[cmd.id];
        if (room) (room as any)[cmd.field] = cmd.to;
      }
      return { structural: false };
    }
    case 'addArea': {
      if (reader) reader.addArea(cmd.id, cmd.name);
      else { map.areas[cmd.id] = { rooms: [], zLevels: [0], mAreaExits: {}, gridMode: false, max_x: 0, max_y: 0, max_z: 0, min_x: 0, min_y: 0, min_z: 0, span: [0,0,0], xmaxForZ: {}, ymaxForZ: {}, xminForZ: {}, yminForZ: {}, pos: [0,0,0], isZone: false, zoneAreaRef: -1, userData: {} }; map.areaNames[cmd.id] = cmd.name; }
      return { structural: true };
    }
    case 'deleteArea': {
      if (reader) reader.removeArea(cmd.id);
      else { delete map.areas[cmd.id]; delete map.areaNames[cmd.id]; }
      return { structural: true };
    }
    case 'deleteAreaWithRooms': {
      for (const edit of cmd.crossAreaNeighborEdits) {
        const n = map.rooms[edit.roomId];
        if (n) (n as any)[edit.dir] = -1;
      }
      for (const { id } of cmd.rooms) delete map.rooms[id];
      delete map.areas[cmd.areaId];
      delete map.areaNames[cmd.areaId];
      if (reader) {
        reader.removeAreaWithRooms(
          cmd.areaId,
          cmd.rooms.map(r => r.id),
          cmd.affectedOtherAreaIds,
        );
      }
      return { structural: true };
    }
    case 'renameArea': {
      if (reader) reader.renameArea(cmd.id, cmd.to);
      else map.areaNames[cmd.id] = cmd.to;
      return { structural: true };
    }
    case 'setCustomEnvColor': {
      if (reader) reader.setCustomEnvColor(cmd.envId, cmd.to);
      else {
        if (cmd.to === null) delete map.mCustomEnvColors[cmd.envId];
        else map.mCustomEnvColors[cmd.envId] = cmd.to;
      }
      return { structural: false };
    }
    case 'addSpecialExit': {
      if (reader) reader.setSpecialExit(cmd.roomId, cmd.name, cmd.toId);
      else { const r = map.rooms[cmd.roomId]; if (r) r.mSpecialExits[cmd.name] = cmd.toId; }
      return { structural: false };
    }
    case 'removeSpecialExit': {
      if (reader) reader.removeSpecialExit(cmd.roomId, cmd.name);
      else { const r = map.rooms[cmd.roomId]; if (r) delete r.mSpecialExits[cmd.name]; }
      return { structural: false };
    }
    case 'setCustomLine': {
      if (reader) reader.setCustomLine(cmd.roomId, cmd.exitName, cmd.data.points, cmd.data.color, cmd.data.style, cmd.data.arrow);
      else {
        const r = map.rooms[cmd.roomId];
        if (r) { r.customLines[cmd.exitName] = cmd.data.points; r.customLinesColor[cmd.exitName] = cmd.data.color; r.customLinesStyle[cmd.exitName] = cmd.data.style; r.customLinesArrow[cmd.exitName] = cmd.data.arrow; }
      }
      if (cmd.companion) {
        const c = cmd.companion;
        if (reader) reader.setCustomLine(c.roomId, c.exitName, c.data.points, c.data.color, c.data.style, c.data.arrow);
        else {
          const r = map.rooms[c.roomId];
          if (r) { r.customLines[c.exitName] = c.data.points; r.customLinesColor[c.exitName] = c.data.color; r.customLinesStyle[c.exitName] = c.data.style; r.customLinesArrow[c.exitName] = c.data.arrow; }
        }
      }
      return { structural: false };
    }
    case 'removeCustomLine': {
      if (reader) reader.removeCustomLine(cmd.roomId, cmd.exitName);
      else {
        const r = map.rooms[cmd.roomId];
        if (r) { delete r.customLines[cmd.exitName]; delete r.customLinesColor[cmd.exitName]; delete r.customLinesStyle[cmd.exitName]; delete r.customLinesArrow[cmd.exitName]; }
      }
      return { structural: false };
    }
    case 'removeAllExits': {
      for (const e of cmd.exits) {
        if (reader) {
          reader.setExit(cmd.roomId, e.dir, -1);
          if (e.reverse) reader.setExit(e.reverse.fromId, e.reverse.dir, -1);
        } else {
          const r = map.rooms[cmd.roomId]; if (r) (r as any)[e.dir] = -1;
          if (e.reverse) { const rv = map.rooms[e.reverse.fromId]; if (rv) (rv as any)[e.reverse.dir] = -1; }
        }
      }
      for (const se of cmd.specialExits) {
        if (reader) reader.removeSpecialExit(cmd.roomId, se.name);
        else { const r = map.rooms[cmd.roomId]; if (r) delete r.mSpecialExits[se.name]; }
      }
      return { structural: false };
    }
    case 'moveRoomsToArea': {
      if (reader) reader.moveRoomsToArea(cmd.roomIds, cmd.fromAreaId, cmd.toAreaId);
      else {
        for (const id of cmd.roomIds) {
          const r = map.rooms[id]; if (!r) continue;
          r.area = cmd.toAreaId;
          const fa = map.areas[cmd.fromAreaId]; if (fa) { const i = fa.rooms.indexOf(id); if (i !== -1) fa.rooms.splice(i, 1); }
          const ta = map.areas[cmd.toAreaId]; if (ta && !ta.rooms.includes(id)) ta.rooms.push(id);
        }
      }
      return { structural: true };
    }
    case 'setRoomLock': {
      if (reader) reader.setRoomLock(cmd.id, cmd.lock);
      else { const r = map.rooms[cmd.id]; if (r) r.isLocked = cmd.lock; }
      return { structural: false };
    }
    case 'setDoor': {
      const key = DIR_SHORT[cmd.dir];
      if (reader) reader.setDoor(cmd.roomId, cmd.dir, cmd.to);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.to === 0) delete r.doors[key]; else r.doors[key] = cmd.to; } }
      return { structural: false };
    }
    case 'setExitWeight': {
      const key = DIR_SHORT[cmd.dir];
      if (reader) reader.setExitWeight(cmd.roomId, cmd.dir, cmd.to);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.to <= 1) delete r.exitWeights[key]; else r.exitWeights[key] = cmd.to; } }
      return { structural: false };
    }
    case 'setExitLock': {
      const idx = DIR_INDEX[cmd.dir];
      if (reader) reader.setExitLock(cmd.roomId, cmd.dir, cmd.lock);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.lock) { if (!r.exitLocks.includes(idx)) r.exitLocks.push(idx); } else { const i = r.exitLocks.indexOf(idx); if (i !== -1) r.exitLocks.splice(i, 1); } } }
      return { structural: false };
    }
    case 'setStub': {
      const idx = DIR_INDEX[cmd.dir];
      if (reader) reader.setStub(cmd.roomId, cmd.dir, cmd.stub);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.stub) { if (!r.stubs.includes(idx)) r.stubs.push(idx); } else { const i = r.stubs.indexOf(idx); if (i !== -1) r.stubs.splice(i, 1); } } }
      return { structural: true };
    }
    case 'setUserDataEntry': {
      if (reader) reader.setUserDataEntry(cmd.roomId, cmd.key, cmd.to);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (!r.userData) r.userData = {}; if (cmd.to === null) delete r.userData[cmd.key]; else r.userData[cmd.key] = cmd.to; } }
      return { structural: false };
    }
    case 'setAreaUserDataEntry': {
      const area = map.areas[cmd.areaId];
      if (area) { if (!area.userData) area.userData = {}; if (cmd.to === null) delete area.userData[cmd.key]; else area.userData[cmd.key] = cmd.to; }
      return { structural: false };
    }
    case 'setMapUserDataEntry': {
      if (!map.mUserData) map.mUserData = {};
      if (cmd.to === null) delete map.mUserData[cmd.key]; else map.mUserData[cmd.key] = cmd.to;
      return { structural: false };
    }
    case 'setSpecialExitDoor': {
      if (reader) reader.setSpecialExitDoor(cmd.roomId, cmd.name, cmd.to);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.to === 0) delete r.doors[cmd.name]; else r.doors[cmd.name] = cmd.to; } }
      return { structural: false };
    }
    case 'setSpecialExitWeight': {
      if (reader) reader.setSpecialExitWeight(cmd.roomId, cmd.name, cmd.to);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.to <= 1) delete r.exitWeights[cmd.name]; else r.exitWeights[cmd.name] = cmd.to; } }
      return { structural: false };
    }
    case 'batch': {
      let structural = false;
      for (const c of cmd.cmds) { if (applyCommand(map, c, scene).structural) structural = true; }
      return { structural };
    }
  }
}

export function revertCommand(map: MudletMap, cmd: Command, scene?: SceneHandle | null): { structural: boolean } {
  const reader = scene?.reader;
  switch (cmd.kind) {
    case 'moveRoom': {
      if (reader) reader.moveRoom(cmd.id, cmd.from.x, -cmd.from.y, cmd.from.z);
      else {
        const room = map.rooms[cmd.id];
        if (room) { room.x = cmd.from.x; room.y = cmd.from.y; room.z = cmd.from.z; }
      }
      return { structural: false };
    }
    case 'addRoom': {
      if (reader) reader.removeRoom(cmd.id);
      else {
        delete map.rooms[cmd.id];
        const area = map.areas[cmd.areaId];
        if (area) {
          const idx = area.rooms.indexOf(cmd.id);
          if (idx !== -1) area.rooms.splice(idx, 1);
        }
      }
      return { structural: true };
    }
    case 'deleteRoom': {
      map.rooms[cmd.id] = { ...cmd.room };
      const area = map.areas[cmd.areaId];
      if (area && !area.rooms.includes(cmd.id)) area.rooms.push(cmd.id);
      if (reader) reader.addRoom(cmd.id, map.rooms[cmd.id]);
      for (const edit of cmd.neighborEdits) {
        const neighbor = map.rooms[edit.roomId];
        if (neighbor) {
          (neighbor as any)[edit.dir] = edit.was;
          // Rebuild the neighbor's area exits since we re-added an outgoing exit.
          if (reader) reader.setExit(edit.roomId, edit.dir, edit.was);
        }
      }
      return { structural: true };
    }
    case 'addExit': {
      if (reader) {
        reader.setExit(cmd.fromId, cmd.dir, cmd.previous);
        if (cmd.reverse) reader.setExit(cmd.reverse.fromId, cmd.reverse.dir, cmd.reverse.previous);
      } else {
        const from = map.rooms[cmd.fromId];
        if (from) (from as any)[cmd.dir] = cmd.previous;
        if (cmd.reverse) {
          const rev = map.rooms[cmd.reverse.fromId];
          if (rev) (rev as any)[cmd.reverse.dir] = cmd.reverse.previous;
        }
      }
      return { structural: false };
    }
    case 'removeExit': {
      if (reader) {
        reader.setExit(cmd.fromId, cmd.dir, cmd.was);
        if (cmd.reverse) reader.setExit(cmd.reverse.fromId, cmd.reverse.dir, cmd.reverse.was);
      } else {
        const from = map.rooms[cmd.fromId];
        if (from) (from as any)[cmd.dir] = cmd.was;
        if (cmd.reverse) {
          const rev = map.rooms[cmd.reverse.fromId];
          if (rev) (rev as any)[cmd.reverse.dir] = cmd.reverse.was;
        }
      }
      return { structural: false };
    }
    case 'setRoomField': {
      if (reader) reader.setRoomField(cmd.id, cmd.field, cmd.from);
      else {
        const room = map.rooms[cmd.id];
        if (room) (room as any)[cmd.field] = cmd.from;
      }
      return { structural: false };
    }
    case 'addArea': {
      if (reader) reader.removeArea(cmd.id);
      else { delete map.areas[cmd.id]; delete map.areaNames[cmd.id]; }
      return { structural: true };
    }
    case 'deleteArea': {
      if (reader) reader.addArea(cmd.id, cmd.name);
      else { map.areas[cmd.id] = { rooms: [], zLevels: [0], mAreaExits: {}, gridMode: false, max_x: 0, max_y: 0, max_z: 0, min_x: 0, min_y: 0, min_z: 0, span: [0,0,0], xmaxForZ: {}, ymaxForZ: {}, xminForZ: {}, yminForZ: {}, pos: [0,0,0], isZone: false, zoneAreaRef: -1, userData: {} }; map.areaNames[cmd.id] = cmd.name; }
      return { structural: true };
    }
    case 'deleteAreaWithRooms': {
      map.areas[cmd.areaId] = cmd.areaSnapshot;
      map.areaNames[cmd.areaId] = cmd.areaName;
      const restored: Array<{ id: number; room: any }> = [];
      for (const { id, room } of cmd.rooms) {
        const copy = { ...room };
        map.rooms[id] = copy;
        restored.push({ id, room: copy });
      }
      for (const edit of cmd.crossAreaNeighborEdits) {
        const n = map.rooms[edit.roomId];
        if (n) (n as any)[edit.dir] = edit.was;
      }
      if (reader) {
        reader.restoreAreaWithRooms(cmd.areaId, cmd.areaName, restored, cmd.affectedOtherAreaIds);
      }
      return { structural: true };
    }
    case 'renameArea': {
      if (reader) reader.renameArea(cmd.id, cmd.from);
      else map.areaNames[cmd.id] = cmd.from;
      return { structural: true };
    }
    case 'setCustomEnvColor': {
      if (reader) reader.setCustomEnvColor(cmd.envId, cmd.from);
      else {
        if (cmd.from === null) delete map.mCustomEnvColors[cmd.envId];
        else map.mCustomEnvColors[cmd.envId] = cmd.from;
      }
      return { structural: false };
    }
    case 'addSpecialExit': {
      if (reader) reader.removeSpecialExit(cmd.roomId, cmd.name);
      else { const r = map.rooms[cmd.roomId]; if (r) delete r.mSpecialExits[cmd.name]; }
      return { structural: false };
    }
    case 'removeSpecialExit': {
      if (reader) reader.setSpecialExit(cmd.roomId, cmd.name, cmd.toId);
      else { const r = map.rooms[cmd.roomId]; if (r) r.mSpecialExits[cmd.name] = cmd.toId; }
      return { structural: false };
    }
    case 'setCustomLine': {
      if (cmd.previous) {
        if (reader) reader.setCustomLine(cmd.roomId, cmd.exitName, cmd.previous.points, cmd.previous.color, cmd.previous.style, cmd.previous.arrow);
        else { const r = map.rooms[cmd.roomId]; if (r) { r.customLines[cmd.exitName] = cmd.previous.points; r.customLinesColor[cmd.exitName] = cmd.previous.color; r.customLinesStyle[cmd.exitName] = cmd.previous.style; r.customLinesArrow[cmd.exitName] = cmd.previous.arrow; } }
      } else {
        if (reader) reader.removeCustomLine(cmd.roomId, cmd.exitName);
        else { const r = map.rooms[cmd.roomId]; if (r) { delete r.customLines[cmd.exitName]; delete r.customLinesColor[cmd.exitName]; delete r.customLinesStyle[cmd.exitName]; delete r.customLinesArrow[cmd.exitName]; } }
      }
      if (cmd.companion) {
        const c = cmd.companion;
        if (c.previous) {
          if (reader) reader.setCustomLine(c.roomId, c.exitName, c.previous.points, c.previous.color, c.previous.style, c.previous.arrow);
          else { const r = map.rooms[c.roomId]; if (r) { r.customLines[c.exitName] = c.previous.points; r.customLinesColor[c.exitName] = c.previous.color; r.customLinesStyle[c.exitName] = c.previous.style; r.customLinesArrow[c.exitName] = c.previous.arrow; } }
        } else {
          if (reader) reader.removeCustomLine(c.roomId, c.exitName);
          else { const r = map.rooms[c.roomId]; if (r) { delete r.customLines[c.exitName]; delete r.customLinesColor[c.exitName]; delete r.customLinesStyle[c.exitName]; delete r.customLinesArrow[c.exitName]; } }
        }
      }
      return { structural: false };
    }
    case 'removeCustomLine': {
      if (reader) reader.setCustomLine(cmd.roomId, cmd.exitName, cmd.snapshot.points, cmd.snapshot.color, cmd.snapshot.style, cmd.snapshot.arrow);
      else { const r = map.rooms[cmd.roomId]; if (r) { r.customLines[cmd.exitName] = cmd.snapshot.points; r.customLinesColor[cmd.exitName] = cmd.snapshot.color; r.customLinesStyle[cmd.exitName] = cmd.snapshot.style; r.customLinesArrow[cmd.exitName] = cmd.snapshot.arrow; } }
      return { structural: false };
    }
    case 'removeAllExits': {
      for (const e of cmd.exits) {
        if (reader) {
          reader.setExit(cmd.roomId, e.dir, e.was);
          if (e.reverse) reader.setExit(e.reverse.fromId, e.reverse.dir, cmd.roomId);
        } else {
          const r = map.rooms[cmd.roomId]; if (r) (r as any)[e.dir] = e.was;
          if (e.reverse) { const rv = map.rooms[e.reverse.fromId]; if (rv) (rv as any)[e.reverse.dir] = cmd.roomId; }
        }
      }
      for (const se of cmd.specialExits) {
        if (reader) reader.setSpecialExit(cmd.roomId, se.name, se.toId);
        else { const r = map.rooms[cmd.roomId]; if (r) r.mSpecialExits[se.name] = se.toId; }
      }
      return { structural: false };
    }
    case 'moveRoomsToArea': {
      // Revert: move back from toAreaId → fromAreaId
      if (reader) reader.moveRoomsToArea(cmd.roomIds, cmd.toAreaId, cmd.fromAreaId);
      else {
        for (const id of cmd.roomIds) {
          const r = map.rooms[id]; if (!r) continue;
          r.area = cmd.fromAreaId;
          const ta = map.areas[cmd.toAreaId]; if (ta) { const i = ta.rooms.indexOf(id); if (i !== -1) ta.rooms.splice(i, 1); }
          const fa = map.areas[cmd.fromAreaId]; if (fa && !fa.rooms.includes(id)) fa.rooms.push(id);
        }
      }
      return { structural: true };
    }
    case 'setRoomLock': {
      if (reader) reader.setRoomLock(cmd.id, !cmd.lock);
      else { const r = map.rooms[cmd.id]; if (r) r.isLocked = !cmd.lock; }
      return { structural: false };
    }
    case 'setDoor': {
      const key = DIR_SHORT[cmd.dir];
      if (reader) reader.setDoor(cmd.roomId, cmd.dir, cmd.from);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.from === 0) delete r.doors[key]; else r.doors[key] = cmd.from; } }
      return { structural: false };
    }
    case 'setExitWeight': {
      const key = DIR_SHORT[cmd.dir];
      if (reader) reader.setExitWeight(cmd.roomId, cmd.dir, cmd.from);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.from <= 1) delete r.exitWeights[key]; else r.exitWeights[key] = cmd.from; } }
      return { structural: false };
    }
    case 'setExitLock': {
      const idx = DIR_INDEX[cmd.dir];
      if (reader) reader.setExitLock(cmd.roomId, cmd.dir, !cmd.lock);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (!cmd.lock) { if (!r.exitLocks.includes(idx)) r.exitLocks.push(idx); } else { const i = r.exitLocks.indexOf(idx); if (i !== -1) r.exitLocks.splice(i, 1); } } }
      return { structural: false };
    }
    case 'setStub': {
      const idx = DIR_INDEX[cmd.dir];
      if (reader) reader.setStub(cmd.roomId, cmd.dir, !cmd.stub);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (!cmd.stub) { if (!r.stubs.includes(idx)) r.stubs.push(idx); } else { const i = r.stubs.indexOf(idx); if (i !== -1) r.stubs.splice(i, 1); } } }
      return { structural: true };
    }
    case 'setUserDataEntry': {
      if (reader) reader.setUserDataEntry(cmd.roomId, cmd.key, cmd.from);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (!r.userData) r.userData = {}; if (cmd.from === null) delete r.userData[cmd.key]; else r.userData[cmd.key] = cmd.from; } }
      return { structural: false };
    }
    case 'setAreaUserDataEntry': {
      const area = map.areas[cmd.areaId];
      if (area) { if (!area.userData) area.userData = {}; if (cmd.from === null) delete area.userData[cmd.key]; else area.userData[cmd.key] = cmd.from; }
      return { structural: false };
    }
    case 'setMapUserDataEntry': {
      if (!map.mUserData) map.mUserData = {};
      if (cmd.from === null) delete map.mUserData[cmd.key]; else map.mUserData[cmd.key] = cmd.from;
      return { structural: false };
    }
    case 'setSpecialExitDoor': {
      if (reader) reader.setSpecialExitDoor(cmd.roomId, cmd.name, cmd.from);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.from === 0) delete r.doors[cmd.name]; else r.doors[cmd.name] = cmd.from; } }
      return { structural: false };
    }
    case 'setSpecialExitWeight': {
      if (reader) reader.setSpecialExitWeight(cmd.roomId, cmd.name, cmd.from);
      else { const r = map.rooms[cmd.roomId]; if (r) { if (cmd.from <= 1) delete r.exitWeights[cmd.name]; else r.exitWeights[cmd.name] = cmd.from; } }
      return { structural: false };
    }
    case 'batch': {
      let structural = false;
      for (const c of [...cmd.cmds].reverse()) { if (revertCommand(map, c, scene).structural) structural = true; }
      return { structural };
    }
  }
}

export function pushCommand(cmd: Command, scene?: SceneHandle | null): boolean {
  const state = store.getState();
  if (!state.map) return false;
  const { structural } = applyCommand(state.map, cmd, scene);
  store.setState((s) => ({
    undo: [...s.undo, cmd],
    redo: [],
  }));
  return structural;
}

export function pushBatch(cmds: Command[], scene?: SceneHandle | null): boolean {
  if (cmds.length === 0) return false;
  if (cmds.length === 1) return pushCommand(cmds[0], scene);
  const state = store.getState();
  if (!state.map) return false;
  let structural = false;
  for (const cmd of cmds) { if (applyCommand(state.map, cmd, scene).structural) structural = true; }
  const batch: Command = { kind: 'batch', cmds };
  store.setState((s) => ({ undo: [...s.undo, batch], redo: [] }));
  return structural;
}

export function undoOnce(scene?: SceneHandle | null): { changed: boolean; structural: boolean } {
  const state = store.getState();
  if (!state.map || state.undo.length === 0) return { changed: false, structural: false };
  const cmd = state.undo[state.undo.length - 1];
  const { structural } = revertCommand(state.map, cmd, scene);
  store.setState((s) => ({
    undo: s.undo.slice(0, -1),
    redo: [...s.redo, cmd],
  }));
  return { changed: true, structural };
}

export function redoOnce(scene?: SceneHandle | null): { changed: boolean; structural: boolean } {
  const state = store.getState();
  if (!state.map || state.redo.length === 0) return { changed: false, structural: false };
  const cmd = state.redo[state.redo.length - 1];
  const { structural } = applyCommand(state.map, cmd, scene);
  store.setState((s) => ({
    undo: [...s.undo, cmd],
    redo: s.redo.slice(0, -1),
  }));
  return { changed: true, structural };
}

export function buildDeleteNeighborEdits(map: MudletMap, roomId: number): NeighborEdit[] {
  return findNeighborsPointingAt(map, roomId).map((n) => ({
    roomId: n.roomId,
    dir: n.dir,
    was: getExit(map.rooms[n.roomId], n.dir),
  }));
}
