/** Local diagnostic hints only. These never grant or restrict mod permissions. */
export interface CrashAdvisory {
  id: string;
  modId: string;
  modName: string;
  entry: string;
  error: string;
  crashedAt: number;
  gameBuild: string;
  attribution: 'recorded' | 'last-known';
  enabled: boolean;
}
