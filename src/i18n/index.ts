import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { pl } from './locales/pl';
import { ko } from './locales/ko';
import { panelsEn } from './locales/panels.en';
import { panelsPl } from './locales/panels.pl';
import { panelsKo } from './locales/panels.ko';
import { areasEn } from './locales/areas.en';
import { areasPl } from './locales/areas.pl';
import { areasKo } from './locales/areas.ko';
import { envsEn } from './locales/envs.en';
import { envsPl } from './locales/envs.pl';
import { envsKo } from './locales/envs.ko';
import { modalsEn } from './locales/modals.en';
import { modalsPl } from './locales/modals.pl';
import { modalsKo } from './locales/modals.ko';
import { sessionsEn } from './locales/sessions.en';
import { sessionsPl } from './locales/sessions.pl';
import { sessionsKo } from './locales/sessions.ko';
import { searchEn } from './locales/search.en';
import { searchPl } from './locales/search.pl';
import { searchKo } from './locales/search.ko';
import { contextEn } from './locales/context.en';
import { contextPl } from './locales/context.pl';
import { contextKo } from './locales/context.ko';
import { swatchesEn } from './locales/swatches.en';
import { swatchesPl } from './locales/swatches.pl';
import { swatchesKo } from './locales/swatches.ko';
import type { EditorLocale, EditorLocaleComplete } from './locales/en';

export { type EditorLocale, type EditorLocaleComplete };

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
      ko: {
        editor: ko,
        panels: panelsKo,
        areas: areasKo,
        envs: envsKo,
        modals: modalsKo,
        sessions: sessionsKo,
        search: searchKo,
        context: contextKo,
        swatches: swatchesKo,
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
