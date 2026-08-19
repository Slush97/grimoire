/**
 * Shared bits of the local (custom) mod import surfaces: the single-file dialog
 * in Installed, the batch dialog, and the "make this unknown mod custom" flow.
 */

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/** Local mod import accepts a bare VPK or an archive we extract on the main side. */
export const VPK_IMPORT_EXTS = ['vpk', 'zip', '7z', 'rar'];
export const VPK_IMPORT_RE = /\.(vpk|zip|7z|rar)$/i;

/** The filename part of a path, for either separator style. */
export function fileNameOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/**
 * Dedupe key for a picked file. Windows paths are case-insensitive, so the same
 * file arriving from the open dialog and from a drop (which can differ in drive
 * letter or folder casing) must collapse to one row instead of importing twice.
 * POSIX paths are case-sensitive, so they are compared as-is.
 */
export function pathDedupeKey(p: string, platform: string): string {
  return platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * Default mod name for a picked file: the filename with the archive/VPK
 * extension, any `pakNN_` engine prefix and the `_dir` suffix stripped, and
 * separators turned back into spaces. This is what a batch import uses unless
 * the user types over it (or an imprint peek recognizes the file).
 *
 * `_dir` is stripped after any extension, not just `.vpk`, so a zipped
 * `foo_dir.zip` names itself "foo" rather than "foo dir". The pak prefix allows
 * three digits because overflow folders number past 99.
 */
export function deriveModNameFromPath(p: string): string {
  return fileNameOf(p)
    .replace(/\.(zip|7z|rar|vpk)$/i, '')
    .replace(/_dir$/i, '')
    .replace(/^pak\d{2,3}_/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/** Filename/folder fallback shown for one member of a local variant group. */
export function deriveVariantLabel(value: string): string {
  return fileNameOf(value)
    .replace(/\.(zip|7z|rar|vpk)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Resolve a user-entered source label into per-VPK labels. A bare VPK gets the
 * exact requested name. If an archive expands into several VPKs, retain each
 * member's honest folder/filename label beneath the requested source prefix so
 * the picker never ends up with several indistinguishable rows.
 */
export function resolveImportedVariantLabel(
  requestedLabel: string | undefined,
  variantSeed: string | undefined,
  memberCount: number,
  memberIndex: number,
): string | undefined {
  const requested = requestedLabel?.trim();
  const fallback = variantSeed ? deriveVariantLabel(variantSeed) : undefined;
  if (!requested) return fallback;
  if (memberCount <= 1) return requested;
  return `${requested} — ${fallback || `Variant ${memberIndex + 1}`}`;
}
