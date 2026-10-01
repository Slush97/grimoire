import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FxControlPoint, FxDescriptor, FxNode, FxRenderer } from '../../../src/components/locker/fxDescriptor';
import { fxTexturePngName } from '../../../src/components/locker/fxDescriptor';
import { runVpkmerge, runVpkmergeStdout } from './modMerger';
import { readParticleSheet } from './particleSheet';
import { parseVpkDirectoryCached, readVpkEntryBytes } from './vpk';
import { readParticleSnapshot } from './particleSnapshot';
import { exportModelAttachments } from './modelAttachments';

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
      curve: parameter(r.m_Curve), field: r.m_nScalarAttribute, map: r.m_nMapType, mult: r.m_flMultFactor,
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
  const selectedConfiguration = selected ?? configurations[0];
  const drivers = rows(selectedConfiguration?.m_drivers);
  const preview = row(selectedConfiguration?.m_previewState);
  const renderers: FxRenderer[] = rows(r.m_Renderers).slice(0, 16).map((renderer) => ({
    class: String(renderer._class ?? ''), params: parameter(renderer) as Row,
    mode: renderer._class === 'C_OP_RenderSprites' ? 'sprite' : renderer._class === 'C_OP_RenderRopes' ? 'rope' : 'unsupported',
    blendMode: typeof renderer.m_nOutputBlendMode === 'string' ? renderer.m_nOutputBlendMode : null,
    textures: [...rows(renderer.m_vecTexturesInput).map((t) => t.m_hTexture), renderer.m_hTexture]
      .filter((t): t is string => typeof t === 'string' && /^materials\/[a-zA-Z0-9_./-]+\.vtex$/.test(t) && !t.includes('..')),
  }));
  return {
    name, maxParticles: Math.min(256, Math.max(1, Number(r.m_nMaxParticles) || 64)),
    constantRadius: parameter(r.m_flConstantRadius) as FxDescriptor['constantRadius'],
    constantLifespan: parameter(r.m_flConstantLifespan) as FxDescriptor['constantLifespan'],
    constantAlpha: parameter(r.m_flConstantAlpha) as FxDescriptor['constantAlpha'],
    constantColor: r.m_ConstantColor as number[],
    preview: { model: typeof preview.m_previewModel === 'string' ? preview.m_previewModel : null,
      sequence: typeof preview.m_sequenceName === 'string' ? preview.m_sequenceName : null },
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
export async function exportParticleBundle(pak: string, entry: string, descriptorFile: string, textureDir: string, modelEntry?: string, texturePaks: readonly string[] = [], configuration?: string, additionalEntries: readonly string[] = []): Promise<void> {
  if (additionalEntries.length > 3) throw new Error('Particle roots exceed preview limits.');
  if (texturePaks.length > 8) throw new Error('Particle package lookup exceeds preview limits.');
  const textures = new Set<string>();
  let systems = 0;
  const load = async (path: string, ancestors: Set<string>, inherited: FxControlPoint[] = [], mapFrames: (group: number) => FxControlPoint[] = () => []): Promise<FxDescriptor> => {
    if (++systems > 32 || ancestors.size > 4 || ancestors.has(path)) throw new Error('Particle graph exceeds preview limits.');
    if (!/^particles\/[a-zA-Z0-9_./-]+\.vpcf_c$/.test(path) || path.includes('..')) throw new Error('Invalid particle resource path.');
    const raw: unknown = JSON.parse(await runVpkmergeStdout(['soundevents', path, '--from-vpk', pak]));
    const d = particleDescriptor(raw, path, configuration);
    for (const renderer of d.renderers) {
      // Source spritecards use base_sprite when an enabled layer names no texture.
      if (renderer.mode !== 'sprite' || !Array.isArray(renderer.params.m_vecTexturesInput)) continue;
      for (const input of renderer.params.m_vecTexturesInput.map(row)) {
        if (input.m_bEnabled === false || input.m_bReplaceTextureWithGradient === true || input.m_hTexture) continue;
        input.m_hTexture = 'materials/particle/base_sprite.vtex';
        renderer.textures.push(input.m_hTexture as string);
      }
    }
    const snapshot = row(raw).m_hSnapshot;
    if (typeof snapshot === 'string') {
      if (!/^particles\/[a-zA-Z0-9_./-]+\.vsnap$/.test(snapshot) || snapshot.includes('..')) throw new Error('Invalid particle snapshot path.');
      const entry = `${snapshot}_c`;
      const owner = [...new Set([...texturePaks, pak])].find((p) => parseVpkDirectoryCached(p)?.includes(entry));
      const bytes = owner ? readVpkEntryBytes(owner, entry) : null;
      if (!bytes || bytes.length > 4*1024*1024) throw new Error('Particle snapshot is unavailable or exceeds preview limits.');
      const metadata: unknown = JSON.parse(await runVpkmergeStdout(['soundevents', entry, '--from-vpk', owner!]));
      d.snapshot = { points: readParticleSnapshot(bytes, metadata) };
    }
    // Inherit missing CPs before loading descendants, so a child's partial
    // preview configuration does not erase authored parent attachment frames.
    d.controlPoints = [...new Map([...inherited, ...d.controlPoints, ...mapFrames(Number(row(raw).m_nGroupID) || 0)].map((cp) => [cp.cp, cp])).values()];
    for (const renderer of d.renderers) for (const texture of renderer.textures) textures.add(texture);
    if (textures.size > 24) throw new Error('Particle textures exceed preview limits.');
    const chain = new Set(ancestors).add(path);
    const childGroups = new Map<number, number>();
    for (const child of rows(row(raw).m_Children)) {
      if (typeof child.m_ChildRef !== 'string') continue;
      const loaded = await load(child.m_ChildRef.replace(/\.vpcf(?:_c)?$/, '.vpcf_c'), chain, d.controlPoints, (group) => {
        // The child definition owns its group. Delayed instances still count
        // in definition order; each receives one sequential source CP.
        const ordinal = childGroups.get(group) ?? 0;
        childGroups.set(group, ordinal + 1);
        const mappings: FxControlPoint[] = [];
        for (const op of d.preEmissionOperators ?? []) {
          if (op.class !== 'C_OP_SetParentControlPointsToChildCP' || op.params.m_bSetOrientation !== true
            || (Number(op.params.m_nChildGroupID) || 0) !== group) continue;
          const count = Math.max(0, Math.min(64, Number(op.params.m_nNumControlPoints) || 1));
          if (ordinal >= count) continue;
          const source = d.controlPoints.find((cp) => cp.cp === (Number(op.params.m_nFirstSourcePoint) || 0) + ordinal);
          if (source) mappings.push({ ...source, cp: Number(op.params.m_nChildControlPoint) || 0 });
        }
        return mappings;
      });
      const delay = Number(child.m_flDelay);
      if (Number.isFinite(delay) && delay > 0) loaded.startDelay = Math.min(30, delay);
      d.children.push(loaded);
    }
    return d;
  };
  const descriptor = await load(entry, new Set());
  for (const additional of [...new Set(additionalEntries)].filter((p) => p !== entry)) descriptor.children.push(await load(additional, new Set()));
  const modelResource = modelEntry ?? descriptor.preview?.model?.replace(/\.vmdl(?:_c)?$/, '.vmdl_c');
  const declaredModel = modelResource && /^models\/[a-zA-Z0-9_./-]+\.vmdl_c$/.test(modelResource) && !modelResource.includes('..') ? modelResource : undefined;
  if (declaredModel) {
    // The selected preview model is authored data, not a bone-name guess.
    // Bundle frames with the effect so a warm --hero model cache whose older
    // sidecar is empty can resolve them without re-exporting the heavy GLB.
    try { descriptor.attachments = await exportModelAttachments(texturePaks[0] ?? pak, pak, declaredModel); }
    catch (error) { console.warn('[heroParticleExport] attachment metadata unavailable:', error); }
  }
  if (declaredModel) {
    const model = row(JSON.parse(await runVpkmergeStdout(['soundevents', declaredModel, '--from-vpk', pak])));
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
