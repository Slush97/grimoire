// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleNamedValues.cs.

import { type KVObject, type KVValue, coerceDouble, getArray, getString, getSubCollection, hasKey, isArray, isCollection, toVector3 } from './kv';
import { Quaternion, Vector3, eulerAnglesToQuaternion, f32 } from './numerics';

/** The kinds of value a particle system named value holds. */
export const ParticleNamedValueType = {
  /** A type particle inputs cannot read, such as an entity handle. */
  Other: 0,
  Float: 1,
  Vector: 2,
  Transform: 3,
} as const;

/** A typed named value. A transform keeps its position in `vector`. */
export interface ParticleNamedValue {
  readonly type: number;
  readonly float: number;
  readonly vector: Vector3;
  readonly rotation: Quaternion;
}

export function namedFloat(value: number): ParticleNamedValue {
  return { type: ParticleNamedValueType.Float, float: f32(value), vector: Vector3.zero, rotation: Quaternion.identity };
}

export function namedVector(value: Vector3): ParticleNamedValue {
  return { type: ParticleNamedValueType.Vector, float: 0, vector: value, rotation: Quaternion.identity };
}

export function namedTransform(position: Vector3, rotation: Quaternion): ParticleNamedValue {
  return { type: ParticleNamedValueType.Transform, float: 0, vector: position, rotation };
}

function defaultOf(type: number): ParticleNamedValue {
  return { type, float: 0, vector: Vector3.zero, rotation: Quaternion.identity };
}

/** This value as `type`, or null when it does not convert. */
function convertTo(value: ParticleNamedValue, type: number): ParticleNamedValue | null {
  if (value.type === ParticleNamedValueType.Other || type === ParticleNamedValueType.Other) {
    return null;
  }

  if (value.type === type) {
    return value;
  }

  if (value.type === ParticleNamedValueType.Vector && type === ParticleNamedValueType.Transform) {
    return namedTransform(value.vector, Quaternion.identity);
  }

  if (value.type === ParticleNamedValueType.Transform && type === ParticleNamedValueType.Vector) {
    return namedVector(value.vector);
  }

  return null;
}

const FUNCTION_LISTS = [
  'm_PreEmissionOperators',
  'm_Emitters',
  'm_Initializers',
  'm_Operators',
  'm_ForceGenerators',
  'm_Constraints',
  'm_Renderers',
];

/**
 * The named values of one system: the definition's m_NamedValueLocals, the names its inputs read,
 * and the names of every child below it. Three tables hold the values: the current one, the one
 * captured on the first step after the system starts or restarts, and the previous step's.
 */
export class ParticleNamedValues {
  private readonly slots = new Map<string, number>();
  private readonly memberList: { name: string; type: number }[] = [];
  private readonly localList: { name: string; value: ParticleNamedValue }[] = [];

  private current: ParticleNamedValue[] = [];
  private previous: ParticleNamedValue[] = [];
  private initial: ParticleNamedValue[] = [];
  private assigned: boolean[] = [];

  private capturePending = true;

  get members(): readonly { name: string; type: number }[] {
    return this.memberList;
  }

  /** The m_NamedValueLocals that carry a default value, in definition order. */
  get locals(): readonly { name: string; value: ParticleNamedValue }[] {
    return this.localList;
  }

  constructor(definition: KVObject, children: readonly ParticleNamedValues[]) {
    for (const local of getArray(definition, 'm_NamedValueLocals') ?? []) {
      if (!isCollection(local)) {
        continue;
      }

      const name = getString(local, 'm_Name');
      const valueType = getString(local, 'm_ValueType');
      const type =
        valueType === 'PVAL_FLOAT' ? ParticleNamedValueType.Float
          : valueType === 'PVAL_VEC3' ? ParticleNamedValueType.Vector
            : valueType === 'PVAL_TRANSFORM' ? ParticleNamedValueType.Transform
              : valueType === null || valueType === 'PVAL_INVALID' || valueType === 'PVAL_VOID' ? null
                : ParticleNamedValueType.Other;

      if (name === null || name === '' || type === null) {
        continue;
      }

      this.addMember(name, type);

      const config = getSubCollection(local, 'm_DefaultConfig');

      if (config !== null && hasKey(config, 'm_ConfigValue')) {
        const value = readDefault(type, config['m_ConfigValue']);

        if (value !== null) {
          this.localList.push({ name, value });
        }
      }
    }

    for (const list of FUNCTION_LISTS) {
      for (const fn of getArray(definition, list) ?? []) {
        this.addInputReferences(fn);
      }
    }

    for (const child of children) {
      for (const { name, type } of child.members) {
        this.addMember(name, type);
      }
    }

    this.reset();
  }

  private addMember(name: string, type: number): void {
    if (!this.slots.has(name)) {
      this.slots.set(name, this.memberList.length);
      this.memberList.push({ name, type });
    }
  }

  private addInputReferences(node: KVValue): void {
    if (isCollection(node)) {
      const name = getString(node, 'm_NamedValue');
      const inputType = getString(node, 'm_nType');

      if (name !== null && name.length > 0 && inputType !== null) {
        switch (inputType) {
          case 'PF_TYPE_NAMED_VALUE':
            this.addMember(name, ParticleNamedValueType.Float);
            break;
          case 'PVEC_TYPE_NAMED_VALUE':
            this.addMember(name, ParticleNamedValueType.Vector);
            break;
          case 'PT_TYPE_NAMED_VALUE':
            this.addMember(name, ParticleNamedValueType.Transform);
            break;
          case 'PM_TYPE_NAMED_VALUE_MODEL':
          case 'PM_TYPE_NAMED_VALUE_EHANDLE':
            this.addMember(name, ParticleNamedValueType.Other);
            break;
        }
      }

      for (const value of Object.values(node)) {
        if (isCollection(value) || isArray(value)) {
          this.addInputReferences(value);
        }
      }
    } else if (isArray(node)) {
      for (const element of node) {
        this.addInputReferences(element);
      }
    }
  }

  /** Puts every value back to its type's default, to be captured again on the next step. */
  reset(): void {
    const count = this.memberList.length;
    this.current = this.memberList.map((member) => defaultOf(member.type));
    this.previous = this.memberList.map((member) => defaultOf(member.type));
    this.initial = this.memberList.map((member) => defaultOf(member.type));
    this.assigned = new Array<boolean>(count).fill(false);
    this.capturePending = true;
  }

  /** Makes the next step capture the values it starts with again, as after a restart. */
  recapture(): void {
    this.capturePending = true;
  }

  /** Writes `value` into the current table, converted to the declared type. */
  set(name: string, value: ParticleNamedValue): boolean {
    const slot = this.slots.get(name);

    if (slot === undefined) {
      return false;
    }

    const converted = convertTo(value, this.memberList[slot].type);

    if (converted === null) {
      return false;
    }

    this.current[slot] = converted;
    this.assigned[slot] = true;
    return true;
  }

  /** Run at the start of every frame: the first one after a start or restart captures the values it starts with. */
  beginFrame(): void {
    if (!this.capturePending) {
      return;
    }

    this.capturePending = false;
    this.previous = [...this.current];
    this.initial = [...this.current];
  }

  /** Run at the end of every simulated frame: the current and previous tables trade places. */
  endFrame(): void {
    const swapped = this.current;
    this.current = this.previous;
    this.previous = swapped;
  }

  /** The current float value, when a local default or a host has given the name one, else null. */
  tryGetFloat(name: string): number | null {
    const slot = this.slots.get(name);

    if (slot === undefined || !this.assigned[slot]) {
      return null;
    }

    return convertTo(this.current[slot], ParticleNamedValueType.Float)?.float ?? null;
  }

  /** The current vector value, or the one captured when the system started unless `follow`. */
  getVector(name: string, follow: boolean): Vector3 {
    return this.get(follow ? this.current : this.initial, name, ParticleNamedValueType.Vector)?.vector ?? Vector3.zero;
  }

  /** The current transform, or the one captured at the start unless `follow`, and the previous step's. */
  tryGetTransform(name: string, follow: boolean): { value: ParticleNamedValue; previous: ParticleNamedValue } | null {
    const found = this.get(follow ? this.current : this.initial, name, ParticleNamedValueType.Transform);
    const foundPrevious = this.get(this.previous, name, ParticleNamedValueType.Transform);

    if (found === null || foundPrevious === null) {
      return null;
    }

    return { value: found, previous: foundPrevious };
  }

  private get(table: ParticleNamedValue[], name: string, type: number): ParticleNamedValue | null {
    const slot = this.slots.get(name);
    return slot === undefined ? null : convertTo(table[slot], type);
  }
}

function readDefault(type: number, value: KVValue): ParticleNamedValue | null {
  if (type === ParticleNamedValueType.Float && typeof value === 'number') {
    return namedFloat(value);
  }

  if (type === ParticleNamedValueType.Vector && isArray(value) && value.length >= 3) {
    return namedVector(toVector3(value));
  }

  if (type === ParticleNamedValueType.Transform && isCollection(value)) {
    const position = hasKey(value, 'position') ? toVector3(value['position']) : Vector3.zero;
    const angles = hasKey(value, 'angles') ? toVector3(value['angles']) : Vector3.zero;
    return namedTransform(position, eulerAnglesToQuaternion(angles));
  }

  if (type === ParticleNamedValueType.Transform && isArray(value) && (value.length === 7 || value.length === 8)) {
    const offset = value.length === 7 ? 3 : 4;
    const element = (index: number) => coerceDouble(value[index], 0);
    return namedTransform(toVector3(value), new Quaternion(element(offset), element(offset + 1), element(offset + 2), element(offset + 3)));
  }

  return null;
}
