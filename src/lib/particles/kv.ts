// Reads particle definitions decoded from KV3 to JSON, as ValveResourceFormat reads its KVObject
// tree. Ported from ValveResourceFormat (MIT): ValveResourceFormat/Serialization/KeyValues/
// KVObjectExtensions.cs and ValveResourceFormat/Particles/Upgrade/UpgradeKV.cs.
//
// The JSON loses the KV3 value types: an integer and a float holding a whole number read the same,
// which the readers here never need to tell apart.

import { Vector3, f32 } from './numerics';

/** A decoded KV3 value: a JSON scalar, array or object. */
export type KVValue = null | boolean | number | string | KVValue[] | KVObject;

/** A decoded KV3 collection. */
export interface KVObject {
  [key: string]: KVValue;
}

export function isCollection(value: KVValue | undefined): value is KVObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isArray(value: KVValue | undefined): value is KVValue[] {
  return Array.isArray(value);
}

export function hasKey(obj: KVObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** GetStringProperty: the value when it is a string, else the default. */
export function getString(obj: KVObject, key: string, defaultValue: string): string;
export function getString(obj: KVObject, key: string, defaultValue?: string | null): string | null;
export function getString(obj: KVObject, key: string, defaultValue: string | null = null): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : defaultValue;
}

/** GetArray: the elements when the value is an array, else null. */
export function getArray(obj: KVObject, key: string): KVValue[] | null {
  const value = obj[key];
  return Array.isArray(value) ? value : null;
}

/** GetArray restricted to its collection elements, as the function lists hold. */
export function getObjectArray(obj: KVObject, key: string): KVObject[] {
  return (getArray(obj, key) ?? []).filter(isCollection);
}

/** GetSubCollection: the value when it is a collection, else null. */
export function getSubCollection(obj: KVObject, key: string): KVObject | null {
  const value = obj[key];
  return isCollection(value) ? value : null;
}

/** A string that does not parse as a number reads as 0, as the upgrade chain's StringToFloat64 does. */
function stringToFloat64(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/** CoerceDouble: numbers, booleans and numeric strings; anything else gives the default. */
export function coerceDouble(value: KVValue | undefined, defaultValue: number): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    return stringToFloat64(value);
  }
  return defaultValue;
}

/** Whether a member is present and not a blank string, as TryGetScalar tests. */
export function hasScalar(obj: KVObject, key: string): boolean {
  if (!hasKey(obj, key)) {
    return false;
  }
  const value = obj[key];
  return !(typeof value === 'string' && value.trim() === '');
}

/** An integer read of a scalar: whole numbers as authored, booleans as 0 or 1. */
export function toInteger(value: KVValue | undefined): number {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    return Math.trunc(stringToFloat64(value)) | 0;
  }
  if (typeof value === 'number') {
    return Math.trunc(value) | 0;
  }
  return 0;
}

/** GetBooleanProperty. */
export function getBoolean(obj: KVObject, key: string, defaultValue: boolean): boolean {
  if (!hasScalar(obj, key)) {
    return defaultValue;
  }
  const value = obj[key];
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
    return stringToFloat64(value) !== 0;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return value === true;
}

/** GetIntegerProperty. */
export function getInteger(obj: KVObject, key: string, defaultValue: number): number {
  return hasScalar(obj, key) ? toInteger(obj[key]) : defaultValue;
}

/** ToVector3 of an array value. */
export function toVector3(value: KVValue | undefined): Vector3 {
  if (!Array.isArray(value)) {
    return Vector3.zero;
  }
  return new Vector3(coerceDouble(value[0], 0), coerceDouble(value[1], 0), coerceDouble(value[2], 0));
}

/** EntityTransformHelper.ParseVector3: space separated components. */
export function parseVector3(text: string): Vector3 {
  const parts = text.trim().split(/\s+/).map((part) => f32(stringToFloat64(part)));
  return new Vector3(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
}

/** A deep copy, so an upgrade never edits the caller's definition. */
export function deepClone<T extends KVValue>(value: T): T {
  return structuredClone(value);
}
