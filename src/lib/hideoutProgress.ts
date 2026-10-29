/** How far the room's first load has come by each of HideoutScene's load marks, from the measured
 *  warm breakdown in docs/hideout-viewer.md (about 4 s to the room frame; GPU programs link last). */
const ROOM_STAGE_END: Readonly<Record<string, number>> = {
  reflectionReady: 0.25, probesDecoded: 0.25, lightmapDecoded: 0.25, lightmapMasksDecoded: 0.25, skyDecoded: 0.25,
  bundleFetched: 0.3, bundleParsed: 0.55, instancesReady: 0.58, materialsReady: 0.6, compiled: 0.9,
};

/** A cache build is about 35 s of exporting, and the room then loads for about 9 s. */
const BUILD_SHARE = 0.8;

export function roomStageProgress(stage: string): number {
  return ROOM_STAGE_END[stage] ?? 0;
}

/** The whole wait for a first hideout, from 0 to 1: the cache build when one runs or ran, then the
 *  room's load. Null while a build runs without reporting, so the bar shows no fake position. */
export function hideoutWarmingProgress({ building, built, build, room }: { building: boolean; built: boolean; build: number | null; room: number }): number | null {
  if (building) return build === null ? null : BUILD_SHARE * build;
  return built ? BUILD_SHARE + (1 - BUILD_SHARE) * room : room;
}
