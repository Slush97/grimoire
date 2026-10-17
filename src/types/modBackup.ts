/** A byte-for-byte backup of one installed VPK and any split archive chunks. */
export interface ModBackupSummary {
  id: string;
  createdAt: number;
  expiresAt: number;
  fileName: string;
  /** Original archive VPK name when known; fileName remains the stored basename. */
  displayFileName?: string;
  description?: string;
  modName: string;
  identityKey: string;
  gameBananaId?: number;
  sourceSection?: string;
  localGroupId?: string;
  sha256?: string;
}
