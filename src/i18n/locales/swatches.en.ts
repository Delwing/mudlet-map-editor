export const swatchesEn = {
  title: 'Swatches',
  noSets: 'No sets yet',
  renameSet: 'Rename set',
  deleteSet: 'Delete set',
  newSet: 'New set',
  setNamePlaceholder: 'Set name…',
  addSwatch: 'Add swatch',
  editSwatch: 'Edit',
  deleteSwatch: 'Delete',
  namePlaceholder: 'Name',
  symPlaceholder: 'Sym',
  confirmDeleteSet: 'Delete set "{{name}}"?',
  pickFromCanvas: 'Pick symbol & room color from a room on the canvas',
  clickToCopy: 'Click a room on the canvas to copy its values…',
  cancel: 'Cancel',
  empty: 'Create a set above, then add swatches to it.',
} as const;

export type SwatchesLocale = { [K in keyof typeof swatchesEn]: string };
