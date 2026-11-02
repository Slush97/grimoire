// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPortableProfile, getProfiles, socialUpdateProfile, socialUpdateProfileContents, type Profile, type SocialUpdateProfileResponse } from '../../lib/api';
import type { PortableExportResult } from '../../types/portableProfile';
import EditProfileDialog from './EditProfileDialog';

vi.mock('../../lib/api', () => ({
  getProfiles: vi.fn(), exportPortableProfile: vi.fn(),
  socialUpdateProfile: vi.fn(), socialUpdateProfileContents: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const local: Profile = {
  id: 'local', name: 'Updated loadout', createdAt: '2026-10-25', updatedAt: '2026-10-25',
  mods: [{ fileName: 'pak01_dir.vpk', enabled: true, priority: 0 }],
};
const exported: PortableExportResult = {
  json: '{}', shareCode: 'mp1:replacement', warnings: ['Local mod omitted'],
  profile: {
    format: 'mod-profile', schemaVersion: '1.0', game: { steamAppId: 1422450 },
    exportedAt: '2026-10-25', exportedBy: { tool: 'Grimoire', version: '1.34.0' },
    profile: { name: 'Updated loadout' },
    mods: [{ source: 'gamebanana', ref: { submissionId: 1, fileId: 2 }, enabled: true, priority: 0, hint: { name: 'Abrams skin' } }],
  },
};
const updated: SocialUpdateProfileResponse = {
  id: 'published', title: 'Existing post', description: 'Existing description',
  mod_count: 1, has_nsfw: false, primary_hero: 'Abrams', like_count: 42,
  created_at: 100, updated_at: 200, is_featured: false,
  owner: { id: 'owner', display_name: 'Owner', avatar_url: null },
  share_code: exported.shareCode, viewer_has_liked: null, heroes: ['Abrams'], thumbnail_urls: [],
};

function saveButton() {
  const button = Array.from(document.querySelectorAll('button')).find((el) => el.textContent === 'social.editProfile.saveChanges');
  if (!button) throw new Error('Save button missing');
  return button;
}
async function choose(id: string) {
  const select = document.querySelector('select');
  if (!select) throw new Error('Profile picker missing');
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('EditProfileDialog', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getProfiles).mockResolvedValue([local, { ...local, id: 'other', name: 'Other loadout' }]);
    vi.mocked(exportPortableProfile).mockResolvedValue(exported);
    vi.mocked(socialUpdateProfileContents).mockResolvedValue(updated);
    vi.mocked(socialUpdateProfile).mockResolvedValue(updated);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function render() {
    await act(async () => root.render(
      <EditProfileDialog profileId="published" initialTitle="Existing post" initialDescription="Existing description" onClose={() => {}} onSaved={onSaved} />
    ));
  }

  it('previews shareable mods and omissions, then updates the existing post', async () => {
    await render();
    expect(saveButton().disabled).toBe(true);
    await choose('local');
    expect(document.body.textContent).toContain('Abrams skin');
    expect(document.body.textContent).toContain('Local mod omitted');
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(socialUpdateProfileContents).toHaveBeenCalledExactlyOnceWith('published', { share_code: exported.shareCode });
    expect(socialUpdateProfile).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(updated);
    expect(document.body.textContent).toContain('social.editProfile.saved');
  });

  it('keeps text-only edits on the existing endpoint', async () => {
    await render();
    const input = document.querySelector('input');
    if (!input) throw new Error('Title input missing');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Renamed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => saveButton().click());
    expect(socialUpdateProfile).toHaveBeenCalledExactlyOnceWith('published', { title: 'Renamed' });
    expect(socialUpdateProfileContents).not.toHaveBeenCalled();
  });

  it('blocks replacement when the export has no shareable mods', async () => {
    vi.mocked(exportPortableProfile).mockResolvedValue({ ...exported, profile: { ...exported.profile, mods: [] } });
    await render();
    await choose('local');
    expect(saveButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('social.publish.noGamebananaMods');
    expect(socialUpdateProfileContents).not.toHaveBeenCalled();
  });

  it('blocks replacement on export failure and allows keeping the original mods', async () => {
    vi.mocked(exportPortableProfile).mockRejectedValue(new Error('Export failed'));
    await render();
    await choose('local');
    expect(saveButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('Export failed');
    await choose('');
    expect(document.body.textContent).not.toContain('Export failed');
  });

  it('ignores an old export after a different profile is selected', async () => {
    let resolveFirst: (value: PortableExportResult) => void = () => { throw new Error('Export not started'); };
    const first = new Promise<PortableExportResult>((resolve) => { resolveFirst = resolve; });
    vi.mocked(exportPortableProfile).mockReturnValueOnce(first);
    await render();
    await choose('local');
    expect(saveButton().disabled).toBe(true);
    await choose('other');
    await act(async () => resolveFirst({ ...exported, shareCode: 'mp1:stale' }));
    await act(async () => saveButton().click());
    expect(socialUpdateProfileContents).toHaveBeenCalledWith('published', { share_code: exported.shareCode });
  });

  it('keeps the editor open when the server rejects the update', async () => {
    vi.mocked(socialUpdateProfileContents).mockRejectedValue(new Error('404 Not found'));
    await render();
    await choose('local');
    await act(async () => saveButton().click());
    expect(document.body.textContent).toContain('404 Not found');
    expect(saveButton().disabled).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
