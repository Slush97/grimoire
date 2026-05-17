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
  fileCount: number;
  section: 'Mod' | 'Sound';
  search: string | null;
  heroName?: string;
  heroFileName?: string;
  categoryName?: string;
  confidence: 'high' | 'medium' | 'low';
  contentHints: string[];
  reasons: string[];
  detectedHeroes: Array<{
    name: string;
    fileName: string;
    score: number;
    strongestSignal: 'strong' | 'medium' | 'weak';
    clues: string[];
  }>;
  samplePaths: string[];
  crcMatch: UnknownModCrcMatchResult;
}

export interface UnknownModCrcMatchResult {
  status: 'found' | 'not-found' | 'error';
  modId?: number;
  modName?: string;
  thumbnailUrl?: string;
  nsfw?: boolean;
  fileId?: number;
  fileName?: string;
  section?: 'Mod' | 'Sound';
  categoryName?: string;
  confidence?: 'exact';
  reason?: string;
  searchedBuckets: string[];
  checkedMods: number;
  checkedFiles: number;
  bytesFetched: number;
  skipped7z: number;
  errors: string[];
}

export interface ApplyUnknownModMatchArgs {
  gameBananaId: number;
  modName: string;
  gameBananaFileId?: number;
  sourceFileName?: string;
  sourceSection?: 'Mod' | 'Sound';
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
