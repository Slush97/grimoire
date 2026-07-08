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
