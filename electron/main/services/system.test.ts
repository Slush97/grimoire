import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fixGameinfo, getGameinfoStatus } from './system';
import { findSearchPathsBlock, hasActivePath } from './gameinfoSearchPaths';

vi.mock('./replayFolder', () => ({ ensureReplayFolderLink: vi.fn() }));

const roots: string[] = [];
const stock = readFileSync(new URL('./__fixtures__/stock-gameinfo.gi', import.meta.url), 'utf8');
const legacyBody = `
    Game citadel/grimoire
    Game citadel/addons
    Mod citadel
    Write citadel
    Game citadel
    Write core
    Mod core
    Game core
    AddonRoot citadel_addons
    OfficialAddonRoot citadel_community_addons
`;

function config(body: string): string {
    return `"GameInfo"\n{\n    "FileSystem"\n    {\n        "SearchPaths"\n        {${body}}\n    }\n    ConVars { fps_max 144 }\n}\n`;
}

function install(content: string) {
    const root = mkdtempSync(join(tmpdir(), 'grimoire-gameinfo-'));
    roots.push(root);
    const citadel = join(root, 'game', 'citadel');
    mkdirSync(citadel, { recursive: true });
    const path = join(citadel, 'gameinfo.gi');
    writeFileSync(path, content);
    return { root, citadel, path, read: () => readFileSync(path, 'utf8') };
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('gameinfo search-path repair', () => {
    it.each(['Game_Language', 'Game_UILanguage'])('preserves stock %s mounts when enabling mods', (key) => {
        const original = stock.replace('Game_Language', key);
        const game = install(original);
        expect(getGameinfoStatus(game.root).configured).toBe(false);
        expect(fixGameinfo(game.root).configured).toBe(true);
        const repaired = game.read();
        const before = findSearchPathsBlock(original)!;
        const after = findSearchPathsBlock(repaired)!;
        expect(repaired.slice(0, after.start)).toBe(original.slice(0, before.start));
        expect(repaired.slice(after.end)).toBe(original.slice(before.end));
        expect(after.body).toContain(before.body);
        expect(hasActivePath(after.body, 'citadel_*LANGUAGE*', key)).toBe(true);
        expect(hasActivePath(after.body, 'citadel_*LANGUAGE*', 'Game_UILanguage')).toBe(true);
        expect(after.body.indexOf('citadel/grimoire')).toBeLessThan(after.body.indexOf('citadel/addons'));
        expect(after.body.indexOf('citadel/addons')).toBeLessThan(after.body.indexOf('citadel_*LANGUAGE*'));
        expect(after.body.indexOf('citadel_*LANGUAGE*')).toBeLessThan(after.body.indexOf('Game "citadel"'));
        expect(readFileSync(`${game.path}.grimoire-bak`, 'utf8')).toBe(original);
    });

    it.each(['\n', '\r\n'])('detects and repairs a previously configured install (%j)', (eol) => {
        const original = config(legacyBody).replace(/\r?\n/g, eol);
        const game = install(original);
        expect(getGameinfoStatus(game.root)).toMatchObject({ configured: false, reason: 'mods-not-loaded' });
        expect(fixGameinfo(game.root).configured).toBe(true);
        const repaired = game.read();
        const body = findSearchPathsBlock(repaired)!.body;
        expect(hasActivePath(body, 'citadel_*LANGUAGE*', 'Game_UILanguage')).toBe(true);
        expect(hasActivePath(body, 'citadel_lv', 'Game_LowViolence')).toBe(true);
        expect(body.indexOf('Game_UILanguage')).toBeLessThan(body.indexOf('Game citadel\n') >= 0
            ? body.indexOf('Game citadel\n') : body.indexOf('Game citadel\r\n'));
        expect(getGameinfoStatus(game.root).configured).toBe(true);
        expect(fixGameinfo(game.root).configured).toBe(true);
        expect(game.read()).toBe(repaired);
        expect(readFileSync(`${game.path}.grimoire-bak`, 'utf8')).toBe(original);
        if (eol === '\r\n') expect(repaired.replaceAll('\r\n', '')).not.toContain('\n');
    });

    it('preserves custom paths, new Valve mounts, comments and duplicate keys', () => {
        const custom = `
    // Keep this } brace and SearchPaths { text in a comment.
    Game_AudioLanguage "citadel_vo_*LANGUAGE*"
    Game "custom/{pack}"
    Game "another/pack" // user content
    Game_Language citadel_*LANGUAGE*
`;
        const game = install(config(legacyBody + custom));
        expect(fixGameinfo(game.root).configured).toBe(true);
        expect(game.read()).toContain(custom);
        expect(game.read()).toContain('ConVars { fps_max 144 }');
    });

    it('keeps override, overflow and Deadworks priority when repairing language mounts', () => {
        const game = install(config(legacyBody + '\n Game citadel/addons2\n Game citadel/addons1\n'));
        for (const folder of ['addons1', 'addons2', 'deadworks_addons/vpks']) {
            mkdirSync(join(game.citadel, folder), { recursive: true });
        }
        expect(fixGameinfo(game.root).configured).toBe(true);
        const body = findSearchPathsBlock(game.read())!.body;
        const paths = ['citadel/grimoire', 'citadel/addons', 'citadel/addons1', 'citadel/addons2',
            'citadel/deadworks_addons/vpks', 'citadel_*LANGUAGE*', 'citadel_lv'];
        for (let i = 1; i < paths.length; i++) {
            expect(body.indexOf(paths[i - 1])).toBeLessThan(body.indexOf(paths[i]));
        }
        expect(body.match(/citadel\/addons1/g)).toHaveLength(1);
        expect(body.match(/citadel\/addons2/g)).toHaveLength(1);
        expect(getGameinfoStatus(game.root).configured).toBe(true);
    });

    it('preserves localization when a later overflow repair is needed', () => {
        const game = install(stock.replace('Game_Language', 'Game_UILanguage'));
        fixGameinfo(game.root);
        mkdirSync(join(game.citadel, 'addons1'));
        expect(getGameinfoStatus(game.root).configured).toBe(false);
        expect(fixGameinfo(game.root).configured).toBe(true);
        const body = findSearchPathsBlock(game.read())!.body;
        expect(hasActivePath(body, 'citadel_*LANGUAGE*', 'Game_UILanguage')).toBe(true);
        expect(hasActivePath(body, 'citadel/addons1')).toBe(true);
        expect(body.match(/Game_UILanguage/g)).toHaveLength(1);
    });

    it.each([
        '// Game_UILanguage citadel_*LANGUAGE*',
        '/* Game_UILanguage citadel_*LANGUAGE* */',
        'Game citadel_*LANGUAGE*',
        'Game_UILanguage citadel_*LANGUAGE*/extra',
    ])('does not mistake %s for the required UI language mount', (entry) => {
        const game = install(config(legacyBody + '\n' + entry + '\n'));
        expect(getGameinfoStatus(game.root).configured).toBe(false);
        expect(fixGameinfo(game.root).configured).toBe(true);
        expect(hasActivePath(findSearchPathsBlock(game.read())!.body,
            'citadel_*LANGUAGE*', 'Game_UILanguage')).toBe(true);
    });

    it('matches quoted and case-insensitive keys and paths exactly', () => {
        const body = `"GAME" "citadel\\addons"\n"Game" "citadel/grimoire"\n` +
            '"game_uilanguage" "citadel_*LANGUAGE*"\n"Game_LowViolence" "citadel_lv"\n';
        const game = install(config(body));
        expect(getGameinfoStatus(game.root).configured).toBe(true);
        fixGameinfo(game.root);
        expect(game.read()).toBe(config(body));
        expect(hasActivePath('Game citadel/addons/profile_default', 'citadel/addons')).toBe(false);
        expect(hasActivePath('Game citadel/addons1', 'citadel/addons')).toBe(false);
        expect(hasActivePath('Write citadel/addons', 'citadel/addons')).toBe(false);
    });

    it('rebuilds a missing SearchPaths section inside a quoted FileSystem', () => {
        const game = install('"GameInfo" { "FileSystem" { OtherSetting 1 } ConVars { fps_max 144 } }');
        expect(fixGameinfo(game.root).configured).toBe(true);
        expect(getGameinfoStatus(game.root).configured).toBe(true);
        expect(game.read()).toContain('OtherSetting 1');
        expect(game.read()).toContain('ConVars { fps_max 144 }');
    });

    it.each([
        'GameInfo { FileSystem { SearchPaths { Game citadel',
        'GameInfo { FileSystem { SearchPaths { Nested { Game citadel } } } }',
        'GameInfo { FileSystem { SearchPaths { Game "unterminated } } }',
        'GameInfo { ConVars { fps_max 144 } }',
    ])('does not write an unrepairable configuration: %s', (original) => {
        const game = install(original);
        expect(fixGameinfo(game.root).configured).toBe(false);
        expect(game.read()).toBe(original);
        expect(existsSync(`${game.path}.grimoire-bak`)).toBe(false);
    });
});
