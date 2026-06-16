import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import bundledManifest from '../../locales/manifest.json';
import {
  applyLanguagePreference,
  isLanguageAvailable,
  languageDisplayName,
  registerDownloadedCatalog,
} from '../../i18n';
import { downloadLocale, getLocaleManifest, listDownloadedLocales } from '../../lib/api';
import type { LocaleManifest, LocaleManifestEntry } from '../../types/locales';
import Tx from '../translation/Tx';

interface LanguageSelectorProps {
  /** Current persisted preference (AppSettings.language). Null = system default. */
  value: string | null;
  /** Persist the chosen language (or null for system default). */
  onChange: (code: string | null) => void;
}

/**
 * Language picker backed by the GitHub-hosted locale manifest.
 *
 * It lists every language on `main` with how much of the app each covers, and
 * downloads the chosen catalog on demand (caching it for offline use). English
 * is bundled; selecting an undownloaded language fetches it, registers it with
 * i18next, then applies it.
 */
export default function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  const { t } = useTranslation();
  const [manifest, setManifest] = useState<LocaleManifest>(bundledManifest as LocaleManifest);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Register already-downloaded catalogs (so they show as ready) and refresh the
  // language list from `main`. Both are best-effort: offline keeps the bundled list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const downloaded = await listDownloadedLocales();
        if (!cancelled) {
          for (const { code, catalog } of downloaded) registerDownloadedCatalog(code, catalog);
        }
      } catch {
        // ignore: bundled languages still work
      }
      try {
        const remote = await getLocaleManifest();
        if (!cancelled && remote?.languages?.length) setManifest(remote);
      } catch {
        // offline or fetch failed: keep the bundled manifest
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const languages = useMemo(() => {
    const list = [...manifest.languages].sort((a, b) => a.name.localeCompare(b.name));
    // Make sure the persisted language is selectable even if the manifest fetch
    // failed and the bundled copy does not list it.
    if (value && !list.some((entry) => entry.code === value)) {
      list.unshift({ code: value, name: languageDisplayName(value), translatedKeys: 0, pct: 0 });
    }
    return list;
  }, [manifest, value]);

  const optionLabel = (entry: LocaleManifestEntry): string => {
    const name = entry.name || languageDisplayName(entry.code);
    // English is the source (always complete and bundled); a percentage is noise.
    return entry.code === manifest.sourceLanguage ? name : `${name} (${entry.pct}%)`;
  };

  const handleSelect = async (code: string) => {
    setError(null);
    if (!code) {
      onChange(null);
      applyLanguagePreference(null);
      return;
    }
    if (isLanguageAvailable(code)) {
      onChange(code);
      applyLanguagePreference(code);
      return;
    }
    setDownloading(code);
    try {
      const { catalog } = await downloadLocale(code);
      registerDownloadedCatalog(code, catalog);
      onChange(code);
      applyLanguagePreference(code);
    } catch {
      setError(t('settings.language.downloadFailed'));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <label className="text-sm font-medium text-text-primary block">
        <Tx k="settings.language.label" fallback="Language" />
      </label>
      <p className="text-xs text-text-secondary mt-0.5 mb-2">
        <Tx
          k="settings.language.description"
          fallback="Choose the app language, or follow your system preference. Percentages show how much of the app each community translation covers."
        />
      </p>
      <select
        value={value ?? ''}
        onChange={(event) => void handleSelect(event.target.value)}
        disabled={downloading !== null}
        className="w-full max-w-xs rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{t('settings.language.systemDefault')}</option>
        {languages.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {optionLabel(entry)}
          </option>
        ))}
      </select>
      {downloading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <Tx k="settings.language.downloading" fallback="Downloading language pack..." />
        </div>
      )}
      {error && (
        <div className="mt-2 flex items-start gap-2 text-xs text-state-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
