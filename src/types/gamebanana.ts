export interface GameBananaMod {
  id: number;
  name: string;
  profileUrl: string;
  dateAdded: number;
  dateModified: number;
  likeCount: number;
  viewCount: number;
  downloadCount?: number;
  hasFiles: boolean;
  nsfw: boolean;
  submitter?: GameBananaSubmitter;
  previewMedia?: GameBananaPreviewMedia;
  rootCategory?: GameBananaCategory;
}

export interface GameBananaSection {
  pluralTitle: string;
  modelName: string;
  categoryModelName: string;
  itemCount: number;
}

export interface GameBananaCategoryNode {
  id: number;
  name: string;
  profileUrl?: string;
  itemCount: number;
  iconUrl?: string;
  parentId?: number;
  children?: GameBananaCategoryNode[];
}

export interface GameBananaSubmitter {
  id: number;
  name: string;
  avatarUrl?: string;
}

export interface GameBananaPreviewMedia {
  images?: GameBananaImage[];
  metadata?: GameBananaPreviewMetadata;
}

export interface GameBananaPreviewMetadata {
  audioUrl?: string;
}
export interface GameBananaImage {
  baseUrl: string;
  file: string;
  file220?: string;
  file530?: string;
}

export interface GameBananaCategory {
  id?: number;
  name: string;
  modelName?: string;
  profileUrl?: string;
  iconUrl?: string;
}

export interface GameBananaModsResponse {
  records: GameBananaMod[];
  totalCount: number;
  isComplete: boolean;
  perPage: number;
}

export interface GameBananaFile {
  id: number;
  fileName: string;
  fileSize: number;
  downloadUrl: string;
  downloadCount: number;
  description?: string;
  isArchived: boolean;
}

export interface GameBananaModDetails {
  id: number;
  name: string;
  description?: string;
  nsfw: boolean;
  category?: GameBananaCategory;
  files?: GameBananaFile[];
  previewMedia?: GameBananaPreviewMedia;
}

export interface GameBananaModFileList {
  id: number;
  files: Array<{ id: number; isArchived: boolean }>;
}

export interface GameBananaComment {
  id: number;
  text: string;
  dateAdded: number;
  poster: {
    id: number;
    name: string;
    avatarUrl?: string;
  };
}

export interface GameBananaCommentsResponse {
  comments: GameBananaComment[];
  totalCount: number;
}

export interface GameBananaCollection {
  id: number;
  name: string;
  description?: string;
  dateAdded: number;
  dateModified: number;
  submitter?: GameBananaSubmitter;
  previewMedia?: GameBananaPreviewMedia;
}

export interface GameBananaCollectionItem {
  id: number;
  modelName: string;
  name: string;
  profileUrl: string;
  dateAdded: number;
  dateModified: number;
  likeCount: number;
  viewCount: number;
  hasFiles: boolean;
  nsfw: boolean;
  gameId?: number;
  gameName?: string;
  submitter?: GameBananaSubmitter;
  previewMedia?: GameBananaPreviewMedia;
  rootCategory?: GameBananaCategory;
}

export interface GameBananaCollectionItemsResponse {
  records: GameBananaCollectionItem[];
  totalCount: number;
  isComplete: boolean;
  perPage: number;
}

// Parse a collection identifier from either a numeric id or a GameBanana URL.
// Mirrored from the main-process helper so the renderer can validate input
// locally before firing an IPC call.
export function parseCollectionId(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  try {
    const url = new URL(trimmed);
    if (!url.hostname.endsWith('gamebanana.com')) return null;
    const match = url.pathname.match(/\/collections\/(\d+)/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function getModThumbnail(mod: GameBananaMod): string | undefined {
  const images = mod.previewMedia?.images;
  if (!images || images.length === 0) return undefined;

  const image = images[0];
  const file = image.file530 || image.file || image.file220;
  return `${image.baseUrl}/${file}`;
}

export function getSoundPreviewUrl(mod: GameBananaMod): string | undefined {
  return mod.previewMedia?.metadata?.audioUrl;
}

export function getPrimaryFile(files: GameBananaFile[]): GameBananaFile {
  // Prefer non-archived files: an archived legacy file can outrank a current
  // one on raw download count just because it's been around longer. Only fall
  // back to archived files when every option is archived.
  const live = files.filter((f) => !f.isArchived);
  const pool = live.length > 0 ? live : files;
  let primary = pool[0];
  for (const file of pool) {
    if (file.downloadCount > primary.downloadCount) {
      primary = file;
    }
  }
  return primary;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString();
}

// Mods updated before this date may be incompatible with the current game version
export const MOD_SAFETY_CUTOFF = Math.floor(new Date('2026-01-22T00:00:00Z').getTime() / 1000);

export function isModOutdated(dateModified: number): boolean {
  return dateModified < MOD_SAFETY_CUTOFF;
}
