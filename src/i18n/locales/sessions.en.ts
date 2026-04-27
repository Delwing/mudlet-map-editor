export const sessionsEn = {
  loading: 'Loading…',
  noMap: 'No map loaded.',
  noMapHint: 'Drag a .dat file in or load from toolbar.',
  savedSessions: 'Saved Sessions',
  deleteAll: 'Delete All',
  load: 'Load',
  delete: 'Delete',
  autoDelete: 'Auto-delete sessions older than',
  days: 'days',
  restored: 'Session restored · {{rooms}} rooms · {{areas}} areas',
} as const;

export type SessionsLocale = { [K in keyof typeof sessionsEn]: string };
