import { describe, expect, it, vi } from 'vitest';
vi.mock('./heroPoseModels', () => ({ withHeroSkinSource: vi.fn() }));
vi.mock('./modMerger', () => ({ runVpkmerge: vi.fn(), runVpkmergeStdout: vi.fn(), verifyVpkOutput: vi.fn() }));
vi.mock('./foundryExport', () => ({ exportVpkFileName: vi.fn(), exportVpkViaDialog: vi.fn() }));
import { partsFromDrawCalls, validateSkinEdits } from './skinEditor';

const fingerprint = 'a'.repeat(64);
const source = { heroName: 'Seven', skinSources: [], fingerprint };
const parts = partsFromDrawCalls({ draw_calls: [
  { material: 'coat.vmat', vertex_count: 10 }, { material: 'coat.vmat', vertex_count: 20 }, { material: 'head.vmat', vertex_count: 30 },
] });
const info = { fingerprint, entry: 'models/hero.vmdl_c', parts };

describe('skin overlay export', () => {
  it('groups all draw calls sharing a material', () => {
    expect(parts[0]).toMatchObject({ material: 'coat.vmat', drawCalls: 2, vertices: 30 });
  });
  it('omits parts already removed by the source skin', () => {
    expect(partsFromDrawCalls({ draw_calls: [{ material: 'removed.vmat', vertex_count: 100, index_count: 0 }] })).toEqual([]);
  });
  it('rejects changed sources, unknown parts, duplicate parts and an invisible model', () => {
    expect(() => validateSkinEdits(info, { ...source, fingerprint: 'b'.repeat(64), edits: [] })).toThrow('changed');
    expect(() => validateSkinEdits(info, { ...source, edits: [{ material: 'other.vmat', hidden: true, tint: null }] })).toThrow('Unknown');
    const edits = [{ material: 'coat.vmat', hidden: true, tint: null }];
    expect(() => validateSkinEdits(info, { ...source, edits: [...edits, ...edits] })).toThrow('repeated');
    expect(() => validateSkinEdits(info, { ...source, edits: parts.map((part) => ({ material: part.material, hidden: true, tint: null })) })).toThrow('visible');
  });
  it('rejects a removal selector that would hide another material', () => {
    const collision = { ...info, parts: [...parts, { ...parts[0], material: 'prefix/coat.vmat' }] };
    expect(() => validateSkinEdits(collision, { ...source, edits: [{ material: 'coat.vmat', hidden: true, tint: null }] })).toThrow('another part');
  });
  it('disallows expression-driven or unsupported tint edits', () => {
    const request = { ...source, edits: [{ material: 'coat.vmat', hidden: false, tint: '#4080ff' }] };
    expect(() => validateSkinEdits(info, request)).toThrow('static color tint');
    expect(() => validateSkinEdits({ ...info, parts: parts.map((part) => ({ ...part, tintable: true })) }, request)).not.toThrow();
  });
});
