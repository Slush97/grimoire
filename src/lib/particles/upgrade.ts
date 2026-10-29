// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Upgrade/ParticleFormatUpgrader.cs,
// UpgradeKV.cs, Vpcf61ToVpcf62.cs, Vpcf62ToVpcf63.cs, Vpcf63ToVpcf64.cs, Vpcf64ToVpcf65.cs,
// Vpcf65ToVpcf66.cs and the FillTransformInput helper of Vpcf45ToVpcf46.cs.
//
// VRF replays the vpcf format-conversion chain from the stored KV3 format to the newest one before it
// reads a definition. Deadlock stores vpcf61 through vpcf66, so only the steps from vpcf61 on are
// ported. A definition stored in an older format, or whose format is unknown (VRF then replays the
// whole chain from its first step), gets the ported steps and an 'unsupported-upgrade' diagnostic.

import type { ParticleDiagnostics } from './diagnostics';
import { type KVObject, type KVValue, coerceDouble, deepClone, hasKey, isArray, isCollection } from './kv';
import { Vector3, f32 } from './numerics';

/** Upgrades one document in place from the step's FromFormat to its ToFormat. */
interface ParticleUpgradeStep {
  fromFormat: string;
  apply(root: KVObject): void;
}

/** The newest format the chain produces. */
export const LATEST_FORMAT = 'vpcf66';

/** The oldest format whose upgrade steps are ported. */
export const OLDEST_PORTED_FORMAT = 'vpcf61';

/** The chain position each format enters at: generic, vpcf1, ..., vpcf66. */
function chainIndex(format: string): number {
  if (format === 'generic') {
    return 0;
  }

  const match = /^vpcf(\d+)$/.exec(format);
  const version = match ? Number(match[1]) : NaN;
  return Number.isInteger(version) && version >= 1 && version <= 66 ? version : -1;
}

/**
 * Deep-clones the document and applies every upgrade step past its stored format, so edits to the
 * result never reach the input. Missing and unknown formats start at the oldest step, as in VRF.
 */
export function upgradeToLatest(root: KVObject, storedFormat: string | null, diagnostics: ParticleDiagnostics, system?: string): KVObject {
  const upgraded = deepClone(root);
  const index = storedFormat === null ? -1 : chainIndex(storedFormat);
  const startIndex = index < 0 ? 0 : index;
  const firstPorted = chainIndex(OLDEST_PORTED_FORMAT);

  if (startIndex < firstPorted) {
    const stored = storedFormat === null ? 'an unknown format' : index < 0 ? `unknown format ${storedFormat}` : storedFormat;
    diagnostics.report(
      'unsupported-upgrade',
      `Definition stored in ${stored} needs the format upgrade steps before ${OLDEST_PORTED_FORMAT}, which are not ported`,
      system,
    );
  }

  for (const step of STEPS) {
    if (chainIndex(step.fromFormat) >= startIndex) {
      step.apply(upgraded);
    }
  }

  return upgraded;
}

// UpgradeKV

function find(obj: KVObject, name: string): KVValue | undefined {
  return hasKey(obj, name) ? obj[name] : undefined;
}

function getString(obj: KVObject, name: string, defaultValue: string): string {
  const value = find(obj, name);
  return typeof value === 'string' ? value : defaultValue;
}

function getInt(obj: KVObject, name: string, defaultValue: number): number {
  const value = find(obj, name);

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'number') {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    return Math.trunc(coerceDouble(value, 0));
  }

  return defaultValue;
}

function getFloat(obj: KVObject, name: string, defaultValue: number): number {
  const value = find(obj, name);
  return f32(value === undefined ? defaultValue : coerceDouble(value, defaultValue));
}

function getBool(obj: KVObject, name: string, defaultValue: boolean): boolean {
  const value = find(obj, name);

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || (lowered !== 'false' && coerceDouble(value, 0) !== 0);
  }

  return defaultValue;
}

/** A member holding an exactly-three-element array of numbers; any other shape yields the default. */
function getFloat3(obj: KVObject, name: string, defaultValue: Vector3): Vector3 {
  const value = find(obj, name);

  if (!isArray(value) || value.length !== 3) {
    return defaultValue;
  }

  const components: number[] = [];

  for (const component of value) {
    if (typeof component !== 'number' && typeof component !== 'string') {
      return defaultValue;
    }

    components.push(f32(coerceDouble(component, 0)));
  }

  return new Vector3(components[0], components[1], components[2]);
}

function setFloatArray(obj: KVObject, name: string, ...values: number[]): void {
  obj[name] = values.map((value) => f32(value));
}

/** Finds or creates the named member and resets it to an empty object, keeping its position when it exists. */
function setObject(obj: KVObject, name: string): KVObject {
  const created: KVObject = {};
  obj[name] = created;
  return created;
}

/** Reads and removes the named member as an integer; an absent member yields the default. */
function takeInt(obj: KVObject, name: string, defaultValue: number): number {
  if (!hasKey(obj, name)) {
    return defaultValue;
  }

  const value = getInt(obj, name, 0);
  delete obj[name];
  return value;
}

/** The named member's object value, created at the tail when absent and reset in place when not an object. */
function mergeObject(obj: KVObject, name: string): KVObject {
  const value = find(obj, name);
  return isCollection(value) ? value : setObject(obj, name);
}

function walkObjects(node: KVValue, visit: (node: KVObject) => void): void {
  if (isCollection(node)) {
    visit(node);

    for (const child of Object.values(node)) {
      walkObjects(child, visit);
    }
  } else if (isArray(node)) {
    for (const element of [...node]) {
      walkObjects(element, visit);
    }
  }
}

/** Vpcf45ToVpcf46.FillTransformInput: values outside 0..63 become PT_TYPE_INVALID without a control point. */
function fillTransformInput(transform: KVObject, controlPoint: number): void {
  if (controlPoint >>> 0 > 63) {
    transform['m_nType'] = 'PT_TYPE_INVALID';
  } else {
    transform['m_nType'] = 'PT_TYPE_CONTROL_POINT';
    transform['m_nControlPoint'] = controlPoint;
  }
}

// The steps

/**
 * Negates the Y component of C_INIT_CreateWithinSphereTransform's two local-coordinate-system speed
 * vector inputs across every vector-input type.
 */
const vpcf61ToVpcf62: ParticleUpgradeStep = {
  fromFormat: 'vpcf61',
  apply(root) {
    walkObjects(root, (node) => {
      if (getString(node, '_class', '') !== 'C_INIT_CreateWithinSphereTransform') {
        return;
      }

      negateVectorInput(node, 'm_LocalCoordinateSystemSpeedMin');
      negateVectorInput(node, 'm_LocalCoordinateSystemSpeedMax');
    });
  },
};

function negateVectorInput(node: KVObject, name: string): void {
  const input = find(node, name);

  if (!isCollection(input)) {
    return;
  }

  switch (getString(input, 'm_nType', 'PVEC_TYPE_LITERAL')) {
    case 'PVEC_TYPE_LITERAL': {
      const value = getFloat3(input, 'm_vLiteralValue', Vector3.zero);
      delete node[name];
      const rebuilt = setObject(node, name);
      rebuilt['m_nType'] = 'PVEC_TYPE_LITERAL';
      setFloatArray(rebuilt, 'm_vLiteralValue', value.x, -value.y, value.z);
      break;
    }

    case 'PVEC_TYPE_PARTICLE_VECTOR':
      negateY(input, 'm_vVectorAttributeScale');
      break;

    case 'PVEC_TYPE_RANDOM_UNIFORM':
      negateY(input, 'm_vRandomMin');
      negateY(input, 'm_vRandomMax');
      break;

    case 'PVEC_TYPE_CP_VALUE':
      negateY(input, 'm_vCPValueScale');
      break;

    case 'PVEC_TYPE_FLOAT_INTERP':
    case 'PVEC_TYPE_FLOAT_INTERP_CLAMPED':
      negateY(input, 'm_vInterpOutput0');
      negateY(input, 'm_vInterpOutput1');
      break;

    case 'PVEC_TYPE_FLOAT_COMPONENTS': {
      const componentY = find(input, 'm_FloatComponentY');

      if (isCollection(componentY)) {
        negateFloatInput(componentY);
      }

      break;
    }

    default:
      break;
  }
}

function negateFloatInput(input: KVObject): void {
  switch (getString(input, 'm_nType', 'PF_TYPE_LITERAL')) {
    case 'PF_TYPE_LITERAL':
      negateFloat(input, 'm_flLiteralValue');
      break;

    case 'PF_TYPE_RANDOM_UNIFORM':
    case 'PF_TYPE_RANDOM_BIASED':
      negateFloat(input, 'm_flRandomMin');
      negateFloat(input, 'm_flRandomMax');
      break;

    case 'PF_TYPE_CONTROL_POINT_COMPONENT':
      if (getString(input, 'm_nMapType', 'PF_MAP_TYPE_INVALID') === 'PF_MAP_TYPE_DIRECT') {
        input['m_nMapType'] = 'PF_MAP_TYPE_MULT';
      }

      break;

    case 'PF_TYPE_PARTICLE_DETAIL_LEVEL':
      negateFloat(input, 'm_flLOD0');
      negateFloat(input, 'm_flLOD1');
      negateFloat(input, 'm_flLOD2');
      negateFloat(input, 'm_flLOD3');
      break;

    case 'PF_TYPE_NOISE':
      negateFloat(input, 'm_flNoiseOutputMin');
      negateFloat(input, 'm_flNoiseOutputMax');
      break;

    default:
      break;
  }

  switch (getString(input, 'm_nMapType', 'PF_MAP_TYPE_INVALID')) {
    case 'PF_MAP_TYPE_MULT':
      negateFloat(input, 'm_flMultFactor');
      break;

    case 'PF_MAP_TYPE_REMAP':
    case 'PF_MAP_TYPE_REMAP_BIASED':
      negateFloat(input, 'm_flOutput0');
      negateFloat(input, 'm_flOutput1');
      break;

    case 'PF_MAP_TYPE_NOTCHED':
      negateFloat(input, 'm_flNotchedOutputOutside');
      negateFloat(input, 'm_flNotchedOutputInside');
      break;

    case 'PF_MAP_TYPE_CURVE': {
      const curve = find(input, 'm_Curve');

      if (isCollection(curve)) {
        negateDomainY(curve, 'm_vDomainMins');
        negateDomainY(curve, 'm_vDomainMaxs');
      }

      break;
    }

    default:
      break;
  }
}

function negateY(obj: KVObject, name: string): void {
  const value = getFloat3(obj, name, Vector3.zero);
  setFloatArray(obj, name, value.x, -value.y, value.z);
}

function negateFloat(obj: KVObject, name: string): void {
  obj[name] = -getFloat(obj, name, 0);
}

function negateDomainY(curve: KVObject, name: string): void {
  const domain = find(curve, name);
  const components = [0, 0];

  if (isArray(domain)) {
    let index = 0;

    for (const element of domain) {
      if (index >= 2) {
        break;
      }

      components[index++] = typeof element === 'number' || typeof element === 'string' ? f32(coerceDouble(element, 0)) : 0;
    }
  }

  setFloatArray(curve, name, components[0], -components[1]);
}

/** Folds C_OP_RemapAverageScalarValuetoCP's four remap scalars into a single m_flOutputRemap input. */
const vpcf62ToVpcf63: ParticleUpgradeStep = {
  fromFormat: 'vpcf62',
  apply(root) {
    walkObjects(root, (node) => {
      if (getString(node, '_class', '') !== 'C_OP_RemapAverageScalarValuetoCP') {
        return;
      }

      const inputMin = getFloat(node, 'm_flInputMin', 0);
      const inputMax = getFloat(node, 'm_flInputMax', 1);
      const outputMin = getFloat(node, 'm_flOutputMin', 0);
      const outputMax = getFloat(node, 'm_flOutputMax', 1);
      delete node['m_flInputMin'];
      delete node['m_flInputMax'];
      delete node['m_flOutputMin'];
      delete node['m_flOutputMax'];

      const remap = setObject(node, 'm_flOutputRemap');
      remap['m_nType'] = 'PF_TYPE_INVALID';
      remap['m_nMapType'] = 'PF_MAP_TYPE_REMAP';
      remap['m_flInput0'] = inputMin;
      remap['m_flInput1'] = inputMax;
      remap['m_flOutput0'] = outputMin;
      remap['m_flOutput1'] = outputMax;
    });
  },
};

/** Converts C_INIT_PositionPlaceOnGround's trace-along-normal flag into a m_vecTraceDir particle-vector input. */
const vpcf63ToVpcf64: ParticleUpgradeStep = {
  fromFormat: 'vpcf63',
  apply(root) {
    walkObjects(root, (node) => {
      if (getString(node, '_class', '') !== 'C_INIT_PositionPlaceOnGround' || !getBool(node, 'm_bTraceAlongNormal', false)) {
        return;
      }

      const attribute = getInt(node, 'm_nTraceDirectionAttribute', 21);
      const setNormal = getBool(node, 'm_bSetNormal', false);
      delete node['m_bTraceAlongNormal'];
      delete node['m_nTraceDirectionAttribute'];

      if (setNormal) {
        node['m_nGroundNormalAttribute'] = attribute;
      }

      const traceDir = mergeObject(node, 'm_vecTraceDir');
      traceDir['m_nType'] = 'PVEC_TYPE_PARTICLE_VECTOR';
      traceDir['m_nVectorAttribute'] = attribute;
    });
  },
};

/** Migrates C_INIT_CreateSpiralSphere's control point, density and override control point into inputs. */
const vpcf64ToVpcf65: ParticleUpgradeStep = {
  fromFormat: 'vpcf64',
  apply(root) {
    walkObjects(root, (node) => {
      if (getString(node, '_class', '') !== 'C_INIT_CreateSpiralSphere') {
        return;
      }

      const cp = takeInt(node, 'm_nControlPointNumber', 0) | 0;
      fillTransformInput(mergeObject(node, 'm_TransformInput'), cp);

      const density = takeInt(node, 'm_nDensity', 0);

      if (density !== 0) {
        const input = setObject(node, 'm_flDensity');
        input['m_nType'] = 'PF_TYPE_LITERAL';
        input['m_flLiteralValue'] = f32(density);
      }

      if (!hasKey(node, 'm_nOverrideCP')) {
        return;
      }

      const overrideCP = takeInt(node, 'm_nOverrideCP', 0) | 0;

      if (overrideCP === -1) {
        return;
      }

      const radius = getFloat(node, 'm_flInitialRadius', 0);
      const speedMin = getFloat(node, 'm_flInitialSpeedMin', 0);
      const speedMax = getFloat(node, 'm_flInitialSpeedMax', 0);
      delete node['m_flInitialRadius'];
      delete node['m_flInitialSpeedMin'];
      delete node['m_flInitialSpeedMax'];

      setCpComponent(setObject(node, 'm_flInitialRadius'), overrideCP, 0, radius);
      setCpComponent(setObject(node, 'm_flDensity'), overrideCP, 1, density);
      setCpComponent(setObject(node, 'm_flInitialSpeedMin'), overrideCP, 2, speedMin);
      setCpComponent(setObject(node, 'm_flInitialSpeedMax'), overrideCP, 2, speedMax);
    });
  },
};

function setCpComponent(input: KVObject, cp: number, component: number, factor: number): void {
  input['m_nType'] = 'PF_TYPE_CONTROL_POINT_COMPONENT';
  input['m_nControlPoint'] = cp;
  input['m_nVectorComponent'] = component;
  input['m_nMapType'] = 'PF_MAP_TYPE_MULT';
  input['m_flMultFactor'] = f32(factor);
}

/** Rebuilds C_OP_MaxVelocity's m_flMaxVelocity into a CP-component input for a consumed override control point. */
const vpcf65ToVpcf66: ParticleUpgradeStep = {
  fromFormat: 'vpcf65',
  apply(root) {
    walkObjects(root, (node) => {
      if (getString(node, '_class', '') !== 'C_OP_MaxVelocity') {
        return;
      }

      if (hasKey(node, 'm_nOverrideCP')) {
        const overrideCP = takeInt(node, 'm_nOverrideCP', 0) | 0;

        if (overrideCP !== -1) {
          const field = getInt(node, 'm_nOverrideCPField', 0);
          const maxVelocity = setObject(node, 'm_flMaxVelocity');
          maxVelocity['m_nType'] = 'PF_TYPE_CONTROL_POINT_COMPONENT';
          maxVelocity['m_nControlPoint'] = overrideCP;
          maxVelocity['m_nVectorComponent'] = field;
        }
      }

      delete node['nOverrideCPField'];
    });
  },
};

const STEPS: readonly ParticleUpgradeStep[] = [vpcf61ToVpcf62, vpcf62ToVpcf63, vpcf63ToVpcf64, vpcf64ToVpcf65, vpcf65ToVpcf66];
