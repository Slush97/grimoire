import { z } from 'zod';

export const compatibilityFindingSchema = z.object({
  entry: z.string(),
  kind: z.enum(['data', 'localization', 'skeleton', 'sounds']),
  status: z.enum(['repairable', 'unsupported']),
  changes: z.number().int().nonnegative(),
  detail: z.string(),
});

export type CompatibilityFinding = z.infer<typeof compatibilityFindingSchema>;

export const compatibilityBatchSchema = z.array(z.union([
  z.object({ mod: z.string(), reports: z.array(compatibilityFindingSchema) }),
  z.object({ mod: z.string(), error: z.string() }),
]));

export const compatibilityFindingsSchema = z.array(compatibilityFindingSchema);

export type CompatibilityRepairResult =
  | { kind: 'unchanged' }
  | { kind: 'repaired'; count: number; backupPath: string };

export type CompatibilityReview =
  | { kind: 'checked'; modId: string; findings: CompatibilityFinding[] }
  | { kind: 'failed'; modId: string; error: string };
