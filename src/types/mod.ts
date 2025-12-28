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
  gameBananaId?: number;
  categoryId?: number;
  sourceSection?: string;
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
  modB: string;
  conflictingPaths: string[];
}

export interface AppSettings {
  deadlockPath: string | null;
  autoConfigureGameInfo: boolean;
  devMode: boolean;
  devDeadlockPath: string | null;
}
