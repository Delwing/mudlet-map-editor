export const searchEn = {
  tabRooms: 'Rooms',
  tabLabels: 'Labels',
  closeTitle: 'Close (Esc)',
  placeholderRooms: 'name, ID, or user data… (Tab to switch)',
  placeholderLabels: 'label text… (Tab to switch)',
  clearTitle: 'Clear',
  noMatches: 'No matches',
  tooManyResults: 'Showing first 100 results — refine your query',
  unnamed: 'unnamed',
  emptyLabel: 'empty label',
} as const;

export type SearchLocale = { [K in keyof typeof searchEn]: string };
