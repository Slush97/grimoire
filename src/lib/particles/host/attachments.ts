// Ported from ValveResourceFormat (MIT): Renderer/Renderer/SceneNodes/ModelSceneNode.Attachments.cs
// (GetAttachmentLocalTransform, GetChildFrame) and SceneNode.GetRigidTransform.
//
// Where a model's attachment is in its current pose, in model space.

import type { ParticleSkeleton } from '../model';
import { createTranslation } from '../model';
import { Matrix4x4, Quaternion, Vector3, f32, safeNormalize } from '../numerics';
import type { BundleAttachment } from './bundle';

/** Matrix4x4.Lerp: element by element. */
export function lerpMatrix(a: Matrix4x4, b: Matrix4x4, amount: number): Matrix4x4 {
  return new Matrix4x4(Array.from(a.m, (value, i) => f32(value + f32(f32(b.m[i] - value) * amount))));
}

/** Matrix4x4.CreateScale with one factor. */
function createScale(scale: number): Matrix4x4 {
  return new Matrix4x4([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);
}

/**
 * GetAttachmentLocalTransform: each influence's offset and rotation carried by its bone's pose,
 * blended in by its weight; an attachment that ignores rotation keeps its translation and a uniform
 * scale. `pose` holds every bone in model space, by bone index.
 */
export function attachmentLocalTransform(attachment: BundleAttachment, skeleton: ParticleSkeleton, pose: readonly Matrix4x4[]): Matrix4x4 {
  let transform = Matrix4x4.identity();

  for (const influence of attachment.influences) {
    const boneIndex = skeleton.getBoneIndex(influence.bone);

    if (boneIndex === -1 || pose[boneIndex] === undefined) {
      continue;
    }

    const [x, y, z, w] = influence.rotation;
    const influenceTransform = Matrix4x4.fromQuaternion(new Quaternion(x, y, z, w)).multiply(createTranslation(new Vector3(...influence.offset)));
    transform = transform.multiply(lerpMatrix(Matrix4x4.identity(), influenceTransform.multiply(pose[boneIndex]), f32(influence.weight)));
  }

  if (attachment.ignoreRotation) {
    // The transform's scale is taken as uniform
    transform = createScale(transform.m[5]).multiply(createTranslation(transform.translation));
  }

  return transform;
}

/** GetRigidTransform: the rotation and translation of a transform, its scale taken out. */
export function rigidTransform(transform: Matrix4x4): Matrix4x4 {
  const row = (index: number) => safeNormalize(new Vector3(transform.m[index * 4], transform.m[index * 4 + 1], transform.m[index * 4 + 2]));
  return Matrix4x4.createBasis(row(0), row(1), row(2)).withTranslation(transform.translation);
}

/**
 * GetChildFrame: where a node attached to `name` sits on the model placed at `modelTransform`. An
 * attachment wins over a bone of the same name; neither gives the model's own frame.
 */
export function childFrame(
  name: string,
  attachments: ReadonlyMap<string, BundleAttachment>,
  skeleton: ParticleSkeleton,
  pose: readonly Matrix4x4[],
  modelTransform: Matrix4x4,
): Matrix4x4 {
  if (name !== '') {
    const attachment = attachments.get(name);

    if (attachment !== undefined) {
      return rigidTransform(attachmentLocalTransform(attachment, skeleton, pose).multiply(modelTransform));
    }

    const boneIndex = skeleton.getBoneIndex(name);

    if (boneIndex !== -1 && pose[boneIndex] !== undefined) {
      return rigidTransform(pose[boneIndex].multiply(modelTransform));
    }
  }

  return rigidTransform(modelTransform);
}

/** GetAttachmentTransform: the attachment's frame on the placed model, or the model's own when there is none. */
export function attachmentTransform(
  name: string,
  attachments: ReadonlyMap<string, BundleAttachment>,
  skeleton: ParticleSkeleton,
  pose: readonly Matrix4x4[],
  modelTransform: Matrix4x4,
): Matrix4x4 {
  const attachment = attachments.get(name);
  return attachment === undefined ? modelTransform : attachmentLocalTransform(attachment, skeleton, pose).multiply(modelTransform);
}
