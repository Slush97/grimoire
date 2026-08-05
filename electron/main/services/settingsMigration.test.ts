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

describe('loadSettings color scheme normalization', () => {
  it('defaults missing color schemes to dark', () => {
    writeFileSync(settingsPath(), JSON.stringify({}));
    expect(loadSettings().colorScheme).toBe('dark');
  });

  it.each(['system', 'light', 'dark'] as const)('keeps a valid %s color scheme', (colorScheme) => {
    writeFileSync(settingsPath(), JSON.stringify({ colorScheme }));
    expect(loadSettings().colorScheme).toBe(colorScheme);
  });

  it.each([null, '', 'sepia', 42, { mode: 'light' }])(
    'normalizes malformed color scheme %j to dark',
    (colorScheme) => {
      writeFileSync(settingsPath(), JSON.stringify({ colorScheme }));
      expect(loadSettings().colorScheme).toBe('dark');
    }
  );
});
