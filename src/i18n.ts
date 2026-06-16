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

export const FALLBACK_LANGUAGE = 'en';

/** True if a catalog for this code is loaded right now, whether bundled or
 *  downloaded. Replaces static lookups so runtime-added languages count. */
export function isLanguageAvailable(code: string | null | undefined): boolean {
  return !!code && i18n.hasResourceBundle(code, 'translation');
}

/** Merge a downloaded catalog into i18next so the language becomes selectable
 *  and t() resolves against it. Safe to call repeatedly (deep-merges/overwrites). */
export function registerDownloadedCatalog(
  code: string,
  catalog: Record<string, unknown>
): void {
  i18n.addResourceBundle(code, 'translation', catalog, true, true);
}

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
  // Only bundled catalogs are considered here: this runs once as the lng for
  // i18n.init (before the resource store exists, so hasResourceBundle would
  // throw), and later only as the system-default fallback. Downloaded languages
  // are explicit user choices, applied via applyLanguagePreference, not detected.
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
    // Only bundled languages are loaded synchronously at init; a cached choice
    // for a downloaded language is re-applied by hydrateDownloadedLocales once
    // its catalog is registered.
    if (cached && resources[cached]) return cached;
  } catch {
    // localStorage can throw (disabled storage); ignore and fall through.
  }
  return detectFromNavigator();
}

/**
 * Apply the persisted language preference, mirroring the dateFormat pattern: the
 * appStore calls this on settings load and save.
 *
 * A null/empty preference means "follow the OS" and clears the cache. A concrete
 * code is always cached (so the choice survives a restart) even if its downloaded
 * catalog has not been registered yet; the language only switches once the catalog
 * is present. hydrateDownloadedLocales re-applies the cached choice after it
 * registers downloaded catalogs, closing that startup gap.
 */
export function applyLanguagePreference(lang: string | null | undefined): void {
  if (!lang) {
    try {
      localStorage.removeItem(LANGUAGE_CACHE_KEY);
    } catch {
      // ignore storage failures; the in-memory language still updates below
    }
    const target = detectFromNavigator();
    if (i18n.language !== target) void i18n.changeLanguage(target);
    return;
  }
  try {
    localStorage.setItem(LANGUAGE_CACHE_KEY, lang);
  } catch {
    // ignore storage failures; the in-memory language still updates below
  }
  if (isLanguageAvailable(lang) && i18n.language !== lang) {
    void i18n.changeLanguage(lang);
  }
}

/**
 * Register every previously downloaded language catalog (cached to disk by the
 * main process) so it becomes selectable, then re-apply the saved preference in
 * case the user's chosen language was one of them. Call once at renderer startup.
 */
export async function hydrateDownloadedLocales(): Promise<string[]> {
  const api = window.electronAPI?.locales;
  if (!api) return [];
  const codes: string[] = [];
  try {
    const downloaded = await api.listDownloaded();
    for (const { code, catalog } of downloaded) {
      registerDownloadedCatalog(code, catalog);
      codes.push(code);
    }
  } catch {
    // Offline or IPC failure: keep whatever bundled languages we already have.
  }
  try {
    const cached = localStorage.getItem(LANGUAGE_CACHE_KEY);
    if (cached) applyLanguagePreference(cached);
  } catch {
    // localStorage unavailable; bundled-language users are unaffected.
  }
  // In the background, pull any translation fixes published to `main` since these
  // catalogs were downloaded. Non-blocking so it never delays first paint.
  void refreshDownloadedCatalogs(api);
  return codes;
}

/**
 * Re-fetch downloaded catalogs and live-swap any that changed on `main`. If the
 * active language was among them, nudge i18next so mounted components re-render
 * with the updated strings. Silent on failure (offline, etc.).
 */
async function refreshDownloadedCatalogs(
  api: NonNullable<typeof window.electronAPI>['locales']
): Promise<void> {
  try {
    const updated = await api.refresh();
    if (!updated.length) return;
    for (const { code, catalog } of updated) registerDownloadedCatalog(code, catalog);
    const active = i18n.language;
    if (updated.some((u) => u.code === active)) void i18n.changeLanguage(active);
  } catch {
    // Offline or IPC failure: users keep their cached catalogs.
  }
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
