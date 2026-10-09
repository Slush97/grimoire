import { describe, expect, it, vi } from 'vitest';
import { NsisUpdater } from 'electron-updater/out/NsisUpdater';
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor';

const nightly = '1.31.1-nightly.20261009123000.42.gabcdef0';
const newerNightly = '1.31.1-nightly.20261009123100.43.gabcdef1';
const stable = '1.31.0';
const feed = `<feed>${['1.40.0-beta.1', stable, newerNightly, nightly].map(version =>
    `<entry><title>${version}</title><link href="https://github.com/Slush97/grimoire/releases/tag/v${version}"/><content>Notes for ${version}</content></entry>`,
).join('')}</feed>`;

function setup(version: string, channel: 'stable' | 'nightly', platform: 'win32' | 'linux' | 'darwin' = 'win32') {
    const updater = new NsisUpdater(null, {
        version, name: 'Grimoire', isPackaged: true,
        appUpdateConfigPath: '', userDataPath: '', baseCachePath: '',
        whenReady: async () => {}, relaunch: vi.fn(), quit: vi.fn(), onQuit: vi.fn(),
    });
    updater.logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    updater.channel = channel === 'nightly' ? 'nightly' : 'latest';
    updater.allowPrerelease = channel === 'nightly';
    updater.allowDowngrade = channel === 'stable' && version.includes('-nightly.');
    updater.autoDownload = false;
    updater.isUserWithinRollout = () => true;
    const executor = new ElectronHttpExecutor();
    const requests: string[] = [];
    vi.spyOn(executor, 'request').mockImplementation(async options => {
        const path = options.path ?? '';
        requests.push(path);
        if (path.endsWith('.atom')) return feed;
        if (path.endsWith('/latest')) return JSON.stringify({ tag_name: `v${stable}` });
        const target = channel === 'nightly' ? newerNightly : stable;
        return `version: ${target}\nfiles:\n  - url: Grimoire-Setup-${target}.exe\n    sha512: test\nreleaseDate: '2026-10-09'\n`;
    });
    const provider = new GitHubProvider({ provider: 'github', owner: 'Slush97', repo: 'grimoire' }, updater, {
        platform, executor, isUseMultipleRangeRequest: false,
    });
    // Exercise the real version comparison and GitHub release selection while
    // replacing only HTTP and the staging-id cache, without disk or network I/O.
    Object.assign(updater, {
        clientPromise: Promise.resolve(provider),
        stagingUserIdPromise: { value: Promise.resolve('00000000-0000-4000-8000-000000000000') },
    });
    return { updater, provider, requests };
}

describe('electron-updater GitHub channel integration', () => {
    it.each([
        ['win32', 'nightly.yml'], ['linux', 'nightly-linux.yml'], ['darwin', 'nightly-mac.yml'],
    ] as const)('stable users can receive the newest nightly on %s', async (platform, file) => {
        const { updater, requests } = setup(stable, 'nightly', platform);
        const result = await updater.checkForUpdates();
        expect(result?.isUpdateAvailable).toBe(true);
        expect(result?.updateInfo.version).toBe(newerNightly);
        expect(requests.at(-1)).toBe(`/Slush97/grimoire/releases/download/v${newerNightly}/${file}`);
    });

    it('stable ignores prereleases even when they are first in the release feed', async () => {
        const { updater, requests } = setup(stable, 'stable');
        const result = await updater.checkForUpdates();
        expect(result?.isUpdateAvailable).toBe(false);
        expect(requests.at(-1)).toBe(`/Slush97/grimoire/releases/download/v${stable}/latest.yml`);
    });

    it('offers an older stable installer when an installed nightly opts out', async () => {
        const { updater, requests } = setup(newerNightly, 'stable');
        const result = await updater.checkForUpdates();
        expect(result?.isUpdateAvailable).toBe(true);
        expect(result?.updateInfo.version).toBe(stable);
        expect(requests.at(-1)).toBe(`/Slush97/grimoire/releases/download/v${stable}/latest.yml`);
    });

    it('does not downgrade a nightly if a stale release is published later', async () => {
        const { updater } = setup('1.31.1-nightly.20261009123200.44.gabcdef2', 'nightly');
        expect((await updater.checkForUpdates())?.isUpdateAvailable).toBe(false);
    });
});
