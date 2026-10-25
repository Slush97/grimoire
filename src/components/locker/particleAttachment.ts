import { Quaternion, type Object3D, type Vector3 } from 'three';
import type { ModelAttachment } from '../../types/modelAttachment';
import { allSpriteLayers, type FxDescriptor, type FxPreviewIssue, type FxControlPoint } from './fxDescriptor';

export interface ParticleAttachmentResolution {
  object: Object3D | null;
  kind: 'exact' | 'fallback' | 'missing' | 'origin';
  frame?: ModelAttachment;
}

/** Transform Source-unit local offsets through the animated authored CP frame. */
export function particleAttachmentToWorld(attachment: ParticleAttachmentResolution, point: Vector3): Vector3 {
  if (attachment.frame) point.applyQuaternion(new Quaternion(...attachment.frame.rotation)).add({
    x: attachment.frame.position[0], y: attachment.frame.position[1], z: attachment.frame.position[2],
  });
  return attachment.object?.localToWorld(point) ?? point;
}

/** Exported attachment nodes take priority. The current morphic GLBs omit
 * attachment metadata, so hand aliases provide only a bounded approximation.
 * A decoded authored frame supplies the bone and local transform when the
 * GLB omits its attachment nodes. Missing metadata retains the approximation. */
export function resolveParticleAttachment(model: Object3D, attachment: string | null, authoredFrames?: readonly ModelAttachment[]): ParticleAttachmentResolution {
  if (attachment) {
    const key = attachment.toLowerCase();
    let exact = model.getObjectByName(attachment);
    if (!exact) model.traverse(object => { if (!exact && object.name.toLowerCase() === key) exact = object; });
    if (exact) return { object: exact, kind: 'exact' };
    const frames: ModelAttachment[] = model.userData.grimoireAttachments ?? [];
    const frame = frames.find((candidate) => candidate.name.toLowerCase() === key)
      ?? authoredFrames?.find((candidate) => candidate.name.toLowerCase() === key);
    const bone = frame && model.getObjectByName(frame.bone);
    if (bone) return { object: bone, kind: 'exact', frame };
  }
  const side = /left|_l$/i.test(attachment ?? '') ? 'l' : 'r';
  let found: Object3D | null = null;
  model.traverse((object) => {
    if (found) return;
    const name = object.name.toLowerCase();
    if (attachment && /cast|hand/i.test(attachment)
      && [`hand_${side}`, `${side}_hand`, `bip_hand_${side}`].includes(name)) found = object;
    if (!attachment && /^(spine_?2|spine_?1|bip_spine_?2)$/.test(name)) found = object;
  });
  return { object: found, kind: found ? 'fallback' : attachment ? 'missing' : 'origin' };
}

export function resolveParticleControlPoint(model: Object3D, point: FxControlPoint | undefined, attachment: string | null, frames?: readonly ModelAttachment[]): ParticleAttachmentResolution {
  if (point && !point.attachment && point.entity === 'self'
    && ((point.cp === 0 && point.attachType === null)
      || /^(?:PATTACH_WORLDORIGIN|PATTACH_ABSORIGIN|PATTACH_ABSORIGIN_FOLLOW)$/.test(point.attachType ?? ''))) {
    return { object: model, kind: 'exact' };
  }
  return resolveParticleAttachment(model, attachment, frames);
}

/** Runtime and diagnostics use the same resolver. A fallback does not become
 * exact merely because it produces a visible effect beside a plausible bone. */
export function particleAttachmentIssues(descriptor: FxDescriptor, model: Object3D): FxPreviewIssue[] {
  const issues: FxPreviewIssue[] = [];
  const checked = new Set<string | null>();
  for (const layer of allSpriteLayers(descriptor)) {
    if (checked.has(layer.attachment)) continue;
    checked.add(layer.attachment);
    const resolution = resolveParticleControlPoint(model, layer.controlPoint, layer.attachment, layer.attachments);
    if (resolution.kind === 'missing' || resolution.kind === 'fallback') {
      issues.push({ system: descriptor.name, class: 'control-point',
        reason: resolution.kind === 'missing' ? 'missing-attachment' : 'attachment-fallback' });
    }
  }
  return issues;
}
