import { createHash } from 'crypto';
import type { CustomPerformanceToggle } from '../../../src/types/performanceCustom';
import type { PerformancePresetSummary } from '../../../src/types/electron';
import type { PerformancePresetFamily } from './performanceConfigData';
import { buildLatestRelease, latestAsPreset, type BuildLatestInput } from './performanceLatestCore';

export function parsePerformanceRepository(input: string): string {
    const repo = input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(repo) || /\/\.{1,2}$/.test(repo)) {
        throw new Error('Use a GitHub repository URL or owner/repository.');
    }
    return repo;
}

export function validatePerformancePath(path: string): string {
    if (!path || path.length > 500 || path.split('/').some((part) => !part || part === '.' || part === '..') || /[\\?#]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32)) {
        throw new Error('Use a relative file path within the repository.');
    }
    return path;
}

export interface CustomPerformanceRecord {
    id: string;
    name: string;
    repo: string;
    configPath: string | null;
    videoPath?: string | null;
    input: BuildLatestInput;
    toggles: CustomPerformanceToggle[];
    addons: Array<{ path: string; size: number }>;
    importedAddons?: string[];
}

/** Some authors publish only the ConVars block as gameinfo.txt for pasting
 * into the stock file. Give that explicit block a root, then run the same gates. */
export function normalizeCustomGameinfo(text: string): string {
    const withoutComments = text.replace(/\/\/[^\r\n]*/g, '').trimStart();
    return /^"?ConVars"?\s*\{/.test(withoutComments) ? `"GameInfo"\n{\n${text}\n}\n` : text;
}

function familyFor(record: CustomPerformanceRecord): PerformancePresetFamily {
    return {
        id: record.id, name: record.name, tier: 'balanced', author: record.repo.split('/')[0],
        upstream: { repo: record.repo, url: `https://github.com/${record.repo}`, path: record.configPath ?? record.videoPath ?? '', license: '', credit: record.repo },
        releases: [],
    };
}

/** Rebuild from original texts under today's safety rules, even offline. Custom
 * sources contribute convars and render settings only, never structural edits. */
export function buildCustomPerformancePreset(record: CustomPerformanceRecord) {
    const family = familyFor(record);
    const built = buildLatestRelease({ ...record.input, configText: normalizeCustomGameinfo(record.input.configText), now: new Date(record.input.now) }, family);
    if (!built.ok) throw new Error(built.error);
    const release = built.release;
    release.sectionOps = [];
    for (const [key, value] of [...release.convars, ...(release.video ?? []), ...release.optIn.map((o) => [o.key, o.value])]) {
        if (!/^[a-zA-Z0-9_]+$/.test(key) || value.length > 512 || /["\r\n{};]/.test(value)) {
            throw new Error(`Unsupported config value: ${key}`);
        }
    }
    // Public, user-selected repositories are not curated upstreams. Accept
    // scalar settings only, and never expose console commands as toggles.
    const scalar = /^(?:true|false|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)$/i;
    const command = /^(?:exec.*|alias|bind.*|unbind.*|connect|disconnect|quit|exit|write.*|log|toggle|incrementvar)$/i;
    const keep = (key: string, value: string) => {
        if (key === key.toLowerCase() && scalar.test(value) && !command.test(key)) return true;
        release.withheld.push(key);
        return false;
    };
    release.convars = release.convars.filter(([key, value]) => keep(key, value));
    release.optIn = release.optIn.filter(({ key, value }) => keep(key, value));
    release.video = release.video?.filter(([key, value]) => keep(key, value));
    // video.txt is loaded after gameinfo.gi. A convar toggle cannot control a
    // value that this same preset supplies again through its video file.
    const videoKeys = new Set(release.video?.map(([key]) => key));
    const availableConvars = release.convars.filter(([key]) => !videoKeys.has(key)).map(([key, value]) => ({ key, value }));
    const availableKeys = new Set(availableConvars.map((entry) => entry.key));
    // A later classification update may withhold a formerly selectable key.
    const toggles = validatePerformanceToggles(record.toggles.filter((toggle) => availableKeys.has(toggle.key)), availableConvars);
    const optional = new Set(toggles.map((toggle) => toggle.key));
    release.optIn.push(...release.convars.filter(([key]) => optional.has(key)).map(([key, value]) => ({ key, value, group: 'visibility' })));
    release.convars = release.convars.filter(([key]) => !optional.has(key));
    // A schema edit changes the definition even though the upstream commit stays.
    release.version += '.' + createHash('sha256').update(JSON.stringify(toggles)).digest('hex').slice(0,8);
    const preset = latestAsPreset(release, family);
    const summary: PerformancePresetSummary = {
        id: preset.id, name: preset.name, tier: preset.tier, author: preset.author,
        version: preset.version, unstable: false, isDefault: false,
        settingCount: preset.convars.length, upstream: preset.upstream, optIn: preset.optIn,
        versions: [{
            version: preset.version, ref: release.ref, refKind: release.refKind,
            commit: release.commit, date: release.date, settingCount: preset.convars.length,
            videoSettingCount: preset.video.length, optIn: preset.optIn,
        }],
        custom: { configPath: record.configPath, videoPath: record.videoPath, toggles, availableConvars, addons: record.addons, importedAddons: record.importedAddons ?? [], withheldCount: release.withheld.length },
    };
    return { preset, summary };
}

export function validatePerformanceToggles(toggles: CustomPerformanceToggle[], available: Array<{ key: string }>): CustomPerformanceToggle[] {
    if (!Array.isArray(toggles) || toggles.length > 100) throw new Error('Too many toggles.');
    const keys = new Set(available.map((entry) => entry.key));
    const seen = new Set<string>();
    return toggles.map((toggle) => {
        if (!toggle || !keys.has(toggle.key) || seen.has(toggle.key) || typeof toggle.label !== 'string' || !toggle.label.trim() || toggle.label.length > 100) {
            throw new Error('Each toggle needs a unique imported convar and a label.');
        }
        seen.add(toggle.key);
        return { key: toggle.key, label: toggle.label.trim() };
    });
}
