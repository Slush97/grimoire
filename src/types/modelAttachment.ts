/** Authored single-bone attachment in Source units and the bone's local frame. */
export interface ModelAttachment {
    name: string;
    bone: string;
    position: [number, number, number];
    rotation: [number, number, number, number];
}
