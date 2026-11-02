import { describe, expect, it } from 'vitest';
import { skinEditErrorDetail, skinEditErrorMessage } from './skinEditError';

const t = (key: string) => key;

describe('skinEditErrorMessage', () => {
  it('keeps a plain sentence from the main process', () => {
    const reason = new Error("Error invoking remote method 'foundry:exportSkinEdits': Error: No skin changes to export.");
    expect(skinEditErrorDetail(reason)).toBe('No skin changes to export.');
    expect(skinEditErrorMessage(reason, t)).toBe('No skin changes to export.');
  });
  it('never shows a validation dump or tool output', () => {
    const zod = new Error(`Error invoking remote method 'foundry:saveSkinEdits': ZodError: [ { "code": "unrecognized_keys", "keys": [ "finish" ] } ]`);
    expect(skinEditErrorMessage(zod, t)).toBe('foundry.skin.errors.generic');
    expect(skinEditErrorMessage(new Error('vpkmerge exited with code 1: thread main panicked at src/lib.rs'), t)).toBe('foundry.skin.errors.generic');
  });
  it('names problems a player can fix', () => {
    expect(skinEditErrorMessage(new Error("Error invoking remote method 'x': Error: Game is running"), t)).toBe('common.gameRunningWarning');
    expect(skinEditErrorMessage(new Error('ENOSPC: no space left on device, write'), t)).toBe('foundry.skin.errors.diskFull');
    expect(skinEditErrorMessage(new Error("EBUSY: resource busy or locked, open 'C:\\pak07_dir.vpk'"), t)).toBe('foundry.skin.errors.fileBusy');
  });
});
