import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * Eagerly bundle every locale catalog under src/locales/<lng>/translation.json.
 * Using import.meta.glob means a new language (e.g. a Weblate PR adding
 * de/translation.json) is picked up automatically: no edit to this file is
 * needed, and the language picker reads the available set from here.
 *
 * en/translation.json is the source of truth and the only catalog hand-edited
 * in this repo; every other language is written by translators via Weblate.
 */
const catalogs = import.meta.glob('./locales/*/translation.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [path, mod] of Object.entries(catalogs)) {
  const match = path.match(/\/locales\/([^/]+)\/translation\.json$/);
  if (!match) continue;
  resources[match[1]] = { translation: mod.default };
}

/** Languages we ship a catalog for, e.g. ['de', 'en', 'pt-BR']. */
export const AVAILABLE_LANGUAGES = Object.keys(resources).sort();

export const FALLBACK_LANGUAGE = 'en';

/**
 * localStorage mirror of the persisted AppSettings.language. It exists only so
 * startup is flash-free: the renderer reads it synchronously at init, before the
 * async settings IPC returns. AppSettings stays the source of truth;
 * applyLanguagePreference keeps this cache in sync.
 */
const LANGUAGE_CACHE_KEY = 'grimoire.language';

/**
 * Best match from what Chromium (and therefore Electron) reports for the OS. A
 * region tag is tried first, then trimmed: 'pt-BR' tries a 'pt-BR' catalog, then
 * 'pt', then falls back to English.
 */
function detectFromNavigator(): string {
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const raw of candidates) {
    if (!raw) continue;
    if (resources[raw]) return raw;
    const base = raw.split('-')[0];
    if (base && resources[base]) return base;
  }
  return FALLBACK_LANGUAGE;
}

/** Starting language for init: a previously chosen override (cached) wins,
 *  otherwise OS detection. The user can change this via the Settings picker. */
function detectInitialLanguage(): string {
  try {
    const cached = localStorage.getItem(LANGUAGE_CACHE_KEY);
    if (cached && resources[cached]) return cached;
  } catch {
    // localStorage can throw (disabled storage); ignore and fall through.
  }
  return detectFromNavigator();
}

/**
 * Apply the persisted language preference, mirroring the dateFormat pattern: the
 * appStore calls this on settings load and save. A known language is applied and
 * cached; null/undefined/unknown reverts to OS detection and clears the cache.
 */
export function applyLanguagePreference(lang: string | null | undefined): void {
  const known = !!lang && Object.prototype.hasOwnProperty.call(resources, lang);
  const target = known ? (lang as string) : detectFromNavigator();
  try {
    if (known) localStorage.setItem(LANGUAGE_CACHE_KEY, lang as string);
    else localStorage.removeItem(LANGUAGE_CACHE_KEY);
  } catch {
    // ignore storage failures; the in-memory language still updates below
  }
  if (i18n.language !== target) void i18n.changeLanguage(target);
}

/** Human-readable name for a language code, in that language's own form
 *  ('de' -> 'Deutsch'). Falls back to the raw code if Intl can't resolve it. */
export function languageDisplayName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

i18n.use(initReactI18next);

// initAsync:false loads the bundled resources synchronously, so t() is ready
// before the first render and no Suspense boundary is required.
void i18n.init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  defaultNS: 'translation',
  interpolation: { escapeValue: false }, // React escapes output already
  returnNull: false,
  initAsync: false,
  react: { useSuspense: false },
});

export default i18n;
