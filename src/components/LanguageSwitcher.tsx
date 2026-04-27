import { useEffect, useState } from 'react';
import { changeLanguage, getCurrentLanguage } from '../i18n';
import i18n from '../i18n';

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'pl', label: 'PL' },
];

export function LanguageSwitcher() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const handler = () => rerender((n) => n + 1);
    i18n.on('languageChanged', handler);
    return () => { i18n.off('languageChanged', handler); };
  }, []);

  const current = getCurrentLanguage();
  const available = LANGUAGES.filter(({ code }) => i18n.hasResourceBundle(code, 'editor'));

  if (available.length < 2) return null;

  return (
    <select
      className="lang-switcher"
      value={current}
      onChange={(e) => changeLanguage(e.target.value)}
    >
      {available.map(({ code, label }) => (
        <option key={code} value={code}>{label}</option>
      ))}
    </select>
  );
}
