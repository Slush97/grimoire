// Reads game resources through a mounted package stack, highest priority first (the selected skin
// stack, then citadel, then core), and decodes their KV3 with the bundled vpkmerge. Node only, no
// Electron: the vpkmerge runner is supplied, so the main process and the dev scripts share this.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { KVObject } from '../../../src/lib/particles/kv';
import { readVpkEntryBytes, vpkHasEntry } from './vpk';

export interface VpkmergeRunner {
    /** Runs vpkmerge and resolves with its standard output. */
    stdout(args: string[]): Promise<string>;
}

/** The most bytes one resource read may return. */
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

export class PackageStack {
    readonly packages: readonly string[];
    private readonly vpkmerge: VpkmergeRunner;
    private readonly scratchDir: string;
    private formatSupport: Promise<boolean> | null = null;
    private mipSupport: Promise<boolean> | null = null;
    private looseCounter = 0;
    private readonly looseId = randomUUID();

    constructor(packages: readonly string[], vpkmerge: VpkmergeRunner, scratchDir: string) {
        this.packages = [...new Set(packages)];
        this.vpkmerge = vpkmerge;
        this.scratchDir = scratchDir;
    }

    /** The highest priority package holding `entry`, or null. */
    owner(entry: string): string | null {
        return this.packages.find((vpk) => vpkHasEntry(vpk, entry)) ?? null;
    }

    read(entry: string): Buffer | null {
        const owner = this.owner(entry);
        const bytes = owner ? readVpkEntryBytes(owner, entry) : null;
        if (bytes && bytes.length > MAX_ENTRY_BYTES) throw new Error(`${entry} exceeds preview limits.`);
        return bytes;
    }

    /** The KV3 DATA block of `entry` as JSON, or null when no package has it. */
    async decode(entry: string): Promise<KVObject | null> {
        const owner = this.owner(entry);
        return owner ? JSON.parse(await this.vpkmerge.stdout(['soundevents', entry, '--from-vpk', owner])) as KVObject : null;
    }

    /** Whether the bundled vpkmerge reports a resource's stored KV3 format (`soundevents --with-format`). */
    supportsFormat(): Promise<boolean> {
        this.formatSupport ??= this.vpkmerge.stdout(['soundevents', '--help']).then((help) => help.includes('--with-format'), () => false);
        return this.formatSupport;
    }

    /** Whether the bundled vpkmerge exports every stored texture mip (`panorama dump --mips`). */
    supportsMips(): Promise<boolean> {
        this.mipSupport ??= this.vpkmerge.stdout(['panorama', 'dump', '--help']).then((help) => help.includes('--mips'), () => false);
        return this.mipSupport;
    }

    /** The DATA block of `entry` and its stored KV3 format name (null when unknown or unsupported). */
    async decodeWithFormat(entry: string): Promise<{ data: KVObject; format: string | null } | null> {
        const owner = this.owner(entry);
        if (!owner) return null;
        if (!(await this.supportsFormat())) {
            return { data: JSON.parse(await this.vpkmerge.stdout(['soundevents', entry, '--from-vpk', owner])) as KVObject, format: null };
        }
        const wrapped = JSON.parse(await this.vpkmerge.stdout(['soundevents', entry, '--from-vpk', owner, '--with-format'])) as {
            format?: { name?: string | null };
            data: KVObject;
        };
        return { data: wrapped.data, format: typeof wrapped.format?.name === 'string' ? wrapped.format.name : null };
    }

    /** Decodes a loose single-block resource (a block of a larger resource re-wrapped as DATA). */
    async decodeLoose(resource: Buffer): Promise<KVObject> {
        await fs.mkdir(this.scratchDir, { recursive: true });
        const file = join(this.scratchDir, `block-${this.looseId}-${this.looseCounter++}.vsndevts_c`);
        await fs.writeFile(file, resource);
        try {
            return JSON.parse(await this.vpkmerge.stdout(['soundevents', file])) as KVObject;
        } finally {
            await fs.rm(file, { force: true });
        }
    }
}
