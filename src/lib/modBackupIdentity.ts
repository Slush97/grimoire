/** Associate backups with their installed mod independently of its current slot. */
export function getModBackupIdentity(
  metadata: {
    localGroupId?: string;
    gameBananaId?: number;
    sourceSection?: string;
    modName?: string;
  } | undefined,
  fileName: string,
  modName?: string,
): string {
  if (metadata?.localGroupId) return `local:${metadata.localGroupId}`;
  if (metadata?.gameBananaId) return `gamebanana:${metadata.sourceSection ?? 'Mod'}:${metadata.gameBananaId}`;
  return `name:${metadata?.modName || modName || fileName}`;
}
