import { describe, expect, it } from 'vitest';
import { modelEntitySchema, renderableModelEntity, sourceEntityMatrix } from './source2Entity';

describe('compiled model entities', () => {
    it('accepts typed vectors and legacy string vectors at the data boundary', () => {
        expect(modelEntitySchema.parse({ rendercolor: '62 155 119', origin: [1, 2, 3] })).toEqual({ rendercolor: [62, 155, 119], origin: [1, 2, 3] });
        expect(modelEntitySchema.safeParse({ rendercolor: '1 nope 3' }).success).toBe(false);
    });

    it('composes Source yaw, pitch and nonuniform scale before translation', () => {
        const matrix = sourceEntityMatrix({ origin: [10, 20, 30], angles: [90, 90, 0], scales: [2, 3, 4] });
        // A forward point pitches down; the left axis yaws toward negative X.
        expect(matrix[0]).toBeCloseTo(0); expect(matrix[1]).toBeCloseTo(0); expect(matrix[2]).toBeCloseTo(-2);
        expect(matrix[4]).toBeCloseTo(-3); expect(matrix[5]).toBeCloseTo(0); expect(matrix[6]).toBeCloseTo(0);
        expect(matrix.slice(12)).toEqual([10, 20, 30, 1]);
    });

    it('uses render state, excluding disabled props and non-rendering trigger models', () => {
        const prop = { model: 'models/a.vmdl', origin: [1, 2, 3], renderamt: 255 };
        expect(renderableModelEntity(modelEntitySchema.parse(prop))).toBe(true);
        expect(renderableModelEntity(modelEntitySchema.parse({ ...prop, StartDisabled: true }))).toBe(false);
        expect(renderableModelEntity(modelEntitySchema.parse({ ...prop, renderamt: 0 }))).toBe(false);
        expect(renderableModelEntity(modelEntitySchema.parse({ model: prop.model, origin: prop.origin }))).toBe(false);
    });
});
