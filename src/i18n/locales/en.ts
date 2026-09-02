export const en = {
  toolbar: {
    newMap: 'New Map',
    loadDat: 'Load .dat',
    loadFromUrl: 'Load .dat from URL',
    saveDat: 'Save .dat',
    saveAs: 'Save to file…',
    area: 'Area',
    level: 'Level',
    room: 'Room',
    go: 'Go',
    goToRoomTitle: 'Go to room by ID',
    fitTitle: 'Fit area to view (F)',
    fit: 'Fit',
    search: 'Search',
    searchTitle: 'Search rooms and labels ({{modKey}}+F)',
    diff: 'Diff',
    diffTitle: 'Compare this map with another file',
    rendererSettings: 'Renderer settings',
    helpTitle: 'Help (keyboard shortcuts)',
    snapTitle: 'Snap to grid (G)',
    snap: 'Snap',
    undo: '↶ Undo',
    undoTitle: 'Undo ({{modKey}}+Z)',
    redo: '↷ Redo',
    redoTitle: 'Redo ({{modKey}}+Shift+Z)',
    swatches: 'Swatches',
    swatchesTitle: 'Room swatches palette',
  },
  status: {
    initialStatus: 'Load a Mudlet .dat file to begin.',
    roomNotFound: 'Room #{{id}} not found',
    newMapCreated: 'New map created · 0 rooms · 1 area',
    saved: 'Saved {{filename}}',
    saveFailed: 'Save failed: {{error}}',
    cancelled: 'Cancelled.',
    undone: 'Undone',
    redone: 'Redone',
    movedLabel: 'Moved label {{id}}',
    movedRoom: 'Moved room {{id}} → ({{x}}, {{y}}, {{z}})',
    movedRooms: 'Moved {{count}} rooms',
    deletedRoom: 'Deleted room {{id}}',
    deletedRooms: 'Deleted {{count}} rooms',
    removedExit: 'Removed exit {{from}} → {{to}}',
    removedStub: 'Removed stub {{dir}} on room {{id}}',
    removedWaypoint: "Removed waypoint from '{{exit}}' on room {{id}}",
    removedCustomLine: "Removed custom line '{{exit}}'",
    deletedLabel: 'Deleted label {{id}}',
    copied: 'Copied {{count}} rooms',
    pasted: 'Pasted {{count}} rooms',
    duplicated: 'Duplicated {{count}} rooms',
    externalExitsStubbed: '{{count}} external exit(s) → stub',
    specialExitsDropped: '{{count}} special exit(s) dropped',
    hashesDropped: '{{count}} duplicate hash(es) cleared',
    lodNoHitTest: 'Overview mode — zoom in to use this tool',
  },
  loading: {
    fetching: 'Downloading map…',
    parsing: 'Reading map file…',
    preparing: 'Building the map…',
    hint: 'Large maps can take a few seconds — the editor may not respond until this finishes.',
  },
  lod: {
    title: 'This level holds {{count}} rooms — the renderer is drawing it at reduced detail',
    mode_roomsOnly: 'Exits hidden',
    mode_raster: 'Overview',
    hintExits: 'zoom in for exit lines',
    hintZoomIn: 'zoom in to edit',
  },
  incoming: {
    title: '{{count}} rooms received from "{{name}}"',
    place: 'Place',
    placeTitle: 'A preview follows your cursor — click on the map to place, Esc cancels',
    placeHint: 'Click on the map to place the rooms · Esc or right-click cancels',
    noMap: 'Load a map first',
    dismiss: 'Dismiss',
  },
  hints: {
    marquee: 'Hold Ctrl to toggle selection',
    connect: 'Pick target · Shift = one-way · Esc cancels',
    customLine: 'Click to add waypoints · right-click or Enter to finish · Esc cancels',
    select: 'Click to select · Shift+click/drag to add · Ctrl+click/drag to toggle · drag selected rooms to move · MMB or Space to pan',
    unlink: 'Click a room to remove all its exits · click an exit or custom line to remove just that one',
    addRoom: 'Click an empty grid cell to place a room · {{modKey}}+click to place without selecting',
    addLabel: 'Click to place a label · select to move/edit · Delete to remove',
    paintDrag: 'Drag to paint multiple rooms · release to commit',
    paintActive: 'Painting "{{name}}" (env {{env}}{{symbol}}) · click or drag rooms',
    paintNoSwatch: 'No swatch selected — open Swatches palette and pick one',
    pickSwatch: 'Click a room to copy its symbol & room color · Esc to cancel',
  },
  tools: {
    select:   { label: 'Select',    hint: 'Click to select · Shift+click/drag to add · Ctrl+click/drag to toggle · drag to move (snaps to grid) · arrow keys nudge · MMB or Space to pan.' },
    connect:  { label: 'Connect',   hint: 'Click source, then target. Shift = one-way.' },
    unlink:   { label: 'Unlink',    hint: 'Click a room to remove all its exits. Click an exit/custom line to remove just that one.' },
    addRoom:  { label: 'Add Room',  hint: 'Click empty cell to create a room. {{modKey}}+click to place without selecting.' },
    addLabel: { label: 'Add Label', hint: 'Click to place a text label. Select to move/edit, Delete to remove.' },
    delete:   { label: 'Delete',    hint: 'Click a room to delete it, or an exit/custom line/label to remove it.' },
    pan:      { label: 'Pan',       hint: 'Drag background to pan. Hold Space with any tool for temporary pan.' },
    paint:    { label: 'Paint',     hint: 'Click or drag rooms to apply the active room swatch (symbol + room color). Select a swatch in the Swatches palette first.' },
  },
  help: {
    title: 'Mudlet Map Editor — Help',
    description: 'Browser-based editor for Mudlet .dat map files. Load a map, navigate areas and z-levels, then use the tools below to build or modify rooms, exits, custom lines, and labels. Changes are auto-saved to your browser session. Export with Save when ready.',
    toolsSection: 'Tools',
    shortcutsSection: 'Keyboard shortcuts',
    close: 'Close',
    shortcuts: {
      switchTool: 'Switch tool',
      tempPan: 'Hold to pan temporarily (any tool)',
      snapGrid: 'Toggle snap to grid',
      fitView: 'Fit area to view',
      search: 'Open / close search (rooms, labels)',
      selectAll: 'Select all rooms on current level',
      copy: 'Copy selected rooms',
      paste: 'Paste rooms at cursor (external exits become stubs)',
      duplicate: 'Duplicate selected rooms with offset',
      delete: 'Delete selection',
      nudge: 'Nudge selected room (Shift = ×5)',
      undo: 'Undo',
      redo: 'Redo',
      finishLine: 'Finish custom line',
      cancel: 'Cancel / deselect',
    },
  },
} as const;

type StringValues<T> = { [K in keyof T]: T[K] extends string ? string : StringValues<T[K]> };
type PartialStringValues<T> = { [K in keyof T]?: T[K] extends string ? string : PartialStringValues<T[K]> };

/**
 * The editor namespace with every key required. Used by the translations
 * bundled here, so a newly added string cannot be forgotten in one language.
 */
export type EditorLocaleComplete = StringValues<typeof en>;

/**
 * The shape consumers pass to override editor strings. Every key is optional —
 * anything omitted falls back to English at runtime anyway, and keeping it that
 * way means adding a string here stays a non-breaking change instead of a
 * compile error in every downstream translation.
 */
export type EditorLocale = PartialStringValues<typeof en>;
