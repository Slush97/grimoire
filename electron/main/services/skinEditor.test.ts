import { describe, expect, it, vi } from 'vitest';
vi.mock('./heroPoseModels', () => ({ withHeroSkinSource: vi.fn() }));
vi.mock('./modMerger', () => ({ runVpkmerge: vi.fn(), runVpkmergeStdout: vi.fn(), verifyVpkOutput: vi.fn() }));
vi.mock('./foundryExport', () => ({ exportVpkFileName: vi.fn(), exportVpkViaDialog: vi.fn() }));
import { buildSkinEditVpk, getSkinEditInfo, partsFromDrawCalls, validateSkinEdits, formDrawCalls } from './skinEditor';
import { withHeroSkinSource } from './heroPoseModels';
import { runVpkmerge, runVpkmergeStdout } from './modMerger';

const fingerprint = 'a'.repeat(64);
const source = { heroName: 'Seven', skinSources: [], fingerprint };
const parts = partsFromDrawCalls({ draw_calls: [
  { material: 'coat.vmat', vertex_count: 10 }, { material: 'coat.vmat', vertex_count: 20 }, { material: 'head.vmat', vertex_count: 30 },
] });
const info = { fingerprint, entry: 'models/hero.vmdl_c', parts };

describe('skin overlay export', () => {
  it('uses the stone-form particle material instead of the model original materials', () => {
    const selected = formDrawCalls({ draw_calls: [{ material: 'wings.vmat', vertex_count: 3 }, { material: 'body.vmat', vertex_count: 9 }] }, {}, { materialOverride: 'stone.vmat' });
    expect(partsFromDrawCalls(selected)).toMatchObject([{ material: 'stone.vmat', drawCalls: 2, vertices: 12 }]);
    expect(selected.hideable.get('stone.vmat')).toBe(false);
  });
  it('uses authored body masks and keeps shared parts in both forms', () => {
    const calls = { draw_calls: [
      { material: 'body.vmat', vertex_count: 3, mesh_index: 0 },
      { material: 'shared.vmat', vertex_count: 3, mesh_index: 1 },
      { material: 'ball.vmat', vertex_count: 3, mesh_index: 2 },
    ] };
    const model = { m_meshGroups: ['default_@0_#&body', 'default_@1_#&inflated'], m_nDefaultMeshGroupMask: 1, m_refMeshGroupMasks: [1, 3, 2] };
    expect(formDrawCalls(calls, model, {}).draw_calls.map((call) => call.material)).toEqual(['body.vmat', 'shared.vmat']);
    expect(formDrawCalls(calls, model, { meshGroup: 'inflated' }).draw_calls.map((call) => call.material)).toEqual(['shared.vmat', 'ball.vmat']);
    expect(() => formDrawCalls(calls, model, { meshGroup: 'missing' })).toThrow('body group');
  });
  it('inspects the replacement materials and prevents state-specific geometry removal', () => {
    const model = { m_materialGroups: [
      { m_name: 'default', m_materials: ['body.vmat', 'gun.vmat'] },
      { m_name: 'ultimate', m_materials: ['rage.vmat', 'gun.vmat'] },
    ] };
    const calls = { draw_calls: [{ material: 'body.vmat', vertex_count: 3 }, { material: 'gun.vmat', vertex_count: 3 }] };
    const selected = formDrawCalls(calls, model, { materialGroup: 'ultimate' });
    expect(selected.draw_calls.map((call) => call.material)).toEqual(['rage.vmat', 'gun.vmat']);
    expect(selected.hideable.get('rage.vmat')).toBe(false);
    expect(selected.hideable.get('gun.vmat')).toBe(true);
    expect(() => formDrawCalls(calls, model, { materialGroup: 'missing' })).toThrow('material group');
  });
  it('protects separate forms on the same model and rejects hiding swapped geometry', () => {
    const stateInfo = { ...info, parts: [
      { ...parts[0], formIds: ['default'], modelEntries: ['shared.vmdl_c'] },
      { ...parts[1], formIds: ['ball'], modelEntries: ['shared.vmdl_c'], hideable: false },
    ] };
    expect(() => validateSkinEdits(stateInfo, { ...source, edits: [{ material: 'coat.vmat', hidden: true, tint: null }] })).toThrow('visible');
    expect(() => validateSkinEdits(stateInfo, { ...source, edits: [{ material: 'head.vmat', hidden: true, tint: null }] })).toThrow('shares geometry');
  });
  it('keeps each form visible independently', () => {
    const forms = { ...info, parts: [
      { ...parts[0], modelEntries: ['base.vmdl_c'] },
      { ...parts[1], modelEntries: ['transformed.vmdl_c'] },
    ] };
    expect(() => validateSkinEdits(forms, { ...source, edits: [{ material: 'head.vmat', hidden: true, tint: null }] })).toThrow('visible');
  });
  it('counts finish-only edits and rejects materials with unsupported finish bindings', () => {
    const request = { ...source, edits: [{ material: 'coat.vmat', hidden: false, tint: null, finish: { roughness: 0.2, metalness: 1 } }] };
    expect(() => validateSkinEdits(info, request)).toThrow('static material finishes');
    expect(() => validateSkinEdits({ ...info, parts: parts.map((part) => ({ ...part, finishable: true })) }, request)).not.toThrow();
  });
  it('counts surface-only edits and rejects unsupported transparency bindings', () => {
    const request = { ...source, edits: [{ material: 'coat.vmat', hidden: false, tint: null, surface: { mode: 'translucent' as const, opacity: 0.35 } }] };
    expect(() => validateSkinEdits(info, request)).toThrow('static transparency');
    expect(() => validateSkinEdits({ ...info, parts: parts.map((part) => ({ ...part, surfaceable: true })) }, request)).not.toThrow();
  });
  it('rejects persisted experimental Ghost edits even on a transparency-capable part', () => {
    const capable = { ...info, parts: parts.map((part) => ({ ...part, surfaceable: true })) };
    const request = { ...source, edits: [{ material: 'coat.vmat', hidden: false, tint: null, surface: { mode: 'ghost' as const, opacity: 0.35 } }] };
    expect(() => validateSkinEdits(capable, request)).toThrow('Ghost surfaces are experimental and cannot be exported from the editor. Choose Translucent or Original.');
    expect(() => validateSkinEdits(info, { ...request, edits: request.edits.map((edit) => ({ ...edit, hidden: true })) })).not.toThrow();
  });
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

describe('skin transparency export chain', () => {
  it('composes translucency after paint/tint and separates opacity before applying a finish', async () => {
    const mode = 'translucent';
    vi.mocked(runVpkmerge).mockClear();
    vi.mocked(runVpkmergeStdout).mockClear();
    const key = '9'.repeat(64);
    vi.mocked(withHeroSkinSource).mockImplementation(async (_path, _hero, _sources, action) => action({
      vpk: 'skin.vpk', base: 'game.vpk', entry: 'model.vmdl_c', fingerprint: key,
    }));
    vi.mocked(runVpkmergeStdout).mockImplementation(async (args) => args[0] === 'model'
      ? JSON.stringify({ draw_calls: [{ material: 'coat.vmat', vertex_count: 3 }] })
      : args[0] === 'texture-info' ? JSON.stringify({ width: 512, height: 512 })
      : JSON.stringify({ m_shaderName: 'pbr.vfx', m_vectorParams: [],
        m_textureParams: [{ m_name: 'g_tColor', m_pValue: 'coat.vtex' }] }));
    const progress: unknown[] = [];
    await buildSkinEditVpk('game', { heroName: 'Abrams', skinSources: [], fingerprint: key, edits: [{
      material: 'coat.vmat', hidden: false, tint: '#ff8800',
      pattern: { style: 'gradient', intensity: 1, phase: 0, scroll: 0.5 },
      surface: { mode, opacity: 0.35 }, finish: { roughness: 0.2, metalness: 0 },
    }] }, 'out.vpk', (event) => progress.push(event));
    const calls = vi.mocked(runVpkmerge).mock.calls.map(([args]) => args);
    expect(calls.map((args) => args[0])).toEqual(['trippy-skin', 'vmat', 'workshop', 'workshop', 'out.vpk']);
    const paint = calls[0], tint = calls[1], surface = calls[2], finish = calls[3];
    const outputOf = (args: string[]) => args[args.indexOf('--encode-vpk') + 1];
    expect(tint[tint.indexOf('--vpk') + 1]).toBe(outputOf(paint));
    expect(surface[surface.indexOf('--vpk') + 1]).toBe(outputOf(tint));
    expect(surface).toEqual(expect.arrayContaining(['surface', '--mode', mode, '--opacity', '0.35']));
    expect(finish[finish.indexOf('--vpk') + 1]).toBe(outputOf(surface));
    expect(progress.at(-1)).toEqual({ stage: 'build', completed: 5, total: 5 });
    vi.mocked(runVpkmergeStdout).mockClear();
  });
});

describe('skin inspection cache', () => {
  it('allows static pbr opacity and excludes cutouts, expression-driven alpha and unsupported shaders', async () => {
    vi.mocked(withHeroSkinSource).mockImplementation(async (_path, _hero, _sources, action) => action({
      vpk: 'skin.vpk', base: 'game.vpk', entry: 'surfaces.vmdl_c', fingerprint: '7'.repeat(64),
    }));
    vi.mocked(runVpkmergeStdout).mockImplementation(async (args) => {
      if (args[0] === 'model') return JSON.stringify({ draw_calls: ['plain', 'cutout', 'dynamic', 'animated-mask', 'other'].map((name) => ({ material: `${name}.vmat`, vertex_count: 3 })) });
      const entry = args[1];
      return JSON.stringify({ m_shaderName: entry === 'other.vmat_c' ? 'effects.vfx' : 'pbr.vfx', m_vectorParams: [],
        m_textureParams: [{ m_name: 'g_tColor', m_pValue: 'part.vtex' }],
        m_intParams: entry === 'cutout.vmat_c' ? [{ m_name: 'F_ALPHA_TEST', m_nValue: 1 }] : [],
        m_dynamicParams: entry === 'dynamic.vmat_c' ? [{ m_name: 'g_flOpacityScale1' }] : [],
        m_dynamicTextureParams: entry === 'animated-mask.vmat_c' ? [{ m_name: 'g_tAltTranslucency' }] : [] });
    });
    const result = await getSkinEditInfo('game', { heroName: 'Abrams', skinSources: [] });
    expect(result.parts.filter((part) => part.surfaceable).map((part) => part.material)).toEqual(['plain.vmat']);
    vi.mocked(runVpkmergeStdout).mockClear();
  });
  it('allows pbr materials that use the default tint, while keeping animated tints read-only', async () => {
    vi.mocked(withHeroSkinSource).mockImplementation(async (_path, _hero, _sources, action) => action({
      vpk: 'skin.vpk', base: 'game.vpk', entry: 'hair.vmdl_c', fingerprint: 'e'.repeat(64),
    }));
    vi.mocked(runVpkmergeStdout).mockImplementation(async (args) => {
      if (args[0] === 'model') return JSON.stringify({ draw_calls: [
        { material: 'hair.vmat', vertex_count: 3 }, { material: 'eyes.vmat', vertex_count: 3 },
      ] });
      return JSON.stringify({ m_shaderName: 'pbr.vfx', m_vectorParams: [],
        m_dynamicParams: args[1] === 'eyes.vmat_c' ? [{ m_name: 'g_vColorTint1' }] : [] });
    });
    const result = await getSkinEditInfo('game', { heroName: 'Abrams', skinSources: [] });
    expect(result.parts.find((part) => part.material === 'hair.vmat')?.tintable).toBe(true);
    expect(result.parts.find((part) => part.material === 'eyes.vmat')?.tintable).toBe(false);
    vi.mocked(runVpkmergeStdout).mockClear();
  });
  it('reuses inspection until the source/game fingerprint changes and retries a failure', async () => {
    let version = 'c'.repeat(64);
    vi.mocked(withHeroSkinSource).mockImplementation(async (_path, _hero, _sources, action) => action({
      vpk: 'skin.vpk', base: 'game.vpk', entry: 'model.vmdl_c', fingerprint: version,
    }));
    vi.mocked(runVpkmergeStdout).mockResolvedValue('{"draw_calls":[]}');
    const get = () => getSkinEditInfo('game', { heroName: 'Mina', skinSources: [] });
    await Promise.all([get(), get()]);
    expect(runVpkmergeStdout).toHaveBeenCalledTimes(1);
    await get(); expect(runVpkmergeStdout).toHaveBeenCalledTimes(1);
    version = 'd'.repeat(64);
    vi.mocked(runVpkmergeStdout).mockRejectedValueOnce(new Error('unavailable'));
    await expect(get()).rejects.toThrow('unavailable');
    await get(); expect(runVpkmergeStdout).toHaveBeenCalledTimes(3);
  });
});
