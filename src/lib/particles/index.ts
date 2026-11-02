// A TypeScript port of ValveResourceFormat's Source 2 particle simulation (MIT; see
// THIRD_PARTY_NOTICES.md). It runs a particle system definition, decoded from KV3 to JSON, with no
// graphics backend. Classes it does not implement yet are reported in `diagnostics`, never ignored.

export { ParticleDiagnostics, type ParticleDiagnostic, type ParticleDiagnosticKind } from './diagnostics';
export { ParticleField, particleFieldName } from './enums';
export type { KVObject, KVValue } from './kv';
export { Quaternion, Vector3 } from './numerics';
export { VRF_CLASSES, isPorted, portedClasses, type FunctionKind } from './registry';
export {
  ParticleSystemSimulation,
  type LoadedParticleSystem,
  type ParticleDefinitionSource,
  type ParticleSystemObserver,
  type SimulationOptions,
} from './simulation';
export { ControlPoint, ParticleSystemState } from './state';
export { LATEST_FORMAT, OLDEST_PORTED_FORMAT } from './upgrade';
export type { ParticleSnapshot } from './utils/snapshotBinding';
