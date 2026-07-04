/**
 * The vpk-modinfo v1 record: the machine-readable identity document embedded
 * as a root-level `modinfo.json` inside every imprinted VPK (alongside the
 * human-readable `addoninfo.txt`). Types live here, in the shared wire-type
 * layer, because both the main-process format module (serializer/parser in
 * electron/main/services/modinfoFormat.ts) and the renderer (the View imprint
 * modal receives the parsed record over IPC) consume them.
 *
 * KEYSTONE: `identity` is the ORIGINAL pre-first-imprint whole-file identity.
 * It is carried forward verbatim on every re-imprint and never re-derived
 * from post-imprint bytes.
 */

/** `format` discriminator stamped into every modinfo.json. */
export const MODINFO_FORMAT = 'vpk-modinfo';

/** Current modinfo.json schema version. Bump on any shape change. */
export const MODINFO_SCHEMA_VERSION = 1;

/** The original (pre-first-imprint) whole-file identity anchor. */
export interface ModinfoIdentity {
  /** 64-hex original whole-file sha256, lowercased. */
  sha256: string;
  /** Original whole-file byte length. */
  size?: number;
  /** 8-hex original whole-file CRC-32, lowercased. */
  crc32?: string;
}

/** Tool provenance: what wrote this record. */
export interface ModinfoWrittenBy {
  tool: string;
  version: string;
}

/** The game this mod targets. */
export interface ModinfoGame {
  name: string;
  steamAppId: number;
  gameBananaGameId: number;
}

/** Where a single mod came from (absent for local mods). */
export interface ModinfoSource {
  gamebananaId?: number;
  gamebananaFileId?: number;
  url?: string;
  section?: string;
  categoryId?: number;
  categoryName?: string;
}

/** How this particular VPK sits inside a multi-VPK download. */
export interface ModinfoPackaging {
  vpkIndex?: number;
  variantLabel?: string;
}

/** One source of a merge, as recorded at merge time. */
export interface ModinfoMergeSource {
  title: string;
  /** The source's own original identity (sha256 may be absent for sources
   *  whose hash was never captured). */
  identity: { sha256?: string };
  gamebananaId?: number;
  gamebananaFileId?: number;
  section?: string;
  priorityAtMergeTime: number;
  enabledAtMergeTime: boolean;
  fileNameAtMergeTime: string;
  vpkIndex?: number;
}

/** Fields shared by both record kinds. */
interface ModinfoCommon {
  format: typeof MODINFO_FORMAT;
  schemaVersion: typeof MODINFO_SCHEMA_VERSION;
  writtenBy: ModinfoWrittenBy;
  /** When THIS record was written (refreshed on every re-imprint). */
  writtenAt: string;
  /** When the file was FIRST imprinted (carried forward on re-imprint). */
  firstImprintedAt: string;
  game: ModinfoGame;
  /** KEYSTONE anchor: the original pre-first-imprint identity. */
  identity: ModinfoIdentity;
  title: string;
  author?: string;
  description?: string;
  source?: ModinfoSource;
  packaging?: ModinfoPackaging;
}

/** A single imprinted mod. */
export interface ModinfoModRecord extends ModinfoCommon {
  kind: 'mod';
}

/** A Grimoire merge: carries the reconstructed source list. */
export interface ModinfoMergeRecord extends ModinfoCommon {
  kind: 'merge';
  merge: { title: string };
  sources: ModinfoMergeSource[];
}

/** The complete machine record, discriminated on `kind`. */
export type ModinfoRecord = ModinfoModRecord | ModinfoMergeRecord;
