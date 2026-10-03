import { describe, expect, it } from 'vitest';
import {
  classifyModFiles,
  isUpdateFlagged,
  tokenizeFileName,
  type FileUpdateState,
  type InstalledUpdateEntry,
  type UpdateFileRow,
} from './updateFileMatch';
import snapshot from './__fixtures__/gamebanana/files-2026-10-02.json';

// File rows of real GameBanana mods as the API returned them on 2026-10-02.
const rowsOf = (modId: number): UpdateFileRow[] => (snapshot as Record<string, UpdateFileRow[]>)[String(modId)];
const row = (modId: number, fileId: number): UpdateFileRow => {
  const found = rowsOf(modId).find((file) => file.id === fileId);
  if (!found) throw new Error(`fixture has no file ${fileId} for mod ${modId}`);
  return found;
};

/** An install of a real row, with the description and filename stem the
 *  download path captures into the sidecar. */
const installedRow = (modId: number, fileId: number, over: Partial<InstalledUpdateEntry> = {}): InstalledUpdateEntry => {
  const file = row(modId, fileId);
  return {
    id: `local-${fileId}`,
    gameBananaId: modId,
    gameBananaFileId: fileId,
    fileDescription: file.description,
    sourceFileName: file.fileName.replace(/\.(zip|rar|7z)$/i, ''),
    ...over,
  };
};

const stateOf = (
  modId: number,
  files: UpdateFileRow[],
  installed: InstalledUpdateEntry[],
  fileId: number,
): FileUpdateState | undefined => classifyModFiles(modId, files, installed).states.get(fileId);

const targetOf = (state: FileUpdateState | undefined): number | undefined =>
  state?.kind === 'update' ? state.target.id : undefined;

/** Whether the mod reads as having an update: what drives the card stripes. */
const isFlagged = (modId: number, files: UpdateFileRow[], installed: InstalledUpdateEntry[]): boolean =>
  [...classifyModFiles(modId, files, installed).states.values()].some(isUpdateFlagged);

const file = (id: number, fileName: string, over: Partial<UpdateFileRow> = {}): UpdateFileRow => ({
  id,
  fileName,
  isArchived: false,
  ...over,
});

const variant = (gameBananaFileId: number, gameBananaId = 650634): InstalledUpdateEntry => ({
  id: `v-${gameBananaFileId}`,
  gameBananaId,
  gameBananaFileId,
});

describe('update flag', () => {
  const qolLockFiles = [
    file(1627686, 'optional_addon_neutral_icons.zip'),
    file(1680726, 'optional_announcer_slot1_seven_josefumivo.zip'),
    file(1780000, 'qollock_319_31july.zip'),
  ];

  it('flags a mod whose installed file the author deleted', () => {
    expect(isFlagged(650634, qolLockFiles, [variant(1769081), variant(1627686)])).toBe(true);
  });

  it('does not flag a mod whose installed files are all still current', () => {
    expect(isFlagged(650634, qolLockFiles, [variant(1780000), variant(1627686)])).toBe(false);
  });

  it('does not flag an archived file that nothing replaces', () => {
    // Before: any archived file was "outdated" forever. Archiving is also how
    // authors retire addons and keep legacy alternates, so archived alone is
    // not an update.
    const files = [file(1, 'old.zip', { isArchived: true }), file(2, 'unrelated_pack.zip')];

    expect(isFlagged(650634, files, [variant(1)])).toBe(false);
  });

  it('flags an archived file with a confident successor', () => {
    const files = [
      file(1, 'skin_gold_v1.zip', { isArchived: true, dateAdded: 100 }),
      file(2, 'skin_gold_v2.zip', { dateAdded: 100_000 }),
    ];

    expect(isFlagged(650634, files, [variant(1)])).toBe(true);
  });

  it('respects ignoreUpdates on the installed variant', () => {
    expect(isFlagged(650634, [file(2, 'new.zip')], [{ ...variant(1), ignoreUpdates: true }])).toBe(false);
  });

  it('ignores variants belonging to a different mod', () => {
    expect(isFlagged(650634, [file(2, 'new.zip')], [variant(1, 999999)])).toBe(false);
  });

  it('ignores custom imports and legacy installs with no file id', () => {
    const files = [file(2, 'new.zip')];

    expect(isFlagged(650634, files, [{ id: 'a', gameBananaId: 650634 }])).toBe(false);
    expect(isFlagged(650634, files, [variant(0)])).toBe(false);
  });

  it('treats an unloaded or fully archived file list as "unknown", not "outdated"', () => {
    expect(isFlagged(650634, [], [variant(1)])).toBe(false);
    expect(isFlagged(650634, [file(2, 'old.zip', { isArchived: true })], [variant(1)])).toBe(false);
  });
});

describe('classifyModFiles on real GameBanana data', () => {
  describe('QOL Lock (650634)', () => {
    const files = rowsOf(650634);
    const addons = [1627686, 1627687, 1631511];
    const announcers = [1641691, 1641703, 1641769, 1680726, 1680727];
    const hotfix = 1833534;
    // The old main was deleted, not archived, so only the sidecar remembers it.
    const deletedMain: InstalledUpdateEntry = {
      id: 'local-main-30sep',
      gameBananaId: 650634,
      gameBananaFileId: 1832204,
      sourceFileName: 'qollock_403_30september',
    };

    it('reads the archived optional addons as archived, never an update, with everything installed', () => {
      const installed = [hotfix, ...announcers, ...addons].map((id) => installedRow(650634, id));
      const { states } = classifyModFiles(650634, files, installed);

      for (const id of addons) expect(states.get(id)).toEqual({ kind: 'archived' });
      for (const id of [hotfix, ...announcers]) expect(states.get(id)).toEqual({ kind: 'current' });
      expect(isFlagged(650634, files, installed)).toBe(false);
    });

    it('keeps the addons archived when only the main is installed beside them', () => {
      // The announcers were uploaded after the addons but are optional files,
      // not their successors, and they are not installed here.
      const installed = [hotfix, ...addons].map((id) => installedRow(650634, id));
      const { states } = classifyModFiles(650634, files, installed);

      for (const id of addons) expect(states.get(id)).toEqual({ kind: 'archived' });
    });

    it('updates the deleted 30 September main to the 1 October hotfix by filename', () => {
      const installed = [deletedMain, ...[...announcers, ...addons].map((id) => installedRow(650634, id))];
      const { states } = classifyModFiles(650634, files, installed);

      expect(states.get(1832204)).toEqual({ kind: 'update', target: row(650634, hotfix), via: 'name', promote: false });
      for (const id of addons) expect(states.get(id)).toEqual({ kind: 'archived' });
    });

    it('promotes a hotfix the user already installed instead of leaving the old main stuck', () => {
      // A one-click or Browse install of the hotfix leaves the old main beside
      // it. Applying the update only removes the old main and moves its state.
      const installed = [deletedMain, installedRow(650634, hotfix)];

      expect(stateOf(650634, files, installed, 1832204)).toEqual({
        kind: 'update',
        target: row(650634, hotfix),
        via: 'name',
        promote: true,
      });
    });
  });

  describe('Top Bar Plus (623518)', () => {
    const files = rowsOf(623518);
    const killstreak = 1614618;
    const v40d = 1769092;
    const v5 = 1834013;

    it('reads killstreak_fx as archived even though v5 is the sole current file', () => {
      expect(stateOf(623518, files, [installedRow(623518, killstreak)], killstreak)).toEqual({ kind: 'archived' });
    });

    it('updates v40d to v5 by filename and leaves killstreak_fx alone in either input order', () => {
      const entries = [installedRow(623518, killstreak), installedRow(623518, v40d)];
      for (const installed of [entries, [...entries].reverse()]) {
        const { states } = classifyModFiles(623518, files, installed);
        expect(targetOf(states.get(v40d))).toBe(v5);
        expect(states.get(killstreak)).toEqual({ kind: 'archived' });
      }
    });
  });

  it('updates each archived file of 601444 to its own successor, not the superset name', () => {
    const files = rowsOf(601444);
    const installed = [1818475, 1797863, 1797864].map((id) => installedRow(601444, id));
    const { states } = classifyModFiles(601444, files, installed);

    // filter_for_passive_items_09_17 -> filter_for_passive_items_10_02, not
    // the _and_active_items_ superset that scored equal under the old matcher.
    expect(targetOf(states.get(1818475))).toBe(1834573);
    expect(targetOf(states.get(1797863))).toBe(1834575);
    expect(targetOf(states.get(1797864))).toBe(1834574);
  });

  it('follows a stable description across renamed uploads (627024)', () => {
    const files = rowsOf(627024);
    const { states } = classifyModFiles(627024, files, [
      installedRow(627024, 1712753),
      installedRow(627024, 1712754),
    ]);

    // heliosmagicianassistant -> heliosmagicianandassistant_b1537 shares no
    // filename token; "Model + Assistant" is the only signal.
    expect(states.get(1712753)).toEqual({
      kind: 'update',
      target: row(627024, 1834531),
      via: 'description',
      promote: false,
    });
    expect(targetOf(states.get(1712754))).toBe(1834532);
  });

  it('updates an archived old version whose description and filename agree (716176)', () => {
    expect(targetOf(stateOf(716176, rowsOf(716176), [installedRow(716176, 1813690)], 1813690))).toBe(1831916);
  });

  it('does not trust a description and filename that point at different files (723141)', () => {
    // The archived pair carries "Lower position" and "Normal height" on the
    // opposite filenames from the new pair.
    const files = rowsOf(723141);
    expect(stateOf(723141, files, [installedRow(723141, 1834883)], 1834883)).toEqual({ kind: 'archived' });

    const deleted = files.filter((candidate) => candidate.id !== 1834883);
    expect(stateOf(723141, deleted, [installedRow(723141, 1834883)], 1834883)).toEqual({ kind: 'needs-pick' });
  });

  describe('Sunlock (688340) and its repeated "Default" description', () => {
    const files = rowsOf(688340);

    it('does not match "Default" when it also labelled an alternative uploaded alongside', () => {
      // day_default2 and day_alt3 were uploaded 11 seconds apart, both "Default",
      // so the description says nothing. Keeping only the alt line current
      // must not turn the default line into an automatic replacement.
      const state = stateOf(688340, files, [installedRow(688340, 1759220)], 1759220);
      expect(state).toEqual({ kind: 'archived' });
    });

    it('still updates the alt line to its successor', () => {
      expect(targetOf(stateOf(688340, files, [installedRow(688340, 1834533)], 1834533))).toBe(1834618);
    });

    it('needs a unique description among the candidates', () => {
      const twoDefaults = [
        file(1, 'old_pack.zip', { isArchived: true, description: 'Default', dateAdded: 100 }),
        file(2, 'pack_red.zip', { description: 'Default', dateAdded: 100_000 }),
        file(3, 'pack_blue.zip', { description: 'Default', dateAdded: 100_000 }),
      ];
      expect(stateOf(5, twoDefaults, [{ id: 'a', gameBananaId: 5, gameBananaFileId: 1 }], 1)).toEqual({ kind: 'archived' });
    });
  });

  it('resolves a total rename by the captured description (657484)', () => {
    const files = rowsOf(657484);
    const renamed: InstalledUpdateEntry = {
      id: 'cory',
      gameBananaId: 657484,
      gameBananaFileId: 1600000,
      fileDescription: 'They call me Cory',
      sourceFileName: 'dynamo_voice_replacement',
    };

    expect(stateOf(657484, files, [renamed], 1600000)).toEqual({
      kind: 'update',
      target: row(657484, 1834570),
      via: 'description',
      promote: false,
    });
    expect(targetOf(stateOf(657484, files, [installedRow(657484, 1639204)], 1639204))).toBe(1834570);
  });

  it('prefers the exact name over an "old_" alternate of it (663301)', () => {
    expect(targetOf(stateOf(663301, rowsOf(663301), [installedRow(663301, 1741532)], 1741532))).toBe(1833926);
  });

  it('keeps a legacy alternate archived (661881)', () => {
    expect(stateOf(661881, rowsOf(661881), [installedRow(661881, 1653319)], 1653319)).toEqual({ kind: 'archived' });
  });

  it('never picks a current file uploaded before the installed one (660980)', () => {
    // bunnymina-v5 is still current but older than the installed v6; v8 is newer.
    expect(targetOf(stateOf(660980, rowsOf(660980), [installedRow(660980, 1656557)], 1656557))).toBe(1676496);
  });

  it('goes by the file rows, not the install-time archived flag', () => {
    // Fix Unknown Mods adoption and archived reinstalls write the sidecar's
    // isArchived too, so it cannot mean "chosen knowingly": v40d still updates.
    const installed = [{ ...installedRow(623518, 1769092), isArchived: true }];

    expect(targetOf(stateOf(623518, rowsOf(623518), installed, 1769092))).toBe(1834013);
  });
});

describe('classifyModFiles rules', () => {
  const gb = 10;
  const entry = (id: string, gameBananaFileId: number, over: Partial<InstalledUpdateEntry> = {}): InstalledUpdateEntry => ({
    id,
    gameBananaId: gb,
    gameBananaFileId,
    ...over,
  });

  it('leaves a deleted file unresolved when no candidate is confident', () => {
    const files = [file(2, 'gold.zip'), file(3, 'silver.zip')];

    expect(stateOf(gb, files, [entry('old', 1, { sourceFileName: 'unrelated' })], 1)).toEqual({ kind: 'needs-pick' });
  });

  it('marks only the matching successor, not alternate current variants', () => {
    const files = [file(2, 'gold-v2.zip', { description: 'Gold' }), file(3, 'silver-v2.zip', { description: 'Silver' })];
    const { states } = classifyModFiles(gb, files, [entry('old-gold', 1, { fileDescription: 'Gold' })]);

    expect(targetOf(states.get(1))).toBe(2);
  });

  it('keeps confident matches separate when another stale file is unresolved', () => {
    const files = [file(2, 'gold-v2.zip', { description: 'Gold' }), file(3, 'silver-v2.zip', { description: 'Silver' })];
    const { states } = classifyModFiles(gb, files, [
      entry('old-gold', 1, { fileDescription: 'Gold' }),
      entry('unknown', 4, { sourceFileName: 'unrelated' }),
    ]);

    expect(targetOf(states.get(1))).toBe(2);
    expect(states.get(4)).toEqual({ kind: 'needs-pick' });
  });

  describe('sole current file safety', () => {
    it('requires a pick when a deleted file only shares a name word', () => {
      const files = [file(2, 'galaxy_remastered.7z')];

      expect(stateOf(gb, files, [entry('old', 1, { sourceFileName: 'galaxy_rem_gold' })], 1)).toEqual({
        kind: 'needs-pick',
      });
    });

    it('maps on a shared description when the names share nothing', () => {
      const files = [file(2, 'consolidated.7z', { description: 'Main mod' })];
      const installed = [entry('old', 1, { sourceFileName: 'old_name', fileDescription: 'main mod' })];

      expect(targetOf(stateOf(gb, files, installed, 1))).toBe(2);
    });

    it('keeps an archived rename without sufficient matching evidence', () => {
      // 571935: even a real rename cannot safely resolve from one shared word.
      const files = [
        file(1, 'hoglin_piglin_1_2.zip', { isArchived: true, dateAdded: 1_757_000_000 }),
        file(2, 'hoglin_krill_ognb.zip', { dateAdded: 1_771_000_000 }),
      ];

      expect(stateOf(gb, files, [entry('hoglin', 1, { sourceFileName: 'hoglin_piglin_1_2' })], 1)).toEqual({ kind: 'archived' });
    });

    it('never maps a file that shares nothing with the sole file, archived or deleted', () => {
      // killstreak_fx, hankextrasounds, warwick_powder_no_tail: addons and
      // alternates, not old versions of the main file.
      for (const [name, sole] of [
        ['killstreak_fx', 'v5_top_bar_plus.zip'],
        ['hankextrasounds', 'hank28.zip'],
        ['warwick_powder_no_tail', 'wwpowder.zip'],
      ]) {
        const files = [file(2, sole)];
        expect(stateOf(gb, files, [entry('stale', 1, { sourceFileName: name })], 1)).toEqual({ kind: 'needs-pick' });
        const archived = [file(1, `${name}.zip`, { isArchived: true }), ...files];
        expect(stateOf(gb, archived, [entry('stale', 1)], 1)).toEqual({ kind: 'archived' });
      }
    });

    it('never maps an alternate onto the main file it qualifies, archived or deleted', () => {
      // juno_paradox_no_physics, victor_*_widefov and sliverofstraw_legacy are
      // alternates kept beside their main file, not old versions of it.
      for (const [name, sole] of [
        ['juno_paradox_no_physics', 'juno_paradox_07912.zip'],
        ['victor_skin_widefov', 'victor_skin.zip'],
        ['sliverofstraw_legacy', 'sliverofstraw_healthbar_fix.zip'],
      ]) {
        const files = [file(2, sole, { dateAdded: 1_771_000_000 })];
        expect(stateOf(gb, files, [entry('alt', 1, { sourceFileName: name })], 1)).toEqual({ kind: 'needs-pick' });
        const archived = [file(1, `${name}.zip`, { isArchived: true, dateAdded: 1_757_000_000 }), ...files];
        expect(stateOf(gb, archived, [entry('alt', 1)], 1)).toEqual({ kind: 'archived' });
      }
    });

    it('needs the sole file to be newer than an archived file\'s upload session', () => {
      const files = [
        file(1, 'galaxy_rem_gold.zip', { isArchived: true, dateAdded: 1000 }),
        file(2, 'galaxy_remastered.zip', { dateAdded: 1000 + 600 }),
      ];

      expect(stateOf(gb, files, [entry('old', 1)], 1)).toEqual({ kind: 'archived' });
    });

    it('does not map a deleted file onto a sole current file that is already installed', () => {
      // Before: the stale file "updated" to the installed file, which only
      // deleted the stale one without asking.
      const files = [file(1774719, 'freaky_hidout.zip')];
      const installed = [
        entry('feet-v4', 1723227, { fileDescription: 'Feet in hub V4', sourceFileName: 'feetinhubv4' }),
        entry('feet-v5', 1774719),
      ];

      expect(stateOf(gb, files, installed, 1723227)).toEqual({ kind: 'needs-pick' });
    });

    it('never targets a sole current file the user already has', () => {
      const files = [file(1, 'optional_addon_icons.zip', { isArchived: true }), file(2, 'main_addon_v3.zip')];

      expect(stateOf(gb, files, [entry('addon', 1), entry('main', 2)], 1)).toEqual({ kind: 'archived' });
    });

    it('does not guess between several stale files that fit', () => {
      const { states } = classifyModFiles(gb, [file(3, 'only_current.zip')], [
        entry('a', 1, { sourceFileName: 'only_first' }),
        entry('b', 2, { sourceFileName: 'only_second' }),
      ]);

      expect(states.get(1)).toEqual({ kind: 'needs-pick' });
      expect(states.get(2)).toEqual({ kind: 'needs-pick' });
    });

    it('does not hand out a sole current file another stale file confidently claimed', () => {
      const files = [file(3, 'skin_gold_v3.zip')];
      const { states } = classifyModFiles(gb, files, [
        entry('gold', 1, { sourceFileName: 'skin_gold_v2' }),
        entry('other', 2, { sourceFileName: 'something_else' }),
      ]);

      expect(targetOf(states.get(1))).toBe(3);
      expect(states.get(2)).toEqual({ kind: 'needs-pick' });
    });
  });

  describe('claims', () => {
    it('gives a contested successor to the stronger match', () => {
      const files = [file(3, 'skin_gold_v3.zip', { description: 'Gold' })];
      const { states } = classifyModFiles(gb, files, [
        entry('both-signals', 1, { sourceFileName: 'skin_gold_v1', fileDescription: 'Gold' }),
        entry('name-only', 2, { sourceFileName: 'skin_gold_v2' }),
      ]);

      expect(targetOf(states.get(1))).toBe(3);
      expect(states.get(2)).toEqual({ kind: 'needs-pick' });
    });

    it('leaves an evenly contested successor unresolved for both', () => {
      const files = [file(3, 'skin_gold_v3.zip')];
      const { states } = classifyModFiles(gb, files, [
        entry('a', 1, { sourceFileName: 'skin_gold_v1' }),
        entry('b', 2, { sourceFileName: 'skin_gold_v2' }),
      ]);

      expect(states.get(1)).toEqual({ kind: 'needs-pick' });
      expect(states.get(2)).toEqual({ kind: 'needs-pick' });
    });

    it('never proposes a file installed elsewhere, like inside a merge', () => {
      const files = [file(2, 'skin_gold_v2.zip')];
      const installed = [entry('old', 1, { sourceFileName: 'skin_gold_v1' })];

      expect(classifyModFiles(gb, files, installed, new Set([2])).states.get(1)).toEqual({ kind: 'needs-pick' });
    });
  });

  it('gives every stale file the same state whatever the input order (601444)', () => {
    const files = rowsOf(601444);
    // Four 09_17 uploads, plus the 08_26 "yesbehaviour" upload that competes
    // with its 09_17 re-upload for the same 10_02 successor.
    const entries = [1818475, 1818476, 1818477, 1818474, 1797866].map((id) => installedRow(601444, id));
    const reference = classifyModFiles(601444, files, entries).states;

    for (const order of permutations(entries)) {
      expect(classifyModFiles(601444, files, order).states).toEqual(reference);
    }
    expect(targetOf(reference.get(1818475))).toBe(1834573);
    expect(targetOf(reference.get(1818476))).toBe(1834575);
    expect(targetOf(reference.get(1818474))).toBe(1834574);
    // Equal claims on one successor resolve neither, instead of letting the
    // first one listed win.
    expect(reference.get(1818477)).toEqual({ kind: 'archived' });
    expect(reference.get(1797866)).toEqual({ kind: 'archived' });
  });

  describe('multi-VPK archives', () => {
    const files = [
      file(1, 'pack_v1.zip', { isArchived: true, dateAdded: 1 }),
      file(2, 'pack_v2.zip', { dateAdded: 100_000 }),
    ];

    it('classify every VPK of one file together', () => {
      const { states, sourceIds } = classifyModFiles(gb, files, [entry('vpk-a', 1), entry('vpk-b', 1)]);

      expect(states.size).toBe(1);
      expect(targetOf(states.get(1))).toBe(2);
      expect(sourceIds.get(1)).toEqual(['vpk-a', 'vpk-b']);
    });

    it('leave an ignored VPK out of the replaceable sources', () => {
      const { states, sourceIds } = classifyModFiles(gb, files, [entry('vpk-a', 1), entry('vpk-b', 1, { ignoreUpdates: true })]);

      expect(targetOf(states.get(1))).toBe(2);
      expect(sourceIds.get(1)).toEqual(['vpk-a']);
    });

    it('read as ignored once every VPK is ignored', () => {
      const installed = [entry('vpk-a', 1, { ignoreUpdates: true }), entry('vpk-b', 1, { ignoreUpdates: true })];

      expect(stateOf(gb, files, installed, 1)).toEqual({ kind: 'ignored' });
    });
  });

  it('reads an archived row with no current files left as archived, a deleted one as unknown', () => {
    const files = [file(1, 'pack.zip', { isArchived: true })];
    const { states } = classifyModFiles(gb, files, [entry('kept', 1), entry('gone', 2)]);

    expect(states.get(1)).toEqual({ kind: 'archived' });
    expect(states.get(2)).toEqual({ kind: 'unknown' });
  });
});

describe('tokenizeFileName', () => {
  it.each([
    ['qollock_403_30september.zip', ['qollock']],
    ['qollock403_1octoberhotfix.zip', ['qollock']],
    ['hank11.zip', ['hank']],
    ['coryv2nomusic.zip', ['cory', 'nomusic']],
    ['v34b-hotfix_top_bar_plus.zip', ['top', 'bar', 'plus']],
    ['heliosmagician_ae871.zip', ['heliosmagician']],
    ['mymod_2026-10-01.7z', ['mymod']],
    ['skin_1st_edition_final.rar', ['skin', 'edition']],
    ['skin_mar_2.zip', ['skin']],
    ['pak19_dir_ae07a.rar', []],
    ['pak01_dir.vpk', []],
    ['sts_silver_v1_0-pak01_dir.7z', ['sts', 'silver']],
  ])('%s -> %j', (name, tokens) => {
    expect([...tokenizeFileName(name)]).toEqual(tokens);
  });

  it('keeps words that only start with a month or upload word', () => {
    expect([...tokenizeFileName('octoberskin_decal_marvel.zip')]).toEqual(['octoberskin', 'decal', 'marvel']);
  });

  it('keeps month names in an undated name, where they name a variant', () => {
    expect([...tokenizeFileName('vindicta_october.zip')]).toEqual(['vindicta', 'october']);
  });

  it('treats an upload word as a date, so its month is dropped', () => {
    expect([...tokenizeFileName('echo_august_update.zip')]).toEqual(['echo']);
    expect([...tokenizeFileName('echo_april_texture_update.zip')]).toEqual(['echo', 'texture']);
  });

  it('peels only whole words off a glued run, never abbreviations or ordinals', () => {
    expect([...tokenizeFileName('marth_lash_skin.zip')]).toEqual(['marth', 'lash', 'skin']);
    expect([...tokenizeFileName('decth_2.zip')]).toEqual(['decth']);
  });
});

describe('tokenizer and session reproductions from review', () => {
  const gb = 42;
  const entry = (id: string, gameBananaFileId: number, over: Partial<InstalledUpdateEntry> = {}): InstalledUpdateEntry => ({
    id,
    gameBananaId: gb,
    gameBananaFileId,
    ...over,
  });

  it('never treats a file uploaded alongside as a successor (663317 silvermix1/silvermix2)', () => {
    // The digit is the only thing telling the two mixes apart, so their tokens
    // collide; they were uploaded in one session, which rules the match out.
    const files = [
      file(1, 'silvermix1_e26db.zip', { isArchived: true, description: 'mix1 variant', dateAdded: 1000 }),
      file(2, 'silvermix2_c0c51.zip', { description: 'mix2 variant', dateAdded: 1000 + 40 }),
      file(3, 'readme_extras.zip', { dateAdded: 1000 + 40 }),
    ];
    const installed = [entry('mix1', 1, { fileDescription: 'mix1 variant', sourceFileName: 'silvermix1_e26db' })];

    expect(stateOf(gb, files, installed, 1)).toEqual({ kind: 'archived' });
  });

  it('follows a dated rename to the matching file, not its texture-only sibling (562166)', () => {
    const files = [
      file(1, 'echo_august_update.zip', { isArchived: true, description: 'August Update', dateAdded: 1_755_700_000 }),
      file(2, 'echo_april_update.zip', { dateAdded: 1_776_150_000 }),
      file(3, 'echo_april_texture_update.zip', { dateAdded: 1_776_400_000 }),
    ];
    const installed = [entry('echo', 1, { fileDescription: 'August Update', sourceFileName: 'echo_august_update' })];

    expect(targetOf(stateOf(gb, files, installed, 1))).toBe(2);
  });

  it('does not match month-named variants to each other', () => {
    const files = [
      file(2, 'vindicta_june.zip', { description: 'June outfit' }),
      file(3, 'vindicta_classic_red.zip', { description: 'Red' }),
    ];
    const installed = [entry('oct', 1, { fileDescription: 'October outfit', sourceFileName: 'vindicta_october' })];

    expect(stateOf(gb, files, installed, 1)).toEqual({ kind: 'needs-pick' });
  });

  it('gives a raw pakNN_dir name no name signal', () => {
    // 621962: the cloth-sim pak must not "update" to the portraits pak.
    const files = [
      file(19, 'pak19_dir_ae07a.rar', { isArchived: true, description: 'fixed better cloth sim', dateAdded: 1_769_900_000 }),
      file(23, 'pak23_dir_48fc6.rar', { description: 'NEW DYNAMIC PORTRAITS', dateAdded: 1_769_990_000 }),
      file(28, 'hank28.zip', { description: 'white outlines fix', dateAdded: 1_778_000_000 }),
    ];
    const installed = [entry('cloth', 19, { fileDescription: 'fixed better cloth sim', sourceFileName: 'pak19_dir_ae07a' })];

    expect(stateOf(gb, files, installed, 19)).toEqual({ kind: 'archived' });
  });

  it('drops a description match on a re-upload inside the hour, keeps one just after', () => {
    const hotfixAt = (seconds: number) => [
      file(1, 'heroes_overhaul.zip', { isArchived: true, description: 'Main file', dateAdded: 10_000 }),
      file(2, 'ho_hotfix2.zip', { description: 'Main file', dateAdded: 10_000 + seconds }),
      file(3, 'optional_icons.zip', { description: 'Icons', dateAdded: 10_000 + seconds }),
    ];
    const installed = [entry('main', 1, { fileDescription: 'Main file', sourceFileName: 'heroes_overhaul' })];

    expect(stateOf(gb, hotfixAt(1800), installed, 1)).toEqual({ kind: 'archived' });
    expect(targetOf(stateOf(gb, hotfixAt(3601), installed, 1))).toBe(2);
  });

  it('keeps non-Latin descriptions apart', () => {
    const files = [
      file(2, 'mina_v2_blue.zip', { description: 'Mina 蓝色' }),
      file(3, 'mina_extras.zip', { description: 'Extras' }),
    ];
    const red = [entry('red', 1, { fileDescription: 'Mina 红色', sourceFileName: 'mina_red_v1' })];
    const blue = [entry('blue', 1, { fileDescription: 'Mina  蓝色!', sourceFileName: 'mina_v1_blue' })];

    expect(stateOf(gb, files, red, 1)).toEqual({ kind: 'needs-pick' });
    expect(stateOf(gb, files, blue, 1)).toMatchObject({ kind: 'update', via: 'description' });
  });

  it('still matches descriptions that differ only in case, spacing and punctuation', () => {
    const files = [file(2, 'zzz.zip', { description: '  current/MAX  health!! ' }), file(3, 'yyy.zip')];
    const installed = [entry('a', 1, { fileDescription: 'Current Max Health', sourceFileName: 'aaa' })];

    expect(stateOf(gb, files, installed, 1)).toMatchObject({ kind: 'update', via: 'description' });
  });

  it('promotes an installed successor of an archived file', () => {
    const files = [
      file(1, 'skin_v1.zip', { isArchived: true, dateAdded: 1 }),
      file(2, 'skin_v2.zip', { dateAdded: 100_000 }),
    ];

    expect(stateOf(gb, files, [entry('old', 1), entry('new', 2)], 1)).toEqual({
      kind: 'update',
      target: files[1],
      via: 'name',
      promote: true,
    });
  });

  it('leaves two stale versions of one file unresolved rather than picking one', () => {
    const files = [
      file(1, 'skin_v1.zip', { isArchived: true, dateAdded: 1 }),
      file(2, 'skin_v2.zip', { isArchived: true, dateAdded: 100_000 }),
      file(3, 'skin_v3.zip', { dateAdded: 200_000 }),
    ];
    const { states } = classifyModFiles(gb, files, [entry('v1', 1), entry('v2', 2)]);

    expect(states.get(1)).toEqual({ kind: 'archived' });
    expect(states.get(2)).toEqual({ kind: 'archived' });
  });
});

describe('order independence over the real fixture', () => {
  it('states never depend on the order of files or installed entries', () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const shuffle = <T,>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };
    const serialize = (states: Map<number, FileUpdateState>) =>
      JSON.stringify([...states.entries()].sort((a, b) => a[0] - b[0]));

    for (const [key, rows] of Object.entries(snapshot as Record<string, UpdateFileRow[]>)) {
      const modId = Number(key);
      for (let trial = 0; trial < 20; trial++) {
        const deleted = new Set(rows.filter(() => random() < 0.3).map((candidate) => candidate.id));
        const files = rows.filter((candidate) => !deleted.has(candidate.id));
        const installed = rows
          .filter(() => random() < 0.4)
          .flatMap((candidate) => {
            const base = {
              gameBananaId: modId,
              gameBananaFileId: candidate.id,
              fileDescription: candidate.description,
              sourceFileName: candidate.fileName.replace(/\.(zip|rar|7z)$/i, ''),
            };
            return random() < 0.2
              ? [{ ...base, id: `${candidate.id}-a` }, { ...base, id: `${candidate.id}-b` }]
              : [{ ...base, id: `${candidate.id}` }];
          });
        const reference = serialize(classifyModFiles(modId, files, installed).states);
        for (let k = 0; k < 4; k++) {
          expect(serialize(classifyModFiles(modId, shuffle(files), shuffle(installed)).states)).toBe(reference);
        }
      }
    }
  });
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}
