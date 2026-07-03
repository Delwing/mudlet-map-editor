# Plugin System

Plugins extend the editor with custom behaviour without modifying the base code. They are plain TypeScript objects that implement the `EditorPlugin` interface and are auto-discovered at build time.

## How plugins are loaded

Drop a file at `src/plugins/<name>/index.ts` with a default export that implements `EditorPlugin`. Vite's `import.meta.glob` picks it up automatically — no registration step needed.

```
src/
  plugins/
    my-plugin/
      index.ts   ← default-exports an EditorPlugin object
```

`index.ts` minimum:

```typescript
import type { EditorPlugin } from '../../editor/plugin';

export default {
  // hooks go here
} satisfies EditorPlugin;
```

## Using the editor as a library

If you maintain a separate repo built on top of this one, add `mudlet-map-editor` as a dependency and pass plugins directly to `<App>`:

```typescript
// your main.tsx
import App from 'mudlet-map-editor';
import myPlugin from './plugins/my-plugin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App plugins={[myPlugin]} title="My MUD Editor" />
);
```

## `EditorPlugin` interface

```typescript
interface EditorPlugin {
  id?: string;
  onAppReady?(): Promise<void>;
  onMapOpened?(map: MudletMap): void;
  onMapClosed?(): void;
  onMapSave?(bytes: Uint8Array): void;
  renderOverlay?(): ReactNode;
  renderLogo?(): ReactNode;
  toolbarActions?(actions: ToolbarAction[]): ToolbarAction[];
  mapFormats?(formats: MapFormat[]): MapFormat[];
  sidebarTabs?(): SidebarTab[];
  swatchSets?(): SwatchSet[];
  roomPanelSections?(): RoomPanelSection[];
  mapChecks?(map: MudletMap, sceneRef: { current: SceneHandle | null }): PluginCheckResult[];
}
```

### `id`

Optional stable string identifier. Used to namespace warning ack keys in localStorage so acknowledgements from one plugin don't collide with another. Defaults to the plugin's position in the array when omitted.

---

### `onAppReady(): Promise<void>`

Runs once after the React tree mounts. Awaited before proceeding. Use it for async initialisation (OAuth flows, fetching remote config, etc.).

```typescript
async onAppReady() {
  const token = await fetchOAuthToken();
  setToken(token);
},
```

---

### `onMapOpened(map: MudletMap): void`

Fires whenever a new map is loaded (including after session restore). Use it to acquire locks, start timers, or prefetch data keyed to the map.

```typescript
onMapOpened(map) {
  lockRemoteMap(map);
},
```

---

### `onMapClosed(): void`

Fires when the current map is unloaded (e.g. before a new file is opened). Pair with `onMapOpened` to release resources.

---

### `onMapSave(bytes: Uint8Array): void`

Called with the serialised `.dat` bytes whenever the user saves. Use it to push the file to a remote location.

```typescript
onMapSave(bytes) {
  uploadToGitHub(bytes);
},
```

---

### `renderOverlay(): ReactNode`

Renders a React subtree on top of the canvas. The overlay is absolutely positioned and covers the full editor area. Use it for HUD elements (clock, status badges, etc.).

```typescript
renderOverlay() {
  return <ClockWidget />;
},
```

---

### `renderLogo(): ReactNode`

Replaces the logo in the toolbar header. The **first** plugin that defines this hook claims the slot — its return value is rendered as-is. Returning `null` hides the logo entirely; returning JSX draws a custom mark. When no plugin defines `renderLogo`, the built-in Mudlet logo appears.

```typescript
renderLogo() {
  return <img src="/my-logo.svg" alt="My MUD" height={24} />;
},
```

---

### `toolbarActions(actions: ToolbarAction[]): ToolbarAction[]`

Reshapes the toolbar's file-action button group. The hook receives the current list (built-ins first, then any additions from earlier plugins) and returns a new list. Transforms from multiple plugins are composed in plugin order.

Built-in action ids are `'new'`, `'load'`, `'loadUrl'`, and `'save'`.

```typescript
interface ToolbarAction {
  id: string;                  // stable id; plugins target an action by matching on this
  title?: string;              // tooltip text
  icon?: ReactNode;            // button contents — typically an SVG icon
  onClick?: () => void;        // click handler (ignored when filePicker is set)
  filePicker?: {               // renders as a <label> wrapping a hidden <input type="file">;
    accept: string;            //   clicking opens the OS file picker
    onFile: (file: File) => void;
  };
  disabled?: boolean;          // greys out + ignores clicks
  badge?: ReactNode;           // overlay node (built-in "save" uses it for the dirty asterisk)
  style?: CSSProperties;       // inline style for the button/label root
  render?: () => ReactNode;    // escape hatch: every field except `id` is ignored and this
                               //   node is rendered in place (use for non-button controls)
}
```

Common transforms:

```typescript
toolbarActions(actions) {
  return actions
    // Hide a built-in:
    .filter((a) => a.id !== 'loadUrl')
    // Replace a callback (keeps the visuals, swaps behaviour):
    .map((a) => (a.id === 'save' ? { ...a, onClick: mySave } : a))
    // Add a custom button:
    .concat({ id: 'sync', title: 'Sync', icon: <SyncIcon />, onClick: doSync });
},
```

> Note: overriding the `'save'` action's `onClick` replaces only the toolbar button's behaviour. The `onMapSave` hook still fires whenever the editor serialises the map elsewhere.

---

### `mapFormats(formats: MapFormat[]): MapFormat[]`

Defines the import/export formats the editor understands. The map isn't tied to Mudlet `.dat` — a **`MapFormat`** is a codec between raw file bytes and the editor's canonical in-memory model (`MudletMap`). Any format that can translate to and from `MudletMap` works: a different `.dat` variant, SQLite, JSON, plaintext, etc.

The hook receives the current list (built-in Mudlet `.dat` first, then any earlier-plugin additions) and returns a new one — the same reshape pattern as `toolbarActions`. Transforms compose in plugin order.

```typescript
interface MapFormat {
  id: string;              // stable id; stored as the active format so saves round-trip
  label: string;           // shown in the save-format chooser
  extensions: string[];    // e.g. ['.json']; the first is the default save extension
  accept?: string;         // load-picker accept string (defaults to extensions joined by ',')
  matches?(fileName: string): boolean;   // claim a filename (defaults to extension match)
  parse(bytes: ArrayBuffer, ctx: { fileName: string }): MudletMap | Promise<MudletMap>;
  serialize(map: MudletMap): Uint8Array | Promise<Uint8Array>;
}
```

How formats are used:

- **Load** (file picker, drag-drop, URL): the format whose `matches` claims the filename parses the bytes. The load picker's `accept` is the union of every format's extensions.
- **Save**: the main Save button always serialises in the active format (the one the map was loaded/last saved with). When more than one format is registered, a caret appears next to it — a split button — whose dropdown lists every format; picking one saves as that format and makes it the new active format. With a single format, there's no caret and Save behaves exactly as before.
- `getMapBytes()` (library export) serialises the current map with the active format — it is `async` because `serialize` may be.

Common transforms:

```typescript
import type { MapFormat } from 'mudlet-map-editor';

const csvFormat: MapFormat = {
  id: 'my-csv',
  label: 'Room list (.csv)',
  extensions: ['.csv'],
  parse: (bytes) => fromCsv(new TextDecoder().decode(bytes)),
  serialize: (map) => new TextEncoder().encode(toCsv(map)),
};

export default {
  mapFormats(formats) {
    return formats
      // Add a custom format:
      .concat(csvFormat)
      // …or replace the built-in .dat:
      // .map((f) => (f.id === 'mudlet-dat' ? myDatVariant : f))
      // …or drop it entirely so the app only supports the custom one:
      // .filter((f) => f.id !== 'mudlet-dat')
  },
} satisfies EditorPlugin;
```

`parse` and `serialize` may be async — return a promise to await network calls, WASM codecs, etc.

**Built-in formats.** The core app ships two: Mudlet `.dat` (binary) and Mudlet `.json` — the latter is Mudlet's real interchange format (`exportJsonMap`/`importJsonMap`, formatVersion 1), so files save/load in actual Mudlet. Its source, `src/editor/mudletJsonFormat.ts`, is a thorough reference implementation of a non-trivial `MapFormat`: it maps our binary `MudletMap` model to Mudlet's JSON schema (rooms nested in areas, `[x,y,z]` coordinate arrays, exits as a flat array keyed by long direction names, `color24RGB`/`color32RGBA` colours, alphabetically-sorted keys and special exits to match Qt, base64 label pixmaps).

Fidelity was validated by diffing our export of a real 26,988-room map against Mudlet's own export of the same map: the output is **byte-identical except** (a) three rooms' symbol *colour* — the binary-reader model exposes `symbol` as a bare string with no colour, so that datum isn't available to us (it's dropped in the `.dat` editor too), and (b) label pixmap bytes, because Mudlet re-encodes the PNG on export while we preserve the original bytes (same image either way). The reverse direction — parsing Mudlet's own JSON — reconstructs all rooms/areas/labels. The one representational edge case, inherent to Mudlet's schema, is a special exit whose command is literally a compass word (e.g. a special exit named `"southeast"`): it serialises identically to how Mudlet writes it, but re-importing resolves it to a normal exit — exactly as Mudlet's own importer does.

---

### `sidebarTabs(): SidebarTab[]`

Adds tabs to the right-side panel. Each tab gets its own render function that receives a stable `sceneRef`.

```typescript
interface SidebarTab {
  id: string;
  label: ReactNode;
  render(sceneRef: { current: SceneHandle | null }): ReactNode;
}
```

```typescript
sidebarTabs() {
  return [
    {
      id: 'history',
      label: 'History',
      render: (sceneRef) => <HistoryPanel sceneRef={sceneRef} />,
    },
  ];
},
```

---

### `swatchSets(): SwatchSet[]`

Contributes preset symbol+environment combinations to the swatch palette. These are merged with any user-defined sets and appear in the palette dropdown.

---

### `roomPanelSections(): RoomPanelSection[]`

Appends custom sections to the bottom of the room selection panel. Each section receives the selected room's id, the full `MudletRoom` object, the map, and the sceneRef.

```typescript
interface RoomPanelSection {
  id: string;
  render(props: RoomSectionProps): ReactNode;
}

interface RoomSectionProps {
  roomId: number;
  room: MudletRoom;
  map: MudletMap;
  sceneRef: { current: SceneHandle | null };
}
```

```typescript
roomPanelSections() {
  return [
    {
      id: 'notes',
      render: ({ roomId, room }) => <NotesSection roomId={roomId} room={room} />,
    },
  ];
},
```

---

### `mapChecks(map, sceneRef): PluginCheckResult[]`

Returns custom map warnings. Called every time built-in warnings are recomputed (after each command, undo/redo, and acknowledgement). Results appear in the **Map** tab alongside built-in checks and support the same ack/unack workflow.

```typescript
interface PluginCheckResult {
  id: string;        // stable, unique within this plugin's results
  message: string;   // bold title in the warnings list
  detail?: string;   // secondary description line
  roomId?: number;   // if set, a "Go" button navigates to this room
}
```

`id` must be stable across runs for the same logical issue so that acknowledgements persist correctly.

```typescript
mapChecks(map) {
  const issues: PluginCheckResult[] = [];

  for (const [idStr, room] of Object.entries(map.rooms)) {
    if (!room) continue;
    const roomId = Number(idStr);

    if (!room.name?.trim()) {
      issues.push({
        id: `unnamed:${roomId}`,
        message: 'Unnamed room',
        detail: `#${roomId} · ${map.areaNames[room.area] ?? `Area ${room.area}`}`,
        roomId,
      });
    }
  }

  return issues;
},
```

The `sceneRef` argument gives access to the `EditorMapReader` (via `sceneRef.current?.reader`) for checks that need area/plane/label data beyond what `MudletMap` exposes directly.

## Full example

```typescript
import type { EditorPlugin, PluginCheckResult } from '../../editor/plugin';
import type { MudletMap } from '../../mapIO';
// or from the package root when using library mode:
// import type { EditorPlugin, PluginCheckResult, MudletMap } from 'mudlet-map-editor';

export default {
  id: 'my-checks',

  async onAppReady() {
    console.log('editor ready');
  },

  onMapOpened(map) {
    console.log(`map loaded: ${Object.keys(map.rooms).length} rooms`);
  },

  mapChecks(map): PluginCheckResult[] {
    const issues: PluginCheckResult[] = [];

    for (const [idStr, room] of Object.entries(map.rooms)) {
      if (!room) continue;
      const roomId = Number(idStr);

      if (!room.name?.trim()) {
        issues.push({
          id: `unnamed:${roomId}`,
          message: 'Unnamed room',
          detail: `#${roomId}`,
          roomId,
        });
      }

      if (room.weight <= 0) {
        issues.push({
          id: `weight:${roomId}`,
          message: 'Non-positive weight',
          detail: `#${roomId} weight=${room.weight}`,
          roomId,
        });
      }
    }

    return issues;
  },
} satisfies EditorPlugin;
```
