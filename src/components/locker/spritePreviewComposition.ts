import { paramScalar, type SpriteSimParams } from './fxDescriptor';

/** Preview approximation for a composed contact glow: keep its authored soft
 * halo and core readable beside HDR warped detail. This is not engine physics
 * or a hero override; incomplete and unrelated compositions remain authored. */
export function balanceSpritePreviewComposition(layers: SpriteSimParams[]): SpriteSimParams[] {
  const groups = new Map<string, SpriteSimParams[]>();
  for (const layer of layers) {
    if (!layer.attachment || !layer.systemId) continue;
    const parent = layer.systemId.slice(0, layer.systemId.lastIndexOf('/'));
    const key = `${parent}:${layer.attachment}`;
    groups.set(key, [...(groups.get(key) ?? []), layer]);
  }
  const roles = new Map<SpriteSimParams, 'soft' | 'core' | 'detail'>();
  for (const group of groups.values()) {
    const core = group.find(l => l.persistent && !l.additive && l.maxParticles === 1
      && l.radiusScale <= .25 && paramScalar(l.spritecard?.params.m_flOverbrightFactor, 1) >= 8);
    if (!core?.texture) continue;
    const soft = group.find(l => l.persistent && l.additive && l.maxParticles === 1
      && l.texture === core.texture && l.alphaScale > 0 && l.alphaScale <= .25 && l.radiusScale > core.radiusScale);
    const detail = group.filter(l => !l.persistent && l.additive && l.maxParticles > 1
      && l.spritecard?.params.m_bSaturateColorPreAlphaBlend === false
      && paramScalar(l.spritecard.params.m_flOverbrightFactor, 1) >= 4
      && Array.isArray(l.spritecard.params.m_vecTexturesInput)
      && l.spritecard.params.m_vecTexturesInput.some(input => input?.m_nTextureType === 'SPRITECARD_TEXTURE_UVDISTORTION')
      && l.spritecard.params.m_vecTexturesInput.some(input => input?.m_nTextureType === 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP'));
    if (!soft || !detail.length) continue;
    roles.set(soft, 'soft'); roles.set(core, 'core'); detail.forEach(l => roles.set(l, 'detail'));
  }
  return layers.map(layer => {
    switch (roles.get(layer)) {
      case 'soft': return { ...layer, radiusScale: Math.min(16, layer.radiusScale * 2), alphaScale: Math.min(1, layer.alphaScale * 4) };
      case 'core': return { ...layer, radiusScale: layer.radiusScale * 1.5 };
      case 'detail': return { ...layer, overbright: layer.overbright * .3, spritecard: layer.spritecard && {
        ...layer.spritecard, params: { ...layer.spritecard.params,
          m_flOverbrightFactor: paramScalar(layer.spritecard.params.m_flOverbrightFactor, 1) * .3 },
      } };
      default: return layer;
    }
  });
}
