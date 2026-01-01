export interface GameBananaMod {
  id: number;
  name: string;
  profileUrl: string;
  dateAdded: number;
  dateModified: number;
  likeCount: number;
  viewCount: number;
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
  let primary = files[0];
  for (const file of files) {
    if (file.downloadCount > primary.downloadCount) {
      primary = file;
    }
  }
  return primary;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString();
}
