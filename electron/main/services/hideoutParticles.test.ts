import { describe, expect, it } from 'vitest';
import { particleLightCookies, readMapParticles } from './hideoutParticles';
import { ParticleSystemSimulation } from '../../../src/lib/particles/simulation';
import { placeMapParticle } from '../../../src/lib/particles/host/mapParticleHost';

describe('map particle entities', () => {
    it('resolves targets across lumps and preserves inactive, data, tint and QAngle fields', () => {
        const particles = readMapParticles([
            { classname: 'info_particle_system', effect_name: 'particles/test.vpcf', start_active: false,
                origin: [10, 20, 30], angles: [0, 90, 0], cpoint2: 'later', cpoint2_parent: 1,
                tint_cp: 5, tint_cp_color: [20, 40, 80], data_cp: 6, data_cp_value: [3, 2, 1] },
            { classname: 'info_particle_target', targetname: 'later', origin: [40, 50, 60] },
        ]);
        expect(particles).toHaveLength(1);
        const particle = particles[0];
        expect(particle.startActive).toBe(false);
        expect(particle.controlPoints[0].parent).toBe(1);
        const simulation = new ParticleSystemSimulation({ name: 'test', data: {}, format: 'vpcf61' }, { loadSystem: () => null });
        placeMapParticle(simulation, particle);
        expect(simulation.getControlPoint(0).position).toMatchObject({ x: 10, y: 20, z: 30 });
        expect(simulation.getControlPoint(0).forward.y).toBeCloseTo(1);
        expect(simulation.getControlPoint(2).position).toMatchObject({ x: 40, y: 50, z: 60 });
        expect(simulation.getControlPoint(5).position).toMatchObject({ x: 20, y: 40, z: 80 });
        expect(simulation.getControlPoint(6).position).toMatchObject({ x: 3, y: 2, z: 1 });
    });

    it('reports missing targets and game-driven path particles instead of inventing their inputs', () => {
        const particles = readMapParticles([
            { classname: 'info_particle_system', effect_name: 'particles/test.vpcf', cpoint1: 'missing', start_active: true },
            { classname: 'citadel_zipline_path', effect_name: 'particles/cable.vpcf', start_active: true },
            { classname: 'info_particle_system', effect_name: 'particles/../escape.vpcf' },
            { classname: 'citadel_new_years_fireworks', FireworkParticle1: 'particles/firework.vpcf' },
        ]);
        expect(particles).toHaveLength(3);
        expect(particles[0].issues).toEqual(['Missing control point 1 target missing.']);
        expect(particles[1].issues[0]).toContain('game path driver');
        expect(particles[2].startActive).toBe(false);
        expect(particles[2].issues[0]).toContain('citadel_new_years_fireworks.FireworkParticle1');
    });
});

describe('particle light cookies', () => {
    it('maps each renderer cookie to its bundled texture file', () => {
        expect(particleLightCookies({
            systems: {
                'particles/fire.vpcf': { data: { m_Renderers: [{ _class: 'C_OP_RenderOmni2Light', m_hLightCookie: 'materials/effects/lightcookies/electrical.vtex' }] }, format: null },
                'particles/glow.vpcf': { data: { m_Renderers: [{ _class: 'C_OP_RenderSprites' }] }, format: null },
                'particles/missing.vpcf': { data: { m_Renderers: [{ _class: 'C_OP_RenderOmni2Light', m_hLightCookie: 'materials/absent.vtex' }] }, format: null },
            },
            textures: { 'materials/effects/lightcookies/electrical.vtex': { file: 'materials_effects_lightcookies_electrical.png' } as never },
        })).toEqual({ 'materials/effects/lightcookies/electrical.vtex': 'particles/tex/materials_effects_lightcookies_electrical.png' });
    });
});
