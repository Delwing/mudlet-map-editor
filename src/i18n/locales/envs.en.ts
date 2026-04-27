export const envsEn = {
  noMap: 'No map loaded.',
  filterPlaceholder: 'Filter ID…',
  addTitle: 'Add room color',
  envTitle: 'Room color {{id}}',
  noneTitle: 'None (−1)',
  noMatch: 'No match',
  filterByIdPlaceholder: 'Filter by ID…',
  newEnv: 'New room color',
  id: 'ID',
  color: 'Color',
  add: 'Add',
  remove: 'Remove',
  envIdPlaceholder: 'Room color ID',
  reservedIds: 'Room color IDs 1–256 are reserved. Use 257 or higher.',
  colorUpdated: 'Room color {{id}} updated',
  customColorRemoved: 'Custom color for room color {{id}} removed',
  customEnvSet: 'Custom room color {{id}} set to {{color}}',
} as const;

export type EnvsLocale = { [K in keyof typeof envsEn]: string };
