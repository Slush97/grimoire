import { describe, expect, it } from 'vitest';
import { browseModKey, browseModSection, toggleBrowseSection } from './browseSections';

describe('Browse section selection', () => {
  it('combines sections and removes one without permitting an empty feed', () => {
    const both = toggleBrowseSection(['Mod'], 'Sound');
    expect(both).toEqual(['Mod', 'Sound']);
    expect(toggleBrowseSection(both, 'Mod')).toEqual(['Sound']);
    expect(toggleBrowseSection(['Sound'], 'Sound')).toEqual(['Sound']);
  });

  it('keeps equal item numbers in different sections distinct', () => {
    const mod = { id: 42, profileUrl: 'https://gamebanana.com/mods/42' };
    const sound = { id: 42, profileUrl: 'https://gamebanana.com/sounds/42' };
    expect(browseModKey(mod)).toBe('Mod:42');
    expect(browseModKey(sound)).toBe('Sound:42');
    expect(browseModSection({ section: 'Wip', profileUrl: '' })).toBe('Wip');
  });
});
