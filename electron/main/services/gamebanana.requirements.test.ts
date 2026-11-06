import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class { static getAllWindows() { return []; } } }));
vi.mock('./modDatabase', () => ({ getCachedCategoryTree: vi.fn(), saveCachedCategoryTree: vi.fn() }));
vi.mock('./modRequirementCache', () => ({ cacheRequirements: vi.fn() }));
import { fetchModDetails, fetchModRequirements } from './gamebanana';
import { cacheRequirements } from './modRequirementCache';

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
      ? [['Recommended model', '', 'On', 'BlueColor', 'Recommended', 'GreyColor']]
      : [['Recommended model', '', '2', '99']] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchModRequirements(1)).toMatchObject({ status: 'loaded', items: [{ importance: 'recommended', state: 'on' }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('infers missing labels without a second request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ _aRequirements: [
      ['NoStam', 'https://gamebanana.com/mods/640378'],
      ['(Optional)Doorman Fox mod', 'https://gamebanana.com/mods/1'],
      ['Recommended addon', 'https://gamebanana.com/mods/2'],
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const snapshot = await fetchModRequirements(634638);
    expect(snapshot).toMatchObject({ status: 'loaded', items: [
      { importance: 'required' }, { importance: 'optional' }, { importance: 'recommended' },
    ] });
    expect(cacheRequirements).toHaveBeenLastCalledWith({ id: 634638, section: 'Mod' }, snapshot);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['unavailable', 'unknown', 'missing'] as const)('infers unresolved importance when ProfilePage labels are %s', async mode => {
    const names = ['Base mod', '(Optional) Recommended addon', '(Recommended) addon'];
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('ProfilePage') && mode === 'unavailable') return new Response('', { status: 404 });
      if (url.endsWith('ProfilePage') && mode === 'missing') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ _aRequirements: names.map(name => url.endsWith('ProfilePage')
        ? [name, '', 'On', '', 'Unknown label', ''] : [name, '', '999', '7']) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchModRequirements(1)).toMatchObject({ status: 'loaded', items: [
      { importance: 'required' }, { importance: 'optional' }, { importance: 'recommended' },
    ] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uses an explicit ProfilePage label before inspecting the name', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({ _aRequirements: url.endsWith('ProfilePage')
      ? [['(Optional) Base mod', '', 'On', '', 'Required', '']]
      : [['(Optional) Base mod', '', '999', '7']] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchModRequirements(1)).toMatchObject({ items: [{ importance: 'required' }] });
  });
});
