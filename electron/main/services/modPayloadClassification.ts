import { inferHeroesFromVpkPaths } from './vpk';

export type ModPayloadClassification =
    | { kind: 'hero'; hero: string }
    | { kind: 'general'; globalType: 'hideout' | 'icons' | 'hud' }
    | { kind: 'ambiguous' | 'unknown' };

const HERO_PAYLOAD = /^(?:(?:models|materials(?:\/models)?)\/heroes(?:_wip|_staging)?\/|particles\/(?:heroes(?:_wip|_staging)?|abilities|weapon_fx)\/)/;
const HIDEOUT = /^(?:models|materials(?:\/models)?)\/hideout\//;
const PORTRAIT = /^panorama\/images\/heroes\//;
const HUD = /^panorama\/(?:layout|styles|images\/(?:hud|items))\//;

/** Conservative fallback for broad categories, never a replacement for ancestry. */
export function classifyModPayload(rawPaths: readonly string[]): ModPayloadClassification {
    const paths = rawPaths.map(path => path.replace(/\\/g, '/').toLowerCase());
    const heroPayload = paths.filter(path => HERO_PAYLOAD.test(path));
    const hideout = paths.some(path => HIDEOUT.test(path));
    const hud = paths.some(path => HUD.test(path));
    const portraits = paths.filter(path => PORTRAIT.test(path));

    if (heroPayload.length > 0) {
        // Bundled portraits must not turn a skin into an icon pack or add heroes.
        // Hideout and functional HUD payloads alongside a skin are ambiguous.
        const heroes = inferHeroesFromVpkPaths(heroPayload);
        return !hideout && !hud && heroes.length === 1
            ? { kind: 'hero', hero: heroes[0] } : { kind: 'ambiguous' };
    }
    if (hideout) {
        return hud || portraits.length > 0
            ? { kind: 'ambiguous' } : { kind: 'general', globalType: 'hideout' };
    }
    if (hud) return { kind: 'general', globalType: 'hud' };
    if (portraits.length > 0) {
        const heroes = inferHeroesFromVpkPaths(portraits);
        if (heroes.length > 1) return { kind: 'general', globalType: 'icons' };
        if (heroes.length === 1) return { kind: 'hero', hero: heroes[0] };
        return { kind: 'ambiguous' };
    }
    const heroes = inferHeroesFromVpkPaths(paths);
    if (heroes.length === 1) return { kind: 'hero', hero: heroes[0] };
    return { kind: heroes.length > 1 ? 'ambiguous' : 'unknown' };
}
