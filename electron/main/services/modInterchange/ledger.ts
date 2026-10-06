/**
 * Import ledger (spec rule 6): which document key became which mod, and which
 * document profile became which Grimoire profile, per source manager.
 *
 * Mods are remembered by content hash (the sidecar's canonical sha256), not by
 * file name: an import reorders slots, so a file name recorded today names
 * another mod tomorrow, and so do the source manager's own records. Hashes
 * survive slot moves and a later GameBanana link of a local mod.
 *
 * Lives in userData as `interchange-ledger.json`. A missing or unreadable file
 * only means every entry is treated as new, as before the ledger existed.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { getUserDataPath } from '../../utils/paths';

export interface LedgerModRecord {
  /** Hashes of every VPK the entry became, loaded or kept as a variant. */
  sha256: string[];
  /** The subset a profile turns on when it enables this entry. */
  loaded: string[];
}

interface LedgerSource {
  mods: Record<string, LedgerModRecord>;
  /** Document profile key -> Grimoire profile id. */
  profiles: Record<string, string>;
}

interface LedgerFile {
  version: 1;
  sources: Record<string, LedgerSource>;
}

function ledgerPath(): string {
  return join(getUserDataPath(), 'interchange-ledger.json');
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hashList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string' && !!h).map((h) => h.toLowerCase()) : [];

function loadLedger(): LedgerFile {
  const empty: LedgerFile = { version: 1, sources: {} };
  try {
    if (!existsSync(ledgerPath())) return empty;
    const raw = JSON.parse(readFileSync(ledgerPath(), 'utf-8')) as unknown;
    if (!isObject(raw) || !isObject(raw.sources)) return empty;
    const sources: Record<string, LedgerSource> = {};
    for (const [manager, value] of Object.entries(raw.sources)) {
      if (!isObject(value)) continue;
      const mods: Record<string, LedgerModRecord> = {};
      for (const [key, record] of Object.entries(isObject(value.mods) ? value.mods : {})) {
        if (!isObject(record)) continue;
        const sha256 = hashList(record.sha256);
        if (sha256.length > 0) mods[key] = { sha256, loaded: hashList(record.loaded) };
      }
      const profiles: Record<string, string> = {};
      for (const [key, id] of Object.entries(isObject(value.profiles) ? value.profiles : {})) {
        if (typeof id === 'string' && id) profiles[key] = id;
      }
      sources[manager] = { mods, profiles };
    }
    return { version: 1, sources };
  } catch (err) {
    console.warn('[Interchange] import ledger unreadable, treating every entry as new:', err);
    return empty;
  }
}

function saveLedger(ledger: LedgerFile): void {
  const path = ledgerPath();
  const tempPath = `${path}.tmp`;
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(ledger, null, 2), 'utf-8');
    renameSync(tempPath, path);
  } catch (err) {
    // A lost ledger write only costs the next re-import its memory.
    console.warn('[Interchange] could not save the import ledger:', err);
  }
}

function sourceOf(ledger: LedgerFile, manager: string): LedgerSource {
  ledger.sources[manager] ??= { mods: {}, profiles: {} };
  return ledger.sources[manager];
}

export function ledgerModsFor(manager: string): Record<string, LedgerModRecord> {
  return loadLedger().sources[manager]?.mods ?? {};
}

export function recordLedgerMods(manager: string, mods: Record<string, LedgerModRecord>): void {
  if (Object.keys(mods).length === 0) return;
  const ledger = loadLedger();
  Object.assign(sourceOf(ledger, manager).mods, mods);
  saveLedger(ledger);
}

export function ledgerProfileId(manager: string, profileKey: string): string | undefined {
  return loadLedger().sources[manager]?.profiles[profileKey];
}

export function recordLedgerProfile(manager: string, profileKey: string, profileId: string): void {
  const ledger = loadLedger();
  sourceOf(ledger, manager).profiles[profileKey] = profileId;
  saveLedger(ledger);
}
