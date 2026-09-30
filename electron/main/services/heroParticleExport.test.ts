import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ run: vi.fn(), stdout: vi.fn() }));
vi.mock('./modMerger', () => ({ runVpkmerge: h.run, runVpkmergeStdout: h.stdout }));
import { exportParticleBundle, particleDescriptor } from './heroParticleExport';
const resource = (overrides = {}) => ({ _class: 'CParticleSystemDefinition', m_Renderers: [], ...overrides });
afterEach(() => vi.resetAllMocks());
describe('compiled particle export', () => {
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
        ? Array.from({ length: 16 }, (_, i) => ({ m_ChildRef: `particles/child${i}.vpcf` })) : [],
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
