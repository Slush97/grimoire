export interface Mod {
  id: string;
  name: string;
  fileName: string;
  path: string;
  enabled: boolean;
  priority: number;
  size: number;
  installedAt: string;
  description?: string;
  thumbnailUrl?: string;
  audioUrl?: string;
  gameBananaId?: number;
  gameBananaFileId?: number;
  categoryId?: number;
  categoryName?: string;
  sourceSection?: string;
  nsfw?: boolean;
  isArchived?: boolean;
  sha256?: string;
  isUnknown?: boolean;
  variantLabel?: string;
  fileDescription?: string;
  sourceFileName?: string;
}

export interface UnknownModFilterGuess {
  modId: string;
  fileName: string;
  crcMatch: UnknownModCrcMatchResult;
}

export interface UnknownModDetectionProgress {
  modId: string;
  requestId?: string;
  phase: 'fingerprinting' | 'cache-hit' | 'searching' | 'fetching-files' | 'indexing' | 'found' | 'caching-remaining' | 'complete' | 'cancelled' | 'error';
  message: string;
  checkedFiles?: number;
  totalFiles?: number;
  indexedEntries?: number;
  bytesFetched?: number;
  currentFileName?: string;
  bucket?: {
    section: string;
    categoryId?: number;
    categoryName?: string;
    search?: string;
    label?: string;
  };
  result?: UnknownModFilterGuess;
}

export interface UnknownModCrcMatchResult {
  status: 'found' | 'not-found' | 'error';
  modId?: number;
  modName?: string;
  thumbnailUrl?: string;
  nsfw?: boolean;
  fileId?: number;
  fileName?: string;
  section?: string;
  categoryName?: string;
  reason?: string;
}

export interface ApplyUnknownModMatchArgs {
  gameBananaId: number;
  modName: string;
  gameBananaFileId?: number;
  sourceFileName?: string;
  sourceSection?: string;
  categoryName?: string;
  thumbnailUrl?: string;
  nsfw?: boolean;
}

export interface ApplyUnknownCustomModArgs {
  name: string;
  thumbnailDataUrl?: string;
  nsfw?: boolean;
}

export interface Profile {
  id: string;
  name: string;
  mods: {
    modId: string;
    enabled: boolean;
    priority: number;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface ModConflict {
  modA: string;
  modAName: string;
  modB: string;
  modBName: string;
  modAIdentity: string;
  modBIdentity: string;
  ignoreKey: string;
  conflictType: 'priority' | 'file';
  details: string;
}

export interface AppSettings {
  deadlockPath: string | null;
  devMode: boolean;
  devDeadlockPath: string | null;
  hideNsfwPreviews: boolean;
  hideOutdatedMods: boolean;
  autoDisableSiblingVariants: boolean;
  steamLaunchOptions: string;
  activeProfileId: string | null;
  autoSaveProfile: boolean;
  experimentalStats: boolean;
  experimentalCrosshair: boolean;
  experimentalSocial: boolean;
  hasCompletedSetup: boolean;
  ignoredConflicts: string[];
  ignoreConflictsByDefault: boolean;
  /** UI accent color (hex, e.g. "#f97316"). Falls back to default orange when unset. */
  accentColor: string;
}
