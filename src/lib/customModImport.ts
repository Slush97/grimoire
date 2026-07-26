/**
 * Shared bits of the local (custom) mod import surfaces: the single-file dialog
 * in Installed, the batch dialog, and the "make this unknown mod custom" flow.
 */

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/** Local mod import accepts a bare VPK or an archive we extract on the main side. */
export const VPK_IMPORT_EXTS = ['vpk', 'zip', '7z', 'rar'];
export const VPK_IMPORT_RE = /\.(vpk|zip|7z|rar)$/i;

/**
 * Default mod name for a picked file: the filename with the archive/VPK
 * extension, any `pakNN_` engine prefix and the `_dir` suffix stripped, and
 * separators turned back into spaces. This is what a batch import uses unless
 * the user types over it (or an imprint peek recognizes the file).
 */
export function deriveModNameFromPath(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? '';
  return base
    .replace(/\.(zip|7z|rar)$/i, '')
    .replace(/_dir\.vpk$/i, '')
    .replace(/\.vpk$/i, '')
    .replace(/^pak\d{2}_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}
