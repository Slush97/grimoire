/**
 * Regression coverage for the experimentalVpkTagging -> experimentalVpkImprinting
 * legacy-key migration in loadSettings (see settings.ts). Mocks electron's
 * app.getPath the same way dmmMigration.nondestructive.test.ts does, pointing
 * getSettingsPath at a real temp file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));

import { loadSettings } from './settings';

function settingsPath(): string {
  return join(h.userData, 'settings.json');
}

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'settings-migration-'));
});

describe('loadSettings legacy experimentalVpkTagging migration', () => {
  it('migrates a legacy experimentalVpkTagging:true to experimentalVpkImprinting:true', () => {
    writeFileSync(settingsPath(), JSON.stringify({ experimentalVpkTagging: true }));
    expect(loadSettings().experimentalVpkImprinting).toBe(true);
  });

  it('lets an explicit experimentalVpkImprinting:false win over legacy true', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ experimentalVpkTagging: true, experimentalVpkImprinting: false })
    );
    expect(loadSettings().experimentalVpkImprinting).toBe(false);
  });

  it('defaults to false when neither key is present', () => {
    writeFileSync(settingsPath(), JSON.stringify({}));
    expect(loadSettings().experimentalVpkImprinting).toBe(false);
  });

  it('defaults to false when no settings file exists at all', () => {
    expect(loadSettings().experimentalVpkImprinting).toBe(false);
  });

  it('honors an explicit experimentalVpkImprinting:true with no legacy key', () => {
    writeFileSync(settingsPath(), JSON.stringify({ experimentalVpkImprinting: true }));
    expect(loadSettings().experimentalVpkImprinting).toBe(true);
  });
});

describe('loadSettings hidden creator normalization', () => {
  it('defaults hidden creators to an empty list for existing settings', () => {
    writeFileSync(settingsPath(), JSON.stringify({}));
    expect(loadSettings().hiddenCreators).toEqual([]);
  });

  it('keeps valid ids, trims names, and deduplicates by stable id', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hiddenCreators: [
          { id: 42, name: ' First name ' },
          { id: 7, name: 'Another creator' },
          { id: 42, name: 'Renamed creator' },
        ],
      })
    );

    expect(loadSettings().hiddenCreators).toEqual([
      { id: 42, name: 'Renamed creator' },
      { id: 7, name: 'Another creator' },
    ]);
  });

  it('drops malformed entries from hand-edited settings', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hiddenCreators: [
          null,
          { id: 0, name: 'Zero' },
          { id: -1, name: 'Negative' },
          { id: 1.5, name: 'Fractional' },
          { id: 9, name: '   ' },
          { id: '12', name: 'String id' },
          { id: 12, name: 'Valid' },
        ],
      })
    );

    expect(loadSettings().hiddenCreators).toEqual([{ id: 12, name: 'Valid' }]);
  });
});

describe('loadSettings hidden mod normalization', () => {
  it('defaults hidden mods to an empty list for existing settings', () => {
    writeFileSync(settingsPath(), JSON.stringify({}));
    expect(loadSettings().hiddenMods).toEqual([]);
  });

  it('keeps valid entries and drops malformed ones', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hiddenMods: [
          { id: 723290, name: ' Kitty Paw Cursor ', section: 'Mod' },
          { id: 0, name: 'Zero', section: 'Mod' },
          { id: '5', name: 'String id', section: 'Mod' },
          { id: 723290, name: 'Kitty Paw Cursor v2', section: 'Mod' },
          { id: 12, name: 'No section' },
          { id: 13, name: 'Unknown section', section: 'Tool' },
          { id: 11, name: 'Other mod', section: 'Mod' },
        ],
      })
    );

    expect(loadSettings().hiddenMods).toEqual([
      { id: 723290, name: 'Kitty Paw Cursor v2', section: 'Mod' },
      { id: 11, name: 'Other mod', section: 'Mod' },
    ]);
  });

  it('keeps the same id hidden in different sections apart', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hiddenMods: [
          { id: 95100, name: 'A sound', section: 'Sound' },
          { id: 95100, name: 'A wip', section: 'Wip' },
        ],
      })
    );

    expect(loadSettings().hiddenMods).toEqual([
      { id: 95100, name: 'A sound', section: 'Sound' },
      { id: 95100, name: 'A wip', section: 'Wip' },
    ]);
  });
});

describe('loadSettings OLED mode', () => {
  it('defaults OLED mode to off for existing settings', () => {
    writeFileSync(settingsPath(), JSON.stringify({}));

    expect(loadSettings().oledMode).toBe(false);
  });

  it('keeps an enabled OLED mode from saved settings', () => {
    writeFileSync(settingsPath(), JSON.stringify({ oledMode: true }));

    expect(loadSettings().oledMode).toBe(true);
  });
});

describe('loadSettings legacy NSFW keys -> nsfwContentMode', () => {
  const load = (legacy: object) => {
    writeFileSync(settingsPath(), JSON.stringify(legacy));
    return loadSettings();
  };

  it('defaults to blur when no NSFW key is present', () => {
    expect(load({}).nsfwContentMode).toBe('blur');
  });

  it('keeps a Browse hide choice', () => {
    expect(load({ browseNsfwContentMode: 'hide', installedHideNsfwPreviews: false }).nsfwContentMode).toBe('hide');
  });

  it('shows only when both the Browse mode and the blur toggle were off', () => {
    expect(load({ browseNsfwContentMode: 'show', installedHideNsfwPreviews: false }).nsfwContentMode).toBe('show');
    expect(load({ browseNsfwContentMode: 'show', installedHideNsfwPreviews: true }).nsfwContentMode).toBe('blur');
    expect(load({ browseNsfwContentMode: 'blur', installedHideNsfwPreviews: false }).nsfwContentMode).toBe('blur');
  });

  it('migrates a pre-split hideNsfwPreviews:false to show', () => {
    expect(load({ hideNsfwPreviews: false }).nsfwContentMode).toBe('show');
  });

  it('lets an explicit nsfwContentMode win over legacy keys', () => {
    expect(load({ nsfwContentMode: 'show', browseNsfwContentMode: 'hide' }).nsfwContentMode).toBe('show');
  });

  it('strips the legacy keys', () => {
    const settings = load({ hideNsfwPreviews: true, browseNsfwContentMode: 'blur', installedHideNsfwPreviews: true });
    expect(settings).not.toHaveProperty('hideNsfwPreviews');
    expect(settings).not.toHaveProperty('browseNsfwContentMode');
    expect(settings).not.toHaveProperty('installedHideNsfwPreviews');
  });
});
