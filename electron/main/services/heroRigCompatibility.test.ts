import { describe, expect, it } from 'vitest';
import { compatibleHeroAnimationRig } from './heroRigCompatibility';

const nodes = [{ name: 'root_motion', children: [1] }, { name: 'pelvis', children: [2] }, { name: 'head' }];
const donor = { nodes, animations: [{ channels: [0, 1, 2].map((node) => ({ target: { node } })) }] };

describe('skin animation donor compatibility', () => {
    it('allows additional skin cloth and prop bones', () => {
        expect(compatibleHeroAnimationRig({ nodes: [...nodes, { name: 'hat' }] }, donor)).toBe(true);
    });
    it('rejects missing body tracks, changed parents and empty animation', () => {
        expect(compatibleHeroAnimationRig({ nodes: nodes.slice(0, 2) }, donor)).toBe(false);
        expect(compatibleHeroAnimationRig({ nodes: [{ name: 'root_motion', children: [1, 2] }, { name: 'pelvis' }, { name: 'head' }] }, donor)).toBe(false);
        expect(compatibleHeroAnimationRig({ nodes }, { nodes, animations: [] })).toBe(false);
    });
});
