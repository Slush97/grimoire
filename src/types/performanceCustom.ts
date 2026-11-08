export interface CustomPerformanceImport {
  repository: string;
  name: string;
  /** Null imports video settings without a gameinfo.gi overlay. */
  configPath: string | null;
  /** Undefined discovers a nearby video file, null explicitly skips it. */
  videoPath?: string | null;
  /** Commit selected during repository inspection. */
  commit?: string;
}

export interface PerformanceRepositoryFile {
  path: string;
  size: number;
}

export interface PerformanceRepositoryInspection {
  repository: string;
  commit: string;
  date: string;
  configPaths: string[];
  videoPaths: string[];
  addons: PerformanceRepositoryFile[];
  unsupportedPaths: string[];
}

export interface CustomPerformanceToggle {
  key: string;
  label: string;
}

export interface CustomPerformanceDetails {
  configPath: string | null;
  videoPath?: string | null;
  toggles: CustomPerformanceToggle[];
  availableConvars: Array<{ key: string; value: string }>;
  addons: Array<{ path: string; size: number }>;
  /** Import history, not a claim that the mod is still installed. */
  importedAddons?: string[];
  withheldCount: number;
}
