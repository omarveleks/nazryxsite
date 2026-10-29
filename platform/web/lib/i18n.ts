// The interface in English, French and Russian. Keys are the English text; a missing translation falls back to it, so a
// new string never breaks a page. Data labels (therapeutic classes, dosage forms, stages, plan names) share the same
// dictionaries, so the same word is translated the same way everywhere.
import { cache } from 'react';
import fr from './i18n/fr';
import ru from './i18n/ru';

export type Lang = 'en' | 'fr' | 'ru';
export const LANGS: [Lang, string][] = [['en', 'English'], ['fr', 'Français'], ['ru', 'Русский']];
export const LANG_COOKIE = 'nzx_lang';
const DICT: Record<Lang, Record<string, string>> = { en: {}, fr, ru };

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'fr' || v === 'ru';
export const langOf = (u?: { language?: string | null } | null): Lang => (isLang(u?.language) ? u!.language : 'en');

/** A translator for one language: t('Save'), t('{n} products', { n }). Variables are filled after the lookup, so the
 *  key is the English template. Keys are matched exactly; the English text is the fallback. */
export function tr(lang: Lang) {
  const d = DICT[lang] ?? {};
  return (key: string, vars?: Record<string, string | number>) => {
    let s = d[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}
export type T = ReturnType<typeof tr>;

/** The language of the request: the page sets it once (setLang), shared server components read it (tt). React's
 *  per-request cache keeps one store per render, so two requests never share a language. */
export const langStore = cache(() => ({ lang: 'en' as Lang }));
export function setLang(lang: Lang) { langStore().lang = lang; return tr(lang); }
export const tt = () => tr(langStore().lang);
export const curLang = () => langStore().lang;

/** Dates in the reader's language: 24 Oct 2026 / 24 oct. 2026 / 24 окт. 2026 г. */
export function fmtDateIn(lang: Lang, d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  return new Date(d).toLocaleDateString({ en: 'en-GB', fr: 'fr-FR', ru: 'ru-RU' }[lang], opts);
}

/** How many languages have a translation for a key: for the admin's coverage line. */
export function covered(key: string) {
  return (fr[key] ? 1 : 0) + (ru[key] ? 1 : 0);
}
