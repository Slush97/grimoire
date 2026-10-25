import { z } from 'zod';

const coordinate = z.number().finite().min(-1000).max(1000);
const vector = z.tuple([coordinate, coordinate, coordinate]);
export const viewerCameraSchema = z.object({ position: vector, target: vector }).strict();
export type ViewerCameraDraft = z.infer<typeof viewerCameraSchema>;
