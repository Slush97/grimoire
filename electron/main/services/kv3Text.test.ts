import { describe, expect, it } from 'vitest';
import { parseKv3Text } from './kv3Text';

describe('parseKv3Text', () => {
    it('reads model keyvalues with typed values, arrays and comments', () => {
        const data = parseKv3Text(`<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:vmdlkeys4:version{9f5c1002-f19f-470c-bd42-c3c26c063d33} -->
{
	// ambient
	CCitadelHeroModelGameData_t =
	{
		m_hAmbientParticle = resource_name:""
		m_vecAmbientParticleSettings = [  ]
		m_flTurnThreshold = 90.0
		m_bTurnToFaceVelocity = false
	}
	particle_cfg_list =
	[
		{
			name = resource:"particles/abilities/abrams/abrams_ambient_book.vpcf"
			config = "preview"
		},
	]
	offsets = [ -10.0, 1e2, 3 ]
	blob = #[ 0A ff ]
	text = """
line one
"""
}`);
        expect(data.particle_cfg_list).toEqual([{ name: 'particles/abilities/abrams/abrams_ambient_book.vpcf', config: 'preview' }]);
        expect(data.CCitadelHeroModelGameData_t).toEqual({ m_hAmbientParticle: '', m_vecAmbientParticleSettings: [], m_flTurnThreshold: 90, m_bTurnToFaceVelocity: false });
        expect(data.offsets).toEqual([-10, 100, 3]);
        expect(data.blob).toEqual([10, 255]);
        expect(data.text).toBe('line one');
    });

    it('rejects unterminated input', () => {
        expect(() => parseKv3Text('{ a = [ 1, 2 }')).toThrow();
        expect(() => parseKv3Text('{ a = "x }')).toThrow();
    });
});
