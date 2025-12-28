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
}
