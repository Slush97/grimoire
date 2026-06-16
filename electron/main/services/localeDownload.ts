import { app } from 'electron';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DownloadedLocale, LocaleManifest } from '../../../src/types/locales';

/**
 * Downloadable language packs.
 *
 * English ships bundled in the app; every other language lives only on GitHub
 * `main`. This service fetches the manifest (the language index the picker reads)
 * and individual catalogs from raw.githubusercontent.com, caching each downloaded
 * catalog under userData/locales/<code>/translation.json so it works offline on
 * the next launch.
 *
 * Updates to an already-downloaded language are picked up via refresh(): we store
 * each catalog's ETag and issue conditional GETs, so a language re-downloads only
 * when its content actually changed on `main`. No auth and no telemetry: these are
 * plain GETs of public repo files.
 */

/** Repo + branch the catalogs are read from. Overridable for tests/forks. */
const RAW_BASE =
  process.env.GRIMOIRE_LOCALE_BASE_URL ??
  'https://raw.githubusercontent.com/Slush97/grimoire/main';

const MANIFEST_URL = `${RAW_BASE}/src/locales/manifest.json`;
const catalogUrl = (code: string) => `${RAW_BASE}/src/locales/${code}/translation.json`;

const DEFAULT_TIMEOUT_MS = 15_000;
/** Refuse absurdly large payloads (a full catalog is well under this). */
const MAX_BYTES = 5 * 1024 * 1024;

/** BCP 47-ish: 2-3 letter language, optional script/region subtag. Anchored so a
 *  code can never escape the locales directory (no slashes, dots, or '..'). */
const CODE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export class LocaleDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocaleDownloadError';
  }
}

interface CatalogMeta {
  /** ETag of the cached catalog, used for conditional refresh requests. */
  etag?: string | null;
}

function assertValidCode(code: string): void {
  if (!CODE_RE.test(code)) {
    throw new LocaleDownloadError(`Invalid language code: ${code}`);
  }
}

function localesRoot(): string {
  return join(app.getPath('userData'), 'locales');
}

function cachePath(code: string): string {
  return join(localesRoot(), code, 'translation.json');
}

function metaPath(code: string): string {
  return join(localesRoot(), code, 'meta.json');
}

interface FetchResult {
  /** 200 with a body, or 304 when the cached ETag still matches. */
  status: 200 | 304;
  etag: string | null;
  text: string | null;
}

async function httpGet(url: string, etag?: string | null): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (etag) headers['If-None-Match'] = etag;
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LocaleDownloadError('Request timed out');
    }
    throw new LocaleDownloadError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 304) {
    return { status: 304, etag: etag ?? null, text: null };
  }
  if (!response.ok) {
    throw new LocaleDownloadError(`HTTP ${response.status} for ${url}`);
  }
  const text = await response.text();
  if (text.length > MAX_BYTES) {
    throw new LocaleDownloadError('Payload too large');
  }
  return { status: 200, etag: response.headers.get('etag'), text };
}

/** Parse and lightly validate a catalog: it must be a JSON object. */
function parseCatalog(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LocaleDownloadError('Catalog is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LocaleDownloadError('Catalog is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function readMeta(code: string): Promise<CatalogMeta> {
  try {
    const text = await readFile(metaPath(code), 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as CatalogMeta) : {};
  } catch {
    return {};
  }
}

/** Persist a catalog and its ETag to the per-language cache directory. */
async function writeCatalog(code: string, text: string, etag: string | null): Promise<void> {
  await mkdir(join(localesRoot(), code), { recursive: true });
  await writeFile(cachePath(code), text, 'utf8');
  await writeFile(metaPath(code), JSON.stringify({ etag } satisfies CatalogMeta), 'utf8');
}

/** Fetch the language index from GitHub `main`. Throws if offline/unreachable;
 *  the renderer falls back to its bundled manifest copy. */
export async function fetchRemoteManifest(): Promise<LocaleManifest> {
  const { text } = await httpGet(MANIFEST_URL);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? '');
  } catch {
    throw new LocaleDownloadError('Manifest is not valid JSON');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as LocaleManifest).languages)
  ) {
    throw new LocaleDownloadError('Manifest is malformed');
  }
  return parsed as LocaleManifest;
}

/** Download a language's catalog and cache it (with its ETag) for offline use. */
export async function downloadLanguage(code: string): Promise<DownloadedLocale> {
  assertValidCode(code);
  const { text, etag } = await httpGet(catalogUrl(code));
  const body = text ?? '';
  const catalog = parseCatalog(body);
  await writeCatalog(code, body, etag);
  return { code, catalog };
}

/** Every language already cached to disk, for startup hydration. */
export async function listDownloadedLanguages(): Promise<DownloadedLocale[]> {
  let entries;
  try {
    entries = await readdir(localesRoot(), { withFileTypes: true });
  } catch {
    return []; // no locales dir yet: nothing downloaded
  }
  const out: DownloadedLocale[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !CODE_RE.test(entry.name)) continue;
    try {
      const text = await readFile(cachePath(entry.name), 'utf8');
      out.push({ code: entry.name, catalog: parseCatalog(text) });
    } catch {
      // Skip an unreadable/corrupt cache entry rather than failing the whole list.
    }
  }
  return out;
}

/**
 * Re-fetch every downloaded catalog with its stored ETag and return only the
 * ones whose content actually changed on `main`. Best-effort: a language that is
 * unreachable, unchanged (304), or byte-identical is skipped, so offline or
 * up-to-date users do no work. Lets translation fixes reach existing users
 * without an app release.
 */
export async function refreshDownloadedLanguages(): Promise<DownloadedLocale[]> {
  let entries;
  try {
    entries = await readdir(localesRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  const updated: DownloadedLocale[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !CODE_RE.test(entry.name)) continue;
    const code = entry.name;
    try {
      const meta = await readMeta(code);
      const result = await httpGet(catalogUrl(code), meta.etag);
      if (result.status === 304 || result.text === null) continue;

      let oldText: string | null = null;
      try {
        oldText = await readFile(cachePath(code), 'utf8');
      } catch {
        // No readable cache: treat as changed and adopt the fetched copy.
      }
      if (oldText === result.text) {
        // Content identical (server ignored If-None-Match): just refresh the
        // ETag so the next check can short-circuit, and skip re-registering.
        await writeFile(metaPath(code), JSON.stringify({ etag: result.etag } satisfies CatalogMeta), 'utf8');
        continue;
      }
      const catalog = parseCatalog(result.text);
      await writeCatalog(code, result.text, result.etag);
      updated.push({ code, catalog });
    } catch {
      // Skip this language; a failure to refresh one must not block the others.
    }
  }
  return updated;
}
