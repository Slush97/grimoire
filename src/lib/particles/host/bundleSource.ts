// The simulation's file loader over a hero particle bundle (VRF's IFileLoader for the runtime).

import { type ParticleMaterialData, type ParticleModelMesh, type ParticleModelSource, deserializeModelMesh, particleResourceKey } from '../render/particleModels';
import type { ParticleDefinitionSource, LoadedParticleSystem } from '../simulation';
import { deserializeSnapshot } from '../snapshotResource';
import type { ParticleSnapshot } from '../utils/snapshotBinding';
import { type ParticleBundle, bundleSystemKey } from './bundle';

export function bundleDefinitionSource(bundle: ParticleBundle): ParticleDefinitionSource {
  const snapshots = new Map<string, ParticleSnapshot>();

  return {
    loadSystem(path: string): LoadedParticleSystem | null {
      const key = bundleSystemKey(path);
      const system = bundle.systems[key];
      return system ? { name: `${key}_c`, data: system.data, format: system.format } : null;
    },
    loadSnapshot(path: string): ParticleSnapshot | null {
      const key = path.replace(/_c$/, '').replace(/\\/g, '/');
      const serialized = bundle.snapshots[key];

      if (serialized === undefined) {
        return null;
      }

      let snapshot = snapshots.get(key);

      if (snapshot === undefined) {
        snapshot = deserializeSnapshot(serialized);
        snapshots.set(key, snapshot);
      }

      return snapshot;
    },
  };
}

/** The models and materials of a bundle, for C_OP_RenderModels, each mesh decoded once. */
export function bundleModelSource(bundle: ParticleBundle): ParticleModelSource {
  const meshes = new Map<string, ParticleModelMesh>();

  return {
    model(path: string): ParticleModelMesh | null {
      const key = particleResourceKey(path);
      const serialized = bundle.models?.[key];

      if (serialized === undefined) {
        return null;
      }

      let mesh = meshes.get(key);

      if (mesh === undefined) {
        mesh = deserializeModelMesh(serialized);
        meshes.set(key, mesh);
      }

      return mesh;
    },
    material(path: string): ParticleMaterialData | null {
      return bundle.materials?.[particleResourceKey(path)] ?? null;
    },
  };
}
