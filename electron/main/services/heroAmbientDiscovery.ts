// Finds the particle effects a hero plays on its own, the way the game names them, rather than from a
// hand-picked list. Node only, no Electron (shared with the dev scripts). Every source is game data
// read through the mounted package stack, so a skin mod that replaces the model or the vdata changes
// what is found:
//
// - the model's keyvalues (m_modelInfo.m_keyValueText): `particle_cfg_list` (system and control point
//   configuration, the hero's idle ambient; 9 heroes as of 2026-10), VRF's `particles_list` (system and
//   attachment) and `CCitadelHeroModelGameData_t.m_hAmbientParticle`;
// - scripts/heroes.vdata: the hero's `m_hAmbientParticle` (Infernus);
// - scripts/abilities.vdata: the primary weapon's `m_PassiveWeaponParticle` (Rem, Graves, Baba), and the
//   particles its code spawns itself (Celeste's `m_BatonFlameParticle`) through their authored preview
//   system (see CODE_SPAWNED_WEAPON_PARTICLES);
// - animation events: AE_CL_CREATE_PARTICLE_EFFECT(_CFG) and AE_CL_STOP_PARTICLE_EFFECT of the clips of the
//   model's `ui` animation graph (what hero select, the shop and the reveal play) and of any clips the
//   viewer plays, from AnimGraph2 clips (.vnmclip) and from the embedded legacy animations (ANIM blocks).

import { type KVObject, type KVValue, getArray, getString, getSubCollection, isCollection } from '../../../src/lib/particles/kv';
import type { BundleEffect, EffectAttachment } from '../../../src/lib/particles/host/bundle';
import { codenamesForHero } from './heroCodenames';
import { parseKv3Text } from './kv3Text';
import { resourceBlocks } from './particleModelExport';
import type { PackageStack } from './heroParticleSources';

/** The most animation clips read for events. */
const MAX_EVENT_CLIPS = 48;

export interface AmbientDiscovery {
    /** The heroes.vdata entry the hero was found under (`hero_atlas`). */
    heroKey: string;
    /** The body model, compiled path. */
    modelEntry: string;
    effects: BundleEffect[];
    /** What was looked at and not found, for the report and diagnostics. */
    notes: string[];
}

export interface DiscoveryOptions {
    /** Hero model previews omit hero gameplay ambients; weapon and model-bound effects still play. */
    context?: 'showcase' | 'match';
    /** The model the viewer shows, when it pins one; otherwise heroes.vdata's m_strModelName. */
    modelEntry?: string;
    /** Clips the viewer plays, by the names `vpkmerge model clips` reports. */
    clips?: readonly string[];
    /** Skip animation events (they cost a decode per clip). */
    skipAnimationEvents?: boolean;
}

const compiled = (path: string) => (path.endsWith('_c') ? path : `${path}_c`).replace(/\\/g, '/');

/**
 * Weapon fields naming a particle the game's code spawns itself, on attachments no data names, with
 * the authored preview system that places it (two baton ends for Celeste's flame). The preview system
 * is used only while its children are the named particle, so a mod that renames either side is not
 * misattributed.
 */
const CODE_SPAWNED_WEAPON_PARTICLES: ReadonlyArray<readonly [field: string, preview: string]> = [
    ['m_BatonFlameParticle', 'particles/abilities/unicorn/unicorn_ambient_weapon.vpcf'],
];
const source = (path: string) => path.replace(/_c$/, '').replace(/\\/g, '/');

/**
 * heroes.vdata m_hAmbientParticle is an actor gameplay ambient, not a model preview declaration.
 * hero_base.m_vecAmbientParticleSettings binds Infernus' effect to palm_R in match. The vanilla
 * showcase recording inf.mp4 has no palm flame, while its material hat fire and arm outline remain.
 * Keep the source available for a future match host, without suppressing model or weapon effects.
 */
const SOURCE_CONTEXTS: Partial<Record<BundleEffect['source'], readonly NonNullable<DiscoveryOptions['context']>[]>> = { 'hero-ambient': ['match'] };

function vector3(value: KVValue | undefined): [number, number, number] {
    return Array.isArray(value) ? [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0] : [0, 0, 0];
}

function attachmentOf(type: KVValue | undefined, point: KVValue | undefined, offset?: KVValue): EffectAttachment | null {
    if (typeof type !== 'string' || type === '') return null;
    return { type: type.toLowerCase().replace(/^pattach_/, ''), point: typeof point === 'string' ? point : '', offset: vector3(offset) };
}

export async function discoverAmbientEffects(stack: PackageStack, heroName: string, options: DiscoveryOptions = {}): Promise<AmbientDiscovery> {
    const notes: string[] = [];
    const effects: BundleEffect[] = [];
    const add: AddEffect = (effect) => {
        if (!/^particles\/[a-zA-Z0-9_./-]+\.vpcf$/.test(effect.system) || effect.system.includes('..')) {
            notes.push(`Skipped invalid system path ${effect.system} (${effect.evidence})`);
            return;
        }
        const key = JSON.stringify([effect.system, effect.source, effect.clip?.name ?? null, effect.clip?.start ?? null]);
        if (effects.some((existing) => JSON.stringify([existing.system, existing.source, existing.clip?.name ?? null, existing.clip?.start ?? null]) === key)) return;
        effects.push({ attachment: null, attachmentCp1: null, ...effect, id: `${effects.length}` });
    };

    const heroes = await stack.decode('scripts/heroes.vdata_c');
    if (!heroes) throw new Error('scripts/heroes.vdata_c is not in any mounted package.');
    const heroKey = codenamesForHero(heroName).map((codename) => `hero_${codename}`).find((key) => isCollection(heroes[key] ?? null));
    if (!heroKey) throw new Error(`No heroes.vdata entry for ${heroName}.`);
    const hero = heroes[heroKey] as KVObject;

    const vdataModel = getString(hero, 'm_strModelName');
    const modelEntry = compiled(options.modelEntry ?? vdataModel ?? '');
    if (!/^models\/[a-zA-Z0-9_./-]+\.vmdl_c$/.test(modelEntry)) throw new Error(`No model for ${heroName}.`);

    // The model's keyvalues
    const model = await stack.decode(modelEntry);
    if (!model) throw new Error(`${modelEntry} is not in any mounted package.`);
    const keyValueText = getString(getSubCollection(model, 'm_modelInfo') ?? {}, 'm_keyValueText') ?? '';
    let keyValues: KVObject = {};
    try {
        keyValues = keyValueText ? parseKv3Text(keyValueText) : {};
    } catch (error) {
        notes.push(`${modelEntry} keyvalues unreadable: ${String(error)}`);
    }

    (getArray(keyValues, 'particle_cfg_list') ?? []).filter(isCollection).forEach((entry, i) => {
        const name = getString(entry, 'name');
        if (name) add({ system: source(name), source: 'model-particle-cfg', evidence: `${modelEntry} m_modelInfo particle_cfg_list[${i}]`, configuration: getString(entry, 'config') });
    });
    (getArray(keyValues, 'particles_list') ?? []).filter(isCollection).forEach((entry, i) => {
        const name = getString(entry, 'name');
        if (name) {
            add({
                system: source(name), source: 'model-particles-list', evidence: `${modelEntry} m_modelInfo particles_list[${i}]`, configuration: null,
                attachment: attachmentOf(entry.attachment_type, entry.attachment_point, entry.attachment_offset),
            });
        }
    });
    const modelAmbient = getString(getSubCollection(keyValues, 'CCitadelHeroModelGameData_t') ?? {}, 'm_hAmbientParticle');
    if (modelAmbient) add({ system: source(modelAmbient), source: 'model-ambient', evidence: `${modelEntry} CCitadelHeroModelGameData_t.m_hAmbientParticle`, configuration: null });

    // heroes.vdata
    const heroAmbient = getString(hero, 'm_hAmbientParticle');
    if (heroAmbient) {
        if ((SOURCE_CONTEXTS['hero-ambient'] ?? []).includes(options.context ?? 'showcase')) {
            add({ system: source(heroAmbient), source: 'hero-ambient', evidence: `scripts/heroes.vdata ${heroKey}.m_hAmbientParticle`, configuration: null });
        } else {
            notes.push(`Omitted ${heroAmbient} from showcase: ${heroKey}.m_hAmbientParticle is a match ambient.`);
        }
    }

    // The primary weapon's passive particle
    const weaponKey = getString(getSubCollection(hero, 'm_mapBoundAbilities') ?? {}, 'ESlot_Weapon_Primary');
    if (weaponKey) {
        const abilities = await stack.decode('scripts/abilities.vdata_c');
        const weapon = abilities && isCollection(abilities[weaponKey] ?? null) ? abilities[weaponKey] as KVObject : null;
        const passive = weapon ? getString(weapon, 'm_PassiveWeaponParticle') : null;
        if (passive) {
            const attachSource = getString(weapon!, 'm_strPassiveWeaponAttachmentSource');
            add({
                system: source(passive), source: 'weapon-passive',
                evidence: `scripts/abilities.vdata ${weaponKey}.m_PassiveWeaponParticle${attachSource ? ` (m_strPassiveWeaponAttachmentSource ${attachSource})` : ''}`,
                configuration: null,
                // The weapon names the attachment the game plays its passive particle on (Graves' hand,
                // where the effect's own preview configuration names the muzzle); bound as a model
                // particle there. Without one the effect's configuration places it.
                attachment: attachSource ? { type: 'point_follow', point: attachSource, offset: [0, 0, 0] } : null,
            });
        }
        for (const [field, preview] of CODE_SPAWNED_WEAPON_PARTICLES) {
            const named = weapon ? getString(weapon, field) : null;
            if (!named) continue;
            const definition = await stack.decode(compiled(preview)).catch(() => null);
            const children = (definition ? getArray(definition, 'm_Children') ?? [] : [])
                .map((child) => (isCollection(child) ? getString(child, 'm_ChildRef') : null))
                .filter((ref): ref is string => ref !== null)
                .map(source);
            if (children.length === 0 || !children.every((ref) => ref === source(named))) {
                notes.push(`${weaponKey}.${field} names ${named}, but ${preview} does not place it; not shown`);
                continue;
            }
            add({
                system: preview, source: 'weapon-code', configuration: 'preview',
                evidence: `scripts/abilities.vdata ${weaponKey}.${field} (${source(named)}), placed by ${preview}`,
            });
        }
    }

    if (!options.skipAnimationEvents) {
        await discoverAnimationEvents(stack, modelEntry, model, options.clips ?? [], add, notes);
    }

    return { heroKey, modelEntry, effects, notes };
}

interface ClipEvent {
    className: string;
    /** Normalized time in the clip, 0 to 1. */
    time: number;
    data: KVObject;
}

type AddEffect = (effect: Omit<BundleEffect, 'id' | 'attachment' | 'attachmentCp1'> & Partial<Pick<BundleEffect, 'attachment' | 'attachmentCp1'>>) => void;

function clipStem(path: string): string {
    return source(path).split('/').pop()!.replace(/\.vnmclip$/, '');
}

/** The particle events of one clip, as effects that start and stop with it. */
function addClipEffects(clipName: string, evidence: string, events: ClipEvent[], add: AddEffect): void {
    for (const event of events) {
        if (event.className !== 'AE_CL_CREATE_PARTICLE_EFFECT' && event.className !== 'AE_CL_CREATE_PARTICLE_EFFECT_CFG') continue;
        const name = getString(event.data, 'name');
        if (!name) continue;
        const stops = events
            .filter((stop) => stop.className === 'AE_CL_STOP_PARTICLE_EFFECT' && getString(stop.data, 'name') === name && stop.time >= event.time)
            .map((stop) => ({ time: stop.time, immediately: stop.data.stop_instantly === true || stop.data.stop_immediately === true, endCap: stop.data.play_endcap === true }));
        const config = event.className === 'AE_CL_CREATE_PARTICLE_EFFECT_CFG' ? getString(event.data, 'config') : null;
        add({
            system: source(name), source: 'anim-event', evidence: `${evidence} ${event.className} at ${event.time.toFixed(3)}`,
            configuration: config,
            attachment: config === null ? attachmentOf(event.data.attachment_type ?? 'absorigin_follow', event.data.attachment_point) : null,
            attachmentCp1: config === null && typeof event.data.attachment_point_cp1 === 'string' && event.data.attachment_point_cp1 !== ''
                ? attachmentOf(event.data.attachment_type_cp1, event.data.attachment_point_cp1) : null,
            clip: { name: clipName, start: event.time, stops, stopOnClipChange: event.data.stop_on_seq_change === true },
        });
    }
}

async function discoverAnimationEvents(stack: PackageStack, modelEntry: string, model: KVObject, clips: readonly string[], add: AddEffect, notes: string[]): Promise<void> {
    // AnimGraph2 clips: those the ui graph lists, then those of the other graphs the viewer plays
    const clipPaths = new Map<string, string>();
    const wanted = new Set(clips.map((clip) => clip.toLowerCase()));
    for (const reference of (getArray(model, 'm_animGraph2Refs') ?? []).filter(isCollection)) {
        const graphPath = getString(reference, 'm_hGraph');
        if (!graphPath) continue;
        const isUi = getString(reference, 'm_sIdentifier') === 'ui';
        if (!isUi && wanted.size === 0) continue;
        const graph = await stack.decode(compiled(graphPath)).catch(() => null);
        for (const resource of graph ? getArray(graph, 'm_resources') ?? [] : []) {
            if (typeof resource !== 'string' || !resource.endsWith('.vnmclip')) continue;
            const stem = clipStem(resource);
            if (isUi || wanted.has(stem.toLowerCase())) clipPaths.set(stem, compiled(resource));
        }
    }

    // Decode a bounded batch together, then add events in authored order. Each decode launches a CLI.
    const entries = [...clipPaths].slice(0, MAX_EVENT_CLIPS);
    for (let offset = 0; offset < entries.length; offset += 4) {
      const batch = entries.slice(offset, offset + 4);
      const decoded = await Promise.all(batch.map(([, path]) => stack.decode(path).catch(() => null)));
      for (const [index, [stem, path]] of batch.entries()) {
        const clip = decoded[index];
        if (!clip) continue;
        const events = (getArray(clip, 'm_events') ?? []).filter(isCollection).map((event): ClipEvent => ({
            className: getString(event, 'm_animEventClassName') ?? '',
            time: Number(getSubCollection(event, 'm_flStartTime')?.m_flValue ?? 0),
            data: getSubCollection(event, 'm_KV') ?? {},
        }));
        addClipEffects(stem, path, events, add);
      }
    }
    if (clipPaths.size > MAX_EVENT_CLIPS) notes.push(`Read events of ${MAX_EVENT_CLIPS} of ${clipPaths.size} clips.`);

    // Legacy embedded animations, for the clips the viewer plays
    if (wanted.size === 0) return;
    const bytes = stack.read(modelEntry);
    const animBlocks = bytes ? resourceBlocks(bytes, new Set(['ANIM'])) : [];
    for (const block of animBlocks) {
        const anims = await stack.decodeLoose(block.resource).catch(() => null);
        for (const anim of anims ? (getArray(anims, 'm_animArray') ?? []).filter(isCollection) : []) {
            const name = getString(anim, 'm_name') ?? '';
            if (!wanted.has(name.toLowerCase())) continue;
            const events = (getArray(anim, 'm_eventArray') ?? []).filter(isCollection).map((event): ClipEvent => ({
                className: getString(event, 'm_sEventName') ?? '',
                time: Number(event.m_flCycle ?? 0),
                data: getSubCollection(event, 'm_EventData') ?? {},
            }));
            addClipEffects(name, `${modelEntry} ANIM ${name}`, events, add);
        }
    }
}
