# Mudlet Map Editor

A browser-based visual editor for [Mudlet](https://www.mudlet.org/) `.dat` binary map files. Load, edit, and save MUD maps directly in your browser — no installation required.

## Features

- **Visual editing** — add, move, and delete rooms on an interactive canvas
- **Exit management** — create bidirectional or one-way exits between rooms in 14+ directions
- **Labels** — place text labels with custom fonts, colors, and optional images
- **Custom lines** — draw waypoint-based paths with configurable colors and arrowheads
- **Area & environment management** — organize rooms into areas, customize terrain colors
- **Swatches / Paint tool** — define symbol+environment presets and paint them onto rooms in one click
- **Undo/redo** — full command history with descriptive labels
- **Binary I/O** — load and save Mudlet `.dat` files directly in the browser; also load from URL
- **Session persistence** — work is auto-saved to IndexedDB and restored on next visit

## Tools

| Key | Tool | Description |
|-----|------|-------------|
| `1` | Select | Click rooms to view/edit properties; nudge with arrow keys |
| `2` | Connect | Click source then target to create an exit |
| `3` | Unlink | Click an exit stub to remove that exit |
| `4` | Add Room | Click an empty grid cell to create a room |
| `5` | Add Label | Place a text label on the map |
| `6` | Delete | Remove rooms, exits, or labels |
| `7` | Pan | Drag to move the viewport |
| `8` | Paint | Apply the active swatch (symbol + environment) to rooms |

The **Custom Line** tool is activated from the side panel (on a selected exit), not the toolbar. Hold **Space** to temporarily pan from any tool.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `G` | Toggle grid snap |
| `F` | Fit area in view |
| `Delete` | Remove selection |
| `Ctrl+A` | Select all rooms in current area/z-level |
| `Esc` | Cancel current operation |

## Getting Started

```bash
npm install
npm run dev
```

Then open the app, click **Load** in the toolbar to open a `.dat` file, or click **New** to start from scratch. Use **Download** to save your changes.

## Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # Type-check and bundle for production
npm run preview   # Preview the production build
```

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** for bundling
- **Konva** for canvas rendering (via [`mudlet-map-renderer`](https://github.com/Delwing/mudlet-map-renderer))
- [`mudlet-map-binary-reader`](https://github.com/Delwing/mudlet-map-binary-reader) for parsing and serializing Mudlet `.dat` files

## Architecture

```
Binary .dat file
  → mudlet-map-binary-reader  →  MudletMap (in-memory model)
  → EditorMapReader (adapter, Y-flip)
  → MapRenderer (Konva canvas) + LiveEffect overlays
```

All map mutations go through a command system (`applyCommand`) that records operations for undo/redo. State is managed in a single centralized store.