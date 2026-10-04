import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ run: vi.fn(), stdout: vi.fn(), index: vi.fn(), attachments: vi.fn() }));
vi.mock('./modMerger', () => ({ runVpkmerge: h.run, runVpkmergeStdout: h.stdout }));
vi.mock('./vpk', () => ({ parseVpkDirectoryCached: h.index }));
vi.mock('./modelAttachments', () => ({ exportModelAttachments: h.attachments }));
import { exportParticleBundle, particleDescriptor } from './heroParticleExport';
const resource = (overrides = {}) => ({ _class: 'CParticleSystemDefinition', m_Renderers: [], ...overrides });
afterEach(() => vi.resetAllMocks());
describe('compiled particle export', () => {
  it('bundles the declared preview-model frames from mounted source without regenerating model geometry', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-declared-frames-test-'));
    const frames = [{ name: 'bolt_fx', bone: 'scapula_L', position: [2, 3, 4], rotation: [0, 0, 0, 1] }];
    h.attachments.mockResolvedValue(frames);
    h.stdout.mockImplementation(async (args: string[]) => JSON.stringify(args[1] === 'particles/root.vpcf_c' ? resource({
      m_controlPointConfigurations: [{ m_name: 'preview', m_previewState: { m_previewModel: 'models/heroes/frank.vmdl' } }],
    }) : { m_modelInfo: { m_keyValueText: 'CitadelModelParticleSettings_t = { m_flScale = 0.91 }' } }));
    try {
      const file = join(dir, 'effect.json');
      await exportParticleBundle('base.vpk', 'particles/root.vpcf_c', file, join(dir, 'tex'), undefined, ['skin.vpk', 'base.vpk'], 'preview');
      expect(h.attachments).toHaveBeenCalledWith('skin.vpk', 'base.vpk', 'models/heroes/frank.vmdl_c');
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({ attachments: frames, scale: 0.91 });
      expect(h.run).not.toHaveBeenCalled();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('preserves repeated child instances, sequential CP frame transfers and authored delays', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-child-frames-test-'));
    const anchors = [11, 12, 13].map((cp) => ({ m_iControlPoint: cp, m_attachmentName: `bolt_${cp}`, m_iAttachType: 'PATTACH_POINT_FOLLOW' }));
    const parent = resource({ m_controlPointConfigurations: [{ m_name: 'preview', m_drivers: anchors }],
      m_Children: [{ m_ChildRef: 'particles/bolts.vpcf' }] });
    const bolts = resource({ m_controlPointConfigurations: [{ m_name: 'preview', m_drivers: anchors.slice(0, 2) }],
      m_PreEmissionOperators: [{ _class: 'C_OP_SetParentControlPointsToChildCP', m_nChildControlPoint: 11,
        m_nNumControlPoints: 3, m_nFirstSourcePoint: 11, m_bSetOrientation: true }],
      m_Children: [{ m_ChildRef: 'particles/other.vpcf' },
        ...[0, 0.11, 0.15].map((m_flDelay) => ({ m_ChildRef: 'particles/spark.vpcf', m_flDelay, m_nGroupId: 99 }))] });
    h.stdout.mockImplementation(async (args: string[]) => JSON.stringify(args[1] === 'particles/root.vpcf_c' ? parent
      : args[1] === 'particles/bolts.vpcf_c' ? bolts : args[1] === 'particles/spark.vpcf_c'
        ? resource({ m_Children: [{ m_ChildRef: 'particles/aura.vpcf' }] }) : resource({ m_nGroupID: 9 })));
    try {
      const file = join(dir, 'effect.json');
      await exportParticleBundle('base.vpk', 'particles/root.vpcf_c', file, join(dir, 'tex'), undefined, [], 'preview');
      const all = (JSON.parse(await fs.readFile(file, 'utf8')) as ReturnType<typeof particleDescriptor>).children[0].children;
      expect(all[0].controlPoints.find((cp) => cp.cp === 11)?.attachment).toBe('bolt_11');
      const children = all.slice(1);
      expect(children).toHaveLength(3);
      expect(children.map((d) => d.startDelay ?? 0)).toEqual([0, 0.11, 0.15]);
      expect(children.map((d) => d.controlPoints.find((cp) => cp.cp === 11)?.attachment)).toEqual(['bolt_11', 'bolt_12', 'bolt_13']);
      expect(children.map((d) => d.children[0].controlPoints.find((cp) => cp.cp === 11)?.attachment)).toEqual(['bolt_11', 'bolt_12', 'bolt_13']);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('selects one authored configuration instead of combining incompatible CP drivers', () => {
    const raw = resource({ m_controlPointConfigurations: [
      { m_name: 'game', m_drivers: [{ m_iControlPoint: 1, m_attachmentName: 'game_anchor' }] },
      { m_name: 'preview', m_drivers: [{ m_iControlPoint: 1, m_attachmentName: 'preview_anchor' }] },
    ] });
    expect(particleDescriptor(raw, 'root', 'preview').controlPoints.map((cp) => cp.attachment)).toEqual(['preview_anchor']);
    expect(particleDescriptor(raw, 'root').controlPoints.map((cp) => cp.attachment)).toEqual(['game_anchor']);
  });
  it('resolves exact texture owners in skin, Citadel, core order without overriding higher priority', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-particle-mount-test-'));
    const textureNames = ['override', 'base', 'core'];
    h.stdout.mockResolvedValue(JSON.stringify(resource({ m_Renderers: [{ _class: 'C_OP_RenderSprites',
      m_vecTexturesInput: textureNames.map((name) => ({ m_hTexture: `materials/particle/${name}.vtex` })) }] })));
    h.index.mockImplementation((pak: string) => ({
      'skin.vpk': ['materials/particle/override.vtex_c'],
      'base.vpk': ['materials/particle/override.vtex_c', 'materials/particle/base.vtex_c'],
      'core.vpk': textureNames.map((name) => `materials/particle/${name}.vtex_c`),
    })[pak]);
    h.run.mockImplementation(async (args: string[]) => {
      const scratch = args[args.indexOf('--out-dir') + 1];
      const pak = args[args.indexOf('--vpk') + 1];
      for (let i = 0; i < args.length; i++) if (args[i] === '--prefix') {
        const entry = args[i + 1];
        const png = join(scratch, entry.replace(/\.vtex_c$/, '.png'));
        const raw = join(scratch, '_raw', entry);
        await fs.mkdir(join(png, '..'), { recursive: true });
        await fs.mkdir(join(raw, '..'), { recursive: true });
        await fs.writeFile(png, pak);
        await fs.writeFile(raw, Buffer.alloc(16));
      }
    });
    try {
      await exportParticleBundle('base.vpk', 'particles/root.vpcf_c', join(dir, 'effect.json'), join(dir, 'tex'), undefined,
        ['skin.vpk', 'base.vpk', 'core.vpk', 'skin.vpk']);
      for (const [name, owner] of [['override', 'skin.vpk'], ['base', 'base.vpk'], ['core', 'core.vpk']]) {
        expect(await fs.readFile(join(dir, 'tex', `materials_particle_${name}_vtex.png`), 'utf8')).toBe(owner);
      }
      expect(h.index).toHaveBeenCalledTimes(3);
      expect(h.run).toHaveBeenCalledTimes(3);
      expect(h.stdout.mock.calls[0][0]).toContain('base.vpk');
      expect(await fs.readdir(join(dir, 'tex'))).toHaveLength(3);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('never sends malformed texture paths to a decoder and refuses missing mounted entries', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-particle-missing-test-'));
    h.stdout.mockResolvedValue(JSON.stringify(resource({ m_Renderers: [{ _class: 'C_OP_RenderSprites',
      m_vecTexturesInput: ['../escape.vtex', 'materials/../escape.vtex', 'C:/secret.vtex', 'materials/particle/missing.vtex']
        .map((m_hTexture) => ({ m_hTexture })) }] })));
    h.index.mockReturnValue([]);
    try {
      await expect(exportParticleBundle('base.vpk', 'particles/root.vpcf_c', join(dir, 'effect.json'), join(dir, 'tex'), undefined,
        ['skin.vpk', 'base.vpk', 'core.vpk'])).rejects.toThrow('absent from mounted packages: materials/particle/missing.vtex');
      expect(h.run).not.toHaveBeenCalled();
      await expect(fs.access(join(dir, 'effect.json'))).rejects.toThrow();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('normalizes scalar and vector wrappers while keeping authored curves', () => {
    const d = particleDescriptor(resource({ m_Initializers: [{ _class: 'C_INIT_InitFloat', m_InputValue: {
      m_nType: 'PF_TYPE_PARTICLE_AGE_NORMALIZED', m_Curve: { m_spline: [{ x: 0, y: 1 }] },
    } }, { _class: 'C_INIT_PositionOffset', m_OffsetMin: { m_nType: 'PVEC_TYPE_LITERAL', m_vLiteralValue: [0, -5, 0] } }] }), 'test');
    expect(d.initializers[0].params.m_InputValue).toMatchObject({ pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED', curve: { m_spline: [{ x: 0, y: 1 }] } });
    expect(d.initializers[1].params.m_OffsetMin).toEqual([0, -5, 0]);
    expect(() => particleDescriptor({ _class: 'SoundEvent' }, 'test')).toThrow('Not a compiled');
  });
  it('preserves lifespan, older texture fields and unsupported stages for diagnostics', () => {
    const d = particleDescriptor(resource({ m_flConstantLifespan: { m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: 3 },
      m_Renderers: [{ _class: 'C_OP_RenderSprites', m_hTexture: 'materials/particle/glow.vtex' },
        { _class: 'C_OP_RenderSprites', m_hTexture: '../escape.vtex' }],
      m_PreEmissionOperators: [{ _class: 'C_OP_SetControlPointToPlayer' }],
      m_ForceGenerators: [{ _class: 'C_OP_TurbulenceForce' }],
      m_Constraints: [{ _class: 'C_OP_WorldCollideConstraint' }],
    }), 'test');
    expect(d.constantLifespan).toBe(3);
    expect(d.renderers[0].textures).toEqual(['materials/particle/glow.vtex']);
    expect(d.renderers[1].textures).toEqual([]);
    expect(d.preEmissionOperators?.[0].class).toBe('C_OP_SetControlPointToPlayer');
    expect(d.forces?.[0].class).toBe('C_OP_TurbulenceForce');
    expect(d.constraints?.[0].class).toBe('C_OP_WorldCollideConstraint');
  });
  it('uses supported generic KV3 decode, bounded texture prefixes and inherited child attachments', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-particle-test-'));
    const parent = resource({
      m_controlPointConfigurations: [{ m_drivers: [{ m_iControlPoint: 2, m_attachmentName: 'ability_cast' }] }],
      m_Children: [{ m_ChildRef: 'particles/child.vpcf' }],
      m_Renderers: [{ _class: 'C_OP_RenderSprites', m_vecTexturesInput: [
        { m_hTexture: 'materials/particle/noise.vtex' }, { m_hTexture: 'materials/particle/ring.vtex' },
      ] }],
    });
    h.stdout.mockImplementation(async (args: string[]) => JSON.stringify(args[1] === 'particles/root.vpcf_c' ? parent : resource({
      m_Renderers: [{ _class: 'C_OP_RenderSprites', m_vecTexturesInput: [{ m_hTexture: 'materials/particle/glow.vtex' }] }],
    })));
    h.run.mockImplementation(async (args: string[]) => {
      const scratch = args[args.indexOf('--out-dir') + 1];
      await fs.mkdir(join(scratch, 'materials', 'particle'), { recursive: true });
      for (const name of ['noise', 'ring', 'glow']) await fs.writeFile(join(scratch, 'materials', 'particle', `${name}.png`), `synthetic ${name}`);
      await fs.mkdir(join(scratch, '_raw', 'materials', 'particle'), { recursive: true });
      for (const name of ['noise', 'ring', 'glow']) await fs.writeFile(join(scratch, '_raw', 'materials', 'particle', `${name}.vtex_c`), Buffer.alloc(16));
    });
    try {
      await exportParticleBundle('base.vpk', 'particles/root.vpcf_c', join(dir, 'effect.json'), join(dir, 'tex'));
      expect(h.stdout.mock.calls[0][0]).toEqual(['soundevents', 'particles/root.vpcf_c', '--from-vpk', 'base.vpk']);
      expect(h.stdout.mock.calls[1][0]).toEqual(['soundevents', 'particles/child.vpcf_c', '--from-vpk', 'base.vpk']);
      const dumpArgs = h.run.mock.calls[0][0];
      expect(dumpArgs.slice(0, 4)).toEqual(['panorama', 'dump', '--vpk', 'base.vpk']);
      expect(dumpArgs.slice(6)).toEqual(['--prefix', 'materials/particle/noise.vtex_c',
        '--prefix', 'materials/particle/ring.vtex_c', '--prefix', 'materials/particle/glow.vtex_c']);
      const d = JSON.parse(await fs.readFile(join(dir, 'effect.json'), 'utf8'));
      expect(d.children[0].controlPoints[0].attachment).toBe('ability_cast');
      for (const name of ['noise', 'ring', 'glow']) expect(await fs.readFile(join(dir, 'tex', `materials_particle_${name}_vtex.png`), 'utf8')).toBe(`synthetic ${name}`);
      expect(await fs.readdir(join(dir, 'tex'))).toHaveLength(3);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('refuses invalid and cyclic resource references before producing a descriptor', async () => {
    await expect(exportParticleBundle('base.vpk', '../evil.vpcf_c', 'unused', 'unused')).rejects.toThrow('Invalid particle');
    h.stdout.mockResolvedValue(JSON.stringify(resource({ m_Children: [{ m_ChildRef: 'particles/root.vpcf' }] })));
    await expect(exportParticleBundle('base.vpk', 'particles/root.vpcf_c', 'unused', 'unused')).rejects.toThrow('exceeds preview limits');
  });
  it('bounds graph and unique texture budgets before decoding textures', async () => {
    h.stdout.mockImplementation(async (args: string[]) => JSON.stringify(resource({
      m_Children: args[1] === 'particles/root.vpcf_c'
        ? Array.from({ length: 32 }, (_, i) => ({ m_ChildRef: `particles/child${i}.vpcf` })) : [],
    })));
    await expect(exportParticleBundle('base.vpk', 'particles/root.vpcf_c', 'unused', 'unused')).rejects.toThrow('graph exceeds');
    expect(h.run).not.toHaveBeenCalled();
    h.stdout.mockResolvedValue(JSON.stringify(resource({ m_Renderers: [{
      _class: 'C_OP_RenderSprites', m_vecTexturesInput: Array.from({ length: 25 }, (_, i) => ({ m_hTexture: `materials/particle/glow${i}.vtex` })),
    }] })));
    await expect(exportParticleBundle('base.vpk', 'particles/root.vpcf_c', 'unused', 'unused')).rejects.toThrow('textures exceed');
    expect(h.run).not.toHaveBeenCalled();
  });
});
import type { FxDescriptor } from '../../../src/components/locker/fxDescriptor';
describe('independent authored ambient roots', () => {
  it('keeps independent control-point frames and distributes two repeated children without merging instances', async () => {
    const root = 'particles/test/head.vpcf_c', weapon = 'particles/test/weapon.vpcf_c', child = 'particles/test/end.vpcf_c';
    const raw = {
      [root]: { _class: 'CParticleSystemDefinition', m_controlPointConfigurations: [{ m_name: 'preview', m_drivers: [{ m_attachmentName: 'head', m_iAttachType: 'PATTACH_POINT_FOLLOW' }] }] },
      [weapon]: { _class: 'CParticleSystemDefinition', m_controlPointConfigurations: [{ m_name: 'preview', m_drivers: [
        { m_iControlPoint: 1, m_attachmentName: 'top' }, { m_iControlPoint: 2, m_attachmentName: 'bottom' }] }],
        m_PreEmissionOperators: [{ _class: 'C_OP_SetParentControlPointsToChildCP', m_nChildControlPoint: 3, m_nFirstSourcePoint: 1, m_nNumControlPoints: 2, m_bSetOrientation: true }],
        m_Children: [{ m_ChildRef: child }, { m_ChildRef: child }] },
      [child]: { _class: 'CParticleSystemDefinition' },
    };
    h.stdout.mockImplementation(async ([pathType, path]) => { expect(pathType).toBe('soundevents'); return JSON.stringify(raw[path as keyof typeof raw]); });
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-ambient-roots-'));
    try {
      const file = join(dir, 'effect.json');
      await exportParticleBundle('pak', root, file, join(dir, 'tex'), undefined, [], 'preview', [weapon, weapon, root]);
      const d: FxDescriptor = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(d.controlPoints[0].attachment).toBe('head');
      expect(d.children).toHaveLength(1);
      expect(d.children[0].children.map(c => c.controlPoints.find(p => p.cp === 3)?.attachment)).toEqual(['top', 'bottom']);
      expect(d.children[0].controlPoints.some(p => p.attachment === 'head')).toBe(false);
      await expect(exportParticleBundle('pak', root, file, join(dir, 'tex'), undefined, [], 'preview', [weapon, weapon, weapon, weapon])).rejects.toThrow('roots exceed');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
