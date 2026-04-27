export const modalsEn = {
  renderer: {
    title: 'Renderer Settings',
    reset: 'Reset',
    resetTitle: 'Reset all to defaults',
    closeTitle: 'Close',
    room: 'Room',
    lines: 'Lines',
    background: 'Background',
    shape: 'Shape',
    size: 'Size',
    style: 'Style',
    width: 'Width',
    color: 'Color',
    areaName: 'Area name',
    showOnMap: 'Show on map',
    rectangle: 'Rectangle',
    rounded: 'Rounded',
    circle: 'Circle',
    borders: 'Borders',
    frame: 'Frame',
    colored: 'Colored',
    emboss: 'Emboss',
  },
  urlLoad: {
    title: 'Load map from URL',
    placeholder: 'https://example.com/map.dat',
    loading: 'Loading…',
    load: 'Load',
    corsNote: 'The server must allow cross-origin requests (CORS). If loading fails, download the file and use "Load .dat" instead.',
  },
} as const;

export type ModalsLocale = { [K in keyof typeof modalsEn]: { [K2 in keyof typeof modalsEn[K]]: string } };
