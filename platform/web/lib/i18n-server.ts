import { cookies } from 'next/headers';
import { LANG_COOKIE, isLang, type Lang } from './i18n';

/** The language for pages without a signed-in user: the cookie the language switch sets, else English. */
export async function cookieLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : 'en';
}
