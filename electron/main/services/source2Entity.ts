import { z } from 'zod';

export const entityVec3 = z.preprocess(value => typeof value === 'string' ? value.trim().split(/\s+/).map(Number) : value,
    z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]));
export const modelEntitySchema = z.object({
    classname: z.string().optional(), model: z.string().optional(), origin: entityVec3.optional(), angles: entityVec3.optional(),
    scales: entityVec3.optional(), rendercolor: entityVec3.optional(), renderamt: z.coerce.number().min(0).max(255).optional(),
    StartDisabled: z.boolean().optional(), skin: z.string().optional(), StartingAnim: z.string().optional(),
    IdleAnim: z.string().optional(), defaultanim: z.string().optional(), parentname: z.string().optional(),
    StartingAnimationLoopMode: z.string().optional(),
});

/** Source QAngle: yaw about Z, pitch about Y, roll about X, then translation. */
export function sourceEntityMatrix(entity: z.infer<typeof modelEntitySchema>): number[] {
    const [pitch, yaw, roll] = (entity.angles ?? [0, 0, 0]).map(value => value * Math.PI / 180);
    const [sp, sy, sr] = [Math.sin(pitch), Math.sin(yaw), Math.sin(roll)];
    const [cp, cy, cr] = [Math.cos(pitch), Math.cos(yaw), Math.cos(roll)];
    const [x, y, z] = entity.scales ?? [1, 1, 1];
    const origin = entity.origin ?? [0, 0, 0];
    return [cy * cp * x, sy * cp * x, -sp * x, 0,
        (cy * sp * sr - sy * cr) * y, (sy * sp * sr + cy * cr) * y, cp * sr * y, 0,
        (cy * sp * cr + sy * sr) * z, (sy * sp * cr - cy * sr) * z, cp * cr * z, 0,
        ...origin, 1];
}

export function renderableModelEntity(entity: z.infer<typeof modelEntitySchema>): boolean {
    // Brush triggers and post volumes also name models, but carry no render state.
    return !!entity.model && !!entity.origin && entity.renderamt !== undefined && entity.renderamt > 0
        && entity.StartDisabled !== true;
}
