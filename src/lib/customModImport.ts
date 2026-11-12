/**
 * Shared bits of the local (custom) mod import surfaces: the single-file dialog
 * in Installed, the batch dialog, and the "make this unknown mod custom" flow.
 */

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/** Local mod import accepts a bare VPK or an archive we extract on the main side. */
export const VPK_IMPORT_EXTS = ['vpk', 'zip', '7z', 'rar'];
export const VPK_IMPORT_RE = /\.(vpk|zip|7z|rar)$/i;

/** Outcome of classifying an external file drop against the supported mod types. */
export interface DroppedModFiles {
  /** Disk paths of supported files, in the order they were dropped. */
  paths: string[];
  /** Names of files whose extension we do not import. */
  rejectedNames: string[];
  /** Supported files with no on-disk path (see `classifyDroppedModFiles`). */
  unresolvedCount: number;
}

/**
 * Split a dropped file list into importable paths, unsupported names, and files
 * that resolve to no path at all. The path resolver is injected so this stays a
 * pure function the app-wide drop controller and the import modal can share.
 *
 * An empty resolved path is almost always a file dragged out of Windows' built-in
 * zip viewer (a virtual shell file with nothing behind it), which is why those are
 * counted separately: the caller tells the user to drag the archive instead.
 */
export function classifyDroppedModFiles(
  files: readonly File[],
  getPathForFile: (file: File) => string,
): DroppedModFiles {
  const paths: string[] = [];
  const rejectedNames: string[] = [];
  let unresolvedCount = 0;

  for (const file of files) {
    if (!VPK_IMPORT_RE.test(file.name)) {
      rejectedNames.push(file.name);
      continue;
    }
    const path = getPathForFile(file);
    if (path) paths.push(path);
    else unresolvedCount++;
  }

  return { paths, rejectedNames, unresolvedCount };
}

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

/** What a file's imprint says about its name. */
export interface ImprintNaming {
  title?: string;
  gamebananaId?: number;
  /** The label the imprint recorded for this file among its mod's files. */
  variantLabel?: string;
}

const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The label an imprint gives one member of a variant group. The title is the
 * label when it tells the member apart: no other member carries it and it is
 * not the group's own name. Files of one mod share a title, so those use the
 * variant label the imprint recorded. `peers` is the whole group, member included.
 */
export function imprintVariantLabel(
  member: ImprintNaming | null | undefined,
  peers: readonly (ImprintNaming | null | undefined)[],
  groupName: string,
): string | undefined {
  const title = member?.title?.trim();
  if (
    title &&
    !sameText(title, groupName) &&
    peers.filter((peer) => peer?.title && sameText(peer.title, title)).length <= 1
  ) {
    return title;
  }
  return member?.variantLabel?.trim() || undefined;
}

/**
 * Name offered for a new variant group in the import dialog. Empty when the
 * rows' imprints name different mods: borrowing one member's name would title
 * the whole card after a single file inside it.
 */
export function suggestVariantGroupName(
  rows: readonly { name: string; imprintTitle?: string }[],
): string {
  const titles = new Set(
    rows.map((row) => row.imprintTitle?.trim().toLowerCase()).filter((title) => !!title),
  );
  return titles.size > 1 ? '' : (rows[0]?.name.trim() ?? '');
}

/**
 * Resolve a user-entered source label into per-VPK labels. A bare VPK gets the
 * exact requested name. If an archive expands into several VPKs, retain each
 * member's honest label beneath the requested source prefix so the picker never
 * ends up with several indistinguishable rows. That label is the imprint's when
 * there is one, else the member's folder or file name.
 */
export function resolveImportedVariantLabel(
  requestedLabel: string | undefined,
  variantSeed: string | undefined,
  memberCount: number,
  memberIndex: number,
  imprintLabel?: string,
): string | undefined {
  const requested = requestedLabel?.trim();
  const fallback = imprintLabel || (variantSeed ? deriveVariantLabel(variantSeed) : undefined);
  if (!requested) return fallback;
  if (memberCount <= 1) return requested;
  return `${requested}: ${fallback || `Variant ${memberIndex + 1}`}`;
}

/** One VPK of an import source: a bare file, or one member of an archive. */
export interface LocalImportMember {
  /** The member's folder inside the archive, else its file name stem. */
  seed?: string;
  imprint?: ImprintNaming | null;
}

export interface PlannedLocalImport {
  modName: string;
  localGroupId?: string;
  variantLabel?: string;
}

function imprintIdentity(imprint: ImprintNaming | null | undefined): string | undefined {
  if (imprint?.gamebananaId) return `gamebanana:${imprint.gamebananaId}`;
  const title = imprint?.title?.trim().toLowerCase();
  return title ? `title:${title}` : undefined;
}

/**
 * Decide what each VPK of one import source becomes.
 *
 * A source normally is one mod: several VPKs are its variants and share `name`.
 * An archive whose imprints name different mods is a pack instead, so each
 * member becomes its own mod under its imprint's title. Members of a pack that
 * carry the same imprint still group, and a member without an imprint keeps the
 * typed name with its file label. An import addressed to an existing group
 * (`joinGroupId`) always joins it: the user asked for one card.
 */
export function planLocalImport(
  members: readonly LocalImportMember[],
  name: string,
  requestedLabel: string | undefined,
  joinGroupId: string | undefined,
  mintGroupId: () => string,
): PlannedLocalImport[] {
  const imprints = members.map((member) => member.imprint ?? null);
  const identities = imprints.map(imprintIdentity);
  const isPack = !joinGroupId && new Set(identities.filter((id) => !!id)).size > 1;

  if (!isPack) {
    const localGroupId = joinGroupId || (members.length > 1 ? mintGroupId() : undefined);
    return members.map((member, index) => ({
      modName: name,
      localGroupId,
      // Ungrouped imports get no label: the card title already says everything
      // about a standalone mod.
      variantLabel: localGroupId
        ? resolveImportedVariantLabel(
            requestedLabel,
            member.seed,
            members.length,
            index,
            imprintVariantLabel(member.imprint, imprints, name),
          )
        : undefined,
    }));
  }

  const groups = new Map<string, { name: string; localGroupId: string }>();
  return members.map((member, index) => {
    const fileLabel = member.seed ? deriveVariantLabel(member.seed) : `Variant ${index + 1}`;
    const identity = identities[index];
    if (!identity) return { modName: `${name}: ${fileLabel}` };

    const peers = imprints.filter((_, peer) => identities[peer] === identity);
    const title = peers.find((peer) => peer?.title?.trim())?.title?.trim() || `${name}: ${fileLabel}`;
    if (peers.length === 1) return { modName: title };

    let group = groups.get(identity);
    if (!group) {
      group = { name: title, localGroupId: mintGroupId() };
      groups.set(identity, group);
    }
    return {
      modName: group.name,
      localGroupId: group.localGroupId,
      variantLabel: imprintVariantLabel(member.imprint, peers, group.name) || fileLabel,
    };
  });
}
