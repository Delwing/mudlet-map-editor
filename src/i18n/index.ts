import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { pl } from './locales/pl';
import { panelsEn } from './locales/panels.en';
import { panelsPl } from './locales/panels.pl';
import { areasEn } from './locales/areas.en';
import { areasPl } from './locales/areas.pl';
import { envsEn } from './locales/envs.en';
import { envsPl } from './locales/envs.pl';
import { modalsEn } from './locales/modals.en';
import { modalsPl } from './locales/modals.pl';
import { sessionsEn } from './locales/sessions.en';
import { sessionsPl } from './locales/sessions.pl';
import { searchEn } from './locales/search.en';
import { searchPl } from './locales/search.pl';
import { contextEn } from './locales/context.en';
import { contextPl } from './locales/context.pl';
import { swatchesEn } from './locales/swatches.en';
import { swatchesPl } from './locales/swatches.pl';
import type { EditorLocale } from './locales/en';

export { type EditorLocale };

function readStoredLang(): string {
  try { return localStorage.getItem('lang') ?? 'en'; } catch { return 'en'; }
}

function writeStoredLang(lng: string) {
  try { localStorage.setItem('lang', lng); } catch { /* */ }
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: {
        editor: en,
        panels: panelsEn,
        areas: areasEn,
        envs: envsEn,
        modals: modalsEn,
        sessions: sessionsEn,
        search: searchEn,
        context: contextEn,
        swatches: swatchesEn,
      },
      pl: {
        editor: pl,
        panels: panelsPl,
        areas: areasPl,
        envs: envsPl,
        modals: modalsPl,
        sessions: sessionsPl,
        search: searchPl,
        context: contextPl,
        swatches: swatchesPl,
      },
    },
    lng: readStoredLang(),
    fallbackLng: 'en',
    ns: ['editor', 'panels', 'areas', 'envs', 'modals', 'sessions', 'search', 'context', 'swatches'],
    defaultNS: 'editor',
    interpolation: { escapeValue: false },
  });
}

/** Register translations for a plugin namespace. Call before the app mounts. */
export function addTranslations(lng: string, ns: string, resources: object): void {
  i18n.addResourceBundle(lng, ns, resources, true, true);
}

export function changeLanguage(lng: string): void {
  writeStoredLang(lng);
  i18n.changeLanguage(lng);
}

export function getCurrentLanguage(): string {
  return i18n.resolvedLanguage ?? i18n.language;
}

export default i18n;
