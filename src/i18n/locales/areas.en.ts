export const areasEn = {
  noMap: 'No map loaded.',
  noAreas: 'No areas.',
  newAreaPlaceholder: 'New area name…',
  add: 'Add',
  rename: 'Rename',
  editUserData: 'Edit user data',
  deleteArea: 'Delete area',
  doubleClickToRename: 'Double-click to rename',
  hasRooms: '{{name}} has {{count}} room(s). Choose:',
  deleteAllRooms: 'Delete all rooms & area',
  moveRoomsTo: 'Move rooms to…',
  moveAndDelete: 'Move & delete',
  cancelDelete: 'Cancel',
  added: "Area '{{name}}' added (ID {{id}})",
  deleted: "Area '{{name}}' and {{count}} rooms deleted",
  renamed: "Renamed area to '{{name}}'",
  moved: "Moved {{count}} rooms to area #{{targetId}}, deleted '{{name}}'",
} as const;

export type AreasLocale = { [K in keyof typeof areasEn]: string };
