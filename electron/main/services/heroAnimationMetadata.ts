import { promises as fs } from 'node:fs';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { attachmentMetadataResources } from './modelAttachments';
import { readVpkEntryBytes } from './vpk';
import { runVpkmergeStdout } from './modMerger';
import type { HeroAnimationInfo } from '../../../src/lib/heroAnimationCatalog';

type AnimationMetadata = Pick<HeroAnimationInfo, 'additive' | 'rootMotion'>;

/** Exact model/source/timing associations from the installed production catalog. */
const PRODUCTION_CLIP_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'models/heroes_wip/inferno/inferno.vmdl_c': { shop_menu_base: 'ui_shop_idle' },
  'models/heroes_staging/hornet_v3/hornet.vmdl_c': { primary_stand_idle: 'weapon_stand_idle' },
  'models/heroes_wip/abrams/abrams.vmdl_c': { shop_menu_base: 'ui_shop_idle' },
  'models/heroes_wip/wraith/wraith.vmdl_c': { primary_stand_reload: 'reload_idle' },
  'models/heroes_wip/mcginnis/mcginnis.vmdl_c': { primary_stand_reload: 'reload_idle' },
  'models/heroes_staging/chrono/chrono.vmdl_c': { shop_menu_base: 'ui_shop_idle', primary_stand_reload: 'reload_idle' },
  'models/heroes_wip/dynamo/dynamo.vmdl_c': { primary_stand_idle: 'weapon_stand_idle', primary_stand_reload: 'reload_idle' },
  'models/heroes_staging/haze/haze.vmdl_c': { shop_menu_base: 'ui_shop_idle', primary_stand_reload: 'reload_idle' },
  'models/heroes_staging/bebop/bebop.vmdl_c': { primary_stand_idle: 'weapon_stand_idle' },
  'models/heroes_staging/nano/nano_v2/nano.vmdl_c': { primary_stand_idle: 'ui_shop_idle', primary_stand_reload: 'reload_idle' },
  'models/heroes_staging/archer/archer.vmdl_c': { shop_menu_base: 'ui_shop_idle', primary_stand_reload: 'reload_idle' },
  'models/heroes_staging/digger/digger.vmdl_c': { primary_stand_idle: 'weapon_stand_idle' },
  'models/heroes_staging/viper/viper.vmdl_c': { primary_run_n: 'weapon_run_n' },
};

/** Only aliases verified against the selected legacy action's source and timing. */
export function heroAnimationMetadataPaths(entry: string, name: string): string[] {
  const folder = posix.dirname(entry);
  const paths = [`${folder}/clips/${name}.vnmclip_c`];
  const alias = PRODUCTION_CLIP_ALIASES[entry]?.[name];
  if (alias) paths.push(`${folder}/clips/${alias}.vnmclip_c`);
  if (name === 'primary_stand_reload' && /^models\/heroes[^/]*\/(?:dynamo|wraith|yamato)\/[^/]+\.vmdl_c$/.test(entry)) {
    const reload = `${folder}/clips/reload_idle.vnmclip_c`;
    if (!paths.includes(reload)) paths.push(reload);
  }
  return paths;
}

/** NmClip and embedded legacy clips may share names but contain different
 * animation data. Only use compiled flags when frame count and duration agree. */
export function parseHeroAnimationMetadata(raw: unknown, clip: HeroAnimationInfo): AnimationMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.m_nNumFrames !== clip.frameCount || typeof r.m_bIsAdditive !== 'boolean'
    || typeof r.m_flDuration !== 'number' || !Number.isFinite(r.m_flDuration)
    || Math.abs(r.m_flDuration - clip.durationSeconds) > Math.max(0.001, 0.5 / clip.fps)) return null;
  const root = r.m_rootMotion as Record<string, unknown> | undefined;
  const linear = root?.m_flAverageLinearVelocity;
  const angular = root?.m_flAverageAngularVelocityRadians;
  return { additive: r.m_bIsAdditive, rootMotion: (typeof linear === 'number' && Number.isFinite(linear) && Math.abs(linear) > 0.01)
    || (typeof angular === 'number' && Number.isFinite(angular) && Math.abs(angular) > 0.001) };
}

/** Read the selected model's neighboring compiled clips. A missing modern
 * asset does not invent metadata for its legacy counterpart. */
export async function readHeroAnimationMetadata(vpk: string, base: string, entry: string, clips: readonly HeroAnimationInfo[]): Promise<Map<string, AnimationMetadata>> {
  const metadata = new Map<string, AnimationMetadata>();
  if (!/^models\/heroes[^/]*\/[a-zA-Z0-9_./-]+\.vmdl_c$/.test(entry) || entry.includes('..')) return metadata;
  const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-animation-metadata-'));
  try {
    for (const [index, clip] of clips.slice(0, 8).entries()) {
      if (!/^[a-zA-Z0-9_-]+$/.test(clip.name)) continue;
      for (const path of heroAnimationMetadataPaths(entry, clip.name)) {
        const bytes = readVpkEntryBytes(vpk, path) ?? (vpk !== base ? readVpkEntryBytes(base, path) : null);
        if (!bytes || bytes.length > 2 * 1024 * 1024) continue;
        const resource = attachmentMetadataResources(bytes)[0];
        if (!resource) continue;
        const file = join(dir, `${index}.vsndevts_c`);
        await fs.writeFile(file, resource);
        try {
          const raw: unknown = JSON.parse(await runVpkmergeStdout(['soundevents', file]));
          const flags = parseHeroAnimationMetadata(raw, clip);
          if (flags) { metadata.set(clip.name, flags); break; }
        } catch {
          // Older exporters may not decode this graph generation. The reviewed
          // catalog remains the fallback; missing flags are not invented.
        }
      }
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  return metadata;
}
