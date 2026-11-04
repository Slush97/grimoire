import { describe, expect, it } from 'vitest';
import { compatibleHeroAnimationRig } from './heroRigCompatibility';

const nodes = [{ name: 'root_motion', children: [1] }, { name: 'pelvis', children: [2] }, { name: 'head', children: [3, 4] }, { name: 'eye_L' }, { name: 'eye_R' }];
const donor = { nodes, animations: [{ channels: nodes.map((_, node) => ({ target: { node } })) }] };

describe('skin animation donor compatibility', () => {
    it('allows additional skin cloth and prop bones', () => {
        expect(compatibleHeroAnimationRig({ nodes: [...nodes, { name: 'hat' }] }, donor)).toBe(true);
    });
    it('rejects missing body tracks, changed parents and empty animation', () => {
        expect(compatibleHeroAnimationRig({ nodes: nodes.slice(0, 2) }, donor)).toBe(false);
        expect(compatibleHeroAnimationRig({ nodes: [{ name: 'root_motion', children: [1, 2] }, { name: 'pelvis' }, { name: 'head', children: [3, 4] }, { name: 'eye_L' }, { name: 'eye_R' }] }, donor)).toBe(false);
        expect(compatibleHeroAnimationRig({ nodes }, { nodes, animations: [] })).toBe(false);
    });
    it('ignores a dangling chain the skin leaves out, but not a missing branch', () => {
        // pelvis -> spine -> (arm_L, arm_R); head -> hair_0 -> hair_1 (a ponytail).
        const hero = [
            { name: 'root_motion', children: [1] }, { name: 'pelvis', children: [2, 5] }, { name: 'spine', children: [3, 4] },
            { name: 'arm_L' }, { name: 'arm_R' }, { name: 'head', children: [6] }, { name: 'hair_0', children: [7] }, { name: 'hair_1' },
        ];
        const motion = { nodes: hero, animations: [{ channels: hero.map((_, node) => ({ target: { node } })) }] };
        const noPonytail = [{ ...hero[0] }, { ...hero[1] }, { ...hero[2] }, hero[3], hero[4], { name: 'head' }];
        expect(compatibleHeroAnimationRig({ nodes: noPonytail }, motion)).toBe(true);
        const noUpperBody = [{ ...hero[0] }, { name: 'pelvis', children: [2] }, { name: 'head', children: [3] }, { name: 'hair_0', children: [4] }, { name: 'hair_1' }];
        expect(compatibleHeroAnimationRig({ nodes: noUpperBody }, motion)).toBe(false);
    });
});
