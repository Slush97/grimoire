import { describe, expect, it } from 'vitest';
import {
    CROSSHAIR_DEFAULTS,
    crosshairFromShareCode,
    crosshairShareCodeParams,
    isCrosshairShareCode,
} from './crosshair';

describe('crosshair share codes', () => {
    it('recognises game share codes and nothing else', () => {
        expect(isCrosshairShareCode('DL.AQC_x1mcAQK4NAKEAgIOAQWik5vGAgIF')).toBe(true);
        expect(isCrosshairShareCode('DL.AQDq5nABAQK4NAKAA.gEC_x1mcAQ==')).toBe(true);
        expect(isCrosshairShareCode('DL.short')).toBe(false);
        expect(isCrosshairShareCode('citadel_crosshair_pip_gap 5')).toBe(false);
        expect(isCrosshairShareCode('DL.AQC_x1mc AQK4NAKEAgIOAQ')).toBe(false);
    });

    it('sends every shape and color setting, with themed off', () => {
        const params = crosshairShareCodeParams({ ...CROSSHAIR_DEFAULTS, pipWidth: 3, colorG: 120 });
        expect(params.themed).toBe(false);
        expect(params.pip_width).toBe(3);
        expect(params.color_g).toBe(120);
        expect(params.dot_outline_opacity).toBe(CROSSHAIR_DEFAULTS.dotOutlineOpacity);
        expect(params).not.toHaveProperty('disable_hero_specific_crosshairs');
        expect(Object.keys(params)).toHaveLength(20);
    });

    it('loads a decoded code and keeps the hero-specific toggle', () => {
        const current = { ...CROSSHAIR_DEFAULTS, disableHeroSpecificCrosshairs: true };
        const s = crosshairFromShareCode({ themed: true, pip_width: 3, pip_gap_static: false, color_b: 120 }, current);
        expect(s.pipWidth).toBe(3);
        expect(s.pipGapStatic).toBe(false);
        expect(s.colorB).toBe(120);
        expect(s.pipHeight).toBe(CROSSHAIR_DEFAULTS.pipHeight);
        expect(s.disableHeroSpecificCrosshairs).toBe(true);
    });
});
