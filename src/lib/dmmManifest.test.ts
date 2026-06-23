import { describe, it, expect } from 'vitest';
import { parseDmmManifest } from './dmmManifest';

describe('parseDmmManifest', () => {
  it('rejects non-JSON', () => {
    expect(() => parseDmmManifest('not json')).toThrow(/JSON parse failed/);
  });

  it('rejects a non-object top level', () => {
    expect(() => parseDmmManifest('[]')).toThrow(/must be a JSON object/);
  });

  it('rejects an unknown future major version', () => {
    expect(() => parseDmmManifest(JSON.stringify({ version: 2, mods: {} }))).toThrow(
      /Unsupported .dmm.json version: 2/
    );
  });

  it('accepts a missing version and missing mods', () => {
    expect(parseDmmManifest('{}')).toEqual({});
  });

  it('rejects mods that is not an object map', () => {
    expect(() => parseDmmManifest(JSON.stringify({ mods: [] }))).toThrow(/must be an object map/);
  });
});
