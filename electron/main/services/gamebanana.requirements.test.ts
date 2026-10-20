import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class { static getAllWindows() { return []; } } }));
vi.mock('./modDatabase', () => ({ getCachedCategoryTree: vi.fn(), saveCachedCategoryTree: vi.fn() }));
vi.mock('./modRequirementCache', () => ({ cacheRequirements: vi.fn() }));
import { fetchModDetails, fetchModRequirements } from './gamebanana';

afterEach(() => vi.unstubAllGlobals());
describe('GameBanana requirement requests', () => {
  it('does not request an unsupported property for WiPs', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ _idRow: 1, _sName: 'WiP' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchModRequirements(1, 'Wip')).toMatchObject({ status: 'loaded', items: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(await fetchModDetails(1, 'Wip')).toMatchObject({ requirements: { status: 'loaded', items: [] } });
    expect(String(fetch.mock.calls[0][0])).not.toContain('_aRequirements');
  });
  it('reads normal requirement rows with the existing details request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ _idRow: 711434, _sName: 'Recolor', _aRequirements: [['Base model', 'https://gamebanana.com/mods/704252', '1', '7']] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const details = await fetchModDetails(711434);
    expect(details.requirements).toMatchObject({ status: 'loaded', items: [{ importance: 'required', state: 'on' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('resolves unfamiliar codes from ProfilePage labels', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({ _aRequirements: url.endsWith('ProfilePage')
      ? [['Optional model', '', 'On', 'BlueColor', 'Recommended', 'GreenColor']]
      : [['Optional model', '', '1', '99']] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchModRequirements(1)).toMatchObject({ status: 'loaded', items: [{ importance: 'optional', state: 'on' }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
