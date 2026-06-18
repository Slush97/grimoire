import type { HeroPoseAuthoringMap } from '../../../src/types/portrait';

/**
 * AUTO-MANAGED per-hero pose/camera framing for baked 3D Locker card snapshots.
 *
 * Authored through the in-app dev pose-authoring tool (the "Commit" action calls
 * writeHeroPoseAuthoringEntry, which regenerates this file via app.getAppPath()).
 * Do NOT hand-edit: the writeback rewrites the whole map with JSON formatting.
 *
 * Heroes absent from this map fall back to the pipeline defaults (default
 * menu/idle pose + DEFAULT_CAMERA_FRAMING). Shipping is just committing this
 * file; the loader bundles it and overlays any in-session dev edits.
 */
export const HERO_POSE_AUTHORING: HeroPoseAuthoringMap = {};
