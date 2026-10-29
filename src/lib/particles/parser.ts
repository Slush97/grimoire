// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleDefinitionParser.cs,
// with KVObjectExtensions.NormalizeEnumName.

import type { ParticleDiagnostics } from './diagnostics';
import { type EnumTable, type ParticleField } from './enums';
import {
  type KVObject,
  type KVValue,
  coerceDouble,
  getString,
  hasKey,
  hasScalar,
  isArray,
  isCollection,
  parseVector3,
  toInteger,
  toVector3,
} from './kv';
import { Vector3, clamp, f32 } from './numerics';
import { fieldMask } from './fields';
import {
  CollectionNumberInput,
  LiteralNumberProvider,
  type NumberProvider,
  createNumberProvider,
} from './numberProviders';
import {
  CollectionVectorInput,
  LiteralColorVectorProvider,
  LiteralVectorProvider,
  type VectorProvider,
  createVectorProvider,
} from './vectorProviders';
import { type TransformProvider, createTransformProvider } from './transformProviders';
import { MAX_CONTROL_POINT, ParticleSystemState } from './state';

/** A mutable cell shared between parsers, as C#'s StrongBox. */
export interface Box<T> {
  value: T;
}

/**
 * Wraps a definition block with typed, default-aware readers. `initialReads` collects the mask of
 * the attributes whose initial value the inputs of the definition read; `randomInputs` is set when
 * the particle function being read declares a random float input.
 */
export class ParticleDefinitionParser {
  readonly data: KVObject;
  readonly logger: ParticleDiagnostics;
  readonly initialReads: Box<bigint>;
  readonly behaviorVersion: number;
  readonly randomInputs: Box<boolean> | null;

  constructor(
    data: KVObject,
    logger: ParticleDiagnostics,
    initialReads: Box<bigint>,
    behaviorVersion = 0,
    randomInputs: Box<boolean> | null = null,
  ) {
    this.data = data;
    this.logger = logger;
    this.initialReads = initialReads;
    this.behaviorVersion = behaviorVersion;
    this.randomInputs = randomInputs;
  }

  /** The same parser at another behavior version. */
  withBehaviorVersion(behaviorVersion: number): ParticleDefinitionParser {
    return new ParticleDefinitionParser(this.data, this.logger, this.initialReads, behaviorVersion, this.randomInputs);
  }

  /** Reads a block nested in this one. */
  nested(data: KVObject): ParticleDefinitionParser {
    return new ParticleDefinitionParser(data, this.logger, this.initialReads, this.behaviorVersion, this.randomInputs);
  }

  /** Reads the block of a particle function, tracking its random inputs apart from other functions. */
  function(data: KVObject): ParticleDefinitionParser {
    return new ParticleDefinitionParser(data, this.logger, this.initialReads, this.behaviorVersion, { value: false });
  }

  addInitialRead(field: ParticleField): void {
    this.initialReads.value |= fieldMask(field);
  }

  addRandomInput(): void {
    if (this.randomInputs !== null) {
      this.randomInputs.value = true;
    }
  }

  /** Child parsers for the array at `key`, or none when it is absent. */
  array(key: string): ParticleDefinitionParser[] {
    if (!hasKey(this.data, key)) {
      return [];
    }

    const value = this.data[key];

    if (!isArray(value)) {
      throw new Error(`Field ${key} is not an array`);
    }

    return value.map((element) => this.nested(isCollection(element) ? element : {}));
  }

  float(key: string, defaultValue = 0): number {
    if (!hasKey(this.data, key)) {
      return defaultValue;
    }

    const value = this.data[key];

    // Newer content authors many scalar fields as full float-input structures; such content still loads
    if (isCollection(value)) {
      this.logger.warn(`Field ${key} is authored as a number provider, but is parsed as a literal float`);
      return this.readNumberProvider(value)?.nextNumber(ParticleSystemState.defaultState()) ?? 0;
    }

    return f32(coerceDouble(value, 0));
  }

  int32(key: string, defaultValue = 0): number {
    if (!hasKey(this.data, key)) {
      return defaultValue;
    }

    const value = this.data[key];

    if (isCollection(value)) {
      this.logger.warn(`Field ${key} is authored as a number provider, but is parsed as a literal int`);
      return Math.trunc(this.readNumberProvider(value)?.nextNumber(ParticleSystemState.defaultState()) ?? 0);
    }

    // A blank string is zero
    return toInteger(value);
  }

  /** A control point index, clamped to 0 to MaxControlPoint. */
  controlPoint(key: string, defaultValue = 0): number {
    return clamp(this.int32(key, defaultValue), 0, MAX_CONTROL_POINT);
  }

  boolean(key: string, defaultValue = false): boolean {
    if (!hasKey(this.data, key)) {
      return defaultValue;
    }

    if (!hasScalar(this.data, key)) {
      return defaultValue;
    }

    const value = this.data[key];

    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      return lowered === 'true' ? true : lowered === 'false' ? false : coerceDouble(value, 0) !== 0;
    }

    return typeof value === 'number' ? value !== 0 : value === true;
  }

  string(key: string, defaultValue = ''): string {
    return getString(this.data, key, defaultValue);
  }

  vector3(key: string, defaultValue: Vector3 = Vector3.zero): Vector3 {
    return hasKey(this.data, key) ? this.readVector3(key, this.data[key]) : defaultValue;
  }

  private readVector3(key: string, value: KVValue): Vector3 {
    // Some content authors vectors as space-separated strings
    if (typeof value === 'string') {
      return parseVector3(value);
    }

    if (isCollection(value) && hasKey(value, 'm_nType')) {
      this.logger.warn(`Field ${key} is authored as a vector provider, but is parsed as a literal vector`);
    }

    return toVector3(value);
  }

  /** Reads an enum authored as a member name or its raw value, falling back to the default. */
  enum(key: string, table: EnumTable, defaultValue: number): number {
    return this.readEnum(key, table, defaultValue, null);
  }

  /** Reads an enum with normalized name matching, as for the C# enum named `enumTypeName`. */
  enumNormalized(key: string, table: EnumTable, enumTypeName: string, defaultValue: number): number {
    return this.readEnum(key, table, defaultValue, enumTypeName);
  }

  private readEnum(key: string, table: EnumTable, defaultValue: number, normalizeAs: string | null): number {
    if (!hasKey(this.data, key)) {
      return defaultValue;
    }

    const value = this.data[key];

    if (typeof value !== 'string') {
      return this.fromEnumValue(key, table, toInteger(value), defaultValue);
    }

    if (/^\s*[+-]?\d+\s*$/.test(value)) {
      return this.fromEnumValue(key, table, Number.parseInt(value, 10), defaultValue);
    }

    const member = normalizeAs !== null ? normalizeEnumName(value, normalizeAs, 'Flags') : value;

    if (Object.prototype.hasOwnProperty.call(table, member)) {
      return table[member];
    }

    this.logger.warn(`Enum has no member named '${value}' read from ${key}, using ${defaultValue}`);
    return defaultValue;
  }

  private fromEnumValue(key: string, table: EnumTable, value: number, defaultValue: number): number {
    if (Object.values(table).includes(value)) {
      return value;
    }

    this.logger.warn(`Enum has no member with value ${value} read from ${key}, using ${defaultValue}`);
    return defaultValue;
  }

  particleField(key: string, defaultValue: ParticleField): ParticleField {
    return hasScalar(this.data, key) ? toInteger(this.data[key]) : defaultValue;
  }

  /** An integer RGB color array as a normalized [0, 1] vector. */
  color24(key: string, defaultValue: Vector3): Vector3 {
    return hasKey(this.data, key) ? toVector3(this.data[key]).div(255) : defaultValue;
  }

  numberProvider(key: string, defaultValue: NumberProvider): NumberProvider {
    if (!hasKey(this.data, key)) {
      return defaultValue;
    }

    return this.readNumberProvider(this.data[key]) ?? defaultValue;
  }

  /** A CParticleCollectionFloatInput: evaluated for the whole collection even where read per particle. */
  collectionNumberProvider(key: string, defaultValue: NumberProvider): NumberProvider {
    const provider = this.numberProvider(key, defaultValue);
    return provider instanceof LiteralNumberProvider ? provider : new CollectionNumberInput(provider);
  }

  /** A CParticleCollectionVecInput: evaluated for the whole collection even where read per particle. */
  collectionVectorProvider(key: string, defaultValue: VectorProvider): VectorProvider {
    const provider = this.vectorProvider(key, defaultValue);
    return provider instanceof LiteralVectorProvider || provider instanceof LiteralColorVectorProvider
      ? provider
      : new CollectionVectorInput(provider);
  }

  private readNumberProvider(value: KVValue): NumberProvider | null {
    if (value === null) {
      return null;
    }

    if (isCollection(value)) {
      return createNumberProvider(getString(value, 'm_nType', 'PF_TYPE_LITERAL'), this.nested(value));
    }

    // A value that is not a block is a literal; a string that does not parse, empty included, is zero
    return new LiteralNumberProvider(f32(coerceDouble(value, 0)));
  }

  vectorProvider(key: string, defaultValue: VectorProvider): VectorProvider {
    return hasKey(this.data, key) ? this.readVectorProvider(key, this.data[key]) : defaultValue;
  }

  private readVectorProvider(key: string, value: KVValue): VectorProvider {
    if (value === 'pvec_color_white') {
      return new LiteralColorVectorProvider(new Vector3(255, 255, 255));
    }

    if (value === 'pvec_color_black') {
      return new LiteralColorVectorProvider(Vector3.zero);
    }

    if (isCollection(value)) {
      return createVectorProvider(getString(value, 'm_nType', 'PVEC_TYPE_LITERAL'), this.nested(value));
    }

    return new LiteralVectorProvider(this.readVector3(key, value));
  }

  transformInput(key: string, defaultValue: TransformProvider): TransformProvider {
    return hasKey(this.data, key) ? createTransformProvider(this.data[key], this) : defaultValue;
  }
}

/**
 * KVObjectExtensions.NormalizeEnumName: VALVE_ENUM_SOME_VALUE to SomeValue, dropping underscores and
 * digits, and the C# enum's own name when the value starts with it.
 */
export function normalizeEnumName(name: string, enumTypeName: string, stripExtension = ''): string {
  let typeName = enumTypeName;

  if (stripExtension !== '' && typeName.endsWith(stripExtension)) {
    typeName = typeName.slice(0, -stripExtension.length);
  }

  let result = '';
  let i = 0;
  let nextUpper = true;
  let startsWithEnumTypeName = true;

  for (const c of name) {
    if (c === '_' || (c >= '0' && c <= '9')) {
      nextUpper = true;
      continue;
    }

    const cs = nextUpper ? c.toUpperCase() : c.toLowerCase();
    result += cs;

    if (i < typeName.length && cs !== typeName[i]) {
      startsWithEnumTypeName = false;
    }

    nextUpper = false;
    i++;
  }

  if (startsWithEnumTypeName) {
    result = result.slice(typeName.length);
  }

  return result;
}
