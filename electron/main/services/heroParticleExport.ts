import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FxDescriptor, FxNode, FxRenderer } from '../../../src/components/locker/fxDescriptor';
import { fxTexturePngName } from '../../../src/components/locker/fxDescriptor';
import { runVpkmerge, runVpkmergeStdout } from './modMerger';
import { readParticleSheet } from './particleSheet';
import { parseVpkDirectoryCached } from './vpk';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];

function parameter(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(parameter);
  if (!v || typeof v !== 'object') return v;
  const r = row(v);
  if (typeof r.m_nType === 'string' && r.m_nType.startsWith('PF_TYPE_')) {
    return r.m_nType === 'PF_TYPE_LITERAL' ? r.m_flLiteralValue : {
      pf: r.m_nType, min: r.m_flRandomMin, max: r.m_flRandomMax, cp: r.m_nControlPoint,
      in0: r.m_flInput0, in1: r.m_flInput1, out0: r.m_flOutput0, out1: r.m_flOutput1,
      curve: parameter(r.m_Curve),
      bias: r.m_flBiasParameter, biasType: r.m_nBiasType,
    };
  }
  if (r.m_nType === 'PVEC_TYPE_LITERAL') return r.m_vLiteralValue;
  return Object.fromEntries(Object.entries(r).map(([key, value]) => [key, parameter(value)]));
}

function nodes(value: unknown): FxNode[] {
  return rows(value).slice(0, 128).map((r) => ({
    class: String(r._class ?? ''),
    params: parameter(r) as Row,
  }));
}

export function particleDescriptor(raw: unknown, name: string, configuration?: string): FxDescriptor {
  const r = row(raw);
  if (r._class !== 'CParticleSystemDefinition') throw new Error('Not a compiled particle system.');
  const configurations = rows(r.m_controlPointConfigurations);
  const selected = configuration ? configurations.find((c) => c.m_name === configuration) : undefined;
  const drivers = rows((selected ?? configurations[0])?.m_drivers);
  const renderers: FxRenderer[] = rows(r.m_Renderers).slice(0, 16).map((renderer) => ({
    class: String(renderer._class ?? ''), params: parameter(renderer) as Row,
    mode: renderer._class === 'C_OP_RenderSprites' ? 'sprite' : 'unsupported',
    blendMode: typeof renderer.m_nOutputBlendMode === 'string' ? renderer.m_nOutputBlendMode : null,
    textures: [...rows(renderer.m_vecTexturesInput).map((t) => t.m_hTexture), renderer.m_hTexture]
      .filter((t): t is string => typeof t === 'string' && /^materials\/[a-zA-Z0-9_./-]+\.vtex$/.test(t) && !t.includes('..')),
  }));
  return {
    name, maxParticles: Math.min(256, Math.max(1, Number(r.m_nMaxParticles) || 64)),
    constantRadius: parameter(r.m_flConstantRadius) as FxDescriptor['constantRadius'],
    constantLifespan: parameter(r.m_flConstantLifespan) as FxDescriptor['constantLifespan'],
    constantColor: r.m_ConstantColor as number[],
    controlPoints: drivers.map((cp) => ({
      cp: Number(cp.m_iControlPoint) || 0,
      attachType: typeof cp.m_iAttachType === 'string' ? cp.m_iAttachType : null,
      attachment: typeof cp.m_attachmentName === 'string' ? cp.m_attachmentName : null,
      entity: typeof cp.m_entityName === 'string' ? cp.m_entityName : null,
    })),
    emitters: nodes(r.m_Emitters), initializers: nodes(r.m_Initializers), operators: nodes(r.m_Operators),
    preEmissionOperators: nodes(r.m_PreEmissionOperators), forces: nodes(r.m_ForceGenerators), constraints: nodes(r.m_Constraints),
    renderers, children: [],
  };
}

/** v0.19.1's soundevents reader decodes any resource's KV3 DATA block. Use its
 * read-only JSON mode, then validate the particle class. No new CLI is required. */
export async function exportParticleBundle(pak: string, entry: string, descriptorFile: string, textureDir: string, modelEntry?: string, texturePaks: readonly string[] = [], configuration?: string): Promise<void> {
  if (texturePaks.length > 8) throw new Error('Particle package lookup exceeds preview limits.');
  const textures = new Set<string>();
  let systems = 0;
  const load = async (path: string, ancestors: Set<string>): Promise<FxDescriptor> => {
    if (++systems > 16 || ancestors.size > 4 || ancestors.has(path)) throw new Error('Particle graph exceeds preview limits.');
    if (!/^particles\/[a-zA-Z0-9_./-]+\.vpcf_c$/.test(path) || path.includes('..')) throw new Error('Invalid particle resource path.');
    const raw: unknown = JSON.parse(await runVpkmergeStdout(['soundevents', path, '--from-vpk', pak]));
    const d = particleDescriptor(raw, path, configuration);
    for (const renderer of d.renderers) for (const texture of renderer.textures) textures.add(texture);
    if (textures.size > 24) throw new Error('Particle textures exceed preview limits.');
    const chain = new Set(ancestors).add(path);
    for (const child of rows(row(raw).m_Children)) {
      if (typeof child.m_ChildRef !== 'string') continue;
      const loaded = await load(child.m_ChildRef.replace(/\.vpcf(?:_c)?$/, '.vpcf_c'), chain);
      if (!loaded.controlPoints.length) loaded.controlPoints = d.controlPoints;
      d.children.push(loaded);
    }
    return d;
  };
  const descriptor = await load(entry, new Set());
  if (modelEntry) {
    const model = row(JSON.parse(await runVpkmergeStdout(['soundevents', modelEntry, '--from-vpk', pak])));
    const text = row(model.m_modelInfo).m_keyValueText;
    // This optional model settings block contains scalar assignments only.
    // Do not read unrelated scale fields from the rest of the embedded KV3.
    const value = typeof text === 'string' && text.length < 1024 * 1024
      ? text.match(/\bCitadelModelParticleSettings_t\s*=\s*\{[^{}]*\bm_flScale\s*=\s*([-+\d.eE]+)[^{}]*\}/)?.[1] : undefined;
    if (value !== undefined) {
      const scale = Number(value);
      if (Number.isFinite(scale) && scale > 0 && scale <= 16) descriptor.scale = scale;
    }
  }
  await fs.mkdir(textureDir, { recursive: true });
  if (textures.size) {
    const owners = new Map<string, string[]>();
    // Caller supplies mounted priority: selected skin stack, Citadel, core.
    // Exact entries avoid decoding the same texture from a lower-priority VPK.
    const indexes = texturePaks.length ? [...new Set(texturePaks)].map((path) => ({ path, entries: new Set(parseVpkDirectoryCached(path) ?? []) })) : null;
    for (const texture of textures) {
      const owner = indexes ? indexes.find(({ entries }) => entries.has(`${texture}_c`))?.path : pak;
      if (!owner) throw new Error(`Particle texture is absent from mounted packages: ${texture}`);
      const group = owners.get(owner) ?? [];
      group.push(texture);
      owners.set(owner, group);
    }
    const scratch = await fs.mkdtemp(join(textureDir, 'decode-'));
    try {
      for (const [owner, group] of owners) {
        const decoded = owners.size === 1 ? scratch : join(scratch, String([...owners.keys()].indexOf(owner)));
        await fs.mkdir(decoded, { recursive: true });
        await runVpkmerge(['panorama', 'dump', '--vpk', owner, '--out-dir', decoded,
          ...group.flatMap((texture) => ['--prefix', `${texture}_c`])]);
        for (const texture of group) {
          const source = join(decoded, texture.replace(/\.vtex$/, '.png'));
          await fs.copyFile(source, join(textureDir, fxTexturePngName(texture)));
          const raw = join(decoded, '_raw', `${texture}_c`);
          if ((await fs.stat(raw)).size > 64 * 1024 * 1024) throw new Error('Particle texture resource exceeds preview limits.');
          const sheet = await fs.readFile(raw).then(readParticleSheet);
          if (sheet) (descriptor.sheets ??= {})[texture] = sheet;
        }
      }
    } finally { await fs.rm(scratch, { recursive: true, force: true }); }
  }
  await fs.writeFile(descriptorFile, JSON.stringify(descriptor));
}
